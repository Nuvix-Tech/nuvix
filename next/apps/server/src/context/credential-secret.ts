const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/
const TOKEN_PATTERN = /^(ses|key)_v1\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)$/
const MIN_SECRET_BYTES = 32

export type CredentialKind = 'session' | 'apiKey'

export interface ParsedCredential {
  readonly id: string
  readonly secret: Uint8Array
}

export interface SecretVerifier {
  readonly salt: string
  readonly digest: string
}

function encode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decode(value: string): Uint8Array | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return null
  const standard = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=')
  try {
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return encode(bytes) === value ? bytes : null
  } catch {
    return null
  }
}

function encodedId(id: string): string {
  return encode(new TextEncoder().encode(id))
}

function decodedId(value: string): string | null {
  const bytes = decode(value)
  if (!bytes) return null
  try {
    const id = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return ID_PATTERN.test(id) && encodedId(id) === value ? id : null
  } catch {
    return null
  }
}

function prefix(kind: CredentialKind): 'ses' | 'key' {
  return kind === 'session' ? 'ses' : 'key'
}

function message(kind: CredentialKind, secret: Uint8Array): Uint8Array {
  const domain = new TextEncoder().encode(`nuvix:${kind}:v1\0`)
  const value = new Uint8Array(domain.length + secret.length)
  value.set(domain)
  value.set(secret, domain.length)
  return value
}

function buffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}

async function hmacKey(salt: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    buffer(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export function createCredentialToken(
  kind: CredentialKind,
  id: string,
  secret: Uint8Array,
): string {
  if (!ID_PATTERN.test(id) || secret.length < MIN_SECRET_BYTES) {
    throw new TypeError('Credential token input is invalid')
  }
  return `${prefix(kind)}_v1.${encodedId(id)}.${encode(secret)}`
}

export function parseCredentialToken(kind: CredentialKind, token: string): ParsedCredential | null {
  if (token.length > 1024) return null
  const match = TOKEN_PATTERN.exec(token)
  if (!match || match[1] !== prefix(kind)) return null
  const id = decodedId(match[2]!)
  const secret = decode(match[3]!)
  if (!id || !secret || secret.length < MIN_SECRET_BYTES) return null
  return Object.freeze({ id, secret })
}

export async function createSecretVerifier(
  kind: CredentialKind,
  secret: Uint8Array,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(32)),
): Promise<SecretVerifier> {
  if (secret.length < MIN_SECRET_BYTES || salt.length !== 32) {
    throw new TypeError('Credential secret verifier input is invalid')
  }
  const digest = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(salt),
    buffer(message(kind, secret)),
  )
  return Object.freeze({
    salt: encode(salt),
    digest: encode(new Uint8Array(digest)),
  })
}

export async function verifyCredentialSecret(
  kind: CredentialKind,
  secret: Uint8Array,
  verifier: SecretVerifier,
): Promise<boolean> {
  const salt = decode(verifier.salt)
  const digest = decode(verifier.digest)
  if (salt?.length !== 32 || digest?.length !== 32) return false
  return await crypto.subtle.verify(
    'HMAC',
    await hmacKey(salt),
    buffer(digest),
    buffer(message(kind, secret)),
  )
}
