import { describe, expect, test } from 'bun:test'

import { type MigrationDatabase, type MigrationQuery, migrate } from '../src/migrate'
import { createMigrationCatalog } from '../src/migrations'

interface FakeOptions {
  readonly applied?: readonly string[]
  readonly execute?: (sql: string) => Promise<void>
}

interface FakeDatabase {
  readonly database: MigrationDatabase
  readonly events: string[]
  readonly applied: Set<string>
  readonly transactionCount: () => number
}

function fakeDatabase(options: FakeOptions = {}): FakeDatabase {
  const applied = new Set(options.applied ?? [])
  const events: string[] = []
  let transactionCount = 0
  let lockTail = Promise.resolve()

  const database: MigrationDatabase = {
    transaction: async (operation) => {
      transactionCount += 1
      const pending = new Set<string>()
      const previousLock = lockTail
      let releaseLock = (): void => undefined
      lockTail = new Promise<void>((resolve) => {
        releaseLock = resolve
      })
      let hasLock = false

      const query = async <TResult>(
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<TResult> => {
        const sql = strings.join('?')

        if (sql.includes('pg_advisory_xact_lock')) {
          events.push('lock:wait')
          await previousLock
          hasLock = true
          events.push('lock:acquired')
          return [] as TResult
        }
        if (sql.includes('CREATE TABLE IF NOT EXISTS platform_migrations')) {
          events.push('bookkeeping:create')
          return [] as TResult
        }
        if (sql.includes('SELECT id FROM platform_migrations')) {
          events.push('bookkeeping:read')
          return [...applied, ...pending].toSorted().map((id) => ({ id })) as TResult
        }
        if (sql.includes('INSERT INTO platform_migrations')) {
          const id = values[0]
          if (typeof id !== 'string') throw new Error('Expected a migration id')
          events.push(`record:${id}`)
          pending.add(id)
          return [] as TResult
        }

        throw new Error(`Unexpected query: ${sql}`)
      }

      const scoped: MigrationQuery = {
        query,
        execute: async (sql) => {
          events.push(`execute:${sql}`)
          await options.execute?.(sql)
        },
      }

      try {
        const result = await operation(scoped)
        for (const id of pending) applied.add(id)
        events.push('transaction:commit')
        return result
      } catch (error) {
        events.push('transaction:rollback')
        throw error
      } finally {
        if (hasLock) releaseLock()
      }
    },
  }

  return {
    database,
    events,
    applied,
    transactionCount: () => transactionCount,
  }
}

const catalog = createMigrationCatalog([
  { id: '0002_second', sql: 'SELECT second' },
  { id: '0001_first', sql: 'SELECT first' },
])

describe('migrate', () => {
  test('creates bookkeeping and takes the transaction-scoped lock for an empty catalog', async () => {
    const fake = fakeDatabase()

    const completed = await migrate(fake.database, [])

    expect(completed).toEqual([])
    expect(fake.events).toEqual([
      'lock:wait',
      'lock:acquired',
      'bookkeeping:create',
      'bookkeeping:read',
      'transaction:commit',
    ])
  })

  test('applies pending migrations once in catalog order and records them atomically', async () => {
    const fake = fakeDatabase()

    const completed = await migrate(fake.database, catalog)

    expect(completed).toEqual(['0001_first', '0002_second'])
    expect(fake.events).toEqual([
      'lock:wait',
      'lock:acquired',
      'bookkeeping:create',
      'bookkeeping:read',
      'execute:SELECT first',
      'record:0001_first',
      'execute:SELECT second',
      'record:0002_second',
      'transaction:commit',
    ])
    expect([...fake.applied]).toEqual(['0001_first', '0002_second'])
  })

  test('skips already-applied migrations while applying later pending entries', async () => {
    const fake = fakeDatabase({ applied: ['0001_first'] })

    const completed = await migrate(fake.database, catalog)

    expect(completed).toEqual(['0002_second'])
    expect(fake.events.filter((event) => event.startsWith('execute:'))).toEqual([
      'execute:SELECT second',
    ])
    expect([...fake.applied]).toEqual(['0001_first', '0002_second'])
  })

  test('serializes concurrent runners under the advisory lock and applies each migration once', async () => {
    let releaseExecution = (): void => undefined
    let executionStarted = (): void => undefined
    const started = new Promise<void>((resolve) => {
      executionStarted = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      releaseExecution = resolve
    })
    const fake = fakeDatabase({
      execute: async () => {
        executionStarted()
        await blocked
      },
    })
    const oneMigration = createMigrationCatalog([{ id: '0001_first', sql: 'SELECT first' }])

    const first = migrate(fake.database, oneMigration)
    await started
    const second = migrate(fake.database, oneMigration)
    await Promise.resolve()

    expect(fake.transactionCount()).toBe(2)
    expect(fake.events.filter((event) => event === 'lock:acquired')).toHaveLength(1)
    releaseExecution()
    expect(await Promise.all([first, second])).toEqual([['0001_first'], []])
    expect(fake.events.filter((event) => event === 'execute:SELECT first')).toHaveLength(1)
  })

  test('redacts failure details, rolls back, stops, and reruns deterministically', async () => {
    const sentinelUrl =
      'postgresql://migration-user:migration-secret@sentinel.internal:6543/platform'
    const sentinelSql = `SELECT 'raw-migration-sentinel-9137', '${sentinelUrl}'`
    const originalError = new Error(`Driver rejected ${sentinelUrl} while executing ${sentinelSql}`)
    let shouldFail = true
    const fake = fakeDatabase({
      execute: async (sql) => {
        if (sql !== sentinelSql || !shouldFail) return
        shouldFail = false
        throw originalError
      },
    })
    const failureCatalog = createMigrationCatalog([
      { id: '0001_first', sql: 'SELECT first' },
      { id: '0002_secret', sql: sentinelSql },
      { id: '0003_later', sql: 'SELECT later' },
    ])

    const error = await migrate(fake.database, failureCatalog).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new Error('Expected a public migration error')
    expect(error.message).toBe('Platform migration failed')
    expect(error.cause).toBeUndefined()
    expect(error).not.toBe(originalError)
    const observableError = `${error.name}\n${error.message}\n${error.stack ?? ''}`
    expect(observableError).not.toContain(sentinelUrl)
    expect(observableError).not.toContain(sentinelSql)
    expect(observableError).not.toContain(originalError.message)
    expect(fake.events).toContain('record:0001_first')
    expect(fake.events).not.toContain('record:0002_secret')
    expect(fake.events).not.toContain('execute:SELECT later')
    expect(fake.events).not.toContain('transaction:commit')
    expect(fake.events.at(-1)).toBe('transaction:rollback')
    expect([...fake.applied]).toEqual([])

    expect(await migrate(fake.database, failureCatalog)).toEqual([
      '0001_first',
      '0002_secret',
      '0003_later',
    ])
    expect(await migrate(fake.database, failureCatalog)).toEqual([])
  })

  test('is absent from every API server source module', async () => {
    const serverSource = new URL('../../../apps/server/src/', import.meta.url)
    const paths = await Array.fromAsync(
      new Bun.Glob('**/*.ts').scan({
        cwd: serverSource.pathname,
        onlyFiles: true,
      }),
    )
    const startupFiles = await Promise.all(
      paths.toSorted().map((path) => Bun.file(new URL(path, serverSource)).text()),
    )

    expect(paths.length).toBeGreaterThan(0)
    expect(startupFiles.join('\n')).not.toMatch(
      /\b(?:from|import)\s*(?:\(\s*)?['"][^'"]*migrate(?:\.[cm]?[jt]s)?['"]/,
    )
  })
})
