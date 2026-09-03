import { Doc, Query } from '@nuvix/db'
import { ConflictError, NotFoundError } from '../shared/errors'
import type { CreateWebhookInput, TestWebhookInput, UpdateWebhookInput } from './contracts'
import type { WebhookDeliveryReport, WebhookDeliveryTarget, WebhookDispatcher } from './dispatcher'
import type { WebhookDocuments } from './documents'
import { webhookSubscribesToEvent } from './matcher'
import { WEBHOOK_MODEL, type WebhookModel } from './model'
import { validateWebhookUrl } from './validator'

export interface WebhookService {
  createWebhook(documents: WebhookDocuments, input: CreateWebhookInput): Promise<Doc>
  listWebhooks(documents: WebhookDocuments): Promise<Doc[]>
  getWebhook(documents: WebhookDocuments, id: string): Promise<Doc>
  updateWebhook(documents: WebhookDocuments, id: string, input: UpdateWebhookInput): Promise<Doc>
  rotateSignature(documents: WebhookDocuments, id: string): Promise<Doc>
  deleteWebhook(documents: WebhookDocuments, id: string): Promise<void>

  testWebhook(
    documents: WebhookDocuments,
    dispatcher: WebhookDispatcher,
    id: string,
    input?: TestWebhookInput,
  ): Promise<WebhookDeliveryReport>

  dispatchMatchingWebhooks(
    documents: WebhookDocuments,
    dispatcher: WebhookDispatcher,
    event: string,
    data: unknown,
  ): Promise<WebhookDeliveryReport[]>

  listLogs(
    documents: WebhookDocuments,
    webhookId: string,
    limit?: number,
    offset?: number,
  ): Promise<Doc[]>
}

export interface WebhookServiceDependencies {
  model?: WebhookModel
  now?: () => Date
  createId?: () => string
  generateSignatureKey?: () => string
}

function defaultGenerateKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('hex')
}

export function createWebhookService({
  model = WEBHOOK_MODEL,
  now = () => new Date(),
  createId = () => crypto.randomUUID(),
  generateSignatureKey = defaultGenerateKey,
}: WebhookServiceDependencies = {}): WebhookService {
  const { fields } = model

  return {
    async createWebhook(documents, input) {
      validateWebhookUrl(input.url)

      const webhookId =
        input.webhookId && input.webhookId !== 'unique()' ? input.webhookId : createId()

      try {
        const existing = await documents.getWebhook(webhookId)
        if (existing?.getId()) {
          throw new ConflictError(`Webhook with id "${webhookId}" already exists`, {
            code: 'webhook_already_exists',
          })
        }
      } catch (err) {
        if (err instanceof ConflictError) throw err
      }

      const signatureKey = generateSignatureKey()
      const doc = new Doc({
        $id: webhookId,
        [fields.webhooks.name]: input.name,
        [fields.webhooks.events]: input.events,
        [fields.webhooks.url]: input.url,
        [fields.webhooks.security]: input.security ?? true,
        [fields.webhooks.httpUser]: input.httpUser ?? '',
        [fields.webhooks.httpPass]: input.httpPass ?? '',
        [fields.webhooks.signatureKey]: signatureKey,
        [fields.webhooks.enabled]: input.enabled ?? true,
        [fields.webhooks.attempts]: 0,
        [fields.webhooks.logs]: '',
        $createdAt: now().toISOString(),
        $updatedAt: now().toISOString(),
      })

      return await documents.createWebhook(doc)
    },

    async listWebhooks(documents) {
      return await documents.findWebhooks()
    },

    async getWebhook(documents, id) {
      try {
        const doc = await documents.getWebhook(id)
        if (!doc?.getId()) {
          throw new NotFoundError('Webhook not found', { code: 'webhook_not_found' })
        }
        return doc
      } catch (err) {
        if (err instanceof NotFoundError) throw err
        throw new NotFoundError('Webhook not found', { code: 'webhook_not_found' })
      }
    },

    async updateWebhook(documents, id, input) {
      const webhook = await this.getWebhook(documents, id)

      if (input.url !== undefined) {
        validateWebhookUrl(input.url)
        webhook.set(fields.webhooks.url, input.url)
      }
      if (input.name !== undefined) {
        webhook.set(fields.webhooks.name, input.name)
      }
      if (input.events !== undefined) {
        webhook.set(fields.webhooks.events, input.events)
      }
      if (input.security !== undefined) {
        webhook.set(fields.webhooks.security, input.security)
      }
      if (input.httpUser !== undefined) {
        webhook.set(fields.webhooks.httpUser, input.httpUser)
      }
      if (input.httpPass !== undefined) {
        webhook.set(fields.webhooks.httpPass, input.httpPass)
      }
      if (input.enabled !== undefined) {
        webhook.set(fields.webhooks.enabled, input.enabled)
        if (input.enabled) {
          webhook.set(fields.webhooks.attempts, 0)
        }
      }

      webhook.set('$updatedAt', now().toISOString())
      return await documents.updateWebhook(webhook)
    },

    async rotateSignature(documents, id) {
      const webhook = await this.getWebhook(documents, id)
      const newKey = generateSignatureKey()
      webhook.set(fields.webhooks.signatureKey, newKey)
      webhook.set('$updatedAt', now().toISOString())
      return await documents.updateWebhook(webhook)
    },

    async deleteWebhook(documents, id) {
      await this.getWebhook(documents, id)
      await documents.deleteWebhook(id)
      await documents.deleteLogsForWebhook(id)
    },

    async testWebhook(documents, dispatcher, id, input) {
      const webhook = await this.getWebhook(documents, id)
      const event = input?.event || 'test.ping'
      const data = input?.data ?? { test: true, timestamp: now().toISOString() }

      const target: WebhookDeliveryTarget = {
        id: webhook.getId(),
        url: webhook.get(fields.webhooks.url),
        security: webhook.get(fields.webhooks.security) ?? true,
        httpUser: webhook.get(fields.webhooks.httpUser) || undefined,
        httpPass: webhook.get(fields.webhooks.httpPass) || undefined,
        signatureKey: webhook.get(fields.webhooks.signatureKey),
      }

      const report = await dispatcher.dispatch(target, event, data)

      // Create log document
      const logDoc = new Doc({
        $id: createId(),
        [fields.webhookLogs.webhookId]: webhook.getId(),
        [fields.webhookLogs.event]: event,
        [fields.webhookLogs.success]: report.success,
        [fields.webhookLogs.statusCode]: report.statusCode ?? null,
        [fields.webhookLogs.response]: report.response ?? '',
        [fields.webhookLogs.error]: report.error ?? '',
        [fields.webhookLogs.durationMs]: report.durationMs,
        [fields.webhookLogs.timestamp]: now().toISOString(),
      })
      await documents.createLog(logDoc)

      // Update attempts / logs counter on webhook
      if (report.success) {
        webhook.set(fields.webhooks.attempts, 0)
      } else {
        const currentAttempts = Number(webhook.get(fields.webhooks.attempts) || 0)
        webhook.set(fields.webhooks.attempts, currentAttempts + 1)
        webhook.set(fields.webhooks.logs, report.error || 'Delivery failed')
      }
      webhook.set('$updatedAt', now().toISOString())
      await documents.updateWebhook(webhook)

      return report
    },

    async dispatchMatchingWebhooks(documents, dispatcher, event, data) {
      const allWebhooks = await documents.findWebhooks([
        Query.equal(fields.webhooks.enabled, [true]),
      ])

      const matching = allWebhooks.filter((wh) => {
        const events = (wh.get(fields.webhooks.events) as string[]) || []
        return webhookSubscribesToEvent(events, event)
      })

      const reports: WebhookDeliveryReport[] = []
      for (const webhook of matching) {
        const target: WebhookDeliveryTarget = {
          id: webhook.getId(),
          url: webhook.get(fields.webhooks.url),
          security: webhook.get(fields.webhooks.security) ?? true,
          httpUser: webhook.get(fields.webhooks.httpUser) || undefined,
          httpPass: webhook.get(fields.webhooks.httpPass) || undefined,
          signatureKey: webhook.get(fields.webhooks.signatureKey),
        }

        const report = await dispatcher.dispatch(target, event, data)
        reports.push(report)

        const logDoc = new Doc({
          $id: createId(),
          [fields.webhookLogs.webhookId]: webhook.getId(),
          [fields.webhookLogs.event]: event,
          [fields.webhookLogs.success]: report.success,
          [fields.webhookLogs.statusCode]: report.statusCode ?? null,
          [fields.webhookLogs.response]: report.response ?? '',
          [fields.webhookLogs.error]: report.error ?? '',
          [fields.webhookLogs.durationMs]: report.durationMs,
          [fields.webhookLogs.timestamp]: now().toISOString(),
        })
        await documents.createLog(logDoc)

        if (report.success) {
          webhook.set(fields.webhooks.attempts, 0)
        } else {
          const currentAttempts = Number(webhook.get(fields.webhooks.attempts) || 0)
          webhook.set(fields.webhooks.attempts, currentAttempts + 1)
          webhook.set(fields.webhooks.logs, report.error || 'Delivery failed')
        }
        webhook.set('$updatedAt', now().toISOString())
        await documents.updateWebhook(webhook)
      }

      return reports
    },

    async listLogs(documents, webhookId, limit = 25, offset = 0) {
      await this.getWebhook(documents, webhookId)

      return await documents.findLogs([
        Query.equal(fields.webhookLogs.webhookId, [webhookId]),
        Query.orderDesc(fields.webhookLogs.timestamp),
        Query.limit(limit),
        Query.offset(offset),
      ])
    },
  }
}
