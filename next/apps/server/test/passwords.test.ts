import { describe, expect, test } from 'bun:test'
import { hashPassword, isValidPassword, verifyPassword } from '../src/utils/passwords'

describe('passwords utility', () => {
  test('validates password length bounds', () => {
    expect(isValidPassword('')).toBe(false)
    expect(isValidPassword('short')).toBe(false)
    expect(isValidPassword('1234567')).toBe(false)
    expect(isValidPassword('12345678')).toBe(true)
    expect(isValidPassword('a'.repeat(256))).toBe(true)
    expect(isValidPassword('a'.repeat(257))).toBe(false)
    expect(isValidPassword(null)).toBe(false)
    expect(isValidPassword(undefined)).toBe(false)
  })

  test('hashes with argon2id by default and verifies correctly', async () => {
    const plain = 'super-secret-password-123'
    const hash = await hashPassword(plain)

    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword(plain, hash)).toBe(true)
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })

  test('hashes with bcrypt when requested and verifies correctly', async () => {
    const plain = 'another-strong-password'
    const hash = await hashPassword(plain, { algorithm: 'bcrypt', cost: 8 })

    expect(hash.startsWith('$2b$') || hash.startsWith('$2a$')).toBe(true)
    expect(await verifyPassword(plain, hash)).toBe(true)
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })

  test('rejects invalid password lengths on hashPassword', async () => {
    expect(hashPassword('short')).rejects.toThrow(TypeError)
    expect(hashPassword('a'.repeat(257))).rejects.toThrow(TypeError)
  })

  test('handles malformed hashes safely in verifyPassword', async () => {
    expect(await verifyPassword('password123', '')).toBe(false)
    expect(await verifyPassword('password123', 'not-a-valid-hash')).toBe(false)
  })
})
