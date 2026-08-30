import { afterAll, describe, expect, test } from 'bun:test'
import { createSchemaCatalog } from '../../src/database/catalog'
import { createSchemaService } from '../../src/database/service'
import { createTenantDatabaseResource } from '../../src/infrastructure/tenant-database-resource'

const connectionString = process.env.NUVIX_SCHEMA_TEST_URL
const live = connectionString ? describe : describe.skip
const integrationUrl = connectionString ?? 'postgresql://integration-not-configured'
const suffix = crypto.randomUUID().replaceAll('-', '')
const names = {
  managed: `it_managed_${suffix}`,
  document: `it_document_${suffix}`,
  failed: `it_failed_${suffix}`,
}

live('schema CRUD on nuvix/postgres:18.1', () => {
  const resource = createTenantDatabaseResource({
    driver: 'postgresql',
    connectionString: integrationUrl,
  })
  const catalog = createSchemaCatalog(resource.postgres)

  afterAll(async () => {
    await Promise.allSettled(Object.values(names).map((name) => catalog.remove(name)))
    await resource.close()
  })

  test('round-trips managed schema CRUD with reserved-schema exclusion and stable errors', async () => {
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
