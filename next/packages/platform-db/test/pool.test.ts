import { describe, expect, test } from 'bun:test'
import {
  createPlatformSqlPool,
  type PlatformSqlClient,
  type PlatformSqlConstructor,
  type PlatformSqlPoolOptions,
} from '../src/pool'

const URL_WITH_CREDENTIALS =
  'postgresql://platform-user:platform-secret@database.internal:6543/credential_database_9137?sslmode=require'
const OPTIONS: PlatformSqlPoolOptions = {
  max: 8,
  idleTimeout: 30,
  maxLifetime: 300,
  connectionTimeout: 10,
}

interface ConstructorOptions {
  readonly max: number
  readonly idleTimeout: number
  readonly maxLifetime: number
  readonly connectionTimeout: number
}

interface ConstructorCall {
  readonly url: string | URL
  readonly options: ConstructorOptions
}

function fakeConstructor(
  input: {
    readonly query?: (
      strings: TemplateStringsArray,
      values: readonly unknown[],
    ) => PromiseLike<unknown>
    readonly close?: () => Promise<void>
  } = {},
): { readonly Sql: PlatformSqlConstructor; readonly calls: ConstructorCall[] } {
  const calls: ConstructorCall[] = []

  const Sql = function (
    this: PlatformSqlClient,
    url: string | URL,
    options: ConstructorOptions,
  ): PlatformSqlClient {
    calls.push({ url, options })
    const client = ((strings: TemplateStringsArray, ...values: readonly unknown[]) =>
      input.query?.(strings, values) ?? Promise.resolve([])) as PlatformSqlClient
    client.close = input.close ?? (() => Promise.resolve())
    return client
  } as unknown as PlatformSqlConstructor

  return { Sql, calls }
}

describe('createPlatformSqlPool', () => {
  test('constructs only the injected lazy client with explicit bounded options', () => {
    const fake = fakeConstructor()

    expect(fake.calls).toHaveLength(0)
    const pool = createPlatformSqlPool(URL_WITH_CREDENTIALS, OPTIONS, fake.Sql)

    expect(fake.calls).toEqual([{ url: URL_WITH_CREDENTIALS, options: OPTIONS }])
    expect(Object.keys(pool).sort()).toEqual(['close', 'query'])
  })

  test('excludes runtime properties outside the supported pool option allowlist', () => {
    const fake = fakeConstructor()
    const runtimeOptions = {
      ...OPTIONS,
      url: 'postgres://attacker:override@other.invalid/database',
      adapter: 'sqlite',
      password: 'override-secret',
      onconnect: () => {
        throw new Error('must not be installed')
      },
    } as PlatformSqlPoolOptions

    createPlatformSqlPool(URL_WITH_CREDENTIALS, runtimeOptions, fake.Sql)

    expect(fake.calls).toEqual([{ url: URL_WITH_CREDENTIALS, options: OPTIONS }])
  })

  test('forwards interpolated values separately through the narrow query capability', async () => {
    const observed: Array<{
      strings: readonly string[]
      values: readonly unknown[]
    }> = []
    const fake = fakeConstructor({
      query: (strings, values) => {
        observed.push({ strings: [...strings], values })
        return Promise.resolve([{ id: 'project-1' }])
      },
    })
    const pool = createPlatformSqlPool(URL_WITH_CREDENTIALS, OPTIONS, fake.Sql)
    const projectId = "project' OR TRUE --"

    const rows = await pool.query<readonly { id: string }[]>`
      SELECT id FROM projects WHERE public_id = ${projectId} AND enabled = ${true}
    `

    expect(rows).toEqual([{ id: 'project-1' }])
    expect(observed).toEqual([
      {
        strings: [
          '\n      SELECT id FROM projects WHERE public_id = ',
          ' AND enabled = ',
          '\n    ',
        ],
        values: [projectId, true],
      },
    ])
  })

  test('shares one awaitable close and closes the client once', async () => {
    let closeCalls = 0
    let finishClose: (() => void) | undefined
    const fake = fakeConstructor({
      close: () => {
        closeCalls += 1
        return new Promise<void>((resolve) => {
          finishClose = resolve
        })
      },
    })
    const pool = createPlatformSqlPool(URL_WITH_CREDENTIALS, OPTIONS, fake.Sql)

    const first = pool.close()
    const second = pool.close()

    expect(second).toBe(first)
    await Promise.resolve()
    expect(closeCalls).toBe(1)
    finishClose?.()
    await first
    expect(pool.close()).toBe(first)
  })

  test('shares one failed close promise and invokes close exactly once', async () => {
    const originalCause = new Error(URL_WITH_CREDENTIALS)
    let closeCalls = 0
    const fake = fakeConstructor({
      close: () => {
        closeCalls += 1
        return Promise.reject(originalCause)
      },
    })
    const pool = createPlatformSqlPool(URL_WITH_CREDENTIALS, OPTIONS, fake.Sql)

    const first = pool.close()
    const second = pool.close()
    const error = await first.catch((caught: unknown) => caught)

    expect(second).toBe(first)
    expect(pool.close()).toBe(first)
    expect(closeCalls).toBe(1)
    expectRedacted(error, 'Platform SQL pool close failed', originalCause)
  })

  test('redacts constructor and query failures', async () => {
    const constructorCause = new Error(URL_WITH_CREDENTIALS)
    class ThrowingClient {
      constructor() {
        throw constructorCause
      }
    }

    let constructorError: unknown
    try {
      createPlatformSqlPool(
        URL_WITH_CREDENTIALS,
        OPTIONS,
        ThrowingClient as unknown as PlatformSqlConstructor,
      )
    } catch (error) {
      constructorError = error
    }
    expectRedacted(constructorError, 'Platform SQL pool create failed', constructorCause)

    const queryCause = new Error(URL_WITH_CREDENTIALS)
    const queryFailure = fakeConstructor({
      query: () => Promise.reject(queryCause),
    })
    const queryPool = createPlatformSqlPool(URL_WITH_CREDENTIALS, OPTIONS, queryFailure.Sql)
    const queryError = await queryPool.query`SELECT ${URL_WITH_CREDENTIALS}`.catch(
      (caught: unknown) => caught,
    )
    expectRedacted(queryError, 'Platform SQL pool query failed', queryCause)
  })

  const invalidOptions: ReadonlyArray<{
    readonly name: keyof PlatformSqlPoolOptions
    readonly value: number
  }> = [
    { name: 'max', value: 0 },
    { name: 'max', value: 1.5 },
    { name: 'max', value: Number.MAX_SAFE_INTEGER + 1 },
    { name: 'idleTimeout', value: -1 },
    { name: 'idleTimeout', value: Number.NaN },
    { name: 'idleTimeout', value: Number.POSITIVE_INFINITY },
    { name: 'maxLifetime', value: -1 },
    { name: 'maxLifetime', value: Number.NaN },
    { name: 'maxLifetime', value: Number.POSITIVE_INFINITY },
    { name: 'connectionTimeout', value: -1 },
    { name: 'connectionTimeout', value: Number.NaN },
    { name: 'connectionTimeout', value: Number.POSITIVE_INFINITY },
  ]

  for (const invalid of invalidOptions) {
    test(`rejects invalid ${invalid.name} value ${String(invalid.value)}`, () => {
      const fake = fakeConstructor()
      const options = { ...OPTIONS, [invalid.name]: invalid.value }

      let error: unknown
      try {
        createPlatformSqlPool(URL_WITH_CREDENTIALS, options, fake.Sql)
      } catch (caught) {
        error = caught
      }

      expectRedacted(error, `Platform SQL pool option ${invalid.name} is invalid`)
      expect(fake.calls).toHaveLength(0)
    })
  }

  test('accepts the minimum max and zero timeout boundaries', () => {
    const fake = fakeConstructor()
    const boundaries: PlatformSqlPoolOptions = {
      max: 1,
      idleTimeout: 0,
      maxLifetime: 0,
      connectionTimeout: 0,
    }

    createPlatformSqlPool(URL_WITH_CREDENTIALS, boundaries, fake.Sql)

    expect(fake.calls).toEqual([{ url: URL_WITH_CREDENTIALS, options: boundaries }])
  })
})

function expectRedacted(error: unknown, message: string, originalCause?: Error): void {
  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw new Error('Expected a public Error')

  expect(error.message).toBe(message)
  expect(error.cause).toBeUndefined()
  if (originalCause) expect(error).not.toBe(originalCause)

  const observableError = `${error.name}\n${error.message}\n${error.stack ?? ''}`
  for (const secret of [
    URL_WITH_CREDENTIALS,
    'postgresql://',
    'platform-user',
    'platform-secret',
    'database.internal',
    '6543',
    'credential_database_9137',
    'sslmode=require',
  ]) {
    expect(observableError).not.toContain(secret)
  }
}
