import { None } from '@nuvix/cache'
import { Adapter, Database, Doc, SQLiteAdapter } from '@nuvix/db'
import type { PlatformDatabaseConfiguration } from '../../../src/infrastructure/database-adapter-config'
import { DATABASE_METADATA } from '../../../src/infrastructure/database-metadata'
import {
  type PlatformDatabaseDriver,
  provisionPlatformDatabase,
} from '../../../src/infrastructure/database-provisioning'
import {
  PLATFORM_PERSISTENCE_MODEL,
  type TenantDatabaseTarget,
} from '../../../src/infrastructure/platform-persistence-model'
import {
  createTenantTargetFilters,
  type TenantTargetFilters,
} from '../../../src/infrastructure/tenant-target-codec'
import { startPostgresResource } from './postgres-resource'

const SQLITE_FIXTURE_DIRECTORY = '/tmp/opencode'
const SQLITE_FILENAME_PATTERN = /^\/tmp\/opencode\/[a-zA-Z0-9._-]+\.sqlite$/
const TARGET_KEY_BYTES = 32

export const PLATFORM_FIXTURE_DRIVERS = ['sqlite', 'postgresql'] as const

export interface PlatformFixtureProject {
  readonly id: string
  readonly enabled: boolean
  readonly target?: TenantDatabaseTarget
}

export interface PlatformFixtureOptions {
  readonly driver: PlatformDatabaseDriver
  readonly projects: readonly PlatformFixtureProject[]
  readonly sqliteFilename?: string
}

export interface PlatformFixtureRuntimeOptions {
  readonly database: PlatformDatabaseConfiguration
  readonly tenantTargetFilters: TenantTargetFilters
}

export interface PlatformFixtureOwner {
  inspectTargetCiphertext(projectId: string): Promise<string>
  corruptTargetCiphertext(projectId: string): Promise<void>
  assertNoSensitiveValues(value: string): Promise<void>
  assertNoClientConnections(): Promise<void>
  assertRemoved(): Promise<void>
  close(): Promise<void>
}

export interface PlatformFixture {
  readonly driver: PlatformDatabaseDriver
  readonly runtime: PlatformFixtureRuntimeOptions
  readonly owner: PlatformFixtureOwner
}

interface PlatformBackingResource {
  readonly configuration: PlatformDatabaseConfiguration
  assertNoClientConnections(): Promise<void>
  assertRemoved(): Promise<void>
  close(): Promise<void>
}

type PlatformAdapter = Adapter | SQLiteAdapter

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function targetKey(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(TARGET_KEY_BYTES)))
}

function generatedSQLiteFilename(): string {
  const identifier = crypto.randomUUID().replaceAll('-', '').toLowerCase()
  return `${SQLITE_FIXTURE_DIRECTORY}/nuvix-platform-${process.pid}-${identifier}.sqlite`
}

function validateSQLiteFilename(filename: string): void {
  if (filename === ':memory:' || !SQLITE_FILENAME_PATTERN.test(filename)) {
    throw new TypeError('SQLite platform fixture requires a unique real file')
  }
}

function sqliteFiles(filename: string): readonly string[] {
  return [filename, `${filename}-journal`, `${filename}-shm`, `${filename}-wal`]
}

async function removeSQLiteFiles(filename: string): Promise<void> {
  const failures: Error[] = []
  for (const path of sqliteFiles(filename)) {
    try {
      const file = Bun.file(path)
      if (await file.exists()) await file.delete()
    } catch {
      failures.push(new Error('SQLite platform fixture file cleanup failed'))
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'SQLite platform fixture cleanup failed')
  }
}

async function assertSQLiteFilesRemoved(filename: string): Promise<void> {
  const retained = await Promise.all(sqliteFiles(filename).map((path) => Bun.file(path).exists()))
  if (retained.some(Boolean)) {
    throw new Error('SQLite platform fixture retained a file after cleanup')
  }
}

async function sqliteBacking(filename: string): Promise<PlatformBackingResource> {
  validateSQLiteFilename(filename)
  if (
    (await Promise.all(sqliteFiles(filename).map((path) => Bun.file(path).exists()))).some(Boolean)
  ) {
    throw new Error('SQLite platform fixture file already exists')
  }

  return Object.freeze({
    configuration: Object.freeze({ driver: 'sqlite' as const, filename }),
    assertNoClientConnections: async () => {},
    assertRemoved: () => assertSQLiteFilesRemoved(filename),
    close: () => removeSQLiteFiles(filename),
  })
}

async function postgresBacking(): Promise<PlatformBackingResource> {
  const postgres = await startPostgresResource()
  return Object.freeze({
    configuration: Object.freeze({
      driver: 'postgresql' as const,
      connectionString: postgres.owner.connectionString(),
    }),
    assertNoClientConnections: () => postgres.owner.assertNoClientConnections(),
    assertRemoved: () => postgres.owner.assertRemoved(),
    close: () => postgres.close(),
  })
}

async function backing(options: PlatformFixtureOptions): Promise<PlatformBackingResource> {
  if (options.driver === 'postgresql') return postgresBacking()
  return sqliteBacking(options.sqliteFilename ?? generatedSQLiteFilename())
}

function adapter(configuration: PlatformDatabaseConfiguration): PlatformAdapter {
  if (configuration.driver === 'postgresql') return new Adapter(configuration.connectionString)
  return new SQLiteAdapter(configuration.filename)
}

async function closeProvisioning(adapter: PlatformAdapter, cache: None): Promise<void> {
  const failures: Error[] = []
  await cache.close().catch(() => failures.push(new Error('Platform fixture cache close failed')))
  await adapter.$client
    .disconnect()
    .catch(() => failures.push(new Error('Platform fixture adapter close failed')))
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Platform fixture provisioning close failed')
  }
}

async function seed(
  configuration: PlatformDatabaseConfiguration,
  filters: TenantTargetFilters,
  projects: readonly PlatformFixtureProject[],
): Promise<void> {
  const selectedAdapter = adapter(configuration)
  const cache = new None()
  let setupFailure: unknown

  try {
    const database = new Database(selectedAdapter, cache)
    await provisionPlatformDatabase(database, configuration.driver, {
      tenantTargetFilters: filters,
    })
    const system = database.system()
    for (const project of projects) {
      await system.createDocument(
        PLATFORM_PERSISTENCE_MODEL.collections.projects,
        new Doc({
          $id: project.id,
          publicId: project.id,
          enabled: project.enabled,
        }),
      )
      if (project.target === undefined) continue
      await system.createDocument(
        PLATFORM_PERSISTENCE_MODEL.collections.tenantTargets,
        new Doc({
          $id: project.id,
          projectId: project.id,
          target: project.target,
        }),
      )
    }
  } catch (error) {
    setupFailure = error
  }

  const cleanupFailure = await closeProvisioning(selectedAdapter, cache).catch(
    (error: unknown) => error,
  )
  if (setupFailure && cleanupFailure) {
    throw new AggregateError(
      [setupFailure, cleanupFailure],
      'Platform fixture provisioning and cleanup failed',
    )
  }
  if (setupFailure) throw setupFailure
  if (cleanupFailure) throw cleanupFailure
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function postgresTargetTable(): string {
  const metadata = DATABASE_METADATA.platform.postgresql
  const table = `${metadata.namespace}_${PLATFORM_PERSISTENCE_MODEL.collections.tenantTargets}`
  return `${quote(metadata.schema)}.${quote(table)}`
}

async function sqliteTargetTable(selectedAdapter: SQLiteAdapter): Promise<string> {
  const suffix = `_${PLATFORM_PERSISTENCE_MODEL.collections.tenantTargets}`
  const result = await selectedAdapter.$client.query<{ name: unknown }>(
    'SELECT "name" FROM "sqlite_schema" WHERE "type" = ? AND "name" LIKE ?',
    ['table', `%${suffix}`],
  )
  const names = result.rows
    .map(({ name }) => name)
    .filter((name): name is string => typeof name === 'string' && name.endsWith(suffix))
  if (names.length !== 1) throw new Error('Platform fixture target table inspection failed')
  return quote(names[0]!)
}

async function inspectTargetCiphertext(
  configuration: PlatformDatabaseConfiguration,
  projectId: string,
): Promise<string> {
  // Raw access is intentionally confined to this test-owner seam so assertions
  // can observe storage before the production document filters decode it.
  const selectedAdapter = adapter(configuration)
  let inspectionFailure: unknown
  let value: unknown

  try {
    selectedAdapter.setMeta(DATABASE_METADATA.platform[configuration.driver])
    const table =
      selectedAdapter instanceof SQLiteAdapter
        ? await sqliteTargetTable(selectedAdapter)
        : postgresTargetTable()
    const result = await selectedAdapter.$client.query<{ target: unknown }>(
      `SELECT ${quote(PLATFORM_PERSISTENCE_MODEL.fields.tenantTargets.target)} AS "target" FROM ${table} WHERE ${quote(PLATFORM_PERSISTENCE_MODEL.fields.tenantTargets.projectId)} = ?`,
      [projectId],
    )
    if (result.rows.length !== 1) throw new Error('Platform fixture target inspection failed')
    value = result.rows[0]!.target
  } catch {
    inspectionFailure = new Error('Platform fixture target inspection failed')
  }

  const cleanupFailure = await selectedAdapter.$client
    .disconnect()
    .catch(() => new Error('Platform fixture inspection close failed'))
  if (inspectionFailure && cleanupFailure) {
    throw new AggregateError(
      [inspectionFailure, cleanupFailure],
      'Platform fixture inspection and cleanup failed',
    )
  }
  if (inspectionFailure) throw inspectionFailure
  if (cleanupFailure) throw cleanupFailure
  if (typeof value !== 'string') throw new Error('Platform fixture target inspection failed')
  return value
}

function tamper(ciphertext: string): string {
  const replacement = ciphertext.endsWith('A') ? 'B' : 'A'
  return `${ciphertext.slice(0, -1)}${replacement}`
}

async function corruptTargetCiphertext(
  configuration: PlatformDatabaseConfiguration,
  projectId: string,
): Promise<void> {
  // Raw mutation is intentionally confined to this test-owner seam. Public
  // document writes would re-encrypt the value and could not model at-rest corruption.
  const selectedAdapter = adapter(configuration)
  let mutationFailure: unknown

  try {
    selectedAdapter.setMeta(DATABASE_METADATA.platform[configuration.driver])
    const table =
      selectedAdapter instanceof SQLiteAdapter
        ? await sqliteTargetTable(selectedAdapter)
        : postgresTargetTable()
    const field = quote(PLATFORM_PERSISTENCE_MODEL.fields.tenantTargets.target)
    const projectField = quote(PLATFORM_PERSISTENCE_MODEL.fields.tenantTargets.projectId)
    const result = await selectedAdapter.$client.query<{ target: unknown }>(
      `SELECT ${field} AS "target" FROM ${table} WHERE ${projectField} = ?`,
      [projectId],
    )
    const ciphertext = result.rows[0]?.target
    if (result.rows.length !== 1 || typeof ciphertext !== 'string') {
      throw new Error('missing target')
    }
    await selectedAdapter.$client.query(
      `UPDATE ${table} SET ${field} = ? WHERE ${projectField} = ?`,
      [tamper(ciphertext), projectId],
    )
  } catch {
    mutationFailure = new Error('Platform fixture target corruption failed')
  }

  const cleanupFailure = await selectedAdapter.$client
    .disconnect()
    .catch(() => new Error('Platform fixture mutation close failed'))
  if (mutationFailure && cleanupFailure) {
    throw new AggregateError(
      [mutationFailure, cleanupFailure],
      'Platform fixture mutation and cleanup failed',
    )
  }
  if (mutationFailure) throw mutationFailure
  if (cleanupFailure) throw cleanupFailure
}

function connectionCanaries(connectionString: string): readonly string[] {
  try {
    const parsed = new URL(connectionString)
    return [connectionString, parsed.username, parsed.password, parsed.host].filter(
      (value) => value.length >= 8,
    )
  } catch {
    return [connectionString]
  }
}

async function assertNoSensitiveValues(
  value: string,
  configuration: PlatformDatabaseConfiguration,
  encryptionKey: string,
  projects: readonly PlatformFixtureProject[],
): Promise<void> {
  const targetProjects = projects.filter(
    (
      project,
    ): project is PlatformFixtureProject & {
      readonly target: TenantDatabaseTarget
    } => project.target !== undefined,
  )
  const ciphertexts = await Promise.all(
    targetProjects.map((project) => inspectTargetCiphertext(configuration, project.id)),
  )
  const storageCanaries =
    configuration.driver === 'sqlite'
      ? [configuration.filename]
      : connectionCanaries(configuration.connectionString)
  const canaries = [
    encryptionKey,
    ...storageCanaries,
    ...targetProjects.flatMap((project) => connectionCanaries(project.target.connectionString)),
    ...ciphertexts,
  ]

  if (canaries.some((canary) => canary.length > 0 && value.includes(canary))) {
    throw new Error('Platform fixture sensitive value leaked into request diagnostics')
  }
}

export async function createPlatformFixture(
  options: PlatformFixtureOptions,
): Promise<PlatformFixture> {
  const encryptionKey = targetKey()
  const tenantTargetFilters = await createTenantTargetFilters(encryptionKey)
  const resource = await backing(options)

  try {
    await seed(resource.configuration, tenantTargetFilters, options.projects)
  } catch (error) {
    const cleanupFailure = await resource.close().catch((failure: unknown) => failure)
    if (cleanupFailure) {
      throw new AggregateError([error, cleanupFailure], 'Platform fixture setup and cleanup failed')
    }
    throw error
  }

  let closePromise: Promise<void> | undefined
  const runtime = Object.freeze({
    database: resource.configuration,
    tenantTargetFilters,
  })
  const owner = Object.freeze({
    inspectTargetCiphertext: (projectId: string) =>
      inspectTargetCiphertext(resource.configuration, projectId),
    corruptTargetCiphertext: (projectId: string) =>
      corruptTargetCiphertext(resource.configuration, projectId),
    assertNoSensitiveValues: (value: string) =>
      assertNoSensitiveValues(value, resource.configuration, encryptionKey, options.projects),
    assertNoClientConnections: () => resource.assertNoClientConnections(),
    assertRemoved: () => resource.assertRemoved(),
    close: () => {
      closePromise ??= resource.close()
      return closePromise
    },
  })

  return Object.freeze({ driver: options.driver, runtime, owner })
}
