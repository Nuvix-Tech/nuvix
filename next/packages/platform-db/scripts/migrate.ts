import { SQL } from 'bun'

import { type MigrationDatabase, type MigrationQuery, migrate } from '../src/migrate'

const MIGRATION_POOL_OPTIONS = {
  max: 1,
  idleTimeout: 30,
  maxLifetime: 300,
  connectionTimeout: 10,
} as const

const USAGE_MESSAGE = 'Usage: bun run migrate:platform'
const CONFIGURATION_FAILURE_MESSAGE = 'Platform migration configuration is invalid'
const MIGRATION_FAILURE_MESSAGE = 'Platform migration failed'
const MIGRATION_SUCCESS_MESSAGE = 'Platform migrations completed'

export interface MigrationResource {
  readonly database: MigrationDatabase
  close(): Promise<void>
}

export interface MigrationCliDependencies {
  create(url: string): MigrationResource
  migrate(database: MigrationDatabase): Promise<readonly string[]>
  stdout(message: string): Promise<void>
  stderr(message: string): Promise<void>
}

export interface MigrationEnvironment {
  readonly NUVIX_INTERNAL_DATABASE_URL?: string
}

function resource(url: string): MigrationResource {
  const sql = new SQL(url, MIGRATION_POOL_OPTIONS)
  const database: MigrationDatabase = {
    transaction: (operation) =>
      sql.begin(async (transaction) => {
        const query: MigrationQuery = {
          query: async <TResult>(strings: TemplateStringsArray, ...values: readonly unknown[]) =>
            (await transaction(strings, ...values)) as TResult,
          execute: async (statement) => {
            await transaction.unsafe(statement)
          },
        }

        return operation(query)
      }),
  }

  return {
    database,
    close: () => sql.close(),
  }
}

const dependencies: MigrationCliDependencies = {
  create: resource,
  migrate,
  stdout: async (message) => {
    await Bun.stdout.write(`${message}\n`)
  },
  stderr: async (message) => {
    await Bun.stderr.write(`${message}\n`)
  },
}

async function emit(output: (message: string) => Promise<void>, message: string): Promise<boolean> {
  try {
    await output(message)
    return true
  } catch {
    return false
  }
}

/** Runs the explicit platform migration command without exposing sensitive failure details. */
export async function runMigrationCli(
  args: readonly string[],
  environment: MigrationEnvironment,
  injected: MigrationCliDependencies,
): Promise<number> {
  if (args.length !== 0) {
    await emit(injected.stderr, USAGE_MESSAGE)
    return 1
  }

  const url = environment.NUVIX_INTERNAL_DATABASE_URL
  if (typeof url !== 'string' || url.length === 0 || url.trim() !== url) {
    await emit(injected.stderr, CONFIGURATION_FAILURE_MESSAGE)
    return 1
  }

  let migrationResource: MigrationResource
  try {
    migrationResource = injected.create(url)
  } catch {
    await emit(injected.stderr, MIGRATION_FAILURE_MESSAGE)
    return 1
  }

  let failed = false
  try {
    await injected.migrate(migrationResource.database)
  } catch {
    failed = true
  }

  try {
    await migrationResource.close()
  } catch {
    failed = true
  }

  if (failed) {
    await emit(injected.stderr, MIGRATION_FAILURE_MESSAGE)
    return 1
  }

  const outputWritten = await emit(injected.stdout, MIGRATION_SUCCESS_MESSAGE)
  if (!outputWritten) {
    await emit(injected.stderr, MIGRATION_FAILURE_MESSAGE)
    return 1
  }

  return 0
}

if (import.meta.main) {
  process.exitCode = await runMigrationCli(
    process.argv.slice(2),
    { NUVIX_INTERNAL_DATABASE_URL: Bun.env.NUVIX_INTERNAL_DATABASE_URL },
    dependencies,
  )
}
