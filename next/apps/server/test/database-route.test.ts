import { describe, expect, test } from 'bun:test'
import { Doc, type Session } from '@nuvix/db'
import type { AccountDocuments } from '../src/account/documents'
import { createApp } from '../src/app'
import type { ProjectAuthContext } from '../src/context/project'
import type { TableDataService } from '../src/database/query'
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
  scopes: [
    'schemas.read',
    'schemas.write',
    'schemas.tables.read',
    'schemas.tables.write',
    'collections.read',
    'collections.write',
    'documents.read',
    'documents.write',
  ],
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

  const mockTableData: Record<string, unknown>[] = [{ _id: '1', name: 'Row 1' }]
  const tables: TableDataService = {
    async query(_schema, _table, _options) {
      return mockTableData
    },
    async count(_schema, _table, _filters) {
      return mockTableData.length
    },
    async get(_schema, _table, rowId) {
      return mockTableData.find((r) => r._id === rowId) ?? null
    },
    async insert(_schema, _table, data) {
      const items = Array.isArray(data) ? data : [data]
      mockTableData.push(...items)
      return items
    },
    async update(_schema, _table, data, _filters, rowId) {
      const item = mockTableData.find((r) => r._id === rowId)
      if (!item) return []
      Object.assign(item, data)
      return [item]
    },
    async delete(_schema, _table, _filters, rowId) {
      const idx = mockTableData.findIndex((r) => r._id === rowId)
      if (idx === -1) return []
      return mockTableData.splice(idx, 1)
    },
  }

  const memoryDocs = new Map<string, Map<string, Doc>>()
  const mockSession = {
    async find(col: string, _queries: unknown[]) {
      const c = memoryDocs.get(col)
      if (!c) return []
      return Array.from(c.values())
    },
    async count(col: string, _queries: unknown[]) {
      const c = memoryDocs.get(col)
      if (!c) return 0
      return c.size
    },
    async getDocument(col: string, id: string) {
      const c = memoryDocs.get(col)
      const doc = c?.get(id)
      if (!doc) throw new Error('Not found')
      return doc
    },
    async createDocument(col: string, doc: Doc) {
      let c = memoryDocs.get(col)
      if (!c) {
        c = new Map()
        memoryDocs.set(col, c)
      }
      c.set(doc.getId(), doc)
      return doc
    },
    async updateDocument(col: string, id: string, doc: Doc) {
      let c = memoryDocs.get(col)
      if (!c) {
        c = new Map()
        memoryDocs.set(col, c)
      }
      c.set(id, doc)
      return doc
    },
    async deleteDocument(col: string, id: string) {
      const c = memoryDocs.get(col)
      if (!c) return false
      return c.delete(id)
    },
  } as unknown as Session

  const requests: DatabaseRequestCapabilities = {
    withProject: async (headers, operation) => {
      projectRequests.push(headers)
      return await operation({
        project: { id: 'project_a', enabled: true },
        auth,
        session: mockSession,
        schemas,
        tables,
        account: {} as AccountDocuments,
      })
    },
  }
  const app = await createApp({
    geoip: { lookup: () => null },
    projectRequests: requests,
    uptime: () => 42,
  })

  return { app, calls, projectRequests, mockTableData }
}

function json(method: 'POST' | 'PATCH' | 'PUT', body: unknown): RequestInit {
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

  test('queries, gets, inserts, updates, and deletes table rows', async () => {
    const state = await harness(ADMIN_SESSION)

    // List rows
    const listRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/tables/users'),
    )
    expect(listRes.status).toBe(200)
    const listData = (await listRes.json()) as { data: unknown[]; meta: { total: number } }
    expect(listData.data).toHaveLength(1)
    expect(listData.meta.total).toBe(1)

    // Count rows
    const countRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/tables/users/count'),
    )
    expect(countRes.status).toBe(200)
    expect((await countRes.json()) as Record<string, unknown>).toEqual({ count: 1 })

    // Get single row
    const getRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/tables/users/1'),
    )
    expect(getRes.status).toBe(200)
    expect((await getRes.json()) as Record<string, unknown>).toEqual({ _id: '1', name: 'Row 1' })

    // Insert row
    const insertRes = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas/core/tables/users',
        json('POST', { name: 'Row 2' }),
      ),
    )
    expect(insertRes.status).toBe(201)

    // Update row
    const updateRes = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas/core/tables/users/1',
        json('PATCH', { name: 'Row 1 Modified' }),
      ),
    )
    expect(updateRes.status).toBe(200)
    expect(((await updateRes.json()) as Record<string, unknown>).name).toBe('Row 1 Modified')

    // Delete row
    const deleteRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/tables/users/1', {
        method: 'DELETE',
      }),
    )
    expect(deleteRes.status).toBe(204)
  })

  test('performs full collection, attribute, index, and document lifecycle', async () => {
    const state = await harness(ADMIN_SESSION)

    // 1. Create collection
    const createColRes = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas/core/collections',
        json('POST', { collectionId: 'posts', name: 'Blog Posts' }),
      ),
    )
    expect(createColRes.status).toBe(201)
    const col = (await createColRes.json()) as Record<string, unknown>
    expect(col.$id).toBe('posts')
    expect(col.name).toBe('Blog Posts')

    // 2. List collections
    const listColsRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/collections'),
    )
    expect(listColsRes.status).toBe(200)
    const cols = (await listColsRes.json()) as Record<string, unknown>
    expect(cols.data).toHaveLength(1)

    // 3. Get collection
    const getColRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/collections/posts'),
    )
    expect(getColRes.status).toBe(200)

    // 4. Update collection
    const updateColRes = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas/core/collections/posts',
        json('PUT', { name: 'Updated Posts' }),
      ),
    )
    expect(updateColRes.status).toBe(200)
    expect(((await updateColRes.json()) as Record<string, unknown>).name).toBe('Updated Posts')

    // 5. Create attribute
    const createAttrRes = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas/core/collections/posts/attributes',
        json('POST', { key: 'title', type: 'string', size: 255, required: true }),
      ),
    )
    expect(createAttrRes.status).toBe(201)
    expect(((await createAttrRes.json()) as Record<string, unknown>).key).toBe('title')

    // 6. List attributes
    const listAttrRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/collections/posts/attributes'),
    )
    expect(listAttrRes.status).toBe(200)
    expect(((await listAttrRes.json()) as Record<string, unknown>).data).toHaveLength(1)

    // 7. Create index
    const createIdxRes = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas/core/collections/posts/indexes',
        json('POST', { key: 'idx_title', type: 'key', attributes: ['title'] }),
      ),
    )
    expect(createIdxRes.status).toBe(201)

    // 8. List indexes
    const listIdxRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/collections/posts/indexes'),
    )
    expect(listIdxRes.status).toBe(200)
    expect(((await listIdxRes.json()) as Record<string, unknown>).data).toHaveLength(1)

    // 9. Create document
    const createDocRes = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas/core/collections/posts/documents',
        json('POST', { documentId: 'post_1', data: { title: 'First Post' } }),
      ),
    )
    expect(createDocRes.status).toBe(201)
    const doc = (await createDocRes.json()) as Record<string, unknown>
    expect(doc.$id).toBe('post_1')
    expect(doc.title).toBe('First Post')

    // 10. List documents
    const listDocsRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/collections/posts/documents'),
    )
    expect(listDocsRes.status).toBe(200)
    expect(((await listDocsRes.json()) as Record<string, unknown>).data).toHaveLength(1)

    // 11. Get document
    const getDocRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/collections/posts/documents/post_1'),
    )
    expect(getDocRes.status).toBe(200)

    // 12. Update document
    const updateDocRes = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas/core/collections/posts/documents/post_1',
        json('PATCH', { data: { title: 'Updated Title' } }),
      ),
    )
    expect(updateDocRes.status).toBe(200)
    expect(((await updateDocRes.json()) as Record<string, unknown>).title).toBe('Updated Title')

    // 13. Delete document
    const deleteDocRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/collections/posts/documents/post_1', {
        method: 'DELETE',
      }),
    )
    expect(deleteDocRes.status).toBe(204)

    // 14. Delete index
    const deleteIdxRes = await state.app.handle(
      new Request(
        'http://nuvix.test/v2/database/schemas/core/collections/posts/indexes/idx_title',
        { method: 'DELETE' },
      ),
    )
    expect(deleteIdxRes.status).toBe(204)

    // 15. Delete attribute
    const deleteAttrRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/collections/posts/attributes/title', {
        method: 'DELETE',
      }),
    )
    expect(deleteAttrRes.status).toBe(204)

    // 16. Delete collection
    const deleteColRes = await state.app.handle(
      new Request('http://nuvix.test/v2/database/schemas/core/collections/posts', {
        method: 'DELETE',
      }),
    )
    expect(deleteColRes.status).toBe(204)
  })
})
