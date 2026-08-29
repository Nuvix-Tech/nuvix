import { describe, expect, test } from 'bun:test'
import { KeyringConfigurationError, parseKeyring } from '../src/keyring'

const key = (byte: number): string => new Uint8Array(32).fill(byte).toBase64()

function message(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    if (error instanceof Error) return error.message
  }
  throw new Error('Expected keyring parsing to fail')
}

describe('parseKeyring', () => {
  test('selects the active key for writes and historical keys by ID for reads', () => {
    const keyring = parseKeyring('new', JSON.stringify({ old: key(1), new: key(2) }))

    expect(keyring.activeID).toBe('new')
    expect(keyring.active().id).toBe('new')
    expect(keyring.active().bytes.every((byte) => byte === 2)).toBe(true)
    expect(keyring.get('old').id).toBe('old')
    expect(keyring.get('old').bytes.every((byte) => byte === 1)).toBe(true)
  })

  test('protects stored key material from mutation through returned lookups', () => {
    const keyring = parseKeyring('active', JSON.stringify({ active: key(7) }))
    const first = keyring.get('active')

    first.bytes.fill(0)

    expect(Object.isFrozen(keyring)).toBe(true)
    expect(Object.isFrozen(first)).toBe(true)
    expect(keyring.get('active').bytes.every((byte) => byte === 7)).toBe(true)
  })

  test('rejects missing or empty variables', () => {
    expect(() => parseKeyring(undefined, '{}')).toThrow(KeyringConfigurationError)
    expect(() => parseKeyring('', '{}')).toThrow(PRIMARY_KEY_ID_VARIABLE)
    expect(() => parseKeyring('active', undefined)).toThrow(KeyringConfigurationError)
    expect(() => parseKeyring('active', '')).toThrow(KEYS_VARIABLE)
  })

  test('rejects malformed JSON and non-object representations', () => {
    expect(() => parseKeyring('active', '{')).toThrow('must be valid JSON')
    expect(() => parseKeyring('active', '[]')).toThrow('must be a JSON object')
    expect(() => parseKeyring('active', 'null')).toThrow('must be a JSON object')
  })

  test('rejects empty keyrings, empty IDs, and non-string values', () => {
    expect(() => parseKeyring('active', '{}')).toThrow('must contain at least one key')
    expect(() => parseKeyring('active', JSON.stringify({ '': key(1) }))).toThrow(
      'contains an empty key ID',
    )
    expect(() => parseKeyring('active', JSON.stringify({ active: 42 }))).toThrow(
      'values must be base64 strings',
    )
  })

  test('rejects duplicate IDs, including equivalent escaped IDs', () => {
    const encoded = key(4)
    const duplicate = `{"active":"${encoded}","active":"${encoded}"}`
    const escapedDuplicate = ` \n {"active":"${encoded}","\\u0061ctive":"${encoded}"} `

    expect(() => parseKeyring('active', duplicate)).toThrow('contains a duplicate key ID')
    expect(() => parseKeyring('active', escapedDuplicate)).toThrow('contains a duplicate key ID')
  })

  test('rejects malformed and non-canonical base64', () => {
    expect(() => parseKeyring('active', JSON.stringify({ active: 'not-base64!' }))).toThrow(
      'contains malformed base64',
    )
    expect(() => parseKeyring('active', JSON.stringify({ active: `${key(5)}\n` }))).toThrow(
      'contains malformed base64',
    )
  })

  test('rejects keys that do not decode to exactly 32 bytes', () => {
    const short = new Uint8Array(31).toBase64()
    const long = new Uint8Array(33).toBase64()

    expect(() => parseKeyring('active', JSON.stringify({ active: short }))).toThrow(
      'exactly 32 bytes',
    )
    expect(() => parseKeyring('active', JSON.stringify({ active: long }))).toThrow(
      'exactly 32 bytes',
    )
  })

  test('rejects an active ID absent from the keyring and unknown read versions', () => {
    const keyring = parseKeyring('active', JSON.stringify({ active: key(1), old: key(2) }))

    expect(() => parseKeyring('missing', JSON.stringify({ active: key(1) }))).toThrow(
      'must match an entry',
    )
    expect(() => keyring.get('missing')).toThrow('Unknown platform encryption key version')
  })

  test('redacts key IDs and encoded material from all validation errors', () => {
    const secretID = 'secret-version-id'
    const encoded = key(9)
    const errors = [
      message(() => parseKeyring(secretID, JSON.stringify({ other: encoded }))),
      message(() => parseKeyring(secretID, JSON.stringify({ [secretID]: `${encoded}!` }))),
      message(() =>
        parseKeyring(secretID, `{"${secretID}":"${encoded}","${secretID}":"${encoded}"}`),
      ),
    ]

    expect(errors.every((error) => !error.includes(secretID))).toBe(true)
    expect(errors.every((error) => !error.includes(encoded))).toBe(true)
  })
})

const PRIMARY_KEY_ID_VARIABLE = 'NUVIX_PLATFORM_ENCRYPTION_PRIMARY_KEY_ID'
const KEYS_VARIABLE = 'NUVIX_PLATFORM_ENCRYPTION_KEYS'
