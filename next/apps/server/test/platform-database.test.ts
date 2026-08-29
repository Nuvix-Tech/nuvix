import { describe, expect, test } from 'bun:test'
import { None } from '@nuvix/cache'
import type { DatabaseOptions, Doc } from '@nuvix/db'
import {
  type DatabaseCapabilitySource,
  requireDatabaseFeature,
  runDatabaseFeature,
} from '../src/infrastructure/database-capabilities'
import {
  createPlatformDatabase,
  type OwnedCacheDriver,
  type PlatformDatabaseConstruction,
  type PlatformLookupSession,
} from '../src/infrastructure/platform-database'

interface FakeAdapter extends DatabaseCapabilitySource {
  readonly selected: 'postgresql' | 'sqlite'
  readonly target: string
  readonly client: { disconnect(): Promise<void> }
}

interface FakeDatabase {
  readonly adapter: FakeAdapter
  readonly cache: OwnedCacheDriver
  readonly filters: DatabaseOptions['filters']
}

const capabilities = (
  overrides: Partial<DatabaseCapabilitySource> = {},
): DatabaseCapabilitySource => ({
  $documentSizeLimit: 16_777_216,
  $limitForAttributes: 1_600,
  $limitForIndexes: 64,
  $supportForAttributes: true,
  $supportForBatchOperations: true,
  $supportForFulltextIndex: true,
  $supportForIndex: true,
  $supportForIndexArray: true,
  $supportForJSONOverlaps: true,
  $supportForRelationships: true,
  $supportForSchemas: true,
  $supportForTimeouts: true,
  $supportForUniqueIndex: true,
  $supportForUpdateLock: true,
  ...overrides,
})

function harness(
  options: {
    readonly capabilityOverrides?: Partial<DatabaseCapabilitySource>
    readonly disconnect?: () => Promise<void>
    readonly database?: () => FakeDatabase
    readonly cache?: OwnedCacheDriver
    readonly session?: PlatformLookupSession
  } = {},
) {
  const selected: string[] = []
  const cache = options.cache ?? new None()
  const session: PlatformLookupSession = options.session ?? {
    find: async () => [],
    getDocument: async () => ({}) as Doc,
    findOne: async () => ({}) as Doc,
  }
  const makeAdapter = (driver: FakeAdapter['selected'], target: string): FakeAdapter => ({
    ...capabilities(options.capabilityOverrides),
    selected: driver,
    target,
    client: { disconnect: options.disconnect ?? (async () => {}) },
  })
  const construction: PlatformDatabaseConstruction<
    FakeAdapter,
    FakeDatabase,
    PlatformLookupSession
  > = {
    postgresql: (target) => {
      selected.push('postgresql')
      const adapter = makeAdapter('postgresql', target)
      return { adapter, client: adapter.client }
    },
    sqlite: (target) => {
      selected.push('sqlite')
      const adapter = makeAdapter('sqlite', target)
      return { adapter, client: adapter.client }
    },
    cache: () => cache,
    database: (adapter, selectedCache, filters) =>
      options.database?.() ?? { adapter, cache: selectedCache, filters },
    system: () => session,
    capabilitySource: (adapter) => adapter,
  }

  return { cache, construction, selected }
}

describe('platform database owner', () => {
  test.each([
    [
      {
        driver: 'postgresql',
        connectionString: 'postgresql://user:password@127.0.0.1:1/platform',
      },
    ],
    [{ driver: 'sqlite', filename: ':memory:' }],
  ] as const)('constructs and closes the public adapter for $driver', async (configuration) => {
    const owner = await createPlatformDatabase(configuration)

    expect(owner.capabilities.features.indexes).toBe(true)
    await owner.close()
  })

  test.each([
    [
      {
        driver: 'postgresql',
        connectionString: 'postgresql://example.test/platform',
      },
      'postgresql',
    ],
    [{ driver: 'sqlite', filename: './data/platform.sqlite' }, 'sqlite'],
  ] as const)('selects the configured $driver construction seam', async (configuration, driver) => {
    const state = harness()
    const owner = await createPlatformDatabase(configuration, {}, state.construction)

    expect(state.selected).toEqual([driver])
    expect(configuration.driver).toBe(driver)
    expect(Object.keys(owner).sort()).toEqual(['capabilities', 'close', 'lookups'])
    expect(Object.keys(owner.lookups).sort()).toEqual(['find', 'findOne', 'getDocument'])
    expect(owner.capabilities.limits).toEqual({
      attributes: 1_600,
      documentBytes: 16_777_216,
      indexes: 64,
    })

    await owner.close()
  })

  test('derives optional feature policy from capabilities', async () => {
    const state = harness({
      capabilityOverrides: {
        $supportForBatchOperations: false,
        $supportForFulltextIndex: false,
        $supportForIndexArray: false,
        $supportForJSONOverlaps: false,
        $supportForTimeouts: false,
        $supportForUpdateLock: false,
      },
    })
    const owner = await createPlatformDatabase(
      { driver: 'sqlite', filename: ':memory:' },
      {},
      state.construction,
    )

    expect(owner.capabilities.features).toEqual({
      attributes: true,
      arrayIndexes: false,
      batchOperations: false,
      fullTextSearch: false,
      indexes: true,
      jsonOverlaps: false,
      relationships: true,
      schemas: true,
      timeouts: false,
      uniqueIndexes: true,
      updateLocks: false,
    })
    expect(() => requireDatabaseFeature(owner.capabilities, 'fullTextSearch')).toThrow(
      'Database feature is not supported: fullTextSearch',
    )
    let persistenceCalls = 0
    const failure = await runDatabaseFeature(
      owner.capabilities,
      'jsonOverlaps',
      async () => ++persistenceCalls,
    ).catch((error: unknown) => error)
    expect((failure as Error).message).toBe('Database feature is not supported: jsonOverlaps')
    expect(persistenceCalls).toBe(0)

    await owner.close()
  })

  test('delegates only narrow lookups through the retained system session', async () => {
    const calls: string[][] = []
    const document = { source: 'system-session' } as unknown as Doc
    const state = harness({
      session: {
        find: async (collectionId) => {
          calls.push(['find', collectionId])
          return [document]
        },
        getDocument: async (collectionId, id) => {
          calls.push(['getDocument', collectionId, id])
          return document
        },
        findOne: async (collectionId) => {
          calls.push(['findOne', collectionId])
          return document
        },
      },
    })
    const owner = await createPlatformDatabase(
      { driver: 'sqlite', filename: ':memory:' },
      {},
      state.construction,
    )

    expect(await owner.lookups.find('projects')).toEqual([document])
    expect(await owner.lookups.getDocument('projects', 'project-id')).toBe(document)
    expect(await owner.lookups.findOne('projects')).toBe(document)
    expect(calls).toEqual([
      ['find', 'projects'],
      ['getDocument', 'projects', 'project-id'],
      ['findOne', 'projects'],
    ])

    await owner.close()
  })

  test.each([
    {
      driver: 'postgresql',
      connectionString: ' postgres://user:secret@example.test/db',
    },
    { driver: 'sqlite', filename: ' ./secret/platform.sqlite' },
  ] as const)('rejects invalid targets without disclosing them', async (configuration) => {
    const state = harness()
    const failure = await createPlatformDatabase(configuration, {}, state.construction).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(TypeError)
    expect((failure as Error).message).toBe('Platform database configuration is invalid')
    expect(String(failure)).not.toContain('secret')
    expect(state.selected).toEqual([])
  })

  test('rolls back constructed resources and redacts construction failures', async () => {
    let cacheCloses = 0
    let disconnects = 0
    const cache = new None()
    cache.close = async () => {
      cacheCloses += 1
    }
    const state = harness({
      cache,
      disconnect: async () => {
        disconnects += 1
      },
      database: () => {
        throw new Error('failed for postgresql://user:secret@example.test/platform')
      },
    })

    const failure = await createPlatformDatabase(
      {
        driver: 'postgresql',
        connectionString: 'postgresql://user:secret@example.test/platform',
      },
      {},
      state.construction,
    ).catch((error: unknown) => error)

    expect((failure as Error).message).toBe('Platform database initialization failed')
    expect(String(failure)).not.toContain('secret')
    expect({ cacheCloses, disconnects }).toEqual({
      cacheCloses: 1,
      disconnects: 1,
    })
  })

  test('closes cache and adapter once and preserves the close promise', async () => {
    let cacheCloses = 0
    let disconnects = 0
    const cache = new None()
    cache.close = async () => {
      cacheCloses += 1
    }
    const state = harness({
      cache,
      disconnect: async () => {
        disconnects += 1
      },
    })
    const owner = await createPlatformDatabase(
      { driver: 'sqlite', filename: ':memory:' },
      {},
      state.construction,
    )

    const first = owner.close()
    const concurrent = owner.close()
    await first
    const later = owner.close()
    await later

    expect({
      sameConcurrentPromise: concurrent === first,
      sameLaterPromise: later === first,
      cacheCloses,
      disconnects,
    }).toEqual({
      sameConcurrentPromise: true,
      sameLaterPromise: true,
      cacheCloses: 1,
      disconnects: 1,
    })
  })

  test('closes every resource and redacts provider failures in deterministic order', async () => {
    const cache = new None()
    cache.close = async () => {
      throw new Error('redis://user:secret@example.test')
    }
    const state = harness({
      cache,
      disconnect: async () => {
        throw new Error('/secret/platform.sqlite')
      },
    })
    const owner = await createPlatformDatabase(
      { driver: 'sqlite', filename: ':memory:' },
      {},
      state.construction,
    )

    const failure = await owner.close().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).message).toBe('Platform database close failed')
    expect((failure as AggregateError).errors.map((error) => error.message)).toEqual([
      'Platform database cache close failed',
      'Platform database adapter close failed',
    ])
    expect(String(failure)).not.toContain('secret')
  })
})
