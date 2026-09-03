import { describe, expect, test } from 'bun:test'
import type { Doc, Session } from '@nuvix/db'
import { createPlatformService, type SqlQueryExecutor } from '../src/platform/service'
import { ConflictError, NotFoundError } from '../src/shared/errors'

describe('PlatformService', () => {
  const setupTestSession = () => {
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

    return { session, docs }
  }

  test('createProject creates a platform project with valid publishable key', async () => {
    const { session } = setupTestSession()
    const service = createPlatformService()

    const project = await service.createProject(session, {
      projectId: 'proj_alpha',
      name: 'Alpha Project',
      description: 'Alpha description',
    })

    expect(project.getId()).toBe('proj_alpha')
    expect(project.get('name')).toBe('Alpha Project')
    expect(project.get('description')).toBe('Alpha description')
    expect(project.get('enabled')).toBe(true)

    const publicId = project.get('publicId')
    expect(typeof publicId).toBe('string')
    expect(publicId.startsWith('pk_live_')).toBe(true)
  })

  test('createProject rejects duplicate project IDs', async () => {
    const { session } = setupTestSession()
    const service = createPlatformService()

    await service.createProject(session, {
      projectId: 'dup_proj',
      name: 'First',
    })

    await expect(
      service.createProject(session, {
        projectId: 'dup_proj',
        name: 'Second',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  test('listProjects, getProject, updateProject, deleteProject round-trip', async () => {
    const { session } = setupTestSession()
    const service = createPlatformService()

    await service.createProject(session, {
      projectId: 'p1',
      name: 'Project 1',
    })
    await service.createProject(session, {
      projectId: 'p2',
      name: 'Project 2',
    })

    const list = await service.listProjects(session)
    expect(list).toHaveLength(2)

    const fetched = await service.getProject(session, 'p1')
    expect(fetched.get('name')).toBe('Project 1')

    const updated = await service.updateProject(session, 'p1', {
      name: 'Updated P1',
      enabled: false,
    })
    expect(updated.get('name')).toBe('Updated P1')
    expect(updated.get('enabled')).toBe(false)

    await service.deleteProject(session, 'p1')
    await expect(service.getProject(session, 'p1')).rejects.toBeInstanceOf(NotFoundError)

    const remaining = await service.listProjects(session)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.getId()).toBe('p2')
  })

  test('getAuthSettings and updateAuthSettings manage auth configuration', async () => {
    const { session } = setupTestSession()
    const service = createPlatformService()

    await service.createProject(session, {
      projectId: 'auth_proj',
      name: 'Auth Proj',
    })

    const initial = await service.getAuthSettings(session, 'auth_proj')
    expect(initial.sessionDurationSeconds).toBe(86400)
    expect(initial.passwordMinLength).toBe(8)

    const updated = await service.updateAuthSettings(session, 'auth_proj', {
      sessionDurationSeconds: 7200,
      passwordMinLength: 12,
      passwordRequireSymbols: true,
    })

    expect(updated.sessionDurationSeconds).toBe(7200)
    expect(updated.passwordMinLength).toBe(12)
    expect(updated.passwordRequireSymbols).toBe(true)

    const fetchedAgain = await service.getAuthSettings(session, 'auth_proj')
    expect(fetchedAgain.sessionDurationSeconds).toBe(7200)
  })

  test('introspects schemas, tables, and columns via sql tag', async () => {
    const service = createPlatformService()

    const mockSql: SqlQueryExecutor = async <T = unknown>(
      strings: TemplateStringsArray,
      ..._values: unknown[]
    ) => {
      const query = strings.join('?')
      if (query.includes('information_schema.schemata')) {
        return [{ schema_name: 'public' }, { schema_name: 'core' }] as T[]
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

    const schemas = await service.introspectSchemas(mockSql)
    expect(schemas).toHaveLength(2)
    expect(schemas[0]?.schema_name).toBe('public')

    const tables = await service.introspectTables(mockSql, 'public')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.table_name).toBe('users')

    const columns = await service.introspectColumns(mockSql, 'public', 'users')
    expect(columns).toHaveLength(1)
    expect(columns[0]?.column_name).toBe('email')
    expect(columns[0]?.data_type).toBe('text')
  })
})
