import type { DatabaseOptions, Filter, FilterValue } from '@nuvix/db'

const ALGORITHM = 'AES-GCM'
const IV_BYTES = 12
const KEY_BYTES = 32
const TAG_BITS = 128
const ENVELOPE_PATTERN = /^ntt1\.([a-zA-Z0-9_-]+)$/
const ADDITIONAL_DATA = new TextEncoder().encode('nuvix:tenant-target:v1')

type Filters = NonNullable<DatabaseOptions['filters']>

interface JsonFilter {
  encode(value: FilterValue): string
  decode(value: FilterValue): FilterValue
}

interface EncryptionFilter {
  encode(value: FilterValue): Promise<string>
  decode(value: FilterValue): Promise<string>
}

export type TenantTargetFilters = Readonly<
  Filters & {
    readonly json: Filter & JsonFilter
    readonly encrypt: Filter & EncryptionFilter
  }
>

export class TenantTargetCodecConfigurationError extends Error {
  readonly code = 'tenant_target_codec_configuration_invalid'

  constructor() {
    super('Tenant target codec configuration is invalid')
    this.name = 'TenantTargetCodecConfigurationError'
  }
}

export class TenantTargetCodecEncodeError extends Error {
  readonly code = 'tenant_target_codec_encode_failed'

  constructor() {
    super('Tenant target encoding failed')
    this.name = 'TenantTargetCodecEncodeError'
  }
}

export class TenantTargetCodecDecodeError extends Error {
  readonly code = 'tenant_target_codec_decode_failed'

  constructor() {
    super('Tenant target decoding failed')
    this.name = 'TenantTargetCodecDecodeError'
  }
}

function buffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function bytes(value: string): Uint8Array | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return null

  const standard = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=')
  try {
    const decoded = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    return base64url(decoded) === value ? decoded : null
  } catch {
    return null
  }
}

function keyBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string') throw new TenantTargetCodecConfigurationError()
  const decoded = bytes(value)
  if (decoded?.byteLength !== KEY_BYTES) throw new TenantTargetCodecConfigurationError()
  return decoded
}

function payload(value: FilterValue): Uint8Array {
  if (typeof value !== 'string') throw new TenantTargetCodecDecodeError()
  const match = ENVELOPE_PATTERN.exec(value)
  const decoded = match ? bytes(match[1]!) : null
  if (!decoded || decoded.byteLength < IV_BYTES + TAG_BITS / 8) {
    throw new TenantTargetCodecDecodeError()
  }
  return decoded
}

function concatenate(first: Uint8Array, second: Uint8Array): Uint8Array {
  const result = new Uint8Array(first.byteLength + second.byteLength)
  result.set(first)
  result.set(second, first.byteLength)
  return result
}

function jsonFilter(): Filter & JsonFilter {
  return Object.freeze({
    encode(value: FilterValue): string {
      try {
        const encoded = JSON.stringify(value)
        if (encoded === undefined) throw new TenantTargetCodecEncodeError()
        return encoded
      } catch {
        throw new TenantTargetCodecEncodeError()
      }
    },
    decode(value: FilterValue): FilterValue {
      if (typeof value !== 'string') throw new TenantTargetCodecDecodeError()
      try {
        return JSON.parse(value) as FilterValue
      } catch {
        throw new TenantTargetCodecDecodeError()
      }
    },
  })
}

function encryptionFilter(key: CryptoKey): Filter & EncryptionFilter {
  return Object.freeze({
    async encode(value: FilterValue): Promise<string> {
      if (typeof value !== 'string') throw new TenantTargetCodecEncodeError()

      try {
        const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
        const ciphertext = await crypto.subtle.encrypt(
          {
            name: ALGORITHM,
            iv: buffer(iv),
            additionalData: buffer(ADDITIONAL_DATA),
            tagLength: TAG_BITS,
          },
          key,
          buffer(new TextEncoder().encode(value)),
        )
        return `ntt1.${base64url(concatenate(iv, new Uint8Array(ciphertext)))}`
      } catch {
        throw new TenantTargetCodecEncodeError()
      }
    },
    async decode(value: FilterValue): Promise<string> {
      try {
        const encoded = payload(value)
        const iv = encoded.slice(0, IV_BYTES)
        const ciphertext = encoded.slice(IV_BYTES)
        const plaintext = await crypto.subtle.decrypt(
          {
            name: ALGORITHM,
            iv: buffer(iv),
            additionalData: buffer(ADDITIONAL_DATA),
            tagLength: TAG_BITS,
          },
          key,
          buffer(ciphertext),
        )
        return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
      } catch {
        throw new TenantTargetCodecDecodeError()
      }
    },
  })
}

/**
 * Creates the two instance-local filters named by the platform target schema.
 * Key material is canonical, unpadded base64url for exactly one 256-bit AES key.
 */
export async function createTenantTargetFilters(
  keyMaterial: unknown,
): Promise<TenantTargetFilters> {
  const key = await crypto.subtle
    .importKey('raw', buffer(keyBytes(keyMaterial)), ALGORITHM, false, ['encrypt', 'decrypt'])
    .catch(() => {
      throw new TenantTargetCodecConfigurationError()
    })

  return Object.freeze({
    json: jsonFilter(),
    encrypt: encryptionFilter(key),
  })
}
