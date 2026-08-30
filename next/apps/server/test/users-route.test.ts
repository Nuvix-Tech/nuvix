import { describe, expect, test } from 'bun:test'
import type { Session } from '@nuvix/db'
import { Elysia } from 'elysia'
import type { ProjectAuthContext } from '../src/context/project'
import type { DatabaseRequestCapabilities } from '../src/infrastructure/database-composition'
import { problemErrors } from '../src/plugins/errors'
import { userRoutes } from '../src/users/route'
import type { UserService } from '../src/users/service'

const USER = {
  $id: 'user_a',
  email: 'ada@example.com',
  status: true,
  labels: [],
  prefs: {},
  emailVerification: false,
  phoneVerification: false,
  registration: '2026-08-30T10:00:00.000Z',
  $createdAt: '2026-08-30T10:00:00.000Z',
  $updatedAt: '2026-08-30T10:00:00.000Z',
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
      }),
  }
  const service = {
    create: called('create', USER),
    list: called('list', {
      data: [USER],
      meta: { total: 1, limit: 25, offset: 0 },
    }),
    get: called('get', USER),
    updateName: called('name', USER),
    updateEmail: called('email', USER),
    updatePhone: called('phone', USER),
    getPrefs: called('getPrefs', {}),
    updatePrefs: called('prefs', {}),
    updateLabels: called('labels', USER),
    updateStatus: called('status', USER),
  } as unknown as UserService
  const app = new Elysia({ prefix: '/v2' })
    .use(
      problemErrors({
        getTranslator: async () => ({ format: (key: string) => key }) as never,
      }),
    )
    .use(userRoutes(requests, service))
  return { app, calls }
}

describe('users routes', () => {
  test('creates a credentialless user with 201', async () => {
    const state = probe({
      type: 'apiKey',
      keyId: 'key_a',
      mode: 'admin',
      scopes: ['users.write'],
    })

    const response = await state.app.handle(
      new Request('http://nuvix.test/v2/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ada@example.com' }),
      }),
    )

    expect(response.status).toBe(201)
    expect(state.calls).toEqual(['create'])
  })

  test.each([
    ['guest', { type: 'guest' } as const],
    [
      'ordinary session',
      {
        type: 'session',
        sessionId: 'session_a',
        userId: 'user_a',
        verified: true,
        scopes: [],
      } as const,
    ],
    ['scope-deficient key', { type: 'apiKey', keyId: 'key_a', mode: 'admin', scopes: [] } as const],
  ])('rejects %s administration', async (_case, auth) => {
    const state = probe(auth)

    const response = await state.app.handle(new Request('http://nuvix.test/v2/users'))

    expect(response.status).toBe(403)
    expect(state.calls).toEqual([])
  })

  test('allows a read-scoped key to list users', async () => {
    const state = probe({
      type: 'apiKey',
      keyId: 'key_a',
      mode: 'admin',
      scopes: ['users.read'],
    })

    const response = await state.app.handle(new Request('http://nuvix.test/v2/users'))

    expect(response.status).toBe(200)
    expect(state.calls).toEqual(['list'])
  })

  test('rejects password fields before service invocation', async () => {
    const state = probe({
      type: 'apiKey',
      keyId: 'key_a',
      mode: 'admin',
      scopes: ['users.write'],
    })

    const response = await state.app.handle(
      new Request('http://nuvix.test/v2/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'ada@example.com',
          password: 'not-in-this-slice',
        }),
      }),
    )

    expect(response.status).toBe(422)
    expect(state.calls).toEqual([])
  })
})
