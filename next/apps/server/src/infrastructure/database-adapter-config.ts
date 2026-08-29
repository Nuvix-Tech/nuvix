export type DatabaseAdapterConfiguration =
  | {
      readonly driver: 'postgresql'
      readonly connectionString: string
    }
  | {
      readonly driver: 'sqlite'
      readonly filename: string
    }

const INVALID_CONFIGURATION = 'Platform database configuration is invalid'

function normalized(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.trim() === value && !value.includes('\0')
  )
}

/** Validates adapter selection without reflecting sensitive input in errors. */
export function validateDatabaseAdapterConfiguration(
  configuration: DatabaseAdapterConfiguration,
): DatabaseAdapterConfiguration {
  if (configuration.driver === 'sqlite') {
    if (!normalized(configuration.filename)) throw new TypeError(INVALID_CONFIGURATION)
    return { driver: 'sqlite', filename: configuration.filename }
  }

  if (configuration.driver !== 'postgresql' || !normalized(configuration.connectionString)) {
    throw new TypeError(INVALID_CONFIGURATION)
  }

  try {
    const protocol = new URL(configuration.connectionString).protocol
    if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
      throw new TypeError(INVALID_CONFIGURATION)
    }
  } catch {
    throw new TypeError(INVALID_CONFIGURATION)
  }

  return {
    driver: 'postgresql',
    connectionString: configuration.connectionString,
  }
}
