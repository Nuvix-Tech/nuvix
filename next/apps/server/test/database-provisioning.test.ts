import { describe, expect, test } from 'bun:test'
import { Database, DuplicateException, type Filter } from '@nuvix/db'
import { DATABASE_METADATA, type DatabaseMetadata } from '../src/infrastructure/database-metadata'
import {
  type PlatformDatabaseProvisioningAdmin,
  provisionPlatformDatabase,
  provisionTenantDatabase,
} from '../src/infrastructure/database-provisioning'
import { createTenantTargetFilters } from '../src/infrastructure/tenant-target-codec'

const TENANT_TARGET_FILTERS = await createTenantTargetFilters(
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
)
const PLATFORM_PROVISIONING_OPTIONS = {
  tenantTargetFilters: TENANT_TARGET_FILTERS,
} as const

const CAPABILITIES = {
  $limitForAttributes: 1_600,
  $limitForIndexes: 64,
  $supportForIndex: true,
  $supportForUniqueIndex: true,
}

function harness(
  options: {
    readonly collectionFailure?: {
      readonly id: string
      readonly error: Error
    }
    readonly createFailure?: Error
    readonly metadataVisibleAfterCreateFailure?: boolean
  } = {},
) {
  const events: string[] = []
  const existing = new Set<string>()
  const filters: Record<string, Filter> = {}
  const metadata: DatabaseMetadata[] = []
  const database = {
    create: async () => {
      events.push('create:metadata')
      if (options.createFailure) {
        if (options.metadataVisibleAfterCreateFailure) existing.add(Database.METADATA)
        throw options.createFailure
      }
      existing.add(Database.METADATA)
    },
    createCollection: async (definition: { readonly id: string }) => {
      events.push(`create:${definition.id}`)
      if (options.collectionFailure?.id === definition.id) throw options.collectionFailure.error
      existing.add(definition.id)
      return {} as never
    },
    exists: async (_database?: string, collection?: string) => {
      events.push(`exists:${collection ?? 'database'}`)
      return collection === undefined || existing.has(collection)
    },
    getAdapter: () => CAPABILITIES,
    getFilters: () => ({ ...filters }),
    addFilter: (name: string, filter: Filter) => {
      if (filters[name]) throw new Error(`duplicate filter: ${name}`)
      filters[name] = filter
    },
    setMeta: (value: DatabaseMetadata) => {
      metadata.push(value)
    },
  } as unknown as PlatformDatabaseProvisioningAdmin

  return { database, events, existing, filters, metadata }
}

describe('database metadata', () => {
  test('defines the exact immutable metadata for every supported database role', () => {
    expect(DATABASE_METADATA).toEqual({
      platform: {
        postgresql: {
          schema: 'internal',
          sharedTables: false,
          namespace: 'platform',
        },
        sqlite: { schema: 'main', sharedTables: false, namespace: 'platform' },
      },
      tenant: {
        postgresql: { schema: 'core', sharedTables: false, namespace: 'nx' },
      },
    })
    expect(
      [
        DATABASE_METADATA,
        DATABASE_METADATA.platform,
        DATABASE_METADATA.platform.postgresql,
        DATABASE_METADATA.platform.sqlite,
        DATABASE_METADATA.tenant,
        DATABASE_METADATA.tenant.postgresql,
      ].every(Object.isFrozen),
    ).toBe(true)
  })
})

describe('database provisioning', () => {
  test('initializes base metadata before fresh platform collections', async () => {
    const state = harness()

    await provisionPlatformDatabase(state.database, 'postgresql', PLATFORM_PROVISIONING_OPTIONS)

    expect(state.events).toEqual([
      'exists:_metadata',
      'create:metadata',
      'exists:platform_projects',
      'create:platform_projects',
      'exists:platform_tenant_targets',
      'create:platform_tenant_targets',
    ])
    expect(state.filters.json).toBe(TENANT_TARGET_FILTERS.json)
    expect(state.filters.encrypt).toBe(TENANT_TARGET_FILTERS.encrypt)
    expect(state.metadata).toEqual([DATABASE_METADATA.platform.postgresql])
  })

  test('initializes base metadata before fresh tenant auth and team collections', async () => {
    const state = harness()

    await provisionTenantDatabase(state.database)

    expect(state.events).toEqual([
      'exists:_metadata',
      'create:metadata',
      'exists:users',
      'create:users',
      'exists:sessions',
      'create:sessions',
      'exists:memberships',
      'create:memberships',
      'exists:api_keys',
      'create:api_keys',
      'exists:jwt_keys',
      'create:jwt_keys',
      'exists:teams',
      'create:teams',
      'exists:buckets',
      'create:buckets',
      'exists:objects',
      'create:objects',
      'exists:multipart_uploads',
      'create:multipart_uploads',
    ])
    expect(state.metadata).toEqual([DATABASE_METADATA.tenant.postgresql])
  })

  test.each([
    [
      'platform',
      (database: PlatformDatabaseProvisioningAdmin) =>
        provisionPlatformDatabase(database, 'sqlite', PLATFORM_PROVISIONING_OPTIONS),
    ],
    ['tenant', provisionTenantDatabase],
  ] as const)('does not recreate initialized %s database state', async (_name, provision) => {
    const state = harness()

    await provision(state.database)
    const firstPass = [...state.events]
    await provision(state.database)

    expect(state.events.filter((event) => event.startsWith('create:'))).toEqual(
      firstPass.filter((event) => event.startsWith('create:')),
    )
  })

  test('accepts a duplicate base initialization only after metadata becomes visible', async () => {
    const duplicate = new DuplicateException('metadata already exists')
    const state = harness({
      createFailure: duplicate,
      metadataVisibleAfterCreateFailure: true,
    })

    await provisionPlatformDatabase(state.database, 'postgresql', PLATFORM_PROVISIONING_OPTIONS)

    expect(state.events.slice(0, 3)).toEqual([
      'exists:_metadata',
      'create:metadata',
      'exists:_metadata',
    ])
    expect(state.events).toContain('create:platform_projects')
  })

  test('propagates non-duplicate base initialization failures before feature setup', async () => {
    const failure = new Error('base setup failed')
    const state = harness({ createFailure: failure })

    await expect(provisionTenantDatabase(state.database)).rejects.toBe(failure)
    expect(state.events).toEqual(['exists:_metadata', 'create:metadata'])
  })

  test('does not hide a duplicate failure when base metadata is still absent', async () => {
    const failure = new DuplicateException('unrelated duplicate')
    const state = harness({ createFailure: failure })

    await expect(
      provisionPlatformDatabase(state.database, 'postgresql', PLATFORM_PROVISIONING_OPTIONS),
    ).rejects.toBe(failure)
    expect(state.events).toEqual(['exists:_metadata', 'create:metadata', 'exists:_metadata'])
  })

  test('propagates feature setup failures and stops later tenant setup', async () => {
    const failure = new Error('auth setup failed')
    const state = harness({
      collectionFailure: { id: 'sessions', error: failure },
    })

    await expect(provisionTenantDatabase(state.database)).rejects.toBe(failure)
    expect(state.events).toContain('create:sessions')
    expect(state.events).not.toContain('exists:memberships')
    expect(state.events).not.toContain('exists:teams')
  })
})
