import { type CacheDriver, None } from '@nuvix/cache'
import { Adapter, Database } from '@nuvix/db'
import type { TenantDatabaseTarget } from './platform-persistence-model'
import type { TenantDatabaseResource as RegistryTenantDatabaseResource } from './tenant-databases'

export interface TenantDatabaseClient {
  disconnect(): Promise<void>
}

export interface TenantDatabaseConstruction<AdapterResource, DatabaseResource> {
  readonly postgresql: (connectionString: string) => AdapterResource
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
  postgresql: (connectionString) => new Adapter(connectionString),
  database: (adapter, cache) => new Database(adapter, cache),
  client: (adapter) => adapter.$client,
  none: () => new None(),
}

function normalized(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.trim() === value && !value.includes('\0')
  )
}

function validate(value: unknown): TenantDatabaseTarget {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('driver' in value) ||
    value.driver !== 'postgresql' ||
    !('connectionString' in value) ||
    !normalized(value.connectionString)
  ) {
    throw new TypeError('Tenant database target is invalid')
  }
  try {
    const protocol = new URL(value.connectionString).protocol
    if (protocol !== 'postgres:' && protocol !== 'postgresql:') throw new Error('protocol')
  } catch {
    throw new TypeError('Tenant database target is invalid')
  }
  return { driver: 'postgresql', connectionString: value.connectionString }
}

export function createTenantDatabaseResource(
  target: TenantDatabaseTarget,
  cache?: CacheDriver,
): TenantDatabaseResource
export function createTenantDatabaseResource<AdapterResource, DatabaseResource>(
  target: TenantDatabaseTarget,
  cache: CacheDriver | undefined,
  construction: TenantDatabaseConstruction<AdapterResource, DatabaseResource>,
): TenantDatabaseResource<DatabaseResource, AdapterResource>
export function createTenantDatabaseResource(
  input: TenantDatabaseTarget,
  cache?: CacheDriver,
  construction?: unknown,
) {
  const target = validate(input)
  const dependencies = (construction ?? DEFAULT_CONSTRUCTION) as TenantDatabaseConstruction<
    unknown,
    unknown
  >
  const adapter = dependencies.postgresql(target.connectionString)
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
