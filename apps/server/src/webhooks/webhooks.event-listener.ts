import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { WebhooksService } from './webhooks.service'
import { configuration } from '@nuvix/utils'

@Injectable()
export class WebhooksEventListener {
  private readonly logger = new Logger(WebhooksEventListener.name)

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * Generic event handler that catches all app events and triggers webhook delivery
   */
  @OnEvent('*')
  async handleAllEvents(event: string, payload: any) {
    // Skip internal events that shouldn't trigger webhooks
    if (this.isInternalEvent(event)) {
      return
    }

    try {
      // Extract project ID from payload if available
      const projectId = configuration.app.projectId

      if (!projectId) {
        // No project context, skip webhook delivery
        return
      }

      // Queue webhook delivery for all matching webhooks
      await this.webhooksService.queueWebhookDelivery(event, payload, projectId)
    } catch (error) {
      this.logger.error(
        `Error processing webhook for event ${event}:`,
        error instanceof Error ? error.stack : error,
      )
    }
  }

  /**
   * Check if an event is internal and should not trigger webhooks
   */
  private isInternalEvent(event: string): boolean {
    const internalEvents = [
      'stats.', // Internal stats events
      'logs.', // Internal log events
      'queue.', // Queue system events
      'audit.', // Audit trail events
    ]

    return internalEvents.some(prefix => event.startsWith(prefix))
  }
}
