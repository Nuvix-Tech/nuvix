import { describe, expect, test } from 'bun:test'
import { type CacheDriver, None } from '@nuvix/cache'
import { Adapter, Database } from '@nuvix/db'
import {
  createTenantDatabaseResource,
  type TenantDatabaseConstruction,
} from '../src/infrastructure/tenant-database-resource'

interface FakeAdapter {
  readonly connectionString: string
  readonly client: { disconnect(): Promise<void> }
}

interface FakeDatabase {
  readonly adapter: FakeAdapter
  readonly cache: CacheDriver
}

function construction(
  options: { readonly disconnect?: () => Promise<void>; readonly none?: () => CacheDriver } = {},
): TenantDatabaseConstruction<FakeAdapter, FakeDatabase> {
  return {
    adapter: (connectionString) => ({
      connectionString,
      client: { disconnect: options.disconnect ?? (async () => {}) },
    }),
    database: (adapter, cache) => ({ adapter, cache }),
    client: (adapter) => adapter.client,
    none: options.none ?? (() => new None()),
  }
}

describe('tenant database resource factory', () => {
  test('constructs and owns resources from the resolved connection string', () => {
    // Arrange
    const connectionString = 'postgresql://tenant.example.test/resolved'
    const cache = new None()

    // Act
    const resource = createTenantDatabaseResource(connectionString, cache, construction())

    // Assert
    expect({
      connectionString: resource.adapter.connectionString,
      ownsAdapter: resource.database.adapter === resource.adapter,
      ownsCache: resource.cache === cache && resource.database.cache === cache,
    }).toEqual({ connectionString, ownsAdapter: true, ownsCache: true })
  })

  test('constructs production resources through public package exports', async () => {
    const resource = createTenantDatabaseResource(
      'postgresql://user:password@127.0.0.1:5432/tenant',
    )

    try {
      expect(resource.adapter).toBeInstanceOf(Adapter)
      expect(resource.database).toBeInstanceOf(Database)
      expect(resource.cache).toBeInstanceOf(None)
    } finally {
      await resource.close()
    }
  })

  test('selects the injected default cache when no cache is supplied', () => {
    // Arrange
    const defaultCache = new None()
    let selections = 0

    // Act
    const resource = createTenantDatabaseResource(
      'postgresql://tenant.example.test/default-cache',
      undefined,
      construction({
        none: () => {
          selections += 1
          return defaultCache
        },
      }),
    )

    // Assert
    expect({
      selectedCache: resource.cache === defaultCache,
      databaseCache: resource.database.cache === defaultCache,
      selections,
    }).toEqual({ selectedCache: true, databaseCache: true, selections: 1 })
  })

  test('uses a supplied cache without constructing the default', () => {
    // Arrange
    const cache = new None()
    let defaultSelections = 0

    // Act
    const resource = createTenantDatabaseResource(
      'postgresql://tenant.example.test/injected-cache',
      cache,
      construction({
        none: () => {
          defaultSelections += 1
          return new None()
        },
      }),
    )

    // Assert
    expect({
      selectedCache: resource.cache === cache,
      defaultSelections,
    }).toEqual({
      selectedCache: true,
      defaultSelections: 0,
    })
  })

  test('rejects empty connection values before constructing resources', () => {
    // Arrange
    let adapterConstructions = 0
    const dependencies = construction()
    const guardedConstruction: TenantDatabaseConstruction<FakeAdapter, FakeDatabase> = {
      ...dependencies,
      adapter: (connectionString) => {
        adapterConstructions += 1
        return dependencies.adapter(connectionString)
      },
    }

    // Act
    const createEmpty = () => createTenantDatabaseResource('', undefined, guardedConstruction)
    const createWhitespace = () =>
      createTenantDatabaseResource('   ', undefined, guardedConstruction)
    const createProjectId = () =>
      createTenantDatabaseResource('project_123', undefined, guardedConstruction)
    const createWrongProtocol = () =>
      createTenantDatabaseResource(
        'https://tenant.example.test/database',
        undefined,
        guardedConstruction,
      )
    const createUnnormalized = () =>
      createTenantDatabaseResource(
        ' postgresql://tenant.example.test/database ',
        undefined,
        guardedConstruction,
      )

    // Assert
    expect(createEmpty).toThrow('normalized PostgreSQL URL')
    expect(createWhitespace).toThrow('normalized PostgreSQL URL')
    expect(createProjectId).toThrow('normalized PostgreSQL URL')
    expect(createWrongProtocol).toThrow('normalized PostgreSQL URL')
    expect(createUnnormalized).toThrow('normalized PostgreSQL URL')
    expect(adapterConstructions).toBe(0)
  })

  test('closes the owned adapter client exactly once', async () => {
    // Arrange
    let disconnects = 0
    const resource = createTenantDatabaseResource(
      'postgresql://tenant.example.test/close',
      undefined,
      construction({
        disconnect: async () => {
          disconnects += 1
        },
      }),
    )

    // Act
    const firstClose = resource.close()
    const concurrentClose = resource.close()
    await firstClose
    const laterClose = resource.close()
    await laterClose

    // Assert
    expect({
      sameConcurrentPromise: concurrentClose === firstClose,
      sameLaterPromise: laterClose === firstClose,
      disconnects,
    }).toEqual({
      sameConcurrentPromise: true,
      sameLaterPromise: true,
      disconnects: 1,
    })
  })

  test('preserves a failed close without disconnecting again', async () => {
    const disconnectError = new Error('disconnect failed')
    let disconnects = 0
    const resource = createTenantDatabaseResource(
      'postgresql://tenant.example.test/failed-close',
      undefined,
      construction({
        disconnect: async () => {
          disconnects += 1
          throw disconnectError
        },
      }),
    )

    const firstClose = resource.close()

    expect(resource.close()).toBe(firstClose)
    await expect(firstClose).rejects.toBe(disconnectError)
    await expect(resource.close()).rejects.toBe(disconnectError)
    expect(disconnects).toBe(1)
  })
})
