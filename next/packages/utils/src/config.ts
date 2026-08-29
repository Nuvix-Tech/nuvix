/**
 * Typed environment configuration for Nuvix v2.
 *
 * Reads `Bun.env` once at import time and validates required variables,
 * failing fast with a clear message instead of surfacing misconfigurations
 * as runtime errors deep inside request handling.
 */

export type NuvixEnv = 'development' | 'production' | 'test'
export type DatabaseDriver = 'postgresql' | 'sqlite'

function required(name: string, fallback?: string): string {
  const value = Bun.env[name] ?? fallback
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}. See docs/ENV.md.`)
  }
  return value
}

function parsePort(raw: string): number {
  const port = Number.parseInt(raw, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`NUVIX_PORT must be an integer in [1, 65535], got: ${raw}`)
  }
  return port
}

function databaseDriver(): DatabaseDriver {
  const value =
    Bun.env.NUVIX_INTERNAL_DATABASE_DRIVER ??
    (Bun.env.NUVIX_INTERNAL_DATABASE_URL ? 'postgresql' : 'sqlite')
  if (value !== 'postgresql' && value !== 'sqlite') {
    throw new Error('NUVIX_INTERNAL_DATABASE_DRIVER must be postgresql | sqlite')
  }
  return value
}

const env = required('NUVIX_ENV', 'development')
if (env !== 'development' && env !== 'production' && env !== 'test') {
  throw new Error(`NUVIX_ENV must be development | production | test, got: ${env}`)
}
const internalDatabaseDriver = databaseDriver()

export const config = {
  /** `development` | `production` | `test` */
  env: env as NuvixEnv,
  isProd: env === 'production',
  isDev: env === 'development',
  isTest: env === 'test',

  host: required('NUVIX_HOST', '0.0.0.0'),
  port: parsePort(required('NUVIX_PORT', '4000')),

  /** Adapter-neutral internal/platform database configuration. */
  internalDatabase:
    internalDatabaseDriver === 'postgresql'
      ? {
          driver: internalDatabaseDriver,
          connectionString: required('NUVIX_INTERNAL_DATABASE_URL'),
        }
      : {
          driver: internalDatabaseDriver,
          filename: required('NUVIX_INTERNAL_DATABASE_FILE', './data/nuvix.sqlite'),
        },

  /** Redis connection string (queues/cache). */
  redisUrl: required('NUVIX_REDIS_URL'),

  storage: {
    uploadsDir: Bun.env.NUVIX_STORAGE_UPLOADS ?? './storage/uploads',
  },
} as const

export type Config = typeof config
