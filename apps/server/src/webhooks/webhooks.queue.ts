import { Processor } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { WebhooksService, WebhookJobData } from './webhooks.service'
import { QueueFor } from '@nuvix/utils'
import { Logger } from '@nestjs/common'
import { Queue } from '@nuvix/core/resolvers'

@Processor(QueueFor.WEBHOOKS, { concurrency: 100 })
export class WebhooksQueue extends Queue {
  private readonly logger = new Logger(WebhooksQueue.name)

  constructor(private readonly webhooksService: WebhooksService) {
    super()
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    this.logger.debug(
      `Processing webhook delivery: ${job.data.webhookId} for event ${job.data.event}`,
    )

    await this.webhooksService.deliverWebhook(job)
  }
}
