import { describe, expect, test } from 'bun:test'
import { type CacheDriver, None } from '@nuvix/cache'
import { Adapter, Database, SQLiteAdapter } from '@nuvix/db'
import type { TenantDatabaseTarget } from '../src/infrastructure/platform-persistence-model'
import {
  createTenantDatabaseResource,
  type TenantDatabaseConstruction,
} from '../src/infrastructure/tenant-database-resource'

interface FakeAdapter {
  readonly driver: TenantDatabaseTarget['driver']
  readonly value: string
  readonly client: { disconnect(): Promise<void> }
}

interface FakeDatabase {
  readonly adapter: FakeAdapter
  readonly cache: CacheDriver
}

function construction(
  options: { readonly disconnect?: () => Promise<void>; readonly none?: () => CacheDriver } = {},
): TenantDatabaseConstruction<FakeAdapter, FakeDatabase> {
  const adapter = (driver: FakeAdapter['driver'], value: string): FakeAdapter => ({
    driver,
    value,
    client: { disconnect: options.disconnect ?? (async () => {}) },
  })
  return {
    postgresql: (value) => adapter('postgresql', value),
    sqlite: (value) => adapter('sqlite', value),
    database: (selected, cache) => ({ adapter: selected, cache }),
    client: (selected) => selected.client,
    none: options.none ?? (() => new None()),
  }
}

describe('tenant database resource factory', () => {
  test.each([
    {
      target: {
        driver: 'postgresql',
        connectionString: 'postgresql://tenant.example.test/resolved',
      } as const,
      value: 'postgresql://tenant.example.test/resolved',
    },
    {
      target: { driver: 'sqlite', filename: './data/project.sqlite' } as const,
      value: './data/project.sqlite',
    },
  ])('selects and owns the $target.driver resource', ({ target, value }) => {
    const cache = new None()

    const resource = createTenantDatabaseResource(target, cache, construction())

    expect(resource.adapter).toMatchObject({ driver: target.driver, value })
    expect(resource.database.adapter).toBe(resource.adapter)
    expect(resource.database.cache).toBe(cache)
  })

  test.each([
    [
      {
        driver: 'postgresql',
        connectionString: 'postgresql://user:password@127.0.0.1:5432/tenant',
      } as const,
      Adapter,
    ],
    [{ driver: 'sqlite', filename: ':memory:' } as const, SQLiteAdapter],
  ])('constructs public @nuvix/db $target.driver resources', async (target, AdapterClass) => {
    const resource = createTenantDatabaseResource(target)

    try {
      expect(resource.adapter).toBeInstanceOf(AdapterClass)
      expect(resource.database).toBeInstanceOf(Database)
      expect(resource.cache).toBeInstanceOf(None)
    } finally {
      await resource.close()
    }
  })

  test('selects the default cache only when none is supplied', () => {
    const defaultCache = new None()
    let selections = 0
    const dependencies = construction({
      none: () => {
        selections += 1
        return defaultCache
      },
    })

    const generated = createTenantDatabaseResource(
      { driver: 'sqlite', filename: ':memory:' },
      undefined,
      dependencies,
    )
    const suppliedCache = new None()
    const supplied = createTenantDatabaseResource(
      { driver: 'sqlite', filename: ':memory:' },
      suppliedCache,
      dependencies,
    )

    expect(generated.cache).toBe(defaultCache)
    expect(supplied.cache).toBe(suppliedCache)
    expect(selections).toBe(1)
  })

  test.each([
    { driver: 'postgresql', connectionString: '' },
    { driver: 'postgresql', connectionString: 'https://example.test/tenant' },
    {
      driver: 'postgresql',
      connectionString: ' postgresql://example.test/tenant',
    },
    { driver: 'sqlite', filename: '' },
    { driver: 'sqlite', filename: ' ./data/tenant.sqlite' },
  ] as TenantDatabaseTarget[])('rejects invalid targets before construction', (target) => {
    let constructions = 0
    const dependencies = construction()
    const guarded: TenantDatabaseConstruction<FakeAdapter, FakeDatabase> = {
      ...dependencies,
      postgresql: (value) => {
        constructions += 1
        return dependencies.postgresql(value)
      },
      sqlite: (value) => {
        constructions += 1
        return dependencies.sqlite(value)
      },
    }

    expect(() => createTenantDatabaseResource(target, undefined, guarded)).toThrow(
      'Tenant database target is invalid',
    )
    expect(constructions).toBe(0)
  })

  test('closes the selected client once and preserves close failures', async () => {
    const failure = new Error('disconnect failed')
    let disconnects = 0
    const resource = createTenantDatabaseResource(
      { driver: 'sqlite', filename: ':memory:' },
      undefined,
      construction({
        disconnect: async () => {
          disconnects += 1
          throw failure
        },
      }),
    )

    const first = resource.close()

    expect(resource.close()).toBe(first)
    await expect(first).rejects.toBe(failure)
    await expect(resource.close()).rejects.toBe(failure)
    expect(disconnects).toBe(1)
  })
})
