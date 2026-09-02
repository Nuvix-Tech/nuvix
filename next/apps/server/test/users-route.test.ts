import { describe, expect, test } from 'bun:test'
import type { Session } from '@nuvix/db'
import { Elysia } from 'elysia'
import type { AccountDocuments } from '../src/account/documents'
import type { ProjectAuthContext } from '../src/context/project'
import type { SchemaService } from '../src/database/service'
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

const MEMBERSHIPS = {
  data: [
    {
      $id: 'membership_a',
      teamId: 'team_a',
      teamName: 'Core',
      roles: ['owner'],
      status: 'accepted',
      invited: '2026-08-30T10:00:00.000Z',
      joined: '2026-08-30T10:00:00.000Z',
    },
  ],
  meta: { total: 1, limit: 25, offset: 0 },
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
    listMemberships: called('listMemberships', MEMBERSHIPS),
    remove: called('remove', undefined),
    createWithPassword: called('createWithPassword', USER),
    updatePassword: called('updatePassword', USER),
    listSessions: called('listSessions', {
      data: [
        {
          $id: 'session_1',
          userId: 'user_a',
          expiresAt: '2026-10-02T12:00:00.000Z',
          $createdAt: '2026-09-02T12:00:00.000Z',
          $updatedAt: '2026-09-02T12:00:00.000Z',
        },
      ],
      meta: { total: 1, limit: 25, offset: 0 },
    }),
    createSession: called('createSession', {
      $id: 'session_1',
      userId: 'user_a',
      token: 'ses_v1.dGVzdA.abcdef',
      expiresAt: '2026-10-02T12:00:00.000Z',
      $createdAt: '2026-09-02T12:00:00.000Z',
      $updatedAt: '2026-09-02T12:00:00.000Z',
    }),
    deleteSession: called('deleteSession', undefined),
    deleteSessions: called('deleteSessions', undefined),
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

  test('keeps users.read and users.write authority distinct', async () => {
    const readOnly = probe({
      type: 'apiKey',
      keyId: 'key_read',
      mode: 'admin',
      scopes: ['users.read'],
    })
    const writeOnly = probe({
      type: 'apiKey',
      keyId: 'key_write',
      mode: 'admin',
      scopes: ['users.write'],
    })

    const [writeResponse, readResponse] = await Promise.all([
      readOnly.app.handle(
        new Request('http://nuvix.test/v2/users', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'ada@example.com' }),
        }),
      ),
      writeOnly.app.handle(new Request('http://nuvix.test/v2/users')),
    ])

    expect(writeResponse.status).toBe(403)
    expect(readResponse.status).toBe(403)
    expect(readOnly.calls).toEqual([])
    expect(writeOnly.calls).toEqual([])
  })

  test('lists user memberships through the read scope only', async () => {
    const readOnly = probe({
      type: 'apiKey',
      keyId: 'key_read',
      mode: 'admin',
      scopes: ['users.read'],
    })
    const writeOnly = probe({
      type: 'apiKey',
      keyId: 'key_write',
      mode: 'admin',
      scopes: ['users.write'],
    })

    const [readResponse, writeResponse] = await Promise.all([
      readOnly.app.handle(new Request('http://nuvix.test/v2/users/user_a/memberships')),
      writeOnly.app.handle(new Request('http://nuvix.test/v2/users/user_a/memberships')),
    ])

    expect(readResponse.status).toBe(200)
    expect(await readResponse.json()).toEqual(MEMBERSHIPS)
    expect(readOnly.calls).toEqual(['listMemberships'])
    expect(writeResponse.status).toBe(403)
    expect(writeOnly.calls).toEqual([])
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

  test('creates user with argon2 and bcrypt', async () => {
    const state = probe({
      type: 'apiKey',
      keyId: 'key_a',
      mode: 'admin',
      scopes: ['users.write'],
    })

    const argonRes = await state.app.handle(
      new Request('http://nuvix.test/v2/users/argon2', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'ada@example.com',
          password: 'password123',
          name: 'Ada Lovelace',
        }),
      }),
    )
    expect(argonRes.status).toBe(201)

    const bcryptRes = await state.app.handle(
      new Request('http://nuvix.test/v2/users/bcrypt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'ada@example.com',
          password: 'password123',
          name: 'Ada Lovelace',
        }),
      }),
    )
    expect(bcryptRes.status).toBe(201)

    expect(state.calls).toEqual(['createWithPassword', 'createWithPassword'])
  })

  test('updates password and deletes user', async () => {
    const state = probe({
      type: 'apiKey',
      keyId: 'key_a',
      mode: 'admin',
      scopes: ['users.write'],
    })

    const passRes = await state.app.handle(
      new Request('http://nuvix.test/v2/users/user_a/password', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'new-password-123' }),
      }),
    )
    expect(passRes.status).toBe(200)

    const delRes = await state.app.handle(
      new Request('http://nuvix.test/v2/users/user_a', {
        method: 'DELETE',
      }),
    )
    expect(delRes.status).toBe(204)

    expect(state.calls).toEqual(['updatePassword', 'remove'])
  })

  test('manages user sessions with appropriate scopes', async () => {
    const writeOnly = probe({
      type: 'apiKey',
      keyId: 'key_write',
      mode: 'admin',
      scopes: ['users.write'],
    })
    const readOnly = probe({
      type: 'apiKey',
      keyId: 'key_read',
      mode: 'admin',
      scopes: ['users.read'],
    })

    // List sessions requires users.read
    const listRes = await readOnly.app.handle(
      new Request('http://nuvix.test/v2/users/user_a/sessions?limit=10'),
    )
    expect(listRes.status).toBe(200)
    expect(readOnly.calls).toEqual(['listSessions'])

    const listDenied = await writeOnly.app.handle(
      new Request('http://nuvix.test/v2/users/user_a/sessions?limit=10'),
    )
    expect(listDenied.status).toBe(403)

    // Create session requires users.write
    const createRes = await writeOnly.app.handle(
      new Request('http://nuvix.test/v2/users/user_a/sessions', {
        method: 'POST',
      }),
    )
    expect(createRes.status).toBe(201)

    // Delete specific session requires users.write
    const deleteSpecific = await writeOnly.app.handle(
      new Request('http://nuvix.test/v2/users/user_a/sessions/session_1', {
        method: 'DELETE',
      }),
    )
    expect(deleteSpecific.status).toBe(204)

    // Delete all sessions requires users.write
    const deleteAll = await writeOnly.app.handle(
      new Request('http://nuvix.test/v2/users/user_a/sessions', {
        method: 'DELETE',
      }),
    )
    expect(deleteAll.status).toBe(204)

    expect(writeOnly.calls).toEqual(['createSession', 'deleteSession', 'deleteSessions'])
  })
})
