import { type CacheDriver, None } from '@nuvix/cache'
import { Adapter, Database } from '@nuvix/db'
import {
  createDatabase as createPostgresDatabase,
  type Database as PostgresDatabase,
} from '@nuvix/pg'
import { SQL } from 'bun'
import { createSchemaCatalog, type SchemaCatalog } from '../database/catalog'
import {
  createDocumentSchemaBootstrap,
  type DocumentSchemaAdmin,
} from '../database/document-schema'
import { createSchemaService, type SchemaService } from '../database/service'
import type { TenantDatabaseTarget } from './platform-persistence-model'
import type { TenantDatabaseResource as RegistryTenantDatabaseResource } from './tenant-databases'

export interface TenantSqlOwner {
  close(): Promise<void>
}

export interface TenantDatabaseConstruction<
  SqlResource extends TenantSqlOwner,
  AdapterResource,
  DatabaseResource,
  PostgresResource,
> {
  readonly sql: (connectionString: string) => SqlResource
  readonly postgresql: (sql: SqlResource) => AdapterResource
  readonly database: (adapter: AdapterResource, cache: CacheDriver) => DatabaseResource
  readonly postgres: (sql: SqlResource) => PostgresResource
  readonly catalog: (postgres: PostgresResource) => SchemaCatalog
  readonly documentAdmin: (
    sql: SqlResource,
    cache: CacheDriver,
    schema: string,
  ) => DocumentSchemaAdmin
  readonly none: () => CacheDriver
}

export interface TenantDatabaseResource<
  DatabaseResource = Database,
  AdapterResource = Adapter,
  PostgresResource = PostgresDatabase,
> extends RegistryTenantDatabaseResource<DatabaseResource> {
  readonly adapter: AdapterResource
  readonly cache: CacheDriver
  readonly postgres: PostgresResource
  readonly schemas: SchemaService
}

const DEFAULT_CONSTRUCTION: TenantDatabaseConstruction<SQL, Adapter, Database, PostgresDatabase> = {
  sql: (connectionString) => new SQL(connectionString),
  postgresql: (sql) => new Adapter(sql),
  database: (adapter, cache) => new Database(adapter, cache),
  postgres: (sql) => createPostgresDatabase(sql),
  catalog: (postgres) => createSchemaCatalog(postgres),
  documentAdmin: (sql, cache, schema) => new Database(new Adapter(sql).setMeta({ schema }), cache),
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
export function createTenantDatabaseResource<
  SqlResource extends TenantSqlOwner,
  AdapterResource,
  DatabaseResource,
  PostgresResource,
>(
  target: TenantDatabaseTarget,
  cache: CacheDriver | undefined,
  construction: TenantDatabaseConstruction<
    SqlResource,
    AdapterResource,
    DatabaseResource,
    PostgresResource
  >,
): TenantDatabaseResource<DatabaseResource, AdapterResource, PostgresResource>
export function createTenantDatabaseResource(
  input: TenantDatabaseTarget,
  cache?: CacheDriver,
  construction?: unknown,
) {
  const target = validate(input)
  const dependencies = (construction ?? DEFAULT_CONSTRUCTION) as TenantDatabaseConstruction<
    TenantSqlOwner,
    unknown,
    unknown,
    unknown
  >
  const sql = dependencies.sql(target.connectionString)
  const adapter = dependencies.postgresql(sql)
  const selectedCache = cache ?? dependencies.none()
  const database = dependencies.database(adapter, selectedCache)
  const postgres = dependencies.postgres(sql)
  const catalog = dependencies.catalog(postgres)
  const bootstrap = createDocumentSchemaBootstrap({
    forSchema: (schema) => dependencies.documentAdmin(sql, selectedCache, schema),
  })
  const schemas = createSchemaService({ catalog, bootstrap })
  let closePromise: Promise<void> | undefined

  return {
    adapter,
    cache: selectedCache,
    database,
    postgres,
    schemas,
    close: () => {
      closePromise ??= Promise.resolve().then(() => sql.close())
      return closePromise
    },
  }
}
