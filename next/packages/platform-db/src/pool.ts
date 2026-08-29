import { SQL } from 'bun'

export interface PlatformSqlPoolOptions {
  readonly max: number
  readonly idleTimeout: number
  readonly maxLifetime: number
  readonly connectionTimeout: number
}

export interface PlatformSqlQuery {
  query<TResult>(strings: TemplateStringsArray, ...values: readonly unknown[]): Promise<TResult>
}

export interface PlatformSqlPool extends PlatformSqlQuery {
  close(): Promise<void>
}

export interface PlatformSqlClient {
  (strings: TemplateStringsArray, ...values: readonly unknown[]): PromiseLike<unknown>
  close(): Promise<void>
}

export interface PlatformSqlConstructor {
  new (url: string | URL, options: PlatformSqlPoolOptions): PlatformSqlClient
}

const invalidOption = (name: keyof PlatformSqlPoolOptions): Error =>
  new Error(`Platform SQL pool option ${name} is invalid`)

function validate(url: string | URL, options: PlatformSqlPoolOptions): void {
  if (typeof url === 'string' && url.length === 0) {
    throw new Error('Platform SQL connection URL is required')
  }

  if (!Number.isSafeInteger(options.max) || options.max < 1) {
    throw invalidOption('max')
  }

  for (const name of ['idleTimeout', 'maxLifetime', 'connectionTimeout'] as const) {
    if (!Number.isFinite(options[name]) || options[name] < 0) {
      throw invalidOption(name)
    }
  }
}

const failure = (operation: 'create' | 'query' | 'close'): Error =>
  new Error(`Platform SQL pool ${operation} failed`)

/** Creates one process-owned, lazy Bun SQL pool without exposing the raw client. */
export function createPlatformSqlPool(
  url: string | URL,
  options: PlatformSqlPoolOptions,
  SqlConstructor: PlatformSqlConstructor = SQL,
): PlatformSqlPool {
  validate(url, options)

  let client: PlatformSqlClient
  try {
    client = new SqlConstructor(url, {
      max: options.max,
      idleTimeout: options.idleTimeout,
      maxLifetime: options.maxLifetime,
      connectionTimeout: options.connectionTimeout,
    })
  } catch {
    throw failure('create')
  }

  let closePromise: Promise<void> | undefined

  const query = async <TResult>(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<TResult> => {
    if (closePromise) throw failure('query')

    try {
      return (await client(strings, ...values)) as TResult
    } catch {
      throw failure('query')
    }
  }

  const close = (): Promise<void> => {
    closePromise ??= Promise.resolve()
      .then(() => client.close())
      .catch(() => {
        throw failure('close')
      })
    return closePromise
  }

  return { query, close }
}
