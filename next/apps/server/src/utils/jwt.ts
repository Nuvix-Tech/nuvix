/**
 * Zero-dependency JWT (HS256) built on WebCrypto.
 *
 * Note: Bun 1.4 has no native JWT API, so this is a small hand-rolled
 * implementation on crypto.subtle — no external dependency needed.
 */

const ALG = 'HS256'
const encoder = new TextEncoder()

export interface JwtPayload {
  /** Subject — user id */
  sub: string
  /** Session id this token was issued for (if applicable) */
  sid?: string
  /** Issued-at (unix seconds) */
  iat?: number
  /** Expiration (unix seconds) */
  exp?: number
  [key: string]: unknown
}

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64url(input: string): string {
  const padded = input.replaceAll('-', '+').replaceAll('_', '/')
  return atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

async function signData(data: string, secret: string): Promise<string> {
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return base64url(new Uint8Array(sig))
}

/** Constant-time string comparison to prevent signature timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function signJwt(
  payload: JwtPayload,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000)
  const body = base64url(JSON.stringify({ ...payload, iat, exp: iat + ttlSeconds }))
  const head = base64url(JSON.stringify({ alg: ALG, typ: 'JWT' }))
  const signature = await signData(`${head}.${body}`, secret)
  return `${head}.${body}.${signature}`
}

/** Returns the verified payload, or null when invalid/expired/tampered. */
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [head, body, signature] = parts as [string, string, string]
  const expected = await signData(`${head}.${body}`, secret)
  if (!timingSafeEqual(signature, expected)) return null

  try {
    const payload = JSON.parse(fromBase64url(body)) as JwtPayload
    if (typeof payload.exp === 'number' && payload.exp <= Date.now() / 1000) {
      return null
    }
    return payload
  } catch {
    return null
  }
}
