import type { ConnectionCrypto } from './connection-crypto'
import type { ConnectionRepository } from './connections'

const UNAVAILABLE = 'Connection metadata is unavailable'
const MAX_PROJECT_ID_CHARACTERS = 128

export interface ResolvedConnection {
  readonly connectionString: string
}

export interface ConnectionResolver {
  resolve(projectID: string): Promise<ResolvedConnection>
}

export class ConnectionResolutionError extends Error {
  constructor() {
    super(UNAVAILABLE)
    this.name = 'ConnectionResolutionError'
  }
}

function project(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value.trim() !== value ||
    Array.from(value).length > MAX_PROJECT_ID_CHARACTERS
  ) {
    throw new ConnectionResolutionError()
  }
  return value
}

function connection(value: unknown): string {
  if (typeof value !== 'string' || value === '' || /\s/u.test(value)) {
    throw new ConnectionResolutionError()
  }

  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
      url.hostname === '' ||
      url.href !== value
    ) {
      throw new ConnectionResolutionError()
    }
  } catch {
    throw new ConnectionResolutionError()
  }

  return value
}

/** Resolves only project-bound, decrypted PostgreSQL metadata for owner-side composition. */
export function createConnectionResolver(
  repository: ConnectionRepository,
  connectionCrypto: ConnectionCrypto,
): ConnectionResolver {
  return Object.freeze({
    async resolve(input: string): Promise<ResolvedConnection> {
      try {
        const projectID = project(input)
        const encrypted = await repository.resolve(projectID)
        const connectionString = connection(await connectionCrypto.decrypt(projectID, encrypted))
        return Object.freeze({ connectionString })
      } catch {
        throw new ConnectionResolutionError()
      }
    },
  })
}
