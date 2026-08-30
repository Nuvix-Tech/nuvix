import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createSchemaCatalog, type SchemaCatalog } from '../../src/database/catalog'
import { createSchemaService } from '../../src/database/service'
import {
  createTenantDatabaseResource,
  type TenantDatabaseResource,
} from '../../src/infrastructure/tenant-database-resource'
import { type PostgresTestResource, startPostgresResource } from './support/postgres-resource'

const live = process.env.NUVIX_LIVE_POSTGRES === '1' ? describe : describe.skip
const suffix = crypto.randomUUID().replaceAll('-', '')
const names = {
  managed: `it_managed_${suffix}`,
  document: `it_document_${suffix}`,
  failed: `it_failed_${suffix}`,
}

live('schema CRUD on nuvix/postgres:18.1', () => {
  let postgres: PostgresTestResource | undefined
  let resource: TenantDatabaseResource | undefined
  let catalog: SchemaCatalog | undefined

  beforeAll(async () => {
    const started = await startPostgresResource()
    postgres = started
    try {
      resource = createTenantDatabaseResource({
        driver: 'postgresql',
        connectionString: started.owner.connectionString(),
      })
      catalog = createSchemaCatalog(resource.postgres)
    } catch (error) {
      try {
        await started.close()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Live PostgreSQL setup and cleanup failed')
      }
      throw error
    }
  })

  afterAll(async () => {
    const failures: unknown[] = []
    if (catalog) {
      const currentCatalog = catalog
      const removals = await Promise.allSettled(
        Object.values(names).map((name) => currentCatalog.remove(name)),
      )
      failures.push(
        ...removals.filter((result) => result.status === 'rejected').map((result) => result.reason),
      )
    }
    if (resource) await resource.close().catch((error: unknown) => failures.push(error))
    if (postgres) await postgres.close().catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw new AggregateError(failures, 'Live PostgreSQL cleanup failed')
  })

  test('round-trips managed schema CRUD with reserved-schema exclusion and stable errors', async () => {
    if (!resource) throw new Error('PostgreSQL test resource was not initialized')
    const before = await resource.schemas.list()
    expect(before.data.map(({ name }) => name)).not.toContain('system')

    const created = await resource.schemas.create({
      name: names.managed,
      description: 'Integration schema',
      type: 'managed',
    })
    expect(created).toEqual({
      name: names.managed,
      description: 'Integration schema',
      type: 'managed',
    })
    expect(await resource.schemas.get(names.managed)).toEqual(created)

    const managed = await resource.schemas.list('managed')
    expect(managed.data).toContainEqual(created)
    expect(managed.meta.total).toBe(managed.data.length)

    const duplicate = await resource.schemas
      .create({ name: names.managed, type: 'document' })
      .catch((error: unknown) => error)
    expect(duplicate).toMatchObject({
      status: 409,
      fields: { type: '/errors/conflict', code: 'schema_already_exists' },
    })

    const updated = await resource.schemas.update(names.managed, null)
    expect(updated).toEqual({ ...created, description: null })

    await resource.schemas.remove(names.managed)
    const missing = await resource.schemas.get(names.managed).catch((error: unknown) => error)
    expect(missing).toMatchObject({
      status: 404,
      fields: { type: '/errors/not-found', code: 'schema_not_found' },
    })
  })

  test('bootstraps document metadata and removes a failed bootstrap schema', async () => {
    if (!resource || !catalog) throw new Error('PostgreSQL test resource was not initialized')
    await resource.schemas.create({ name: names.document, type: 'document' })

    const metadata = await resource.postgres
      .raw<readonly { exists: boolean }[]>(
        'select exists (select 1 from information_schema.tables where table_schema = ? and table_name = ?) as "exists"',
        [names.document, 'nx__metadata'],
      )
      .execute()
    expect(metadata[0]?.exists).toBe(true)

    const failing = createSchemaService({
      catalog,
      bootstrap: {
        initialize: async () => {
          throw new Error('induced bootstrap failure')
        },
      },
    })
    await expect(failing.create({ name: names.failed, type: 'document' })).rejects.toMatchObject({
      status: 500,
    })
    expect(await catalog.get(names.failed)).toBeUndefined()

    const physical = await resource.postgres
      .raw<readonly { exists: boolean }[]>(
        'select exists (select 1 from information_schema.schemata where schema_name = ?) as "exists"',
        [names.failed],
      )
      .execute()
    expect(physical[0]?.exists).toBe(false)
  })
})
