import { describe, expect, test } from 'bun:test'
import type { Session } from '@nuvix/db'
import type { AccountDocuments } from '../src/account/documents'
import { createApp } from '../src/app'
import type { ProjectAuthContext } from '../src/context/project'
import type { SchemaService } from '../src/database/service'
import type { DatabaseRequestCapabilities } from '../src/infrastructure/database-composition'
import { ConflictError, NotFoundError } from '../src/shared/errors'

const MANAGED_SCHEMA = {
  name: 'appdata',
  description: 'Application data',
  type: 'managed',
} as const

const DOCUMENT_SCHEMA = {
  name: 'documents',
  description: null,
  type: 'document',
} as const

const ADMIN_SESSION: ProjectAuthContext = {
  type: 'session',
  sessionId: 'admin_session',
  userId: 'admin_user',
  verified: true,
  scopes: ['schemas.read', 'schemas.write'],
}

type SchemaOperation = keyof SchemaService

interface SchemaCall {
  readonly operation: SchemaOperation
  readonly arguments: readonly unknown[]
}

interface HarnessOptions {
  readonly failures?: Partial<Record<SchemaOperation, unknown>>
}

async function harness(auth: ProjectAuthContext, options: HarnessOptions = {}) {
  const calls: SchemaCall[] = []
  const projectRequests: Headers[] = []

  function record(operation: SchemaOperation, ...arguments_: unknown[]): void {
    calls.push({ operation, arguments: arguments_ })
    if (Object.hasOwn(options.failures ?? {}, operation)) throw options.failures?.[operation]
  }

  const schemas: SchemaService = Object.freeze({
    async list(type) {
      record('list', type)
      const data = [MANAGED_SCHEMA, DOCUMENT_SCHEMA].filter(
        (schema) => type === undefined || schema.type === type,
      )
      return { data, meta: { total: data.length } }
    },
    async get(name) {
      record('get', name)
      return { ...MANAGED_SCHEMA, name }
    },
    async create(input) {
      record('create', input)
      return { ...input, description: input.description ?? null }
    },
    async update(name, description) {
      record('update', name, description)
      return { ...MANAGED_SCHEMA, name, description: description ?? null }
    },
    async remove(name) {
      record('remove', name)
    },
  })
  const requests: DatabaseRequestCapabilities = {
    withProject: async (headers, operation) => {
      projectRequests.push(headers)
      return await operation({
        project: { id: 'project_a', enabled: true },
        auth,
        session: {} as Session,
        schemas,
        account: {} as AccountDocuments,
      })
    },
  }
  const app = await createApp({
    geoip: { lookup: () => null },
    projectRequests: requests,
    uptime: () => 42,
  })

  return { app, calls, projectRequests }
}

function json(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

describe('database schema routes', () => {
  test('registers all five routes and delegates their exact inputs to the request-scoped service', async () => {
    const state = await harness(ADMIN_SESSION)

    const list = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas?type=managed'),
    )
    const create = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas',
        json('POST', {
          name: 'events',
          description: 'Event data',
          type: 'unmanaged',
        }),
      ),
    )
    const get = await state.app.handle(new Request('http://nuvix.test/v2/database/schemas/appdata'))
    const update = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas/appdata',
        json('PATCH', { description: null }),
      ),
    )
    const remove = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/appdata', {
        method: 'DELETE',
      }),
    )

    expect(list.status).toBe(200)
    expect(await list.json()).toEqual({
      data: [MANAGED_SCHEMA],
      meta: { total: 1 },
    })
    expect(create.status).toBe(201)
    expect(await create.json()).toEqual({
      name: 'events',
      description: 'Event data',
      type: 'unmanaged',
    })
    expect(get.status).toBe(200)
    expect(await get.json()).toEqual(MANAGED_SCHEMA)
    expect(update.status).toBe(200)
    expect(await update.json()).toEqual({
      ...MANAGED_SCHEMA,
      description: null,
    })
    expect(remove.status).toBe(204)
    expect(await remove.text()).toBe('')
    expect(state.calls).toEqual([
      { operation: 'list', arguments: ['managed'] },
      {
        operation: 'create',
        arguments: [{ name: 'events', description: 'Event data', type: 'unmanaged' }],
      },
      { operation: 'get', arguments: ['appdata'] },
      { operation: 'update', arguments: ['appdata', null] },
      { operation: 'remove', arguments: ['appdata'] },
    ])
  })

  test('accepts API keys only when each operation has its matching scope', async () => {
    const state = await harness({
      type: 'apiKey',
      keyId: 'key_a',
      mode: 'console',
      scopes: ['schemas.read', 'schemas.write'],
    })

    const list = await state.app.handle(new Request('http://nuvix.test/v2/database/schemas'))
    const create = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas',
        json('POST', { name: 'events', type: 'managed' }),
      ),
    )

    expect(list.status).toBe(200)
    expect(create.status).toBe(201)
    expect(state.calls.map((call) => call.operation)).toEqual(['list', 'create'])
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
    [
      'user JWT',
      {
        type: 'jwt',
        userId: 'user_a',
        verified: true,
        scopes: ['schemas.read'],
      } as const,
    ],
  ])('rejects %s before schema service invocation', async (_case, auth) => {
    const state = await harness(auth)

    const response = await state.app.handle(new Request('http://nuvix.test/v2/database/schemas'))

    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')?.startsWith('application/problem+json')).toBe(true)
    expect(await response.json()).toMatchObject({
      type: '/errors/forbidden',
      status: 403,
    })
    expect(state.calls).toEqual([])
  })

  test.each([
    ['read', ['schemas.write'], 'GET', undefined],
    ['write', ['schemas.read'], 'POST', { name: 'events', type: 'managed' }],
  ] as const)(
    'rejects an API key missing the schemas.%s scope',
    async (_case, scopes, method, body) => {
      const state = await harness({
        type: 'apiKey',
        keyId: 'key_a',
        mode: 'admin',
        scopes,
      })
      const request =
        method === 'POST'
          ? new Request('http://nuvix.test/v2/database/schemas', json(method, body))
          : new Request('http://nuvix.test/v2/database/schemas')

      const response = await state.app.handle(request)

      expect(response.status).toBe(403)
      expect(state.calls).toEqual([])
    },
  )

  test('returns 422 for an invalid schema contract before entering project scope', async () => {
    const state = await harness(ADMIN_SESSION)

    const response = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas',
        json('POST', { name: 'Invalid-Name', type: 'managed' }),
      ),
    )

    expect(response.status).toBe(422)
    expect(response.headers.get('content-type')?.startsWith('application/problem+json')).toBe(true)
    expect(state.projectRequests).toEqual([])
    expect(state.calls).toEqual([])
  })

  test.each([
    [
      'schema_already_exists',
      'POST',
      { name: 'appdata', type: 'managed' },
      new ConflictError('Schema already exists', {
        code: 'schema_already_exists',
      }),
      409,
      '/errors/conflict',
    ],
    [
      'schema_not_found',
      'GET',
      undefined,
      new NotFoundError('Schema', { code: 'schema_not_found' }),
      404,
      '/errors/not-found',
    ],
  ] as const)(
    'serializes %s through the shared problem error plugin',
    async (code, method, body, failure, status, type) => {
      const operation = method === 'POST' ? 'create' : 'get'
      const state = await harness(ADMIN_SESSION, {
        failures: { [operation]: failure },
      })
      const request =
        method === 'POST'
          ? new Request('http://nuvix.test/v2/database/schemas', json(method, body))
          : new Request('http://nuvix.test/v2/database/schemas/missing')

      const response = await state.app.handle(request)
      const problem = (await response.json()) as Record<string, unknown>

      expect(response.status).toBe(status)
      expect(response.headers.get('content-type')?.startsWith('application/problem+json')).toBe(
        true,
      )
      expect(problem).toMatchObject({ type, code, status })
      expect(state.calls.map((call) => call.operation)).toEqual([operation])
    },
  )

  test('does not expose unreviewed collection routes', async () => {
    const state = await harness(ADMIN_SESSION)

    const response = await state.app.handle(
      new Request('http://nuvix.test/v2/database/collections'),
    )

    expect(response.status).toBe(404)
    expect(state.projectRequests).toEqual([])
    expect(state.calls).toEqual([])
  })
})
