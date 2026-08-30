import { describe, expect, test } from 'bun:test'
import { Doc, type Query, QueryType } from '@nuvix/db'
import {
  PLATFORM_PERSISTENCE_MODEL,
  type PlatformPersistenceModel,
} from '../src/infrastructure/platform-persistence-model'
import {
  createTenantTargetResolver,
  type TenantTargetDocuments,
} from '../src/infrastructure/tenant-database-target'

function harness(result: Doc[] | Error) {
  const calls: Array<{ collection: string; queries: Query[] }> = []
  const documents: TenantTargetDocuments = {
    find: async (collection, queries = []) => {
      calls.push({ collection, queries })
      if (result instanceof Error) throw result
      return result
    },
  }
  return { calls, documents }
}

const document = (projectId: unknown, target: unknown) => new Doc({ projectId, target })

describe('tenant database target resolver', () => {
  test('resolves and freezes a validated PostgreSQL target', async () => {
    const target = {
      driver: 'postgresql',
      connectionString: 'postgresql://user:secret@example.test/tenant',
    } as const
    const state = harness([document('project_a', target)])

    const resolved = await createTenantTargetResolver(state.documents).resolve('project_a')

    expect(resolved).toEqual(target)
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  test('supports JSON-filter output and configurable collection fields', async () => {
    const model: PlatformPersistenceModel = {
      ...PLATFORM_PERSISTENCE_MODEL,
      collections: {
        ...PLATFORM_PERSISTENCE_MODEL.collections,
        tenantTargets: 'locations',
      },
      fields: {
        ...PLATFORM_PERSISTENCE_MODEL.fields,
        tenantTargets: { projectId: 'project', target: 'configuration' },
      },
    }
    const state = harness([
      new Doc({
        project: 'project_a',
        configuration: JSON.stringify({
          driver: 'postgresql',
          connectionString: 'postgresql://example.test/project_a',
        }),
      }),
    ])

    const resolved = await createTenantTargetResolver(state.documents, model).resolve('project_a')

    expect(resolved).toEqual({
      driver: 'postgresql',
      connectionString: 'postgresql://example.test/project_a',
    })
    expect(state.calls[0]?.collection).toBe('locations')
    expect(state.calls[0]?.queries.map((query) => query.getMethod())).toEqual([
      QueryType.Equal,
      QueryType.Select,
      QueryType.Limit,
    ])
    expect(state.calls[0]?.queries[1]?.getValues()).toEqual(['project', 'configuration'])
  })

  test.each([
    ['missing', []],
    [
      'duplicate',
      [
        document('project_a', {
          driver: 'postgresql',
          connectionString: 'postgresql://example.test/one',
        }),
        document('project_a', {
          driver: 'postgresql',
          connectionString: 'postgresql://example.test/two',
        }),
      ],
    ],
  ] as const)('fails closed for a %s target record', async (_case, records) => {
    const failure = await createTenantTargetResolver(harness([...records]).documents)
      .resolve('project_a')
      .catch((error: unknown) => error)

    expect((failure as Error).message).toBe('Tenant database target resolution failed')
  })

  test.each([
    document('other_project', {
      driver: 'postgresql',
      connectionString: 'postgresql://example.test/other',
    }),
    document('project_a', {
      driver: 'postgresql',
      connectionString: 'https://example.test',
    }),
    document('project_a', { driver: 'sqlite', filename: './secret.sqlite' }),
    document('project_a', {
      driver: 'sqlite',
      filename: ':memory:',
      unsupported: true,
    }),
    document('project_a', { driver: 'unknown', filename: ':memory:' }),
    document('project_a', 'not-json'),
  ])('rejects malformed, mismatched, or unsupported target data', async (record) => {
    const failure = await createTenantTargetResolver(harness([record]).documents)
      .resolve('project_a')
      .catch((error: unknown) => error)

    expect((failure as Error).message).toBe('Tenant database target resolution failed')
    expect(String(failure)).not.toContain('secret')
  })

  test('rejects malformed project IDs before persistence', async () => {
    const state = harness([])

    const failure = await createTenantTargetResolver(state.documents)
      .resolve('-invalid')
      .catch((error: unknown) => error)

    expect((failure as Error).message).toBe('Tenant database target resolution failed')
    expect(state.calls).toEqual([])
  })

  test('redacts persistence failures', async () => {
    const state = harness(new Error('failed at postgresql://user:secret@example.test/tenant'))

    const failure = await createTenantTargetResolver(state.documents)
      .resolve('project_a')
      .catch((error: unknown) => error)

    expect((failure as Error).message).toBe('Tenant database target resolution failed')
    expect(String(failure)).not.toContain('secret')
  })
})
