import { type CacheDriver, None } from '@nuvix/cache'
import { Adapter, Database } from '@nuvix/db'
import type { TenantDatabaseResource as RegistryTenantDatabaseResource } from './tenant-databases'

export interface TenantDatabaseClient {
  disconnect(): Promise<void>
}

export interface TenantDatabaseConstruction<AdapterResource, DatabaseResource> {
  readonly adapter: (connectionString: string) => AdapterResource
  readonly database: (adapter: AdapterResource, cache: CacheDriver) => DatabaseResource
  readonly client: (adapter: AdapterResource) => TenantDatabaseClient
  readonly none: () => CacheDriver
}

export interface TenantDatabaseResource<DatabaseResource = Database, AdapterResource = Adapter>
  extends RegistryTenantDatabaseResource<DatabaseResource> {
  readonly adapter: AdapterResource
  readonly cache: CacheDriver
}

const DEFAULT_CONSTRUCTION: TenantDatabaseConstruction<Adapter, Database> = {
  adapter: (connectionString) => new Adapter(connectionString),
  database: (adapter, cache) => new Database(adapter, cache),
  client: (adapter) => adapter.$client,
  none: () => new None(),
}

export function createTenantDatabaseResource(
  connectionString: string,
  cache?: CacheDriver,
): TenantDatabaseResource
export function createTenantDatabaseResource<AdapterResource, DatabaseResource>(
  connectionString: string,
  cache: CacheDriver | undefined,
  construction: TenantDatabaseConstruction<AdapterResource, DatabaseResource>,
): TenantDatabaseResource<DatabaseResource, AdapterResource>
export function createTenantDatabaseResource(
  connectionString: string,
  cache?: CacheDriver,
  construction?: unknown,
) {
  if (typeof connectionString !== 'string' || connectionString.trim() !== connectionString) {
    throw new TypeError('Tenant PostgreSQL connection string must be a normalized PostgreSQL URL')
  }
  try {
    const protocol = new URL(connectionString).protocol
    if (protocol !== 'postgres:' && protocol !== 'postgresql:') throw new Error('invalid protocol')
  } catch {
    throw new TypeError('Tenant PostgreSQL connection string must be a normalized PostgreSQL URL')
  }

  const dependencies = (construction ?? DEFAULT_CONSTRUCTION) as TenantDatabaseConstruction<
    unknown,
    unknown
  >
  const adapter = dependencies.adapter(connectionString)
  const selectedCache = cache ?? dependencies.none()
  const database = dependencies.database(adapter, selectedCache)
  const client = dependencies.client(adapter)
  let closePromise: Promise<void> | undefined

  return {
    adapter,
    cache: selectedCache,
    database,
    close: () => {
      closePromise ??= Promise.resolve().then(() => client.disconnect())
      return closePromise
    },
  }
}
