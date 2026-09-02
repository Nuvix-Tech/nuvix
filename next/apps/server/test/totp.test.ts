import { describe, expect, test } from 'bun:test'
import {
  base32Decode,
  base32Encode,
  createTotpUri,
  generateHotp,
  generateTotp,
  generateTotpSecret,
  verifyTotp,
} from '../src/utils/totp'

describe('Base32 encoding and decoding', () => {
  test('encodes and decodes standard test strings', () => {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    // RFC 4648 test vectors
    expect(base32Encode(encoder.encode(''))).toBe('')
    expect(base32Encode(encoder.encode('f'))).toBe('MY')
    expect(base32Encode(encoder.encode('fo'))).toBe('MZXQ')
    expect(base32Encode(encoder.encode('foo'))).toBe('MZXW6')
    expect(base32Encode(encoder.encode('foob'))).toBe('MZXW6YQ')
    expect(base32Encode(encoder.encode('fooba'))).toBe('MZXW6YTB')
    expect(base32Encode(encoder.encode('foobar'))).toBe('MZXW6YTBOI')

    expect(decoder.decode(base32Decode('MY'))).toBe('f')
    expect(decoder.decode(base32Decode('MZXQ'))).toBe('fo')
    expect(decoder.decode(base32Decode('MZXW6'))).toBe('foo')
    expect(decoder.decode(base32Decode('MZXW6YQ'))).toBe('foob')
    expect(decoder.decode(base32Decode('MZXW6YTB'))).toBe('fooba')
    expect(decoder.decode(base32Decode('MZXW6YTBOI'))).toBe('foobar')
  })

  test('handles padding and whitespace gracefully', () => {
    const decoder = new TextDecoder()
    expect(decoder.decode(base32Decode('MZXW6===  '))).toBe('foo')
    expect(decoder.decode(base32Decode('mzxw6'))).toBe('foo')
  })
})

describe('RFC 4226 HOTP standard test vectors', () => {
  // Secret: "12345678901234567890" (ASCII bytes)
  const secretKey = new TextEncoder().encode('12345678901234567890')

  const rfcTestVectors = [
    { counter: 0, expected: '755224' },
    { counter: 1, expected: '287082' },
    { counter: 2, expected: '359152' },
    { counter: 3, expected: '969429' },
    { counter: 4, expected: '338314' },
    { counter: 5, expected: '254676' },
    { counter: 6, expected: '287922' },
    { counter: 7, expected: '162583' },
    { counter: 8, expected: '399871' },
    { counter: 9, expected: '520489' },
  ]

  for (const { counter, expected } of rfcTestVectors) {
    test(`generates correct HOTP for counter ${counter}`, async () => {
      const otp = await generateHotp(secretKey, counter, 6)
      expect(otp).toBe(expected)
    })
  }
})

describe('RFC 6238 TOTP generation and verification', () => {
  // Base32 representation of "12345678901234567890" is GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'))

  test('generates valid TOTP token at specific timestamps', async () => {
    // 59s -> counter 1 (at 30s period) -> HOTP counter 1 is "287082"
    const otp59 = await generateTotp(secret, 59_000, 30, 6)
    expect(otp59).toBe('287082')

    // 119s -> counter 3 -> HOTP counter 3 is "969429"
    const otp119 = await generateTotp(secret, 119_000, 30, 6)
    expect(otp119).toBe('969429')
  })

  test('verifies tokens within the acceptable drift window', async () => {
    const now = 100_000 // counter = 3 (between 90s and 120s)
    const currentToken = await generateTotp(secret, now)
    const prevToken = await generateTotp(secret, now - 30_000) // counter = 2
    const nextToken = await generateTotp(secret, now + 30_000) // counter = 4
    const farToken = await generateTotp(secret, now - 60_000) // counter = 1

    // With window = 1: current, prev, next all valid
    expect(await verifyTotp(currentToken, secret, { timestampMs: now, window: 1 })).toBe(true)
    expect(await verifyTotp(prevToken, secret, { timestampMs: now, window: 1 })).toBe(true)
    expect(await verifyTotp(nextToken, secret, { timestampMs: now, window: 1 })).toBe(true)

    // Two periods away is rejected with window = 1
    expect(await verifyTotp(farToken, secret, { timestampMs: now, window: 1 })).toBe(false)

    // With window = 0: only exact current counter is accepted
    expect(await verifyTotp(currentToken, secret, { timestampMs: now, window: 0 })).toBe(true)
    expect(await verifyTotp(prevToken, secret, { timestampMs: now, window: 0 })).toBe(false)
  })

  test('rejects incorrect codes and invalid secrets', async () => {
    const now = 100_000
    expect(await verifyTotp('000000', secret, { timestampMs: now })).toBe(false)
    expect(await verifyTotp('123', secret, { timestampMs: now })).toBe(false)
    expect(await verifyTotp('287082', 'INVALID!BASE32!', { timestampMs: now })).toBe(false)
  })

  test('generates secure random Base32 secret', () => {
    const s1 = generateTotpSecret()
    const s2 = generateTotpSecret()

    expect(s1).toBeDefined()
    expect(s1.length).toBe(32) // 20 bytes encoded in base32 = 32 chars
    expect(s1).not.toBe(s2)
    expect(() => base32Decode(s1)).not.toThrow()
  })

  test('creates standard otpauth URI', () => {
    const uri = createTotpUri({
      secret: 'JBSWY3DPEHPK3PXP',
      account: 'user@example.com',
      issuer: 'Nuvix Cloud',
    })

    expect(uri).toBe(
      'otpauth://totp/Nuvix%20Cloud:user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Nuvix+Cloud&algorithm=SHA1',
    )
  })
})
