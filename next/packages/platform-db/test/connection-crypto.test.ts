import { describe, expect, test } from 'bun:test'
import {
  ConnectionDecryptionError,
  ConnectionEncryptionError,
  createConnectionCrypto,
  type EncryptedConnection,
  type NonceGenerator,
} from '../src/connection-crypto'
import { parseKeyring } from '../src/keyring'

const CONNECTION = 'postgresql://tenant:secret@db.internal:5432/app?sslmode=require'
const PROJECT = 'project-019'
const key = (byte: number): string => new Uint8Array(32).fill(byte).toBase64()

function keyring(active = 'new') {
  return parseKeyring(active, JSON.stringify({ old: key(1), new: key(2) }))
}

function sequence(...values: number[]): NonceGenerator {
  let index = 0
  return () => new Uint8Array(12).fill(values[index++] ?? 0)
}

function changed(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes)
  copy[0] = copy[0]! ^ 1
  return copy
}

async function failure(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action()
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('Expected decryption to fail')
}

describe('createConnectionCrypto', () => {
  test('round trips a binary-safe canonical AES-256-GCM envelope without plaintext', async () => {
    const connectionCrypto = createConnectionCrypto(keyring(), sequence(7))

    const encrypted = await connectionCrypto.encrypt(PROJECT, CONNECTION)

    expect(encrypted).toEqual({
      encryptionVersion: 1,
      keyVersion: 'new',
      nonce: new Uint8Array(12).fill(7),
      ciphertext: expect.any(Uint8Array),
    })
    expect(encrypted.ciphertext.byteLength).toBe(new TextEncoder().encode(CONNECTION).length + 16)
    expect(encrypted.ciphertext.toBase64()).not.toContain(CONNECTION)
    expect(await connectionCrypto.decrypt(PROJECT, encrypted)).toBe(CONNECTION)
  })

  test('requests a fresh nonce for every encryption', async () => {
    const connectionCrypto = createConnectionCrypto(keyring(), sequence(3, 4))

    const first = await connectionCrypto.encrypt(PROJECT, CONNECTION)
    const second = await connectionCrypto.encrypt(PROJECT, CONNECTION)

    expect(first.nonce).toEqual(new Uint8Array(12).fill(3))
    expect(second.nonce).toEqual(new Uint8Array(12).fill(4))
    expect(second.nonce).not.toEqual(first.nonce)
    expect(second.ciphertext).not.toEqual(first.ciphertext)
  })

  test('collapses ciphertext, nonce, version, and project tampering into one cause-less error', async () => {
    const connectionCrypto = createConnectionCrypto(keyring(), sequence(9))
    const encrypted = await connectionCrypto.encrypt(PROJECT, CONNECTION)
    const attempts = [
      () =>
        connectionCrypto.decrypt(PROJECT, {
          ...encrypted,
          ciphertext: changed(encrypted.ciphertext),
        }),
      () =>
        connectionCrypto.decrypt(PROJECT, {
          ...encrypted,
          nonce: changed(encrypted.nonce),
        }),
      () => connectionCrypto.decrypt(PROJECT, { ...encrypted, keyVersion: 'old' }),
      () =>
        connectionCrypto.decrypt(PROJECT, {
          ...encrypted,
          keyVersion: 'missing-secret-version',
        }),
      () => connectionCrypto.decrypt('another-project', encrypted),
    ]

    const errors = await Promise.all(attempts.map((attempt) => failure(attempt)))

    expect(errors.every((error) => error instanceof ConnectionDecryptionError)).toBe(true)
    expect(new Set(errors.map((error) => error.message))).toEqual(
      new Set(['Connection metadata is unavailable']),
    )
    expect(errors.every((error) => !('cause' in error))).toBe(true)
    expect(errors.every((error) => !error.message.includes(CONNECTION))).toBe(true)
    expect(errors.every((error) => !error.message.includes(PROJECT))).toBe(true)
    expect(errors.every((error) => !error.message.includes('missing-secret-version'))).toBe(true)
  })

  test('authenticates the stored key version even when versions share key material', async () => {
    const encoded = key(6)
    const duplicateMaterial = parseKeyring('new', JSON.stringify({ old: encoded, new: encoded }))
    const connectionCrypto = createConnectionCrypto(duplicateMaterial, sequence(8))
    const encrypted = await connectionCrypto.encrypt(PROJECT, CONNECTION)

    const error = await failure(() =>
      connectionCrypto.decrypt(PROJECT, {
        ...encrypted,
        keyVersion: 'old',
      }),
    )

    expect(error).toBeInstanceOf(ConnectionDecryptionError)
    expect(error.message).toBe('Connection metadata is unavailable')
    expect('cause' in error).toBe(false)
  })

  test('rejects malformed envelopes with the same redacted cause-less error', async () => {
    const connectionCrypto = createConnectionCrypto(keyring(), sequence(5))
    const encrypted = await connectionCrypto.encrypt(PROJECT, CONNECTION)
    const malformed = [
      null,
      {},
      { ...encrypted, unexpected: true },
      { ...encrypted, encryptionVersion: 2 },
      { ...encrypted, keyVersion: '' },
      { ...encrypted, keyVersion: ' old ' },
      { ...encrypted, keyVersion: 'v'.repeat(129) },
      { ...encrypted, nonce: new Uint8Array(11) },
      { ...encrypted, nonce: encrypted.nonce.toBase64() },
      { ...encrypted, ciphertext: new Uint8Array(16) },
      { ...encrypted, ciphertext: encrypted.ciphertext.toBase64() },
    ]

    const errors = await Promise.all(
      malformed.map((value) =>
        failure(() => connectionCrypto.decrypt(PROJECT, value as EncryptedConnection)),
      ),
    )

    expect(errors.every((error) => error instanceof ConnectionDecryptionError)).toBe(true)
    expect(errors.every((error) => error.message === 'Connection metadata is unavailable')).toBe(
      true,
    )
    expect(errors.every((error) => !('cause' in error))).toBe(true)
  })

  test('rejects inherited envelope fields hidden by unrelated own properties', async () => {
    const connectionCrypto = createConnectionCrypto(keyring(), sequence(5))
    const encrypted = await connectionCrypto.encrypt(PROJECT, CONNECTION)
    const inherited = Object.assign(Object.create(encrypted) as object, {
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
    }) as unknown as EncryptedConnection

    const error = await failure(() => connectionCrypto.decrypt(PROJECT, inherited))

    expect(error).toBeInstanceOf(ConnectionDecryptionError)
    expect(error.message).toBe('Connection metadata is unavailable')
    expect('cause' in error).toBe(false)
  })

  test('decrypts old records by stored version after active-key rotation', async () => {
    const oldCrypto = createConnectionCrypto(keyring('old'), sequence(1))
    const oldRecord = await oldCrypto.encrypt(PROJECT, CONNECTION)
    const rotatedCrypto = createConnectionCrypto(keyring('new'), sequence(2))

    const newRecord = await rotatedCrypto.encrypt(PROJECT, CONNECTION)

    expect(oldRecord.keyVersion).toBe('old')
    expect(newRecord.keyVersion).toBe('new')
    expect(await rotatedCrypto.decrypt(PROJECT, oldRecord)).toBe(CONNECTION)
    expect(await rotatedCrypto.decrypt(PROJECT, newRecord)).toBe(CONNECTION)
  })

  test('counts canonical key-version limits as PostgreSQL Unicode code points', async () => {
    const boundary = '😀'.repeat(128)
    const acceptedKeyring = parseKeyring(boundary, JSON.stringify({ [boundary]: key(7) }))
    const connectionCrypto = createConnectionCrypto(acceptedKeyring, sequence(6))

    const encrypted = await connectionCrypto.encrypt(PROJECT, CONNECTION)

    expect(boundary.length).toBe(256)
    expect(encrypted.keyVersion).toBe(boundary)
    expect(await connectionCrypto.decrypt(PROJECT, encrypted)).toBe(CONNECTION)
  })

  test('rejects malformed active key versions before encryption without leaking key data', async () => {
    const malformed = [' old ', 'v'.repeat(129), '😀'.repeat(129)]

    for (const keyVersion of malformed) {
      const encodedKey = key(8)
      const malformedKeyring = parseKeyring(
        keyVersion,
        JSON.stringify({ [keyVersion]: encodedKey }),
      )
      let nonceRequests = 0
      const connectionCrypto = createConnectionCrypto(malformedKeyring, () => {
        nonceRequests += 1
        return new Uint8Array(12)
      })

      const error = await failure(() => connectionCrypto.encrypt(PROJECT, CONNECTION))

      expect(error).toBeInstanceOf(ConnectionEncryptionError)
      expect(error.message).toBe('Connection encryption is unavailable')
      expect(error.message).not.toContain(keyVersion)
      expect(error.message).not.toContain(encodedKey)
      expect('cause' in error).toBe(false)
      expect(nonceRequests).toBe(0)
    }
  })

  test('requires normalized identities and exact 12-byte generated nonces', async () => {
    const connectionCrypto = createConnectionCrypto(keyring(), () => new Uint8Array(11))

    await expect(connectionCrypto.encrypt(' project-019 ', CONNECTION)).rejects.toThrow(
      'normalized',
    )
    await expect(connectionCrypto.encrypt(PROJECT, ` ${CONNECTION}`)).rejects.toThrow('normalized')
    await expect(connectionCrypto.encrypt(PROJECT, CONNECTION)).rejects.toThrow('exactly 12 bytes')
  })
})
