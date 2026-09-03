import { type BatchQueue, createBatchQueue } from './batch'

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-nuvix-signature',
  'x-nuvix-timestamp',
  'x-nuvix-nonce',
  'x-nuvix-key',
  'x-nuvix-session',
  'x-nuvix-jwt',
  'secret',
  'token',
  'apikey',
  'password',
  'pass',
])

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  if (SENSITIVE_KEYS.has(lower)) return true
  return (
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('password') ||
    lower.includes('auth') ||
    lower.includes('apikey')
  )
}

export function redactSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) return data
  if (typeof data !== 'object') return data

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item))
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveData(value)
    } else {
      result[key] = value
    }
  }
  return result
}

export interface ApiLogRecord {
  readonly requestId: string
  readonly projectId?: string
  readonly method: string
  readonly path: string
  readonly status: number
  readonly durationMs: number
  readonly clientIp?: string
  readonly userAgent?: string
  readonly metadata?: Record<string, unknown>
  readonly timestamp: string
}

export interface ApiLogsBatchQueueOptions {
  readonly batchSize?: number
  readonly intervalMs?: number
  readonly persist: (batch: ApiLogRecord[]) => Promise<void>
  readonly onError?: (error: unknown, batch: ApiLogRecord[]) => void
}

export type ApiLogsBatchQueue = BatchQueue<ApiLogRecord>

export function createApiLogsBatchQueue(options: ApiLogsBatchQueueOptions): ApiLogsBatchQueue {
  return createBatchQueue<ApiLogRecord>({
    batchSize: options.batchSize ?? 500,
    intervalMs: options.intervalMs ?? 3000,
    persist: async (batch) => {
      // Apply deep redaction on each record's metadata before persisting
      const redacted = batch.map((item) => ({
        ...item,
        metadata: item.metadata
          ? (redactSensitiveData(item.metadata) as Record<string, unknown>)
          : undefined,
      }))
      await options.persist(redacted)
    },
    onError: options.onError,
  })
}
