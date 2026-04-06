import { Processor } from '@nestjs/bullmq'
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common'
import { type Database, Doc, TransactionException } from '@nuvix/db'
import {
  configuration,
  fnv1a128,
  MetricFor,
  MetricPeriod,
  QueueFor,
} from '@nuvix/utils'
import type { Stats } from '@nuvix/utils/types'
import { Job } from 'bullmq'
import { CoreService } from '../../core.service.js'
import { AbstractBatchQueue } from './batch.queue.js'

@Injectable()
@Processor(QueueFor.STATS, { concurrency: 10 })
export class StatsQueue extends AbstractBatchQueue<
  Array<{ key: MetricFor; value: number }>,
  StatsQueueOptions
> {
  protected readonly logger = new Logger(StatsQueue.name)

  protected readonly batchSize = configuration.limits.batchSize || 5000

  protected readonly batchIntervalMs =
    configuration.limits.batchIntervalMs || 3000

  private static readonly periods = [
    MetricPeriod.INF,
    MetricPeriod.HOUR,
    MetricPeriod.DAY,
  ] as const

  private readonly db: Database

  constructor(
    @Inject(forwardRef(() => CoreService))
    private readonly coreService: CoreService,
  ) {
    super()
    this.db = this.coreService.getDatabase()
  }

  /**
   * Build item from job
   * Each job returns an array of metrics
   */
  protected async buildItem(
    job: Job<StatsQueueOptions>,
  ): Promise<Array<{ key: MetricFor; value: number }>> {
    const { metrics, reduce } = job.data

    const working = [...metrics]

    if (reduce?.length) {
      for (const doc of reduce) {
        if (doc.empty()) continue

        const collection = doc.getCollection()

        if (collection === 'users') {
          const sessions = doc.get('sessions', [])?.length || 0

          if (sessions > 0) {
            working.push({
              key: MetricFor.SESSIONS,
              value: sessions * -1,
            })
          }
        }

        if (collection === 'buckets') {
          const id = doc.getSequence().toString()

          const filesDoc = await this.db.getDocument(
            'stats',
            fnv1a128(
              `${MetricPeriod.INF}|${MetricFor.BUCKET_ID_FILES.replace(
                '{bucketInternalId}',
                id,
              )}`,
            ),
          )

          const storageDoc = await this.db.getDocument(
            'stats',
            fnv1a128(
              `${MetricPeriod.INF}|${MetricFor.BUCKET_ID_FILES_STORAGE.replace(
                '{bucketInternalId}',
                id,
              )}`,
            ),
          )

          if (filesDoc?.get('value')) {
            working.push({
              key: MetricFor.FILES,
              value: filesDoc.get('value') * -1,
            })
          }

          if (storageDoc?.get('value')) {
            working.push({
              key: MetricFor.FILES_STORAGE,
              value: storageDoc.get('value') * -1,
            })
          }
        }
      }
    }

    return working
  }

  /**
   * Persist receives batch of metric arrays
   * We aggregate them before writing
   */
  protected async persist(
    batch: Array<Array<{ key: MetricFor; value: number }>>,
  ): Promise<void> {
    // Aggregate all metrics in this batch
    const accumulator: Record<string, number> = {}

    for (const metrics of batch) {
      for (const { key, value } of metrics) {
        accumulator[key] = (accumulator[key] ?? 0) + value
      }
    }

    const receivedAt = new Date()
    const docs: Doc<Stats>[] = []

    for (const [key, value] of Object.entries(accumulator) as [
      MetricFor,
      number,
    ][]) {
      if (value === 0) continue

      for (const period of StatsQueue.periods) {
        const time = StatsQueue.formatDate(period, receivedAt)

        const id = fnv1a128(`${time}|${period}|${key}`)

        docs.push(
          new Doc<Stats>({
            $id: id,
            time,
            period,
            metric: key,
            value,
            region: 'local',
          }),
        )
      }
    }

    if (docs.length === 0) return

    this.logger.log(`Flushing ${docs.length} stats`)

    await this.db
      .createOrUpdateDocumentsWithIncrease('stats', 'value', docs)
      .catch(err => {
        if (err instanceof TransactionException) {
          return this.db.createOrUpdateDocumentsWithIncrease(
            'stats',
            'value',
            docs,
          )
        }
        throw err
      })
  }

  public static formatDate(
    period: MetricPeriod,
    date: Date | string,
  ): string | null {
    date = typeof date === 'string' ? new Date(date) : date

    switch (period) {
      case MetricPeriod.INF:
        return null

      case MetricPeriod.HOUR:
        return `${date.toISOString().slice(0, 13)}:00:00Z`

      case MetricPeriod.DAY:
        return `${date.toISOString().slice(0, 10)}T00:00:00Z`

      default:
        throw new Error(`Unsupported period: ${period}`)
    }
  }
}

export interface StatsQueueOptions {
  metrics: Array<{ key: MetricFor; value: number }>
  reduce?: Doc<any>[]
}

export enum StatsQueueJob {
  ADD_METRIC = 'add-metric',
}
