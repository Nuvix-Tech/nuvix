import { Database, DuplicateException } from '@nuvix/db'
import { setupTenantAuthSchema } from '../context/tenant-auth-schema'
import { setupTeamSchema } from '../teams/schema'
import { DATABASE_METADATA } from './database-metadata'
import { setupPlatformSchema } from './platform-schema'

export type DatabaseProvisioningAdmin = Pick<
  Database,
  'create' | 'createCollection' | 'exists' | 'getAdapter' | 'setMeta'
>

export type PlatformDatabaseDriver = keyof typeof DATABASE_METADATA.platform

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
  database: DatabaseProvisioningAdmin,
  driver: PlatformDatabaseDriver,
): Promise<void> {
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
}
