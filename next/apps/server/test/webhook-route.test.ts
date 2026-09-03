import { describe, expect, test } from 'bun:test'
import { Doc, type Session } from '@nuvix/db'
import { Elysia } from 'elysia'
import type { ProjectAuthContext } from '../src/context/project'
import type { DatabaseRequestCapabilities } from '../src/infrastructure/database-composition'
import { problemErrors } from '../src/plugins/errors'
import type { WebhookDispatcher } from '../src/webhooks/dispatcher'
import { WEBHOOK_MODEL } from '../src/webhooks/model'
import { webhookRoutes } from '../src/webhooks/route'
import { createWebhookService } from '../src/webhooks/service'

function createMockWebhookEnvironment() {
  const webhooks = new Map<string, Doc>()
  const logs = new Map<string, Doc>()

  const session = {
    find: async (col: string) => {
      if (col === WEBHOOK_MODEL.collections.webhooks) return Array.from(webhooks.values())
      if (col === WEBHOOK_MODEL.collections.webhookLogs) return Array.from(logs.values())
      return []
    },
    getDocument: async (col: string, id: string) => {
      if (col === WEBHOOK_MODEL.collections.webhooks) {
        const doc = webhooks.get(id)
        return doc ?? new Doc({})
      }
      if (col === WEBHOOK_MODEL.collections.webhookLogs) {
        const doc = logs.get(id)
        return doc ?? new Doc({})
      }
      return new Doc({})
    },
    createDocument: async (col: string, doc: Doc) => {
      if (col === WEBHOOK_MODEL.collections.webhooks) webhooks.set(doc.getId(), doc)
      if (col === WEBHOOK_MODEL.collections.webhookLogs) logs.set(doc.getId(), doc)
      return doc
    },
    updateDocument: async (col: string, id: string, doc: Doc) => {
      if (col === WEBHOOK_MODEL.collections.webhooks) webhooks.set(id, doc)
      if (col === WEBHOOK_MODEL.collections.webhookLogs) logs.set(id, doc)
      return doc
    },
    deleteDocument: async (col: string, id: string) => {
      if (col === WEBHOOK_MODEL.collections.webhooks) return webhooks.delete(id)
      if (col === WEBHOOK_MODEL.collections.webhookLogs) return logs.delete(id)
      return false
    },
    count: async () => 0,
  }

  const dispatcher: WebhookDispatcher = {
    async dispatch(_target, _event) {
      return {
        success: true,
        statusCode: 200,
        durationMs: 25,
        response: '{"received":true}',
      }
    },
  }

  return { session, dispatcher, webhooks, logs }
}

const FULL_AUTH: ProjectAuthContext = {
  type: 'apiKey',
  keyId: 'key_full',
  mode: 'admin',
  scopes: ['webhooks.read', 'webhooks.write'],
}

const READ_ONLY_AUTH: ProjectAuthContext = {
  type: 'apiKey',
  keyId: 'key_ro',
  mode: 'admin',
  scopes: ['webhooks.read'],
}

function buildTestApp(currentAuth: () => ProjectAuthContext) {
  const env = createMockWebhookEnvironment()
  const requests: DatabaseRequestCapabilities = {
    withProject: async (_headers, handler) =>
      handler({
        auth: currentAuth(),
        session: env.session as unknown as Session,
        project: {} as never,
        schemas: {} as never,
        account: {} as never,
      }),
  }

  return new Elysia({ prefix: '/v2' })
    .use(problemErrors({ getTranslator: () => ({ t: (k: string) => k }) as never }))
    .use(
      webhookRoutes({
        requests,
        dispatcher: env.dispatcher,
        service: createWebhookService(),
      }),
    )
}

describe('Webhook Routes', () => {
  let activeAuth = FULL_AUTH
  const app = buildTestApp(() => activeAuth)

  test('webhook lifecycle: create, list, get, update, rotate signature, test, logs, delete', async () => {
    activeAuth = FULL_AUTH

    // 1. Create webhook
    const resCreate = await app.handle(
      new Request('http://localhost/v2/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          webhookId: 'wh_deploy',
          name: 'Deploy Notifications',
          events: ['storage.*'],
          url: 'https://api.github.com/webhook',
          security: true,
        }),
      }),
    )
    expect(resCreate.status).toBe(201)
    const created = (await resCreate.json()) as { $id: string; signatureKey: string; name: string }
    expect(created.$id).toBe('wh_deploy')
    expect(created.name).toBe('Deploy Notifications')
    expect(created.signatureKey).toBeString()

    // 2. List webhooks
    const resList = await app.handle(new Request('http://localhost/v2/webhooks', { method: 'GET' }))
    expect(resList.status).toBe(200)
    const list = (await resList.json()) as { total: number; webhooks: { $id: string }[] }
    expect(list.total).toBe(1)
    expect(list.webhooks[0]?.$id).toBe('wh_deploy')

    // 3. Get webhook
    const resGet = await app.handle(
      new Request('http://localhost/v2/webhooks/wh_deploy', { method: 'GET' }),
    )
    expect(resGet.status).toBe(200)
    const fetched = (await resGet.json()) as { $id: string }
    expect(fetched.$id).toBe('wh_deploy')

    // 4. Update webhook
    const resUpdate = await app.handle(
      new Request('http://localhost/v2/webhooks/wh_deploy', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Deployments V2' }),
      }),
    )
    expect(resUpdate.status).toBe(200)
    const updated = (await resUpdate.json()) as { name: string }
    expect(updated.name).toBe('Deployments V2')

    // 5. Rotate signature key
    const resRotate = await app.handle(
      new Request('http://localhost/v2/webhooks/wh_deploy/signature', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(resRotate.status).toBe(200)
    const rotated = (await resRotate.json()) as { signatureKey: string }
    expect(rotated.signatureKey).not.toBe(created.signatureKey)

    // 6. Test dispatch
    const resTest = await app.handle(
      new Request('http://localhost/v2/webhooks/wh_deploy/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'ping' }),
      }),
    )
    expect(resTest.status).toBe(200)
    const testReport = (await resTest.json()) as { success: boolean; statusCode: number }
    expect(testReport.success).toBe(true)
    expect(testReport.statusCode).toBe(200)

    // 7. Get logs
    const resLogs = await app.handle(
      new Request('http://localhost/v2/webhooks/wh_deploy/logs', { method: 'GET' }),
    )
    expect(resLogs.status).toBe(200)
    const logsBody = (await resLogs.json()) as { total: number; logs: { webhookId: string }[] }
    expect(logsBody.total).toBe(1)
    expect(logsBody.logs[0]?.webhookId).toBe('wh_deploy')

    // 8. Scope enforcement: read-only auth cannot delete
    activeAuth = READ_ONLY_AUTH
    const resForbidden = await app.handle(
      new Request('http://localhost/v2/webhooks/wh_deploy', { method: 'DELETE' }),
    )
    expect(resForbidden.status).toBe(403)

    // 9. Delete webhook with write auth
    activeAuth = FULL_AUTH
    const resDelete = await app.handle(
      new Request('http://localhost/v2/webhooks/wh_deploy', { method: 'DELETE' }),
    )
    expect(resDelete.status).toBe(204)
  })
})
