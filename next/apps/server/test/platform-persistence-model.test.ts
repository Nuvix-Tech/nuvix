import { describe, expect, test } from 'bun:test'
import { IndexType } from '@nuvix/db'
import {
  PLATFORM_PERSISTENCE_MODEL,
  type PlatformPersistenceModel,
  type TenantDatabaseTarget,
} from '../src/infrastructure/platform-persistence-model'
import {
  assertPlatformSchemaCapabilities,
  createPlatformCollectionDefinitions,
  type PlatformCollectionDefinition,
  type PlatformSchemaCapabilities,
  type PlatformSchemaDatabase,
  setupPlatformSchema,
} from '../src/infrastructure/platform-schema'

const POSTGRESQL_CAPABILITIES: PlatformSchemaCapabilities = {
  $limitForAttributes: 1_600,
  $limitForIndexes: 64,
  $supportForIndex: true,
  $supportForUniqueIndex: true,
}

const SQLITE_CAPABILITIES: PlatformSchemaCapabilities = {
  $limitForAttributes: 1_600,
  $limitForIndexes: 64,
  $supportForIndex: true,
  $supportForUniqueIndex: true,
}

function schemaHarness(capabilities: PlatformSchemaCapabilities) {
  const created: PlatformCollectionDefinition[] = []
  const existing = new Set<string>()
  const database = {
    createCollection: async (definition: PlatformCollectionDefinition) => {
      created.push(definition)
      existing.add(definition.id)
      return {} as never
    },
    exists: async (_database?: string, collection?: string) =>
      collection === undefined || existing.has(collection),
    getAdapter: () => capabilities,
  } as unknown as PlatformSchemaDatabase

  return { created, database, existing }
}

describe('platform persistence model', () => {
  test('keeps safe project data separate from the owner-only PostgreSQL target', () => {
    const target: TenantDatabaseTarget = {
      driver: 'postgresql',
      connectionString: 'postgresql://example.test/project',
    }

    expect(PLATFORM_PERSISTENCE_MODEL.collections).toEqual({
      projects: 'platform_projects',
      tenantTargets: 'platform_tenant_targets',
    })
    expect(JSON.stringify(PLATFORM_PERSISTENCE_MODEL)).not.toContain('credential')
    expect(target.driver).toBe('postgresql')
  })

  test('allows a different module-owned collection and field mapping', () => {
    const model: PlatformPersistenceModel = {
      collections: {
        projects: 'registry',
        tenantTargets: 'targets',
      },
      fields: {
        projects: { publicId: 'slug', enabled: 'active' },
        tenantTargets: { projectId: 'project', target: 'configuration' },
      },
    }

    const definitions = createPlatformCollectionDefinitions(model)

    expect(definitions.map(({ id }) => id)).toEqual(['registry', 'targets'])
    expect(definitions[0]?.attributes?.map((attribute) => attribute.getId())).toEqual([
      'slug',
      'active',
    ])
  })

  test.each([
    ['PostgreSQL', POSTGRESQL_CAPABILITIES],
    ['SQLite', SQLITE_CAPABILITIES],
  ] as const)('uses the same portable schema for %s capabilities', async (_name, capabilities) => {
    const state = schemaHarness(capabilities)

    await setupPlatformSchema(state.database)

    expect(state.created.map(({ id }) => id)).toEqual([
      'platform_projects',
      'platform_tenant_targets',
    ])
    expect(
      state.created.flatMap(({ indexes = [] }) => indexes.map((item) => item.get('type'))),
    ).not.toContain(IndexType.FullText)
  })

  test('is idempotent when the collections already exist', async () => {
    const state = schemaHarness(SQLITE_CAPABILITIES)
    state.existing.add('platform_projects')

    await setupPlatformSchema(state.database)

    expect(state.created.map(({ id }) => id)).toEqual(['platform_tenant_targets'])
  })

  test('rejects unsupported indexes before touching persistence', async () => {
    const state = schemaHarness({
      ...SQLITE_CAPABILITIES,
      $supportForUniqueIndex: false,
    })

    const setup = setupPlatformSchema(state.database)

    await expect(setup).rejects.toThrow('does not support the portable index contract')
    expect(state.created).toEqual([])
  })

  test('rejects adapter limits before touching persistence', async () => {
    const definitions = createPlatformCollectionDefinitions()

    expect(() =>
      assertPlatformSchemaCapabilities(
        { ...SQLITE_CAPABILITIES, $limitForAttributes: 1 },
        definitions,
      ),
    ).toThrow('exceeds the adapter attribute limit')
  })
})
