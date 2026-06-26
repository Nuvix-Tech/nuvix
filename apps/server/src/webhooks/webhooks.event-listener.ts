import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { WebhooksService } from './webhooks.service'
import { AppEvents } from '@nuvix/utils'

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
      const projectId = this.extractProjectId(payload)

      if (!projectId) {
        // No project context, skip webhook delivery
        return
      }

      // Queue webhook delivery for all matching webhooks
      await this.webhooksService.queueWebhookDelivery(
        event,
        payload,
        projectId,
      )
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

    return internalEvents.some((prefix) => event.startsWith(prefix))
  }

  /**
   * Extract project ID from event payload
   */
  private extractProjectId(payload: any): string | null {
    if (!payload || typeof payload !== 'object') {
      return null
    }

    // Try common project ID field names
    const projectFields = [
      'projectId',
      'projectInternalId',
      'project',
      'project_id',
    ]

    for (const field of projectFields) {
      if (payload[field]) {
        return payload[field]
      }

      // Check nested in metadata
      if (payload.metadata?.projectId) {
        return payload.metadata.projectId
      }

      // Check in context
      if (payload.context?.project) {
        return payload.context.project
      }
    }

    // Try to extract from entity if present
    if (payload.payload?.data?.$permissions) {
      // This is likely a document event, project might be in the document
      return null // Would need to query the document to get project
    }

    return null
  }
}