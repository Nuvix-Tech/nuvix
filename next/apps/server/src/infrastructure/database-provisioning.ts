import { Database, DuplicateException, type Filter } from '@nuvix/db'
import { setupTenantAuthSchema } from '../context/tenant-auth-schema'
import { setupMessagingSchema } from '../messaging/schema'
import { setupStorageSchema } from '../storage/schema'
import { setupTeamSchema } from '../teams/schema'
import { setupWebhookSchema } from '../webhooks/schema'
import { DATABASE_METADATA } from './database-metadata'
import { setupPlatformSchema } from './platform-schema'
import {
  TenantTargetCodecConfigurationError,
  type TenantTargetFilters,
} from './tenant-target-codec'

export type DatabaseProvisioningAdmin = Pick<
  Database,
  'create' | 'createCollection' | 'exists' | 'getAdapter' | 'setMeta'
>

export type PlatformDatabaseProvisioningAdmin = DatabaseProvisioningAdmin &
  Pick<Database, 'addFilter' | 'getFilters'>

export interface PlatformDatabaseProvisioningOptions {
  readonly tenantTargetFilters: TenantTargetFilters
}

export type PlatformDatabaseDriver = keyof typeof DATABASE_METADATA.platform

function addFilter(
  database: PlatformDatabaseProvisioningAdmin,
  name: 'json' | 'encrypt',
  filter: Filter,
): void {
  const configured = database.getFilters()[name]
  if (configured === filter) return
  if (configured) throw new TenantTargetCodecConfigurationError()
  database.addFilter(name, filter)
}

function configureTenantTargetFilters(
  database: PlatformDatabaseProvisioningAdmin,
  filters: TenantTargetFilters,
): void {
  addFilter(database, 'json', filters.json)
  addFilter(database, 'encrypt', filters.encrypt)
}

async function setupMetadata(database: DatabaseProvisioningAdmin): Promise<void> {
  if (await database.exists(undefined, Database.METADATA)) return

  // Database.create() always attempts metadata collection creation, even when
  // its schema already exists. A verified duplicate is therefore the only
  // safe race to treat as successful initialization.
  try {
    await database.create()
  } catch (error) {
    if (!(error instanceof DuplicateException)) throw error
    if (!(await database.exists(undefined, Database.METADATA))) throw error
  }
}

/** Explicit owner-only setup for an adapter-neutral platform database. */
export async function provisionPlatformDatabase(
  database: PlatformDatabaseProvisioningAdmin,
  driver: PlatformDatabaseDriver,
  options: PlatformDatabaseProvisioningOptions,
): Promise<void> {
  configureTenantTargetFilters(database, options.tenantTargetFilters)
  database.setMeta(DATABASE_METADATA.platform[driver])
  await setupMetadata(database)
  await setupPlatformSchema(database)
}

/** Explicit owner-only setup for a PostgreSQL tenant database. */
export async function provisionTenantDatabase(database: DatabaseProvisioningAdmin): Promise<void> {
  database.setMeta(DATABASE_METADATA.tenant.postgresql)
  await setupMetadata(database)
  await setupTenantAuthSchema(database)
  await setupTeamSchema(database)
  await setupStorageSchema(database)
  await setupMessagingSchema(database)
  await setupWebhookSchema(database)
}
