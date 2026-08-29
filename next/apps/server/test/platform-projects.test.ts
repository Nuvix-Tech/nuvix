import { describe, expect, test } from 'bun:test'
import { Doc, type Query, QueryType } from '@nuvix/db'
import {
  PLATFORM_PERSISTENCE_MODEL,
  type PlatformPersistenceModel,
} from '../src/infrastructure/platform-persistence-model'
import {
  createPlatformProjectLookup,
  type PlatformProjectDocuments,
} from '../src/infrastructure/platform-projects'

interface FindCall {
  readonly collectionId: string
  readonly queries: Query[]
}

function harness(result: Doc[] | Error) {
  const calls: FindCall[] = []
  const lookup: PlatformProjectDocuments = {
    find: async (collectionId, queries = []) => {
      calls.push({ collectionId, queries })
      if (result instanceof Error) throw result
      return result
    },
  }
  return { calls, lookup }
}

const document = (publicId: unknown, enabled: unknown, extra: Record<string, unknown> = {}) =>
  new Doc({ publicId, enabled, ...extra })

describe('adapter-neutral platform project lookup', () => {
  test.each(['PostgreSQL', 'SQLite'] as const)(
    'resolves the same safe project shape with a %s session fixture',
    async () => {
      const state = harness([
        document('project.demo-1', true, {
          internalId: 'private-sequence',
          target: 'postgresql://user:secret@example.test/tenant',
        }),
      ])

      const result = await createPlatformProjectLookup(state.lookup).resolve('project.demo-1')

      expect(result).toEqual({ id: 'project.demo-1', enabled: true })
      expect(Object.keys(result!)).toEqual(['id', 'enabled'])
      expect(Object.isFrozen(result)).toBe(true)
    },
  )

  test('uses model fields with a least-privilege portable projection', async () => {
    const model: PlatformPersistenceModel = {
      ...PLATFORM_PERSISTENCE_MODEL,
      collections: {
        ...PLATFORM_PERSISTENCE_MODEL.collections,
        projects: 'registry',
      },
      fields: {
        ...PLATFORM_PERSISTENCE_MODEL.fields,
        projects: { publicId: 'slug', enabled: 'active' },
      },
    }
    const state = harness([new Doc({ slug: 'custom_id', active: true })])

    await createPlatformProjectLookup(state.lookup, model).resolve('custom_id')

    expect(state.calls[0]?.collectionId).toBe('registry')
    expect(state.calls[0]?.queries.map((query) => query.getMethod())).toEqual([
      QueryType.Equal,
      QueryType.Select,
      QueryType.Limit,
    ])
    expect(state.calls[0]?.queries[0]?.getAttribute()).toBe('slug')
    expect(state.calls[0]?.queries[0]?.getValues()).toEqual(['custom_id'])
    expect(state.calls[0]?.queries[1]?.getValues()).toEqual(['slug', 'active'])
    expect(state.calls[0]?.queries[2]?.getValue()).toBe(2)
  })

  test.each([
    ['unknown', []],
    ['disabled', [document('project_a', false)]],
  ] as const)('fails closed with null for an %s project', async (_case, result) => {
    const state = harness([...result])

    const resolved = await createPlatformProjectLookup(state.lookup).resolve('project_a')

    expect(resolved).toBeNull()
  })

  test.each([
    ['', 'empty'],
    [' project_a', 'leading whitespace'],
    ['project a', 'embedded whitespace'],
    ['-project_a', 'leading special character'],
    ['a'.repeat(37), 'overlong'],
  ] as const)('rejects a %s identifier before persistence', async (publicId) => {
    const state = harness([])

    const failure = await createPlatformProjectLookup(state.lookup)
      .resolve(publicId)
      .catch((error: unknown) => error)

    expect((failure as Error).message).toBe('Platform project lookup failed')
    expect(state.calls).toEqual([])
  })

  test('rejects duplicate matches without exposing documents', async () => {
    const state = harness([
      document('project_a', true, { private: 'first-secret' }),
      document('project_a', true, { private: 'second-secret' }),
    ])

    const failure = await createPlatformProjectLookup(state.lookup)
      .resolve('project_a')
      .catch((error: unknown) => error)

    expect((failure as Error).message).toBe('Platform project lookup failed')
    expect(String(failure)).not.toContain('secret')
  })

  test.each([document(42, true), document('project_a', 'yes'), document('another_project', true)])(
    'rejects malformed or mismatched project documents',
    async (malformed) => {
      const state = harness([malformed])

      const failure = await createPlatformProjectLookup(state.lookup)
        .resolve('project_a')
        .catch((error: unknown) => error)

      expect((failure as Error).message).toBe('Platform project lookup failed')
    },
  )

  test('redacts persistence causes', async () => {
    const state = harness(new Error('postgresql://user:secret@example.test/platform'))

    const failure = await createPlatformProjectLookup(state.lookup)
      .resolve('project_a')
      .catch((error: unknown) => error)

    expect((failure as Error).message).toBe('Platform project lookup failed')
    expect(String(failure)).not.toContain('secret')
  })
})
