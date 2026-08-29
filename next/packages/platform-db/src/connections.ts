import type { EncryptedConnection } from './connection-crypto'
import type { PlatformSqlQuery } from './pool'

const ENCRYPTION_VERSION = 1
const NONCE_BYTES = 12
const TAG_BYTES = 16
const MAX_KEY_VERSION_CHARACTERS = 128
const ROW_KEYS = ['ciphertext', 'encryption_version', 'key_version', 'nonce'] as const
const UNAVAILABLE = 'Connection metadata is unavailable'

export interface ConnectionRepository {
  resolve(projectID: string): Promise<EncryptedConnection>
}

export class ConnectionMetadataMissingError extends Error {
  constructor() {
    super(UNAVAILABLE)
    this.name = 'ConnectionMetadataMissingError'
  }
}

export class ConnectionMetadataDuplicateError extends Error {
  constructor() {
    super(UNAVAILABLE)
    this.name = 'ConnectionMetadataDuplicateError'
  }
}

export class ConnectionMetadataMalformedError extends Error {
  constructor() {
    super(UNAVAILABLE)
    this.name = 'ConnectionMetadataMalformedError'
  }
}

export class ConnectionMetadataQueryError extends Error {
  constructor() {
    super(UNAVAILABLE)
    this.name = 'ConnectionMetadataQueryError'
  }
}

function project(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    Array.from(value).length > 128 ||
    value.trim() !== value
  ) {
    throw new ConnectionMetadataMalformedError()
  }
  return value
}

function binary(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (value instanceof Uint8Array) return Uint8Array.from(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  return null
}

function keyVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    value.trim() === value &&
    Array.from(value).length <= MAX_KEY_VERSION_CHARACTERS
  )
}

function parseEnvelope(row: unknown): EncryptedConnection {
  if (typeof row !== 'object' || row === null) throw new ConnectionMetadataMalformedError()

  const keys = Object.keys(row)
  if (keys.length !== ROW_KEYS.length || !ROW_KEYS.every((key) => Object.hasOwn(row, key))) {
    throw new ConnectionMetadataMalformedError()
  }

  const record = row as Record<(typeof ROW_KEYS)[number], unknown>
  const nonce = binary(record.nonce)
  const ciphertext = binary(record.ciphertext)
  if (
    record.encryption_version !== ENCRYPTION_VERSION ||
    !keyVersion(record.key_version) ||
    nonce?.byteLength !== NONCE_BYTES ||
    ciphertext === null ||
    ciphertext.byteLength <= TAG_BYTES
  ) {
    throw new ConnectionMetadataMalformedError()
  }

  return Object.freeze({
    encryptionVersion: ENCRYPTION_VERSION,
    keyVersion: record.key_version,
    nonce,
    ciphertext,
  })
}

function envelope(row: unknown): EncryptedConnection {
  try {
    return parseEnvelope(row)
  } catch {
    throw new ConnectionMetadataMalformedError()
  }
}

async function rows(sql: PlatformSqlQuery, projectID: string): Promise<readonly unknown[]> {
  let result: unknown
  try {
    result = await sql.query<unknown>`
      SELECT
        connection.encryption_version,
        connection.key_version,
        connection.nonce,
        connection.ciphertext
      FROM project_connections AS connection
      INNER JOIN projects AS project ON project.id = connection.project_id
      WHERE project.public_id = ${projectID} AND project.enabled = ${true}
      LIMIT 2
    `
  } catch {
    throw new ConnectionMetadataQueryError()
  }

  try {
    if (!Array.isArray(result)) throw new ConnectionMetadataMalformedError()
    return result
  } catch {
    throw new ConnectionMetadataMalformedError()
  }
}

function resolveRows(result: readonly unknown[]): EncryptedConnection {
  let length: number
  let row: unknown
  try {
    length = result.length
    if (length === 1) row = result[0]
  } catch {
    throw new ConnectionMetadataMalformedError()
  }

  if (length === 0) throw new ConnectionMetadataMissingError()
  if (length !== 1) throw new ConnectionMetadataDuplicateError()
  return envelope(row)
}

/** Creates a read-only encrypted connection-metadata capability over process-owned platform SQL. */
export function createConnectionRepository(sql: PlatformSqlQuery): ConnectionRepository {
  return Object.freeze({
    async resolve(input: string): Promise<EncryptedConnection> {
      const result = await rows(sql, project(input))
      return resolveRows(result)
    },
  })
}
