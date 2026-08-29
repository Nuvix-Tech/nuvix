import type { Keyring, VersionedKey } from './keyring'

const ENCRYPTION_VERSION = 1
const KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BITS = 128
const TAG_BYTES = TAG_BITS / 8
const MAX_KEY_VERSION_CHARACTERS = 128
const ENVELOPE_KEYS = ['ciphertext', 'encryptionVersion', 'keyVersion', 'nonce'] as const
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
type Bytes = Uint8Array<ArrayBuffer>

export interface EncryptedConnection {
  readonly encryptionVersion: number
  readonly keyVersion: string
  readonly nonce: Bytes
  /** Web Crypto's canonical ciphertext || 128-bit authentication-tag representation. */
  readonly ciphertext: Bytes
}

export interface ConnectionCrypto {
  encrypt(projectID: string, connection: string): Promise<EncryptedConnection>
  decrypt(projectID: string, encrypted: EncryptedConnection): Promise<string>
}

export type NonceGenerator = () => Bytes

export class ConnectionEncryptionError extends Error {
  constructor() {
    super('Connection encryption is unavailable')
    this.name = 'ConnectionEncryptionError'
  }
}

export class ConnectionDecryptionError extends Error {
  constructor() {
    super('Connection metadata is unavailable')
    this.name = 'ConnectionDecryptionError'
  }
}

function isCanonicalKeyVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    value.trim() === value &&
    Array.from(value).length <= MAX_KEY_VERSION_CHARACTERS
  )
}

function project(projectID: string): string {
  if (projectID === '' || projectID.trim() !== projectID) {
    throw new TypeError('projectID must be a normalized, non-empty value')
  }
  return projectID
}

function aad(projectID: string, keyVersion: string): Bytes {
  // A fixed-order JSON tuple avoids delimiter ambiguity while binding all routing metadata.
  return encoder.encode(JSON.stringify([ENCRYPTION_VERSION, keyVersion, project(projectID)]))
}

function nonce(generate: NonceGenerator): Bytes {
  const value = generate()
  if (!(value instanceof Uint8Array) || value.byteLength !== NONCE_BYTES) {
    throw new TypeError(`nonce generator must return exactly ${NONCE_BYTES} bytes`)
  }
  return value.slice()
}

function systemNonce(): Bytes {
  return crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
}

async function imported(key: VersionedKey): Promise<CryptoKey> {
  if (key.bytes.byteLength !== KEY_BYTES) throw new TypeError('Invalid encryption key')
  return crypto.subtle.importKey('raw', new Uint8Array(key.bytes), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

function algorithm(nonceValue: Bytes, aad: Bytes) {
  return {
    name: 'AES-GCM',
    iv: nonceValue,
    additionalData: aad,
    tagLength: TAG_BITS,
  }
}

function envelope(value: EncryptedConnection): EncryptedConnection {
  const ownKeys = typeof value === 'object' && value !== null ? Object.keys(value) : []
  if (
    typeof value !== 'object' ||
    value === null ||
    ownKeys.length !== ENVELOPE_KEYS.length ||
    !ENVELOPE_KEYS.every((member) => ownKeys.includes(member)) ||
    value.encryptionVersion !== ENCRYPTION_VERSION ||
    !isCanonicalKeyVersion(value.keyVersion) ||
    !(value.nonce instanceof Uint8Array) ||
    value.nonce.byteLength !== NONCE_BYTES ||
    !(value.ciphertext instanceof Uint8Array) ||
    value.ciphertext.byteLength <= TAG_BYTES
  ) {
    throw new ConnectionDecryptionError()
  }
  return value
}

/** Creates project-bound authenticated encryption for privileged connection metadata. */
export function createConnectionCrypto(
  keyring: Keyring,
  generateNonce: NonceGenerator = systemNonce,
): ConnectionCrypto {
  return Object.freeze({
    async encrypt(projectID: string, connection: string): Promise<EncryptedConnection> {
      const active = keyring.active()
      if (!isCanonicalKeyVersion(active.id)) throw new ConnectionEncryptionError()
      const additionalData = aad(projectID, active.id)
      if (connection === '' || connection.trim() !== connection) {
        throw new TypeError('connection must be a normalized, non-empty value')
      }
      const nonceValue = nonce(generateNonce)
      const key = await imported(active)
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          algorithm(nonceValue, additionalData),
          key,
          encoder.encode(connection),
        ),
      )

      return Object.freeze({
        encryptionVersion: ENCRYPTION_VERSION,
        keyVersion: active.id,
        nonce: nonceValue,
        ciphertext,
      })
    },

    async decrypt(projectID: string, encrypted: EncryptedConnection): Promise<string> {
      try {
        const value = envelope(encrypted)
        const additionalData = aad(projectID, value.keyVersion)
        const key = await imported(keyring.get(value.keyVersion))
        const plaintext = await crypto.subtle.decrypt(
          algorithm(value.nonce, additionalData),
          key,
          value.ciphertext,
        )
        const connection = decoder.decode(plaintext)
        if (connection === '') throw new Error('Invalid plaintext')
        return connection
      } catch {
        // Parsing, key lookup, and authentication failures are deliberately indistinguishable.
        throw new ConnectionDecryptionError()
      }
    },
  })
}
