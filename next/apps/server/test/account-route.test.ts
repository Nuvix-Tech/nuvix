import { describe, expect, test } from 'bun:test'
import { treaty } from '@elysia/eden'
import type { Session } from '@nuvix/db'
import { Elysia } from 'elysia'
import type { AccountDocuments } from '../src/account/documents'
import { accountRoutes } from '../src/account/route'
import type { AccountService } from '../src/account/service'
import type { ProjectAuthContext } from '../src/context/project'
import type { SchemaService } from '../src/database/service'
import type { DatabaseRequestCapabilities } from '../src/infrastructure/database-composition'
import { problemErrors } from '../src/plugins/errors'

const USER = {
  $id: 'user_a',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  status: true,
  labels: [],
  prefs: { theme: 'dark' },
  emailVerification: false,
  phoneVerification: false,
  registration: '2026-08-30T10:00:00.000Z',
  $createdAt: '2026-08-30T10:00:00.000Z',
  $updatedAt: '2026-08-30T10:00:00.000Z',
}

const SESSION = {
  $id: 'session_1',
  userId: 'user_a',
  token: 'ses_v1.dGVzdA.abcdef',
  expiresAt: '2026-10-02T12:00:00.000Z',
  $createdAt: '2026-09-02T12:00:00.000Z',
  $updatedAt: '2026-09-02T12:00:00.000Z',
}

function probe(auth: ProjectAuthContext) {
  const calls: string[] = []
  const called =
    <Result>(name: string, result: Result) =>
    async () => {
      calls.push(name)
      return result
    }

  const requests: DatabaseRequestCapabilities = {
    withProject: async (_headers, operation) =>
      await operation({
        project: { id: 'project_a', enabled: true },
        auth,
        session: {} as Session,
        schemas: Object.freeze({}) as SchemaService,
        account: {} as AccountDocuments,
      }),
  }

  const service = {
    register: called('register', USER),
    get: called('get', USER),
    updateName: called('updateName', { ...USER, name: 'New Name' }),
    updatePassword: called('updatePassword', USER),
    updateEmail: called('updateEmail', { ...USER, email: 'new@example.com' }),
    updatePrefs: called('updatePrefs', { ...USER, prefs: { theme: 'light' } }),
    deleteAccount: called('deleteAccount', undefined),
    createEmailSession: called('createEmailSession', SESSION),
    listSessions: called('listSessions', {
      data: [SESSION],
      meta: { total: 1, limit: 25, offset: 0 },
    }),
    getSession: called('getSession', SESSION),
    deleteSession: called('deleteSession', undefined),
    deleteSessions: called('deleteSessions', undefined),
    createAnonymousSession: called('createAnonymousSession', SESSION),
  } as unknown as AccountService

  const app = new Elysia({ prefix: '/v2' })
    .use(problemErrors({ getTranslator: () => ({ t: (k: string) => k }) as never }))
    .use(accountRoutes(requests, service))
  const client = treaty(app)

  return { calls, client, service }
}

const SESSION_AUTH: ProjectAuthContext = {
  type: 'session',
  sessionId: 'session_1',
  userId: 'user_a',
  verified: true,
  scopes: [],
}

const GUEST_AUTH: ProjectAuthContext = {
  type: 'guest',
}

const API_KEY_AUTH: ProjectAuthContext = {
  type: 'apiKey',
  keyId: 'key_1',
  mode: 'admin',
  scopes: ['users.read', 'users.write'],
}

describe('account routes', () => {
  test('registers account without user authentication', async () => {
    const { calls, client } = probe(GUEST_AUTH)
    const { data, status } = await client.v2.account.post({
      email: 'ada@example.com',
      password: 'password123',
      name: 'Ada Lovelace',
    })

    expect(status).toBe(201)
    expect(data?.$id).toBe('user_a')
    expect(calls).toEqual(['register'])
  })

  test('creates email session without user authentication', async () => {
    const { calls, client } = probe(GUEST_AUTH)
    const { data, status } = await client.v2.account.sessions.email.post({
      email: 'ada@example.com',
      password: 'password123',
    })

    expect(status).toBe(201)
    expect(data?.$id).toBe('session_1')
    expect(data?.token).toBe('ses_v1.dGVzdA.abcdef')
    expect(calls).toEqual(['createEmailSession'])
  })

  test('returns user profile for authenticated session', async () => {
    const { calls, client } = probe(SESSION_AUTH)
    const { data, status } = await client.v2.account.get()

    expect(status).toBe(200)
    expect(data?.$id).toBe('user_a')
    expect(calls).toEqual(['get'])
  })

  test('rejects unauthenticated get profile with 401', async () => {
    const { calls, client } = probe(GUEST_AUTH)
    const { error, status } = await client.v2.account.get()

    expect(status).toBe(401)
    expect((error?.value as { code?: string })?.code).toBe('credential_invalid')
    expect(calls).toEqual([])
  })

  test('rejects api-key authenticated get profile with 401', async () => {
    const { calls, client } = probe(API_KEY_AUTH)
    const { error, status } = await client.v2.account.get()

    expect(status).toBe(401)
    expect((error?.value as { code?: string })?.code).toBe('credential_invalid')
    expect(calls).toEqual([])
  })

  test('updates name, password, email, and preferences', async () => {
    const { calls, client } = probe(SESSION_AUTH)

    const nameRes = await client.v2.account.name.patch({ name: 'New Name' })
    expect(nameRes.status).toBe(200)

    const passRes = await client.v2.account.password.patch({
      password: 'new-password-123',
      oldPassword: 'old-password-123',
    })
    expect(passRes.status).toBe(200)

    const emailRes = await client.v2.account.email.patch({
      email: 'new@example.com',
      password: 'new-password-123',
    })
    expect(emailRes.status).toBe(200)

    const prefsGet = await client.v2.account.prefs.get()
    expect(prefsGet.status).toBe(200)

    const prefsPatch = await client.v2.account.prefs.patch({
      prefs: { theme: 'light' },
    })
    expect(prefsPatch.status).toBe(200)

    expect(calls).toEqual(['updateName', 'updatePassword', 'updateEmail', 'get', 'updatePrefs'])
  })

  test('lists sessions and gets specific session', async () => {
    const { calls, client } = probe(SESSION_AUTH)

    const list = await client.v2.account.sessions.get({ query: { limit: 10 } })
    expect(list.status).toBe(200)
    expect(list.data?.data.length).toBe(1)

    const session = await client.v2.account.sessions({ sessionId: 'session_1' }).get()
    expect(session.status).toBe(200)
    expect(session.data?.$id).toBe('session_1')

    expect(calls).toEqual(['listSessions', 'getSession'])
  })

  test('deletes current session, specific session, and all sessions', async () => {
    const { calls, client } = probe(SESSION_AUTH)

    const currentRes = await client.v2.account.sessions.current.delete()
    expect(currentRes.status).toBe(204)

    const specificRes = await client.v2.account.sessions({ sessionId: 'session_1' }).delete()
    expect(specificRes.status).toBe(204)

    const allRes = await client.v2.account.sessions.delete()
    expect(allRes.status).toBe(204)

    expect(calls).toEqual(['deleteSession', 'deleteSession', 'deleteSessions'])
  })

  test('deletes account and returns 204', async () => {
    const { calls, client } = probe(SESSION_AUTH)

    const res = await client.v2.account.delete()
    expect(res.status).toBe(204)
    expect(calls).toEqual(['deleteAccount'])
  })

  test('creates anonymous session for guest and rejects authenticated caller', async () => {
    const guestState = probe({ type: 'guest' })
    const res = await guestState.client.v2.account.sessions.anonymous.post({})
    expect(res.status).toBe(201)
    expect(res.data?.$id).toBe('session_1')
    expect(res.data?.token).toBe('ses_v1.dGVzdA.abcdef')
    expect(guestState.calls).toEqual(['createAnonymousSession'])

    const authState = probe(SESSION_AUTH)
    const conflictRes = await authState.client.v2.account.sessions.anonymous.post({})
    expect(conflictRes.status).toBe(409)
    expect(authState.calls).toEqual([])
  })
})
