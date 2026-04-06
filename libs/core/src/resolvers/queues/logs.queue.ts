import { Processor } from '@nestjs/bullmq'
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common'
import { DataSource } from '@nuvix/pg'
import { configuration, QueueFor, Schemas } from '@nuvix/utils'
import { Job } from 'bullmq'
import { CoreService } from '../../core.service.js'
import { AbstractBatchQueue } from './batch.queue.js'

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-nuvix-signature',
  'x-nuvix-timestamp',
  'x-nuvix-nonce',
  'secret',
  'token',
  'apikey',
  'x-nuvix-key',
  'x-nuvix-session',
  'x-nuvix-jwt',
])

@Injectable()
@Processor(QueueFor.LOGS, { concurrency: 1000 })
export class ApiLogsQueue extends AbstractBatchQueue<
  ApiLog,
  ApiLogsQueueJobData
> {
  protected readonly logger = new Logger(ApiLogsQueue.name)

  protected readonly batchSize = configuration.limits.batchSize || 5000

  protected readonly batchIntervalMs =
    configuration.limits.batchIntervalMs || 3000

  private readonly dataSource: DataSource

  constructor(
    @Inject(forwardRef(() => CoreService))
    private readonly coreService: CoreService,
  ) {
    super()
    this.dataSource = this.coreService.getDataSourceWithMainPool()
  }

  protected buildItem(job: Job<ApiLogsQueueJobData>): ApiLog {
    return job.data
  }

  private isSensitiveKey(key: string): boolean {
    if (SENSITIVE_KEYS.has(key)) return true

    return (
      key.includes('token') ||
      key.includes('secret') ||
      key.includes('key') ||
      key.includes('password') ||
      key.includes('auth')
    )
  }

  /**
   * Deep recursive redaction for metadata
   */
  private redact(data: any): any {
    if (!data || typeof data !== 'object') return data
    if (Array.isArray(data)) return data.map(v => this.redact(v))

    return Object.keys(data).reduce(
      (acc, key) => {
        const k = key.toLowerCase()
        // Redact sensitive keys at any level of nesting
        if (this.isSensitiveKey(k)) {
          acc[key] = '[REDACTED]'
        } else if (typeof data[key] === 'object') {
          acc[key] = this.redact(data[key])
        } else {
          acc[key] = data[key]
        }
        return acc
      },
      {} as Record<string, any>,
    )
  }

  protected async persist(batch: ApiLog[]): Promise<void> {
    const redactedBatch = batch.map(log => ({
      ...log,
      metadata: this.redact(log.metadata),
    }))

    await this.dataSource
      .table('api_logs')
      .withSchema(Schemas.System)
      .insert(redactedBatch)
    this.logger.log(`Flushed ${batch.length} api logs`)
  }
}

export type ApiLogsQueueJobData = ApiLog

export interface ApiLog {
  request_id: string
  method: string
  path: string
  status: number
  timestamp: Date
  client_ip?: string
  user_agent?: string
  resource: string
  latency_ms?: number
  region?: string
  error?: string
  metadata?: Record<string, any>
}
