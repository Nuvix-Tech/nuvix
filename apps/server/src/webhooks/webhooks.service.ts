import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { CoreService } from '@nuvix/core'
import { Database, Doc, ID, Query } from '@nuvix/db'
import { QueueFor } from '@nuvix/utils'
import type { WebhookLogs, WebhooksDoc } from '@nuvix/utils/types'
import { Queue, Job } from 'bullmq'
import { createHmac } from 'crypto'

export function eventMatchesPattern(event: string, pattern: string): boolean {
  if (!pattern || !event) {
    return false
  }

  if (pattern === '*') {
    return true
  }

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  const regexString = `^${escaped.replace(/\*/g, '.*')}$`
  const matcher = new RegExp(regexString)

  return matcher.test(event)
}

export function webhookSubscribesToEvent(
  webhook: WebhooksDoc,
  event: string,
): boolean {
  const events = webhook.get('events', [])
  return events.some((pattern: string) => eventMatchesPattern(event, pattern))
}

export interface WebhookJobData {
  webhookId: string
  webhookInternalId: number
  projectId: string
  event: string
  payload: any
  attempts: number
}

@Injectable()
export class WebhooksService implements OnModuleInit {
  private readonly logger = new Logger(WebhooksService.name)
  private readonly db: Database

  constructor(
    private readonly coreService: CoreService,
    @InjectQueue(QueueFor.WEBHOOKS)
    private readonly webhooksQueue: Queue<WebhookJobData>,
  ) {
    this.db = this.coreService.getInternalDatabase()
  }

  async onModuleInit() {
    // Start processing webhook deliveries
    this.logger.log('Webhook delivery system initialized')
  }

  /**
   * Get all active webhooks for a project that subscribe to a specific event
   */
  async getActiveWebhooksForEvent(
    projectId: string,
    event: string,
  ): Promise<WebhooksDoc[]> {
    const project = await this.db.findOne('projects', [
      Query.equal('projectId', [projectId]),
    ])

    if (project.empty()) {
      this.logger.warn(`Project not found: ${projectId}`)
      return []
    }

    const webhooks = await this.db.find('webhooks', [
      Query.equal('projectInternalId', [project.getSequence()]),
      Query.equal('enabled', [true]),
      Query.limit(100), // Reasonable limit for webhooks per project
    ])

    // Filter webhooks that subscribe to this event via wildcard-aware matching
    return webhooks.filter((webhook: WebhooksDoc) =>
      webhookSubscribesToEvent(webhook, event),
    )
  }

  /**
   * Queue webhook delivery for all matching webhooks
   */
  async queueWebhookDelivery(
    event: string,
    payload: any,
    projectId: string,
  ): Promise<void> {
    const webhooks = await this.getActiveWebhooksForEvent(projectId, event)

    if (webhooks.length === 0) {
      return // No webhooks subscribed to this event
    }

    const jobs = webhooks.map(webhook => ({
      name: 'deliver',
      data: {
        webhookId: webhook.getId(),
        webhookInternalId: webhook.getSequence(),
        projectId,
        event,
        payload,
        attempts: 0,
      } as WebhookJobData,
      opts: {
        attempts: 5, // Retry up to 5 times
        backoff: {
          type: 'exponential',
          delay: 1000, // Start with 1 second delay
        },
        removeOnComplete: {
          age: 3600, // Keep successful jobs for 1 hour
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours for debugging
        },
      },
    }))

    await this.webhooksQueue.addBulk(jobs)

    this.logger.debug(
      `Queued ${jobs.length} webhook deliveries for event: ${event}`,
    )
  }

  /**
   * Generate HMAC-SHA256 signature for webhook payload
   */
  generateSignature(secret: string, payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex')
  }

  /**
   * Log webhook delivery attempt
   */
  async logDelivery(
    webhookInternalId: number,
    webhookId: string,
    success: boolean,
    statusCode?: number,
    response?: string,
    error?: string,
  ): Promise<void> {
    try {
      const deliveryLog = new Doc<WebhookLogs>({
        $id: ID.unique(),
        webhookInternalId: webhookInternalId,
        timestamp: new Date().toISOString(),
        success,
        statusCode: statusCode ?? null,
        response: response?.substring(0, 1000) ?? null, // Truncate large responses
        error: error?.substring(0, 1000) ?? null,
      })

      await this.db.createDocument('webhook_logs', deliveryLog)

      // Update webhook attempts counter
      const webhook = await this.db.getDocument('webhooks', webhookId)
      if (!webhook.empty()) {
        if (success) {
          webhook.set('attempts', 0) // Reset on success
        } else {
          const currentAttempts = webhook.get('attempts', 0)
          webhook.set('attempts', currentAttempts + 1)
          webhook.set('logs', error?.substring(0, 500) ?? 'Unknown error')
        }
        await this.db.updateDocument('webhooks', webhook.getId(), webhook)
      }
    } catch (err) {
      this.logger.error('Failed to log webhook delivery', err)
    }
  }

  /**
   * Process a single webhook delivery
   */
  async deliverWebhook(job: Job<WebhookJobData>): Promise<void> {
    const { webhookId, webhookInternalId, event, payload, attempts } = job.data

    try {
      const webhook = await this.db.getDocument('webhooks', webhookId)
      if (webhook.empty()) {
        this.logger.warn(`Webhook not found: ${webhookId}`)
        return // Don't retry if webhook doesn't exist
      }

      if (!webhook.get('enabled', true)) {
        this.logger.debug(`Webhook disabled: ${webhookId}`)
        return // Don't retry if disabled
      }

      const url = webhook.get('url', '')
      const secret = webhook.get('signatureKey', '')
      const security = webhook.get('security', true)
      const httpUser = webhook.get('httpUser', '')
      const httpPass = webhook.get('httpPass', '')

      if (!url) {
        throw new Error('Webhook URL is not set')
      }

      // Prepare payload
      const webhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        data: payload,
      }

      const payloadString = JSON.stringify(webhookPayload)
      const signature = this.generateSignature(secret, payloadString)

      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': event,
        'X-Webhook-ID': webhookId,
      }

      // Add basic auth if configured
      const authHeader =
        httpUser && httpPass
          ? `Basic ${Buffer.from(`${httpUser}:${httpPass}`).toString('base64')}`
          : undefined

      if (authHeader) {
        headers['Authorization'] = authHeader
      }

      // Make the request
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: AbortSignal.timeout(10000), // 10 second timeout
        ...(security ? {} : { agent: this.createInsecureAgent() }),
      })

      const responseBody = await response.text()

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${responseBody.substring(0, 200)}`,
        )
      }

      // Log successful delivery
      await this.logDelivery(
        webhook.getSequence(),
        webhookId,
        true,
        response.status,
        responseBody,
      )

      this.logger.debug(
        `Webhook delivered successfully: ${webhookId} -> ${url}`,
      )
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      // Log failed delivery
      await this.logDelivery(
        webhookInternalId,
        webhookId,
        false,
        undefined,
        undefined,
        errorMessage,
      )

      this.logger.warn(
        `Webhook delivery failed (attempt ${attempts + 1}): ${webhookId} - ${errorMessage}`,
      )

      // Re-throw to trigger retry
      throw error
    }
  }

  /**
   * Create an HTTPS agent that skips certificate verification (for development)
   */
  private createInsecureAgent() {
    // Only import in Node.js environment
    if (typeof process !== 'undefined' && process.versions?.node) {
      const https = require('https')
      return new https.Agent({ rejectUnauthorized: false })
    }
    return undefined
  }
}
