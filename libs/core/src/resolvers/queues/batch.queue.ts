import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Job } from 'bullmq'
import { Queue } from './queue'

export abstract class AbstractBatchQueue<T, J = any>
  extends Queue
  implements OnModuleInit, OnModuleDestroy
{
  protected abstract readonly logger: Logger
  protected abstract readonly batchSize: number
  protected abstract readonly batchIntervalMs: number

  private buffer: T[] = []
  private interval!: NodeJS.Timeout
  private flushing = false

  onModuleInit(): void {
    this.start()
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.interval)
    await this.flush()
  }

  async process(job: Job<J>): Promise<void> {
    const item = await this.buildItem(job)
    if (!item) return

    this.buffer.push(item)

    if (this.buffer.length >= this.batchSize) {
      clearInterval(this.interval)
      await this.flush()
      this.start()
    }
  }

  private start(): void {
    this.interval = setInterval(() => void this.flush(), this.batchIntervalMs)
  }

  private async flush(): Promise<void> {
    if (this.flushing) return
    if (this.buffer.length === 0) return

    this.flushing = true

    const snapshot = this.buffer
    this.buffer = []

    try {
      await this.persist(snapshot)
    } catch (error) {
      this.logger.error('Batch persist failed', error)
      this.buffer.unshift(...snapshot)
    } finally {
      this.flushing = false
    }
  }

  protected abstract buildItem(job: Job<J>): Promise<T | null> | T | null
  protected abstract persist(batch: T[]): Promise<void>
}
