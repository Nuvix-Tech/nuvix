import { type BatchQueue, createBatchQueue } from './batch'

export interface AuditLogRecord {
  readonly projectId: string
  readonly userId?: string
  readonly event: string
  readonly resource: string
  readonly ip?: string
  readonly userAgent?: string
  readonly data?: Record<string, unknown>
  readonly timestamp: string
}

export interface AuditsBatchQueueOptions {
  readonly batchSize?: number
  readonly intervalMs?: number
  readonly persist: (batch: AuditLogRecord[]) => Promise<void>
  readonly onError?: (error: unknown, batch: AuditLogRecord[]) => void
}

export type AuditsBatchQueue = BatchQueue<AuditLogRecord>

export function createAuditsBatchQueue(options: AuditsBatchQueueOptions): AuditsBatchQueue {
  return createBatchQueue<AuditLogRecord>({
    batchSize: options.batchSize ?? 500,
    intervalMs: options.intervalMs ?? 3000,
    persist: options.persist,
    onError: options.onError,
  })
}
