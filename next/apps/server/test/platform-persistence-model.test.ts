import { describe, expect, test } from 'bun:test'
import { None } from '@nuvix/cache'
import {
  AuthorizationException,
  Database,
  Doc,
  IndexType,
  Permission,
  Role,
  SQLiteAdapter,
} from '@nuvix/db'
import { DATABASE_METADATA } from '../src/infrastructure/database-metadata'
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

async function permissionDatabase(): Promise<Database> {
  const adapter = new SQLiteAdapter(':memory:').setMeta(DATABASE_METADATA.platform.sqlite)
  const database = new Database(adapter, new None())
  await database.create()

  for (const definition of createPlatformCollectionDefinitions()) {
    // Keep this fixture on authorization only; tenant-target codec behavior has
    // its own slice and does not affect collection-level access decisions.
    await database.createCollection({
      id: definition.id,
      permissions: definition.permissions,
      documentSecurity: definition.documentSecurity,
    })
  }

  return database
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

  test('defines both platform collections with exact owner-only permissions', () => {
    const definitions = createPlatformCollectionDefinitions()

    expect(
      definitions.map(({ id, permissions, documentSecurity }) => ({
        id,
        permissions,
        documentSecurity,
      })),
    ).toEqual([
      {
        id: 'platform_projects',
        permissions: [],
        documentSecurity: false,
      },
      {
        id: 'platform_tenant_targets',
        permissions: [],
        documentSecurity: false,
      },
    ])
  })

  test('keeps both platform collections inaccessible to non-system sessions', async () => {
    const database = await permissionDatabase()
    const system = database.system()
    const caller = database.for(
      Role.any().toString(),
      Role.users().toString(),
      Role.user('caller').toString(),
    )

    try {
      for (const collectionId of Object.values(PLATFORM_PERSISTENCE_MODEL.collections)) {
        const id = `${collectionId}-owner-record`
        const widenedDocumentPermissions = [
          Permission.read(Role.any()),
          Permission.update(Role.any()),
          Permission.delete(Role.any()),
        ]
        await system.createDocument(
          collectionId,
          new Doc({ $id: id, $permissions: widenedDocumentPermissions }),
        )

        await expect(
          caller.createDocument(
            collectionId,
            new Doc({
              $id: `${collectionId}-denied`,
              $permissions: widenedDocumentPermissions,
            }),
          ),
        ).rejects.toBeInstanceOf(AuthorizationException)
        await expect(caller.getDocument(collectionId, id)).rejects.toBeInstanceOf(
          AuthorizationException,
        )
        await expect(
          caller.updateDocument(collectionId, id, new Doc({ changed: true })),
        ).rejects.toBeInstanceOf(AuthorizationException)
        await expect(caller.deleteDocument(collectionId, id)).rejects.toBeInstanceOf(
          AuthorizationException,
        )

        expect((await system.getDocument(collectionId, id)).getId()).toBe(id)
      }
    } finally {
      await database.getAdapter<SQLiteAdapter>().$client.disconnect()
    }
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
