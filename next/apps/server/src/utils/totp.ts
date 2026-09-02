/**
 * RFC 6238 (TOTP) and RFC 4226 (HOTP) implementation using native WebCrypto.
 * Pure Bun/Web standards with zero third-party dependencies.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Encodes raw bytes to RFC 4648 Base32 string (without padding). */
export function base32Encode(buffer: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!
    bits += 8

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }

  return output
}

/** Decodes RFC 4648 Base32 string (case-insensitive, ignoring whitespace and padding). */
export function base32Decode(input: string): Uint8Array {
  const clean = input.trim().toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')
  let bits = 0
  let value = 0
  const result: number[] = []

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]!
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`)
    }

    value = (value << 5) | index
    bits += 5

    if (bits >= 8) {
      result.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return new Uint8Array(result)
}

function counterToBuffer(counter: number | bigint): Uint8Array {
  const buf = new Uint8Array(8)
  const view = new DataView(buf.buffer)
  view.setBigUint64(0, BigInt(counter), false)
  return buf
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}

async function hmacSha1(keyBytes: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, toArrayBuffer(message))
  return new Uint8Array(sig)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Generates an RFC 4226 HOTP token for a given key and counter. */
export async function generateHotp(
  keyBytes: Uint8Array,
  counter: number | bigint,
  digits = 6,
): Promise<string> {
  const counterBuf = counterToBuffer(counter)
  const hash = await hmacSha1(keyBytes, counterBuf)
  const offset = hash[hash.length - 1]! & 0x0f
  const view = new DataView(hash.buffer, hash.byteOffset, hash.byteLength)
  const binary = view.getUint32(offset, false) & 0x7fffffff
  return (binary % 10 ** digits).toString().padStart(digits, '0')
}

/** Generates a cryptographically random Base32 secret for TOTP. Default 20 bytes (160 bits). */
export function generateTotpSecret(byteLength = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return base32Encode(bytes)
}

/** Generates an RFC 6238 TOTP token for a given Base32 secret. */
export async function generateTotp(
  secret: string,
  timestampMs: number = Date.now(),
  periodSeconds = 30,
  digits = 6,
): Promise<string> {
  const keyBytes = base32Decode(secret)
  const counter = Math.floor(timestampMs / 1000 / periodSeconds)
  return await generateHotp(keyBytes, counter, digits)
}

export interface VerifyTotpOptions {
  /** Number of periods before and after to check for clock drift (default 1). */
  readonly window?: number
  readonly timestampMs?: number
  readonly periodSeconds?: number
  readonly digits?: number
}

/** Verifies an RFC 6238 TOTP token against a Base32 secret within an optional drift window. */
export async function verifyTotp(
  token: string,
  secret: string,
  options: VerifyTotpOptions = {},
): Promise<boolean> {
  const window = options.window ?? 1
  const timestampMs = options.timestampMs ?? Date.now()
  const periodSeconds = options.periodSeconds ?? 30
  const digits = options.digits ?? 6
  const currentCounter = Math.floor(timestampMs / 1000 / periodSeconds)

  let keyBytes: Uint8Array
  try {
    keyBytes = base32Decode(secret)
  } catch {
    return false
  }

  const normalizedToken = token.trim()
  if (normalizedToken.length !== digits) return false

  for (let i = -window; i <= window; i++) {
    const counter = currentCounter + i
    if (counter < 0) continue
    const generated = await generateHotp(keyBytes, counter, digits)
    if (timingSafeEqual(normalizedToken, generated)) {
      return true
    }
  }

  return false
}

export interface TotpUriOptions {
  readonly secret: string
  readonly account: string
  readonly issuer?: string
  readonly digits?: number
  readonly periodSeconds?: number
}

/** Assembles standard otpauth:// URL for authenticator app QR codes. */
export function createTotpUri(options: TotpUriOptions): string {
  const label = options.issuer
    ? `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.account)}`
    : encodeURIComponent(options.account)

  const params = new URLSearchParams()
  params.set('secret', options.secret)
  if (options.issuer) params.set('issuer', options.issuer)
  if (options.digits && options.digits !== 6) params.set('digits', String(options.digits))
  if (options.periodSeconds && options.periodSeconds !== 30) {
    params.set('period', String(options.periodSeconds))
  }
  params.set('algorithm', 'SHA1')

  return `otpauth://totp/${label}?${params.toString()}`
}
