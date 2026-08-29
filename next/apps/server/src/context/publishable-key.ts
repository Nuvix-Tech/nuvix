export type PublishableKeyEnvironment = 'test' | 'live'

export interface PublishableKeyPayload {
  readonly environment: PublishableKeyEnvironment
  readonly projectId: string
}

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/
const KEY_PATTERN = /^pk_(test|live)_([a-zA-Z0-9_-]+)$/
const PAYLOAD_VERSION = 'v1'

function encode(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decode(value: string): string | null {
  const standard = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=')

  try {
    const decoded = atob(padded)
    return encode(decoded) === value ? decoded : null
  } catch {
    return null
  }
}

function validProjectId(value: string): boolean {
  return PROJECT_ID_PATTERN.test(value)
}

/** Builds a public tenant locator. It contains no credential or authority. */
export function createPublishableKey(
  projectId: string,
  environment: PublishableKeyEnvironment,
): string {
  if (!validProjectId(projectId)) throw new TypeError('Project identifier is invalid')
  return `pk_${environment}_${encode(`${PAYLOAD_VERSION}:${projectId}`)}`
}

/** Strictly parses a public locator; malformed or environment-mismatched keys return null. */
export function parsePublishableKey(
  value: string | null,
  expectedEnvironment?: PublishableKeyEnvironment,
): PublishableKeyPayload | null {
  if (value === null) return null

  const match = KEY_PATTERN.exec(value)
  if (!match) return null

  const environment = match[1] as PublishableKeyEnvironment
  if (expectedEnvironment && environment !== expectedEnvironment) return null

  const decoded = decode(match[2]!)
  if (decoded === null) return null

  const prefix = `${PAYLOAD_VERSION}:`
  if (!decoded.startsWith(prefix)) return null

  const projectId = decoded.slice(prefix.length)
  if (!validProjectId(projectId)) return null

  return Object.freeze({ environment, projectId })
}
