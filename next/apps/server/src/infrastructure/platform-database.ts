import { type CacheDriver, None } from '@nuvix/cache'
import {
  Adapter,
  Database,
  type DatabaseOptions,
  type Doc,
  type Query,
  type Session,
  SQLiteAdapter,
} from '@nuvix/db'
import {
  type PlatformDatabaseConfiguration,
  validatePlatformDatabaseConfiguration,
} from './database-adapter-config'
import {
  type DatabaseCapabilities,
  type DatabaseCapabilitySource,
  deriveDatabaseCapabilities,
} from './database-capabilities'
import { DATABASE_METADATA } from './database-metadata'

interface DatabaseClient {
  disconnect(): Promise<void>
}

export interface OwnedAdapterResource<AdapterResource> {
  readonly adapter: AdapterResource
  readonly client: DatabaseClient
}

export interface OwnedCacheDriver extends CacheDriver {
  close(): Promise<void>
}

export interface PlatformLookupSession {
  find(collectionId: string, queries?: Query[]): Promise<Doc[]>
  getDocument(collectionId: string, id: string, queries?: Query[]): Promise<Doc>
  findOne(collectionId: string, queries?: Query[]): Promise<Doc>
}

export interface PlatformLookupCapabilities {
  find(collectionId: string, queries?: Query[]): Promise<Doc[]>
  getDocument(collectionId: string, id: string, queries?: Query[]): Promise<Doc>
  findOne(collectionId: string, queries?: Query[]): Promise<Doc>
}

export interface PlatformDatabaseConstruction<AdapterResource, DatabaseResource, SessionResource> {
  readonly postgresql: (connectionString: string) => OwnedAdapterResource<AdapterResource>
  readonly sqlite: (filename: string) => OwnedAdapterResource<AdapterResource>
  readonly cache: () => OwnedCacheDriver
  readonly database: (
    adapter: AdapterResource,
    cache: OwnedCacheDriver,
    filters: DatabaseOptions['filters'],
  ) => DatabaseResource
  readonly system: (database: DatabaseResource) => SessionResource
  readonly capabilitySource: (adapter: AdapterResource) => DatabaseCapabilitySource
}

export interface PlatformDatabaseOwner {
  readonly capabilities: DatabaseCapabilities
  readonly lookups: PlatformLookupCapabilities
  close(): Promise<void>
}

export interface PlatformDatabaseOptions {
  readonly cache?: OwnedCacheDriver
  readonly filters?: DatabaseOptions['filters']
}

type PublicAdapter = Adapter | SQLiteAdapter

const DEFAULT_CONSTRUCTION: PlatformDatabaseConstruction<PublicAdapter, Database, Session> = {
  postgresql: (connectionString) => {
    const adapter = new Adapter(connectionString).setMeta(DATABASE_METADATA.platform.postgresql)
    return { adapter, client: adapter.$client }
  },
  sqlite: (filename) => {
    const adapter = new SQLiteAdapter(filename).setMeta(DATABASE_METADATA.platform.sqlite)
    return { adapter, client: adapter.$client }
  },
  cache: () => new None(),
  database: (adapter, cache, filters) => new Database(adapter, cache, { filters }),
  system: (database) => database.system(),
  capabilitySource: (adapter) => adapter,
}

async function closeResources(
  cache: OwnedCacheDriver | undefined,
  client: DatabaseClient,
): Promise<void> {
  const failures: Error[] = []

  if (cache) {
    try {
      await cache.close()
    } catch {
      failures.push(new Error('Platform database cache close failed'))
    }
  }

  try {
    await client.disconnect()
  } catch {
    failures.push(new Error('Platform database adapter close failed'))
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Platform database close failed')
  }
}

function lookupCapabilities(session: PlatformLookupSession): PlatformLookupCapabilities {
  return Object.freeze({
    find: (collectionId: string, queries?: Query[]) => session.find(collectionId, queries),
    getDocument: (collectionId: string, id: string, queries?: Query[]) =>
      session.getDocument(collectionId, id, queries),
    findOne: (collectionId: string, queries?: Query[]) => session.findOne(collectionId, queries),
  })
}

export async function createPlatformDatabase<
  AdapterResource = PublicAdapter,
  DatabaseResource = Database,
  SessionResource extends PlatformLookupSession = Session,
>(
  input: PlatformDatabaseConfiguration,
  options: PlatformDatabaseOptions = {},
  construction: PlatformDatabaseConstruction<
    AdapterResource,
    DatabaseResource,
    SessionResource
  > = DEFAULT_CONSTRUCTION as unknown as PlatformDatabaseConstruction<
    AdapterResource,
    DatabaseResource,
    SessionResource
  >,
): Promise<PlatformDatabaseOwner> {
  const configuration = validatePlatformDatabaseConfiguration(input)
  let cache: OwnedCacheDriver | undefined
  let client: DatabaseClient | undefined

  try {
    const resource =
      configuration.driver === 'postgresql'
        ? construction.postgresql(configuration.connectionString)
        : construction.sqlite(configuration.filename)
    const { adapter } = resource
    client = resource.client
    cache = options.cache ?? construction.cache()
    const database = construction.database(adapter, cache, options.filters)
    const systemSession = construction.system(database)
    const capabilities = deriveDatabaseCapabilities(construction.capabilitySource(adapter))
    const lookups = lookupCapabilities(systemSession)
    const ownedClient = client
    let closePromise: Promise<void> | undefined

    return {
      capabilities,
      lookups,
      close: () => {
        closePromise ??= closeResources(cache, ownedClient)
        return closePromise
      },
    }
  } catch {
    if (client) await closeResources(cache, client).catch(() => undefined)
    throw new Error('Platform database initialization failed')
  }
}
