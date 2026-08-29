import type { Migration } from './migrations'
import { migrations } from './migrations'
import type { PlatformSqlQuery } from './pool'

const MIGRATION_LOCK_NAMESPACE = 1_315_217_481
const MIGRATION_LOCK_ID = 1

interface AppliedMigration {
  readonly id: string
}

export interface MigrationQuery extends PlatformSqlQuery {
  /** Executes SQL loaded exclusively from the trusted, immutable migration catalog. */
  execute(sql: string): Promise<void>
}

export interface MigrationDatabase {
  transaction<TResult>(operation: (query: MigrationQuery) => Promise<TResult>): Promise<TResult>
}

/** Applies pending migrations explicitly inside one advisory-locked transaction. */
export async function migrate(
  database: MigrationDatabase,
  catalog: readonly Migration[] = migrations,
): Promise<readonly string[]> {
  try {
    return await database.transaction(async (query) => {
      await query.query`
        SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_ID})
      `
      await query.query`
        CREATE TABLE IF NOT EXISTS platform_migrations (
          id text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `

      const rows = await query.query<readonly AppliedMigration[]>`
        SELECT id FROM platform_migrations ORDER BY id
      `
      const applied = new Set(rows.map((row) => row.id))
      const completed: string[] = []

      for (const migration of catalog) {
        if (applied.has(migration.id)) continue

        await query.execute(migration.sql)
        await query.query`
          INSERT INTO platform_migrations (id) VALUES (${migration.id})
        `
        completed.push(migration.id)
      }

      return completed
    })
  } catch {
    throw new Error('Platform migration failed')
  }
}
