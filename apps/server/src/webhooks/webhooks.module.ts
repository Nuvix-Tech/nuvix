import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { QueueFor } from '@nuvix/utils'
import { WebhooksService } from './webhooks.service'
import { WebhooksController } from './webhooks.controller'
import { WebhooksEventListener } from './webhooks.event-listener'
import { WebhooksQueue } from './webhooks.queue'

@Module({
  imports: [
    BullModule.registerQueue({
      name: QueueFor.WEBHOOKS,
    }),
  ],
  providers: [
    WebhooksService,
    WebhooksEventListener,
    WebhooksQueue,
  ],
  controllers: [
    WebhooksController,
  ],
  exports: [
    WebhooksService,
  ],
})
export class WebhooksModule {}