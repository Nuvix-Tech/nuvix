import { describe, expect, test } from 'bun:test'
import type { Doc, Query, Session } from '@nuvix/db'
import { Elysia } from 'elysia'
import type { ProjectAuthContext } from '../src/context/project'
import type { DatabaseRequestCapabilities } from '../src/infrastructure/database-composition'
import type { MessagingGateway } from '../src/messaging/gateway'
import { MESSAGING_MODEL } from '../src/messaging/model'
import { messagingRoutes } from '../src/messaging/route'
import { createMessagingService } from '../src/messaging/service'
import { problemErrors } from '../src/plugins/errors'

function createMockMessagingEnvironment() {
  const providers = new Map<string, Doc>()
  const topics = new Map<string, Doc>()
  const subscribers = new Map<string, Doc>()
  const messages = new Map<string, Doc>()

  const session = {
    find: async (col: string, queries: readonly Query[] = []) => {
      let all: Doc[] = []
      if (col === MESSAGING_MODEL.collections.providers) all = [...providers.values()]
      if (col === MESSAGING_MODEL.collections.topics) all = [...topics.values()]
      if (col === MESSAGING_MODEL.collections.subscribers) all = [...subscribers.values()]
      if (col === MESSAGING_MODEL.collections.messages) all = [...messages.values()]

      if (queries.length === 0) return all
      return all.filter((doc) => {
        for (const q of queries) {
          const attr = q.getAttribute()
          const vals = q.getValues()
          if (attr && vals?.length && !vals.includes(doc.get(attr))) {
            return false
          }
        }
        return true
      })
    },
    getDocument: async (col: string, id: string) => {
      let doc: Doc | undefined
      if (col === MESSAGING_MODEL.collections.providers) doc = providers.get(id)
      if (col === MESSAGING_MODEL.collections.topics) doc = topics.get(id)
      if (col === MESSAGING_MODEL.collections.subscribers) doc = subscribers.get(id)
      if (col === MESSAGING_MODEL.collections.messages) doc = messages.get(id)
      if (!doc) throw new Error('Document not found')
      return doc
    },
    createDocument: async (col: string, doc: Doc) => {
      if (col === MESSAGING_MODEL.collections.providers) providers.set(doc.getId(), doc)
      if (col === MESSAGING_MODEL.collections.topics) topics.set(doc.getId(), doc)
      if (col === MESSAGING_MODEL.collections.subscribers) subscribers.set(doc.getId(), doc)
      if (col === MESSAGING_MODEL.collections.messages) messages.set(doc.getId(), doc)
      return doc
    },
    updateDocument: async (col: string, id: string, doc: Doc) => {
      if (col === MESSAGING_MODEL.collections.providers) providers.set(id, doc)
      if (col === MESSAGING_MODEL.collections.topics) topics.set(id, doc)
      if (col === MESSAGING_MODEL.collections.subscribers) subscribers.set(id, doc)
      if (col === MESSAGING_MODEL.collections.messages) messages.set(id, doc)
      return doc
    },
    deleteDocument: async (col: string, id: string) => {
      if (col === MESSAGING_MODEL.collections.providers) return providers.delete(id)
      if (col === MESSAGING_MODEL.collections.topics) return topics.delete(id)
      if (col === MESSAGING_MODEL.collections.subscribers) return subscribers.delete(id)
      if (col === MESSAGING_MODEL.collections.messages) return messages.delete(id)
      return false
    },
    count: async () => 0,
  }

  const gateway: MessagingGateway = {
    async send(req) {
      return {
        deliveredTo: req.recipients.length,
        results: req.recipients.map((r) => ({
          recipient: r,
          status: 'success',
          error: '',
        })),
      }
    },
  }

  return { session, gateway }
}

const FULL_AUTH: ProjectAuthContext = {
  type: 'apiKey',
  keyId: 'key_full',
  mode: 'admin',
  scopes: [
    'providers.read',
    'providers.write',
    'topics.read',
    'topics.write',
    'subscribers.read',
    'subscribers.write',
    'messages.read',
    'messages.write',
  ],
}

const READ_ONLY_AUTH: ProjectAuthContext = {
  type: 'apiKey',
  keyId: 'key_ro',
  mode: 'admin',
  scopes: ['providers.read', 'topics.read', 'subscribers.read', 'messages.read'],
}

function buildTestApp(currentAuth: () => ProjectAuthContext) {
  const env = createMockMessagingEnvironment()
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
      messagingRoutes({
        requests,
        gateway: env.gateway,
        service: createMessagingService(),
      }),
    )
}

describe('Messaging Routes', () => {
  let activeAuth = FULL_AUTH
  const app = buildTestApp(() => activeAuth)

  test('providers endpoints: POST, GET, PUT, DELETE with scope enforcement', async () => {
    activeAuth = FULL_AUTH

    // 1. Create provider
    const resCreate = await app.handle(
      new Request('http://localhost/v2/messaging/providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'mailgun_eu',
          name: 'Mailgun EU',
          type: 'email',
          adapter: 'mailgun',
          options: { apiKey: 'key_123', domain: 'mg.example.com', isEu: true },
        }),
      }),
    )
    expect(resCreate.status).toBe(201)
    const provider = (await resCreate.json()) as { $id: string; adapter: string }
    expect(provider.$id).toBe('mailgun_eu')
    expect(provider.adapter).toBe('mailgun')

    // 2. List providers
    const resList = await app.handle(
      new Request('http://localhost/v2/messaging/providers', { method: 'GET' }),
    )
    expect(resList.status).toBe(200)
    const listBody = (await resList.json()) as { total: number; providers: { $id: string }[] }
    expect(listBody.total).toBe(1)
    expect(listBody.providers[0]?.$id).toBe('mailgun_eu')

    // 3. Update provider
    const resUpdate = await app.handle(
      new Request('http://localhost/v2/messaging/providers/mailgun_eu', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Mailgun Europe' }),
      }),
    )
    expect(resUpdate.status).toBe(200)
    const updated = (await resUpdate.json()) as { name: string }
    expect(updated.name).toBe('Mailgun Europe')

    // 4. Unauthorized write with read-only auth -> 403
    activeAuth = READ_ONLY_AUTH
    const resForbidden = await app.handle(
      new Request('http://localhost/v2/messaging/providers/mailgun_eu', {
        method: 'DELETE',
      }),
    )
    expect(resForbidden.status).toBe(403)

    // 5. Authorized delete
    activeAuth = FULL_AUTH
    const resDelete = await app.handle(
      new Request('http://localhost/v2/messaging/providers/mailgun_eu', {
        method: 'DELETE',
      }),
    )
    expect(resDelete.status).toBe(204)
  })

  test('topics & subscribers endpoints: create topic, subscribe, and list', async () => {
    activeAuth = FULL_AUTH

    // 1. Create topic
    const resTopic = await app.handle(
      new Request('http://localhost/v2/messaging/topics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topicId: 'announcements',
          name: 'Global Announcements',
          description: 'Platform broadcast channel',
        }),
      }),
    )
    expect(resTopic.status).toBe(201)
    const topic = (await resTopic.json()) as { $id: string; total: number }
    expect(topic.$id).toBe('announcements')
    expect(topic.total).toBe(0)

    // 2. Add subscriber
    const resSub = await app.handle(
      new Request('http://localhost/v2/messaging/topics/announcements/subscribers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subscriberId: 'sub_admin',
          target: 'admin@nuvix.io',
          providerType: 'email',
          userName: 'Admin User',
        }),
      }),
    )
    expect(resSub.status).toBe(201)
    const sub = (await resSub.json()) as { $id: string; target: string }
    expect(sub.$id).toBe('sub_admin')
    expect(sub.target).toBe('admin@nuvix.io')

    // 3. List subscribers
    const resListSubs = await app.handle(
      new Request('http://localhost/v2/messaging/topics/announcements/subscribers', {
        method: 'GET',
      }),
    )
    expect(resListSubs.status).toBe(200)
    const subList = (await resListSubs.json()) as { total: number; subscribers: { $id: string }[] }
    expect(subList.total).toBe(1)
    expect(subList.subscribers[0]?.$id).toBe('sub_admin')
  })

  test('messages endpoints: create draft and trigger dispatch', async () => {
    activeAuth = FULL_AUTH

    // Setup active email provider
    await app.handle(
      new Request('http://localhost/v2/messaging/providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'email_default',
          name: 'Sendgrid Primary',
          type: 'email',
          adapter: 'sendgrid',
          options: { apiKey: 'SG.fake' },
        }),
      }),
    )

    // 1. Create draft message
    const resDraft = await app.handle(
      new Request('http://localhost/v2/messaging/messages/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: 'welcome_email',
          targets: ['user@example.com'],
          subject: 'Welcome to Nuvix',
          content: 'Hello, welcome aboard!',
          draft: true,
        }),
      }),
    )
    expect(resDraft.status).toBe(201)
    const draft = (await resDraft.json()) as { $id: string; status: string }
    expect(draft.$id).toBe('welcome_email')
    expect(draft.status).toBe('draft')

    // 2. Dispatch the message
    const resSend = await app.handle(
      new Request('http://localhost/v2/messaging/messages/welcome_email/send', {
        method: 'POST',
      }),
    )
    expect(resSend.status).toBe(200)
    const sent = (await resSend.json()) as { status: string; deliveredTo: number }
    expect(sent.status).toBe('completed')
    expect(sent.deliveredTo).toBe(1)
  })
})
