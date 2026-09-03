import { describe, expect, test } from 'bun:test'
import type { Doc, Session } from '@nuvix/db'
import { Elysia } from 'elysia'
import { platformRoute } from '../src/platform/route'
import { createPlatformService, type SqlQueryExecutor } from '../src/platform/service'
import { NotFoundError } from '../src/shared/errors'

interface ProjectDto {
  $id: string
  name: string
  description: string
  publicId: string
  enabled: boolean
  $createdAt: string
  $updatedAt: string
}

interface ProjectListDto {
  total: number
  projects: ProjectDto[]
}

interface AuthSettingsDto {
  sessionDurationSeconds: number
  maxActiveSessions: number
  passwordMinLength: number
  passwordRequireSymbols: boolean
}

interface SchemasDto {
  schemas: Array<{ schema_name: string }>
}

interface TablesDto {
  tables: Array<{ table_schema: string; table_name: string; table_type: string }>
}

interface ColumnsDto {
  columns: Array<{
    table_name: string
    column_name: string
    data_type: string
    is_nullable: string
    column_default: string | null
  }>
}

describe('Platform Routes (HTTP)', () => {
  const setupApp = () => {
    const docs = new Map<string, Doc>()

    const session = {
      createDocument: async (_collection: string, doc: Doc) => {
        docs.set(doc.getId(), doc)
        return doc
      },
      getDocument: async (_collection: string, id: string) => {
        const doc = docs.get(id)
        if (!doc) throw new NotFoundError('Not found')
        return doc
      },
      find: async (_collection: string) => {
        return Array.from(docs.values())
      },
      updateDocument: async (_collection: string, id: string, doc: Doc) => {
        docs.set(id, doc)
        return doc
      },
      deleteDocument: async (_collection: string, id: string) => {
        docs.delete(id)
        return true
      },
    } as unknown as Session

    const service = createPlatformService()

    const mockSql: SqlQueryExecutor = async <T = unknown>(strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('information_schema.schemata')) {
        return [{ schema_name: 'public' }] as T[]
      }
      if (query.includes('information_schema.tables')) {
        return [{ table_schema: 'public', table_name: 'users', table_type: 'BASE TABLE' }] as T[]
      }
      if (query.includes('information_schema.columns')) {
        return [
          {
            table_name: 'users',
            column_name: 'email',
            data_type: 'text',
            is_nullable: 'NO',
            column_default: null,
          },
        ] as T[]
      }
      return []
    }

    const app = new Elysia({ prefix: '/v2' }).use(
      platformRoute({
        service,
        getPlatformSession: async () => session,
        getTenantSql: async () => mockSql,
      }),
    )

    return { app, docs }
  }

  test('POST /v2/platform/projects creates project and GET returns it', async () => {
    const { app } = setupApp()

    const res = await app.handle(
      new Request('http://localhost/v2/platform/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj_route_1',
          name: 'Route Project',
          description: 'Created via route',
        }),
      }),
    )

    expect(res.status).toBe(201)
    const body = (await res.json()) as ProjectDto
    expect(body.$id).toBe('proj_route_1')
    expect(body.name).toBe('Route Project')
    expect(body.publicId.startsWith('pk_live_')).toBe(true)

    const listRes = await app.handle(
      new Request('http://localhost/v2/platform/projects', {
        method: 'GET',
      }),
    )
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as ProjectListDto
    expect(listBody.total).toBe(1)
    expect(listBody.projects[0]?.$id).toBe('proj_route_1')
  })

  test('GET, PUT, and DELETE /v2/platform/projects/:projectId', async () => {
    const { app } = setupApp()

    await app.handle(
      new Request('http://localhost/v2/platform/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p_lifecycle',
          name: 'Before',
        }),
      }),
    )

    // GET
    const getRes = await app.handle(
      new Request('http://localhost/v2/platform/projects/p_lifecycle'),
    )
    expect(getRes.status).toBe(200)
    expect(((await getRes.json()) as ProjectDto).name).toBe('Before')

    // PUT
    const putRes = await app.handle(
      new Request('http://localhost/v2/platform/projects/p_lifecycle', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'After',
          enabled: false,
        }),
      }),
    )
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as ProjectDto
    expect(putBody.name).toBe('After')
    expect(putBody.enabled).toBe(false)

    // DELETE
    const delRes = await app.handle(
      new Request('http://localhost/v2/platform/projects/p_lifecycle', {
        method: 'DELETE',
      }),
    )
    expect(delRes.status).toBe(204)
  })

  test('GET and PUT /v2/platform/projects/:projectId/auth', async () => {
    const { app } = setupApp()

    await app.handle(
      new Request('http://localhost/v2/platform/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p_auth',
          name: 'Auth Test',
        }),
      }),
    )

    const getAuth = await app.handle(
      new Request('http://localhost/v2/platform/projects/p_auth/auth'),
    )
    expect(getAuth.status).toBe(200)
    const authData = (await getAuth.json()) as AuthSettingsDto
    expect(authData.sessionDurationSeconds).toBe(86400)

    const putAuth = await app.handle(
      new Request('http://localhost/v2/platform/projects/p_auth/auth', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionDurationSeconds: 3600,
          maxActiveSessions: 3,
        }),
      }),
    )
    expect(putAuth.status).toBe(200)
    const updatedAuth = (await putAuth.json()) as AuthSettingsDto
    expect(updatedAuth.sessionDurationSeconds).toBe(3600)
    expect(updatedAuth.maxActiveSessions).toBe(3)
  })

  test('metadata introspection endpoints return schema, table, and column info', async () => {
    const { app } = setupApp()

    const schemasRes = await app.handle(
      new Request('http://localhost/v2/platform/projects/p_meta/metadata/schemas'),
    )
    expect(schemasRes.status).toBe(200)
    const schemasBody = (await schemasRes.json()) as SchemasDto
    expect(schemasBody.schemas).toHaveLength(1)
    expect(schemasBody.schemas[0]?.schema_name).toBe('public')

    const tablesRes = await app.handle(
      new Request('http://localhost/v2/platform/projects/p_meta/metadata/tables?schema=public'),
    )
    expect(tablesRes.status).toBe(200)
    const tablesBody = (await tablesRes.json()) as TablesDto
    expect(tablesBody.tables).toHaveLength(1)
    expect(tablesBody.tables[0]?.table_name).toBe('users')

    const columnsRes = await app.handle(
      new Request('http://localhost/v2/platform/projects/p_meta/metadata/columns?table=users'),
    )
    expect(columnsRes.status).toBe(200)
    const columnsBody = (await columnsRes.json()) as ColumnsDto
    expect(columnsBody.columns).toHaveLength(1)
    expect(columnsBody.columns[0]?.column_name).toBe('email')
  })
})
