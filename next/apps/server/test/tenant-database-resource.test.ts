import { describe, expect, test } from 'bun:test'
import { type CacheDriver, None } from '@nuvix/cache'
import { Adapter, Database } from '@nuvix/db'
import type { TenantDatabaseTarget } from '../src/infrastructure/platform-persistence-model'
import {
  createTenantDatabaseResource,
  type TenantDatabaseConstruction,
} from '../src/infrastructure/tenant-database-resource'

interface FakeAdapter {
  readonly sql: FakeSql
}

interface FakeDatabase {
  readonly adapter: FakeAdapter
  readonly cache: CacheDriver
}

interface FakePostgres {
  readonly sql: FakeSql
}

interface FakeSql {
  readonly value: string
  close(): Promise<void>
}

function construction(
  options: {
    readonly close?: () => Promise<void>
    readonly none?: () => CacheDriver
    readonly onSql?: (sql: FakeSql) => void
  } = {},
): TenantDatabaseConstruction<FakeSql, FakeAdapter, FakeDatabase, FakePostgres> {
  return {
    sql: (value) => ({ value, close: options.close ?? (async () => {}) }),
    postgresql: (sql) => {
      options.onSql?.(sql)
      return { sql }
    },
    database: (adapter, cache) => ({ adapter, cache }),
    postgres: (sql) => {
      options.onSql?.(sql)
      return { sql }
    },
    none: options.none ?? (() => new None()),
  }
}

const TARGET: TenantDatabaseTarget = {
  driver: 'postgresql',
  connectionString: 'postgresql://tenant.example.test/project_a',
}

describe('PostgreSQL tenant database resource factory', () => {
  test('constructs and owns the resolved PostgreSQL resource', () => {
    const cache = new None()
    const sharedSql: FakeSql[] = []

    const resource = createTenantDatabaseResource(
      TARGET,
      cache,
      construction({ onSql: (sql) => sharedSql.push(sql) }),
    )

    expect(resource.adapter.sql.value).toBe(TARGET.connectionString)
    expect(resource.postgres.sql).toBe(resource.adapter.sql)
    expect(sharedSql).toEqual([resource.adapter.sql, resource.adapter.sql])
    expect(resource.database.adapter).toBe(resource.adapter)
    expect(resource.database.cache).toBe(cache)
  })

  test('constructs production resources through public @nuvix/db exports', async () => {
    const resource = createTenantDatabaseResource({
      driver: 'postgresql',
      connectionString: 'postgresql://user:password@127.0.0.1:5432/tenant',
    })

    try {
      expect(resource.adapter).toBeInstanceOf(Adapter)
      expect(resource.database).toBeInstanceOf(Database)
      expect(resource.cache).toBeInstanceOf(None)
      expect(typeof resource.postgres.table).toBe('function')
      expect('sql' in resource).toBe(false)
      expect('client' in resource).toBe(false)
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

    const generated = createTenantDatabaseResource(TARGET, undefined, dependencies)
    const suppliedCache = new None()
    const supplied = createTenantDatabaseResource(TARGET, suppliedCache, dependencies)

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
    { driver: 'sqlite', filename: './secret/tenant.sqlite' },
  ])('rejects unsupported or invalid targets before construction', (target) => {
    let constructions = 0
    const dependencies = construction()
    const guarded: TenantDatabaseConstruction<FakeSql, FakeAdapter, FakeDatabase, FakePostgres> = {
      ...dependencies,
      sql: (value) => {
        constructions += 1
        return dependencies.sql(value)
      },
    }

    const failure = (() => {
      try {
        createTenantDatabaseResource(target as unknown as TenantDatabaseTarget, undefined, guarded)
      } catch (error) {
        return error
      }
    })()

    expect((failure as Error).message).toBe('Tenant database target is invalid')
    expect(String(failure)).not.toContain('secret')
    expect(constructions).toBe(0)
  })

  test('closes the SQL owner once and preserves close failures', async () => {
    const failure = new Error('close failed')
    let closes = 0
    const resource = createTenantDatabaseResource(
      TARGET,
      undefined,
      construction({
        close: async () => {
          closes += 1
          throw failure
        },
      }),
    )

    const first = resource.close()

    expect(resource.close()).toBe(first)
    await expect(first).rejects.toBe(failure)
    await expect(resource.close()).rejects.toBe(failure)
    expect(closes).toBe(1)
  })
})
