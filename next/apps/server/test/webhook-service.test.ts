import { describe, expect, test } from 'bun:test'
import { Doc } from '@nuvix/db'
import type { WebhookDispatcher } from '../src/webhooks/dispatcher'
import type { WebhookDocuments } from '../src/webhooks/documents'
import { WEBHOOK_MODEL } from '../src/webhooks/model'
import { createWebhookService } from '../src/webhooks/service'

function createMemoryWebhookDocuments(): {
  documents: WebhookDocuments
  webhooks: Map<string, Doc>
  logs: Map<string, Doc>
} {
  const webhooks = new Map<string, Doc>()
  const logs = new Map<string, Doc>()

  const documents: WebhookDocuments = {
    async findWebhooks(queries) {
      let results = Array.from(webhooks.values())
      if (queries) {
        for (const q of queries) {
          if (q.getAttribute() === WEBHOOK_MODEL.fields.webhooks.enabled) {
            results = results.filter(
              (w) => w.get(WEBHOOK_MODEL.fields.webhooks.enabled) === q.getValues()[0],
            )
          }
        }
      }
      return results
    },
    async getWebhook(id) {
      const doc = webhooks.get(id)
      if (!doc) return new Doc({})
      return doc
    },
    async createWebhook(doc) {
      webhooks.set(doc.getId(), doc)
      return doc
    },
    async updateWebhook(doc) {
      webhooks.set(doc.getId(), doc)
      return doc
    },
    async deleteWebhook(id) {
      return webhooks.delete(id)
    },
    async findLogs(queries) {
      let results = Array.from(logs.values())
      if (queries) {
        for (const q of queries) {
          if (q.getAttribute() === WEBHOOK_MODEL.fields.webhookLogs.webhookId) {
            results = results.filter(
              (l) => l.get(WEBHOOK_MODEL.fields.webhookLogs.webhookId) === q.getValues()[0],
            )
          }
        }
      }
      return results
    },
    async createLog(doc) {
      logs.set(doc.getId(), doc)
      return doc
    },
    async deleteLogsForWebhook(webhookId) {
      let count = 0
      for (const [id, doc] of logs.entries()) {
        if (doc.get(WEBHOOK_MODEL.fields.webhookLogs.webhookId) === webhookId) {
          logs.delete(id)
          count++
        }
      }
      return count
    },
  }

  return { documents, webhooks, logs }
}

describe('Webhook Service', () => {
  test('creates, gets, updates, rotates signature, and deletes a webhook', async () => {
    const { documents, webhooks } = createMemoryWebhookDocuments()
    const service = createWebhookService()

    // 1. Create webhook
    const created = await service.createWebhook(documents, {
      webhookId: 'wh_slack',
      name: 'Slack Alerts',
      events: ['users.*', 'storage.*'],
      url: 'https://api.slack.com/webhook',
      security: true,
      httpUser: 'bot',
      httpPass: 'token123',
    })

    expect(created.getId()).toBe('wh_slack')
    expect(created.get('name')).toBe('Slack Alerts')
    expect(created.get('events')).toEqual(['users.*', 'storage.*'])
    expect(created.get('signatureKey')).toBeString()
    expect(created.get('signatureKey')).toHaveLength(64)
    expect(created.get('enabled')).toBe(true)

    // 2. Get webhook
    const fetched = await service.getWebhook(documents, 'wh_slack')
    expect(fetched.getId()).toBe('wh_slack')

    // 3. List webhooks
    const list = await service.listWebhooks(documents)
    expect(list).toHaveLength(1)
    expect(list[0]?.getId()).toBe('wh_slack')

    // 4. Update webhook
    const updated = await service.updateWebhook(documents, 'wh_slack', {
      name: 'Renamed Slack Alerts',
      enabled: false,
    })
    expect(updated.get('name')).toBe('Renamed Slack Alerts')
    expect(updated.get('enabled')).toBe(false)

    // 5. Rotate signature key
    const oldKey = updated.get('signatureKey')
    const rotated = await service.rotateSignature(documents, 'wh_slack')
    expect(rotated.get('signatureKey')).not.toBe(oldKey)
    expect(rotated.get('signatureKey')).toHaveLength(64)

    // 6. Delete webhook
    await service.deleteWebhook(documents, 'wh_slack')
    expect(webhooks.has('wh_slack')).toBe(false)
  })

  test('testWebhook dispatches payload and logs the attempt', async () => {
    const { documents, logs } = createMemoryWebhookDocuments()
    const service = createWebhookService()

    await service.createWebhook(documents, {
      webhookId: 'wh_test',
      name: 'Test Webhook',
      events: ['*'],
      url: 'https://webhook.site/uuid',
    })

    const mockDispatcher: WebhookDispatcher = {
      async dispatch(_target, _event, _data) {
        return {
          success: true,
          statusCode: 200,
          durationMs: 35,
          response: '{"status":"ok"}',
        }
      },
    }

    const report = await service.testWebhook(documents, mockDispatcher, 'wh_test', {
      event: 'custom.event',
      data: { ping: 'pong' },
    })

    expect(report.success).toBe(true)
    expect(report.statusCode).toBe(200)
    expect(logs.size).toBe(1)

    const logEntry = Array.from(logs.values())[0]
    expect(logEntry?.get('webhookId')).toBe('wh_test')
    expect(logEntry?.get('event')).toBe('custom.event')
    expect(logEntry?.get('success')).toBe(true)
  })

  test('dispatchMatchingWebhooks delivers only to subscribed webhooks', async () => {
    const { documents, logs } = createMemoryWebhookDocuments()
    const service = createWebhookService()

    await service.createWebhook(documents, {
      webhookId: 'wh_users',
      name: 'User Webhook',
      events: ['users.*'],
      url: 'https://api.external.com/users',
      enabled: true,
    })

    await service.createWebhook(documents, {
      webhookId: 'wh_storage',
      name: 'Storage Webhook',
      events: ['storage.*'],
      url: 'https://api.external.com/storage',
      enabled: true,
    })

    await service.createWebhook(documents, {
      webhookId: 'wh_disabled',
      name: 'Disabled Webhook',
      events: ['users.*'],
      url: 'https://api.external.com/disabled',
      enabled: false,
    })

    const dispatchedTargets: string[] = []
    const mockDispatcher: WebhookDispatcher = {
      async dispatch(target) {
        dispatchedTargets.push(target.id)
        return {
          success: true,
          statusCode: 200,
          durationMs: 20,
        }
      },
    }

    const reports = await service.dispatchMatchingWebhooks(
      documents,
      mockDispatcher,
      'users.create',
      { id: 'u_1' },
    )

    expect(reports).toHaveLength(1)
    expect(dispatchedTargets).toEqual(['wh_users'])
    expect(logs.size).toBe(1)
  })

  test('listLogs retrieves logs for a webhook', async () => {
    const { documents } = createMemoryWebhookDocuments()
    const service = createWebhookService()

    await service.createWebhook(documents, {
      webhookId: 'wh_log_test',
      name: 'Log Test',
      events: ['*'],
      url: 'https://api.example.com/log',
    })

    const mockDispatcher: WebhookDispatcher = {
      async dispatch() {
        return { success: true, statusCode: 200, durationMs: 15 }
      },
    }

    await service.testWebhook(documents, mockDispatcher, 'wh_log_test')
    await service.testWebhook(documents, mockDispatcher, 'wh_log_test')

    const userLogs = await service.listLogs(documents, 'wh_log_test')
    expect(userLogs).toHaveLength(2)
  })
})
