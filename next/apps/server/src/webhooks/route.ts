import type { Doc } from '@nuvix/db'
import { Elysia, t } from 'elysia'
import type { ProjectAuthContext } from '../context/project'
import type { DatabaseRequestCapabilities } from '../infrastructure/database-composition'
import { ForbiddenError } from '../shared/errors'
import {
  CreateWebhookBody,
  TestWebhookBody,
  UpdateWebhookBody,
  WebhookDeliveryReportResponse,
  WebhookId,
  WebhookLogResponse,
  WebhookResponse,
} from './contracts'
import type { WebhookDispatcher } from './dispatcher'
import { webhookDocuments } from './documents'
import { WEBHOOK_MODEL, type WebhookModel } from './model'
import { createWebhookService, type WebhookService } from './service'

export interface WebhookRouteDependencies {
  requests: DatabaseRequestCapabilities
  dispatcher: WebhookDispatcher
  service?: WebhookService
  model?: WebhookModel
}

function assertScopes(auth: ProjectAuthContext, requiredScopes: readonly string[]): void {
  if (auth.type === 'guest') throw new ForbiddenError()
  if (auth.type === 'apiKey') {
    const hasAny = requiredScopes.some((s) => auth.scopes.includes(s))
    if (!hasAny) throw new ForbiddenError()
  }
}

function parseStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === 'string' && val.trim().length > 0) {
    try {
      const parsed = JSON.parse(val)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {}
    if (val.startsWith('{') && val.endsWith('}')) {
      return val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean)
    }
    return [val]
  }
  return []
}

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
    return value
  }
  return new Date().toISOString()
}

function toWebhookResponse(doc: Doc, model: WebhookModel = WEBHOOK_MODEL) {
  const fields = model.fields.webhooks
  return {
    $id: doc.getId(),
    $createdAt: isoDate(doc.get('$createdAt')),
    $updatedAt: isoDate(doc.get('$updatedAt')),
    name: doc.get(fields.name) ?? '',
    events: parseStringArray(doc.get(fields.events)),
    url: doc.get(fields.url) ?? '',
    security: Boolean(doc.get(fields.security) ?? true),
    httpUser: doc.get(fields.httpUser) ?? '',
    signatureKey: doc.get(fields.signatureKey) ?? '',
    enabled: Boolean(doc.get(fields.enabled) ?? true),
    attempts: Number(doc.get(fields.attempts) || 0),
    logs: doc.get(fields.logs) ?? '',
  }
}

function toWebhookLogResponse(doc: Doc, model: WebhookModel = WEBHOOK_MODEL) {
  const fields = model.fields.webhookLogs
  const statusCode = doc.get(fields.statusCode)
  return {
    $id: doc.getId(),
    webhookId: doc.get(fields.webhookId) ?? '',
    event: doc.get(fields.event) ?? '',
    success: Boolean(doc.get(fields.success)),
    statusCode: statusCode !== undefined && statusCode !== null ? Number(statusCode) : null,
    response: doc.get(fields.response) ?? '',
    error: doc.get(fields.error) || null,
    durationMs: Number(doc.get(fields.durationMs) || 0),
    timestamp: isoDate(doc.get(fields.timestamp)),
  }
}

export function webhookRoutes({
  requests,
  dispatcher,
  service = createWebhookService(),
  model = WEBHOOK_MODEL,
}: WebhookRouteDependencies) {
  return (
    new Elysia({ name: 'webhook-routes', prefix: '/webhooks' })
      // ================= Webhooks CRUD =================
      .post(
        '',
        {
          body: CreateWebhookBody,
          response: { 201: WebhookResponse },
          detail: { tags: ['webhooks'] },
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['webhooks.write'])
            set.status = 201
            const doc = await service.createWebhook(webhookDocuments(session, model), body)
            return toWebhookResponse(doc, model)
          }),
      )
      .get(
        '',
        {
          response: {
            200: t.Object({
              total: t.Integer(),
              webhooks: t.Array(WebhookResponse),
            }),
          },
          detail: { tags: ['webhooks'] },
        },
        async ({ request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['webhooks.read'])
            const docs = await service.listWebhooks(webhookDocuments(session, model))
            return {
              total: docs.length,
              webhooks: docs.map((d) => toWebhookResponse(d, model)),
            }
          }),
      )
      .get(
        '/:webhookId',
        {
          params: t.Object({ webhookId: WebhookId }),
          response: { 200: WebhookResponse },
          detail: { tags: ['webhooks'] },
        },
        async ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['webhooks.read'])
            const doc = await service.getWebhook(webhookDocuments(session, model), params.webhookId)
            return toWebhookResponse(doc, model)
          }),
      )
      .put(
        '/:webhookId',
        {
          params: t.Object({ webhookId: WebhookId }),
          body: UpdateWebhookBody,
          response: { 200: WebhookResponse },
          detail: { tags: ['webhooks'] },
        },
        async ({ body, params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['webhooks.write'])
            const doc = await service.updateWebhook(
              webhookDocuments(session, model),
              params.webhookId,
              body,
            )
            return toWebhookResponse(doc, model)
          }),
      )
      .patch(
        '/:webhookId/signature',
        {
          params: t.Object({ webhookId: WebhookId }),
          body: t.Optional(t.Object({})),
          response: { 200: WebhookResponse },
          detail: { tags: ['webhooks'] },
        },
        async ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['webhooks.write'])
            const doc = await service.rotateSignature(
              webhookDocuments(session, model),
              params.webhookId,
            )
            return toWebhookResponse(doc, model)
          }),
      )
      .delete(
        '/:webhookId',
        {
          params: t.Object({ webhookId: WebhookId }),
          response: { 204: t.Null() },
          detail: { tags: ['webhooks'] },
        },
        async ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['webhooks.write'])
            await service.deleteWebhook(webhookDocuments(session, model), params.webhookId)
            set.status = 204
            return null
          }),
      )

      // ================= Delivery Testing & Logs =================
      .post(
        '/:webhookId/test',
        {
          params: t.Object({ webhookId: WebhookId }),
          body: t.Optional(TestWebhookBody),
          response: { 200: WebhookDeliveryReportResponse },
          detail: { tags: ['webhooks'] },
        },
        async ({ body, params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['webhooks.write'])
            return await service.testWebhook(
              webhookDocuments(session, model),
              dispatcher,
              params.webhookId,
              body ?? undefined,
            )
          }),
      )
      .get(
        '/:webhookId/logs',
        {
          params: t.Object({ webhookId: WebhookId }),
          query: t.Object({
            limit: t.Optional(t.Numeric()),
            offset: t.Optional(t.Numeric()),
          }),
          response: {
            200: t.Object({
              total: t.Integer(),
              logs: t.Array(WebhookLogResponse),
            }),
          },
          detail: { tags: ['webhooks'] },
        },
        async ({ params, query, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['webhooks.read'])
            const docs = await service.listLogs(
              webhookDocuments(session, model),
              params.webhookId,
              query.limit ? Number(query.limit) : 25,
              query.offset ? Number(query.offset) : 0,
            )
            return {
              total: docs.length,
              logs: docs.map((d) => toWebhookLogResponse(d, model)),
            }
          }),
      )
  )
}
