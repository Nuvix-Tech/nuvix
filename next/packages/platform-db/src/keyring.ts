const PRIMARY_KEY_ID_VARIABLE = 'NUVIX_PLATFORM_ENCRYPTION_PRIMARY_KEY_ID'
const KEYS_VARIABLE = 'NUVIX_PLATFORM_ENCRYPTION_KEYS'
const KEY_BYTES = 32
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export interface VersionedKey {
  readonly id: string
  readonly bytes: Uint8Array
}

export interface Keyring {
  readonly activeID: string
  active(): VersionedKey
  get(id: string): VersionedKey
}

export class KeyringConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeyringConfigurationError'
  }
}

function fail(variable: string, rule: string): never {
  throw new KeyringConfigurationError(`${variable} ${rule}`)
}

function parseObject(serialized: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    fail(KEYS_VARIABLE, 'must be valid JSON')
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(KEYS_VARIABLE, 'must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function memberNames(serialized: string): string[] {
  const names: string[] = []
  let position = 0
  const whitespace = /\s/

  while (whitespace.test(serialized[position] ?? '')) position += 1
  position += 1

  while (position < serialized.length) {
    while (whitespace.test(serialized[position] ?? '')) position += 1
    if (serialized[position] === '}') return names

    const start = position
    position += 1
    while (position < serialized.length) {
      if (serialized[position] === '\\') {
        position += 2
        continue
      }
      if (serialized[position] === '"') break
      position += 1
    }
    position += 1
    names.push(JSON.parse(serialized.slice(start, position)) as string)

    while (whitespace.test(serialized[position] ?? '')) position += 1
    position += 1

    let depth = 0
    let inString = false
    while (position < serialized.length) {
      const character = serialized[position]
      if (inString && character === '\\') {
        position += 2
        continue
      }
      if (character === '"') inString = !inString
      if (!inString && (character === '{' || character === '[')) depth += 1
      if (!inString && (character === '}' || character === ']') && depth > 0) depth -= 1
      if (!inString && depth === 0 && (character === ',' || character === '}')) break
      position += 1
    }

    if (serialized[position] === '}') return names
    position += 1
  }
  return names
}

function decode(value: string): Uint8Array {
  if (value === '' || !BASE64.test(value)) fail(KEYS_VARIABLE, 'contains malformed base64')

  let bytes: Uint8Array
  try {
    bytes = Uint8Array.fromBase64(value, {
      alphabet: 'base64',
      lastChunkHandling: 'strict',
    })
  } catch {
    fail(KEYS_VARIABLE, 'contains malformed base64')
  }

  if (bytes.toBase64() !== value) fail(KEYS_VARIABLE, 'contains malformed base64')
  if (bytes.byteLength !== KEY_BYTES) {
    fail(KEYS_VARIABLE, `keys must decode to exactly ${KEY_BYTES} bytes`)
  }
  return bytes
}

function copy(id: string, bytes: Uint8Array): VersionedKey {
  return Object.freeze({ id, bytes: bytes.slice() })
}

export function parseKeyring(
  activeID: string | undefined,
  serialized: string | undefined,
): Keyring {
  if (activeID === undefined || activeID === '') fail(PRIMARY_KEY_ID_VARIABLE, 'is required')
  if (serialized === undefined || serialized === '') fail(KEYS_VARIABLE, 'is required')

  const object = parseObject(serialized)
  const entries = Object.entries(object)
  if (entries.length === 0) fail(KEYS_VARIABLE, 'must contain at least one key')

  const names = memberNames(serialized)
  if (new Set(names).size !== names.length) fail(KEYS_VARIABLE, 'contains a duplicate key ID')

  const keys = new Map<string, Uint8Array>()
  for (const [id, value] of entries) {
    if (id === '') fail(KEYS_VARIABLE, 'contains an empty key ID')
    if (typeof value !== 'string') fail(KEYS_VARIABLE, 'values must be base64 strings')
    keys.set(id, decode(value))
  }

  if (!keys.has(activeID)) fail(PRIMARY_KEY_ID_VARIABLE, `must match an entry in ${KEYS_VARIABLE}`)

  const get = (id: string): VersionedKey => {
    const bytes = keys.get(id)
    if (bytes === undefined) throw new Error('Unknown platform encryption key version')
    return copy(id, bytes)
  }

  return Object.freeze({
    activeID,
    active: () => get(activeID),
    get,
  })
}
