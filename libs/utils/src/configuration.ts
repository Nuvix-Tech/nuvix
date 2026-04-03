import * as path from 'node:path'
import { Logger } from '@nestjs/common'
import { PROJECT_ROOT } from './constants'
type CookieSameSite = 'none' | 'lax' | 'strict'

const BYTES = {
  MB: 1_000_000,
  GB: 1_000_000_000,
} as const

const SECONDS = {
  HOUR: 3600,
  DAY: 86400,
} as const

const DEFAULT_HEADERS = [
  'Content-Type',
  'Content-Length',
  'Authorization',
  'X-Requested-With',
  'X-HTTP-Method-Override',
  'Accept',
  'range',
  'content-range',
  // Nuvix headers
  'X-Nuvix-Project', // keep for sdk compatibility
  'X-Nuvix-Key',
  'X-Nuvix-Locale',
  'X-Nuvix-Mode',
  'X-Nuvix-JWT',
  'X-Nuvix-id',
  'X-Nuvix-Response-Format',
  'X-Nuvix-Timeout',
  'x-Nuvix-session',
  // SDK headers
  'x-sdk-language',
  'x-sdk-name',
  'x-sdk-platform',
  'x-sdk-version',
  'x-fallback-cookies',
] as const

const env = {
  get: (key: string, fallback = ''): string => process.env[key] ?? fallback,

  getRequired: (key: string): string | undefined => process.env[key],

  bool: (key: string, fallback = false): boolean => {
    const val = process.env[key]?.toLowerCase()
    if (val === undefined) return fallback
    return val === 'true' || val === '1' || val === 'yes'
  },

  int: (key: string, fallback: number): number => {
    const val = process.env[key]
    if (!val) return fallback
    const parsed = Number.parseInt(val, 10)
    return Number.isNaN(parsed) ? fallback : parsed
  },

  list: (key: string, fallback: string[] = []): string[] => {
    const val = process.env[key]
    if (!val) return fallback
    return val
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  },

  is: (key: string, value: string): boolean => process.env[key] === value,

  isNot: (key: string, value: string): boolean => process.env[key] !== value,
}

const paths = {
  root: PROJECT_ROOT,

  fromRoot: (...segments: string[]) => path.join(PROJECT_ROOT, ...segments),

  storage: (...segments: string[]) =>
    path.join(PROJECT_ROOT, 'storage', ...segments),
}

const createConfig = () => {
  const assetsRoot = paths.fromRoot(env.get('NUVIX_ASSETS_ROOT', 'assets'))

  return {
    app: {
      name: 'Nuvix',
      version: '1.0.0',
      color: '#ff751f',
      userAgent: 'Nuvix-Server v%s. Please report abuse at %s',
      projectId: env.get('NUVIX_PROJECT_ID', 'default'),
      region: env.get('NUVIX_REGION', 'local'),

      // URLs & Hosts
      host: env.get('NUVIX_HOST', 'localhost'),
      consoleURL: env.get('NUVIX_CONSOLE_URL', 'http://localhost:3000'),

      // Environment
      isProduction: env.is('NODE_ENV', 'production'),
      forceHttps: env.isNot('NUVIX_FORCE_HTTPS', 'disabled'),

      // Email
      emailTeam: env.get('NUVIX_EMAIL_TEAM', 'team@localhost.test'),
      emailSecurity: env.get('NUVIX_EMAIL_SECURITY'),

      // Feature flags
      enableApiLogs: env.bool('NUVIX_ENABLE_API_LOGS', true),
      enableStats: env.bool('NUVIX_ENABLE_STATS', true),
      enableThrottling: env.bool('NUVIX_ENABLE_THROTTLING', true),

      // Debug
      debug: {
        colors: env.bool('NUVIX_DEBUG_COLORS', true),
        json: env.bool('NUVIX_DEBUG_JSON', false),
        errors: env.bool('NUVIX_DEBUG_ERRORS', false),
      },

      // Misc
      docsRoot: env.get('NUVIX_DOCS_ROOT') || PROJECT_ROOT,
      testApiKey: env.get('NUVIX_TEST_API_KEY'),
    },

    assets: {
      root: assetsRoot,
      images: path.join(assetsRoot, 'images'),
      fonts: path.join(assetsRoot, 'fonts'),
      templates: path.join(assetsRoot, 'locale', 'templates'),
      views: path.join(assetsRoot, 'views'),
      public: paths.fromRoot(env.get('NUVIX_ASSETS_PUBLIC', 'public')),
      resolve: (...segments: string[]) => path.join(assetsRoot, ...segments),
    },

    security: {
      jwtSecret: env.getRequired('NUVIX_JWT_SECRET'),
      encryptionKey: (() => {
        const key = env.getRequired('NUVIX_ENCRYPTION_KEY')
        if (!key) {
          Logger.warn(
            'NUVIX_ENCRYPTION_KEY not set. Using insecure default. ' +
              'Set a custom key in production.',
          )
          return 'acd3462d9128abcd'
        }
        return key
      })(),
    },

    server: {
      host: env.get('NUVIX_HOST', 'localhost'),
      methods: ['GET', 'PUT', 'PATCH', 'POST', 'DELETE'] as const,
      credentials: true,
      allowedOrigins: env.list('NUVIX_CORS_ORIGIN'),
      allowedHeaders: [...DEFAULT_HEADERS, ...env.list('NUVIX_CORS_HEADERS')],
      exposedHeaders: ['X-Nuvix-Session', 'X-Fallback-Cookies'],
      cookieDomain: env.get('NUVIX_COOKIE_DOMAIN'),
      cookieSameSite: env.get(
        'NUVIX_COOKIE_SAMESITE',
        'none',
      ) as CookieSameSite,
      cookieName: env.get('NUVIX_COOKIE_NAME', 'session'),
      fallbackCookies: env.bool('NUVIX_DEBUG_FALLBACK_COOKIES', false),
    },

    redis: {
      host: env.getRequired('NUVIX_REDIS_HOST'),
      port: env.int('NUVIX_REDIS_PORT', 6379),
      user: env.getRequired('NUVIX_REDIS_USER'),
      password: env.getRequired('NUVIX_REDIS_PASSWORD'),
      db: env.int('NUVIX_REDIS_DB', 0),
      secure: env.bool('NUVIX_REDIS_SECURE', false),
    },

    smtp: {
      host: env.getRequired('NUVIX_SMTP_HOST'),
      port: env.int('NUVIX_SMTP_PORT', 587),
      secure: env.bool('NUVIX_SMTP_SECURE', false),
      user: env.getRequired('NUVIX_SMTP_USER'),
      password: env.getRequired('NUVIX_SMTP_PASSWORD'),
      emailFrom: env.getRequired('NUVIX_SMTP_EMAIL_FROM'),
      sender: env.getRequired('NUVIX_SMTP_SENDER'),
      replyTo: env.getRequired('NUVIX_SMTP_REPLY_TO'),
      dkim: {
        domain: env.getRequired('NUVIX_SMTP_DKIM_DOMAIN'),
        key: env.getRequired('NUVIX_SMTP_DKIM_KEY'),
        privateKey: env.getRequired('NUVIX_SMTP_DKIM_PRIVATE_KEY'),
      },
      enabled: () => {
        const requiredFields = ['NUVIX_SMTP_HOST']
        return requiredFields.every(field => !!env.get(field))
      },
    },

    sms: {
      enabled: env.bool('NUVIX_SMS_ENABLED', false),
      twilio: {
        accountSid: env.getRequired('NUVIX_SMS_TWILIO_ACCOUNT_SID'),
        authToken: env.getRequired('NUVIX_SMS_TWILIO_AUTH_TOKEN'),
        fromPhone: env.getRequired('NUVIX_SMS_TWILIO_FROM_PHONE'),
      },
    },

    database: {
      postgres: {
        host: env.get('NUVIX_DATABASE_HOST', 'localhost'),
        port: env.int('NUVIX_DATABASE_PORT', 5432),
        user: env.get('NUVIX_DATABASE_USER', 'postgres'),
        password: env.getRequired('NUVIX_DATABASE_PASSWORD') as string, // for app role
        authenticatorPassword: env.get(
          'NUVIX_DATABASE_AUTHENTICATOR_PASSWORD',
          env.getRequired('NUVIX_DATABASE_PASSWORD'),
        ), // for authenticator role
        postgresPassword: env.get(
          'NUVIX_DATABASE_POSTGRES_PASSWORD',
          env.getRequired('NUVIX_DATABASE_PASSWORD'),
        ), // for postgres role
        // adminPassword: env.getRequired('NUVIX_DATABASE_ADMIN_PASSWORD'), // for admin role
        database: 'postgres',
        ssl: env.bool('NUVIX_DATABASE_SSL', false),
        maxConnections: env.int('NUVIX_DATABASE_MAX_CONNECTIONS', 20),
      },
      timeouts: {
        query: env.int('NUVIX_DATABASE_QUERY_TIMEOUT', 30_000),
        idle: env.int('NUVIX_DATABASE_IDLE_TIMEOUT', 30_000),
        connection: env.int('NUVIX_DATABASE_CONNECTION_TIMEOUT', 10_000),
        statement: env.int('NUVIX_DATABASE_STATEMENT_TIMEOUT', 30_000),
      },
      reconnect: { sleep: 2, maxAttempts: 10 },
    },

    storage: {
      uploads: paths.storage('uploads'),
      temp: paths.storage('tmp'),
      readBuffer: 20 * BYTES.MB,
      maxSize: env.int('NUVIX_STORAGE_MAX_SIZE', 5 * BYTES.GB),
      limit: env.int('NUVIX_STORAGE_LIMIT', 10 * BYTES.GB),
      maxOutputChunkSize: 5 * BYTES.MB,
    },

    limits: {
      paging: env.int('NUVIX_LIMIT_PAGING', 12),
      maxCount: 10_000,
      limitCount: 5_000,
      listDefault: 25,

      // User limits
      users: env.int('NUVIX_LIMIT_USERS', 10_000),
      userPasswordHistory: env.int('NUVIX_LIMIT_USER_PASSWORD_HISTORY', 10),
      userSessionsMax: env.int('NUVIX_LIMIT_USER_SESSIONS_MAX', 100),
      userSessionsDefault: env.int('NUVIX_LIMIT_USER_SESSIONS_DEFAULT', 10),

      // Processing limits (20MB each)
      antivirus: 20 * BYTES.MB,
      encryption: 20 * BYTES.MB,
      compression: 20 * BYTES.MB,

      // Array limits
      arrayParamsSize: 100,
      arrayLabelsSize: 1_000,
      arrayElementSize: 4_096,

      // Query limits
      subquery: 1_000,
      subscribersSubquery: 1_000_000,

      // Rate limits
      writeRateDefault: 60,
      writeRatePeriodDefault: 60,

      // Batch processing
      batchSize: env.int('NUVIX_BATCH_SIZE', 2_000),
      batchIntervalMs: env.int('NUVIX_BATCH_INTERVAL_MS', 5_000),
    },

    access: {
      key: SECONDS.DAY,
      user: SECONDS.DAY,
      project: SECONDS.DAY,
    },

    cache: {
      update: env.int('NUVIX_CACHE_UPDATE', SECONDS.DAY),
      buster: 4318,
    },

    system: {
      emailAddress: env.get('NUVIX_SYSTEM_EMAIL_ADDRESS', 'support@nuvix.in'),
      emailName: env.get('NUVIX_NAME', 'Nuvix Support'),
    },

    logLevels: env.list('NUVIX_LOG_LEVELS', ['log', 'error', 'warn']),
  } as const
}

type ValidationRule = {
  key: string
  required?: boolean
  requiredIn?: 'production' | 'always'
  format?: RegExp
  formatHint?: string
  minLength?: number
  validator?: (value: string) => boolean
  validatorHint?: string
}

const VALIDATION_RULES: ValidationRule[] = [
  // Security (critical)
  {
    key: 'NUVIX_JWT_SECRET',
    requiredIn: 'production',
    minLength: 32,
  },
  {
    key: 'NUVIX_ENCRYPTION_KEY',
    requiredIn: 'production',
    minLength: 16,
  },

  // Database
  {
    key: 'NUVIX_DATABASE_PASSWORD',
    requiredIn: 'production',
  },
  {
    key: 'NUVIX_DATABASE_PORT',
    validator: v =>
      !v || (Number.parseInt(v) > 0 && Number.parseInt(v) < 65536),
    validatorHint: 'must be a valid port (1-65535)',
  },

  // Redis
  {
    key: 'NUVIX_REDIS_HOST',
    requiredIn: 'production',
  },
  {
    key: 'NUVIX_REDIS_PORT',
    validator: v =>
      !v || (Number.parseInt(v) > 0 && Number.parseInt(v) < 65536),
    validatorHint: 'must be a valid port (1-65535)',
  },

  // SMTP
  {
    key: 'NUVIX_SMTP_EMAIL_FROM',
    format: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    formatHint: 'must be a valid email address',
  },

  // URLs
  {
    key: 'NUVIX_CONSOLE_URL',
    format: /^https?:\/\/.+/,
    formatHint: 'must be a valid URL starting with http:// or https://',
  },
  {
    key: 'NUVIX_SYSTEM_EMAIL_ADDRESS',
    format: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    formatHint: 'must be a valid email address',
  },

  // Storage limits
  {
    key: 'NUVIX_STORAGE_MAX_SIZE',
    validator: v => !v || Number.parseInt(v) > 0,
    validatorHint: 'must be a positive number',
  },
  {
    key: 'NUVIX_STORAGE_LIMIT',
    validator: v => !v || Number.parseInt(v) > 0,
    validatorHint: 'must be a positive number',
  },
]

type ValidationError = {
  key: string
  message: string
  severity: 'error' | 'warning'
}

type ValidationResult = {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

const validateEnv = (
  rules: ValidationRule[] = VALIDATION_RULES,
): ValidationResult => {
  const isProduction = process.env.NODE_ENV === 'production'
  const errors: ValidationError[] = []
  const warnings: ValidationError[] = []

  for (const rule of rules) {
    const value = process.env[rule.key]
    const hasValue = value !== undefined && value !== ''

    // Required check
    if (rule.requiredIn === 'always' && !hasValue) {
      errors.push({
        key: rule.key,
        message: `${rule.key} is required`,
        severity: 'error',
      })
      continue
    }

    if (rule.requiredIn === 'production' && isProduction && !hasValue) {
      errors.push({
        key: rule.key,
        message: `${rule.key} is required in production`,
        severity: 'error',
      })
      continue
    }

    // Skip further validation if no value
    if (!hasValue) continue

    // Min length check
    if (rule.minLength && value.length < rule.minLength) {
      const err = {
        key: rule.key,
        message: `${rule.key} must be at least ${rule.minLength} characters`,
        severity: isProduction ? 'error' : 'warning',
      } as const
      isProduction ? errors.push(err) : warnings.push(err)
    }

    // Format check
    if (rule.format && !rule.format.test(value)) {
      errors.push({
        key: rule.key,
        message: `${rule.key} ${rule.formatHint || 'has invalid format'}`,
        severity: 'error',
      })
    }

    // Custom validator
    if (rule.validator && !rule.validator(value)) {
      errors.push({
        key: rule.key,
        message: `${rule.key} ${rule.validatorHint || 'failed validation'}`,
        severity: 'error',
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

const validateConfig = (
  options: { exitOnError?: boolean; silent?: boolean } = {},
) => {
  const { exitOnError = true, silent = false } = options
  const result = validateEnv()

  if (!silent) {
    // Print warnings
    for (const warning of result.warnings) {
      Logger.warn(`Config warning: ${warning.message}`)
    }

    // Print errors
    for (const error of result.errors) {
      Logger.error(`Config error: ${error.message}`)
    }

    // Summary
    if (!result.valid) {
      Logger.error(
        `\n Configuration validation failed with ${result.errors.length} error(s).\n` +
          `   Fix the above issues and restart.\n`,
      )
    } else if (result.warnings.length > 0) {
      Logger.warn(
        `\n Configuration loaded with ${result.warnings.length} warning(s).\n`,
      )
    } else {
      Logger.log('Configuration validated successfully')
    }
  }

  if (!result.valid && exitOnError) {
    process.exit(1)
  }

  return result
}

export type NuvixConfig = ReturnType<typeof createConfig>
export const configuration = createConfig()
export { createConfig as nxconfig }
export { validateConfig, ValidationResult }
