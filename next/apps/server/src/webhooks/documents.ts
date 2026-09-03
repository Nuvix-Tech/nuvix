import type { Doc, Query, Session } from '@nuvix/db'
import { WEBHOOK_MODEL, type WebhookModel } from './model'

export interface WebhookDocuments {
  findWebhooks(queries?: readonly Query[]): Promise<Doc[]>
  getWebhook(id: string): Promise<Doc>
  createWebhook(doc: Doc): Promise<Doc>
  updateWebhook(doc: Doc): Promise<Doc>
  deleteWebhook(id: string): Promise<boolean>

  findLogs(queries?: readonly Query[]): Promise<Doc[]>
  createLog(doc: Doc): Promise<Doc>
  deleteLogsForWebhook(webhookId: string): Promise<number>
}

export function webhookDocuments(
  session: Session,
  model: WebhookModel = WEBHOOK_MODEL,
): WebhookDocuments {
  const { collections, fields } = model

  return Object.freeze({
    findWebhooks: (queries?: readonly Query[]) =>
      session.find(collections.webhooks, queries ? [...queries] : []),
    getWebhook: (id: string) => session.getDocument(collections.webhooks, id),
    createWebhook: (doc: Doc) => session.createDocument(collections.webhooks, doc),
    updateWebhook: (doc: Doc) => session.updateDocument(collections.webhooks, doc.getId(), doc),
    deleteWebhook: (id: string) => session.deleteDocument(collections.webhooks, id),

    findLogs: (queries?: readonly Query[]) =>
      session.find(collections.webhookLogs, queries ? [...queries] : []),
    createLog: (doc: Doc) => session.createDocument(collections.webhookLogs, doc),
    deleteLogsForWebhook: async (webhookId: string) => {
      // Find and remove all logs associated with the deleted webhook
      const { Query } = await import('@nuvix/db')
      const logs = await session.find(collections.webhookLogs, [
        Query.equal(fields.webhookLogs.webhookId, [webhookId]),
      ])
      let deleted = 0
      for (const log of logs) {
        const ok = await session.deleteDocument(collections.webhookLogs, log.getId())
        if (ok) deleted++
      }
      return deleted
    },
  })
}
