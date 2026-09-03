import { type BatchQueue, createBatchQueue } from './batch'

export interface MetricItem {
  readonly key: string
  readonly value: number
  readonly projectId: string
}

export interface AggregatedMetric {
  readonly projectId: string
  readonly key: string
  readonly value: number
  readonly period: 'hour' | 'day' | 'inf'
  readonly timestamp: string
}

export interface StatsBatchQueueOptions {
  readonly batchSize?: number
  readonly intervalMs?: number
  readonly persist: (aggregated: AggregatedMetric[]) => Promise<void>
  readonly onError?: (error: unknown, items: MetricItem[]) => void
}

export function formatMetricTimestamp(period: 'hour' | 'day' | 'inf', date: Date): string {
  switch (period) {
    case 'inf':
      return 'inf'
    case 'hour':
      return `${date.toISOString().slice(0, 13)}:00:00Z`
    case 'day':
      return `${date.toISOString().slice(0, 10)}T00:00:00Z`
  }
}

export type StatsBatchQueue = BatchQueue<MetricItem>

export function createStatsBatchQueue(options: StatsBatchQueueOptions): StatsBatchQueue {
  return createBatchQueue<MetricItem>({
    batchSize: options.batchSize ?? 1000,
    intervalMs: options.intervalMs ?? 3000,
    persist: async (items) => {
      // 1. In-memory aggregation: sum values by (projectId, key)
      const accumulator = new Map<string, { projectId: string; key: string; sum: number }>()

      for (const item of items) {
        const compositeKey = `${item.projectId}:${item.key}`
        const existing = accumulator.get(compositeKey)
        if (existing) {
          existing.sum += item.value
        } else {
          accumulator.set(compositeKey, {
            projectId: item.projectId,
            key: item.key,
            sum: item.value,
          })
        }
      }

      // 2. Expand each accumulated metric into hourly, daily, and total (inf) intervals
      const now = new Date()
      const periods: Array<'hour' | 'day' | 'inf'> = ['hour', 'day', 'inf']
      const aggregated: AggregatedMetric[] = []

      for (const { projectId, key, sum } of accumulator.values()) {
        if (sum === 0) continue
        for (const period of periods) {
          aggregated.push({
            projectId,
            key,
            value: sum,
            period,
            timestamp: formatMetricTimestamp(period, now),
          })
        }
      }

      if (aggregated.length > 0) {
        await options.persist(aggregated)
      }
    },
    onError: options.onError,
  })
}
