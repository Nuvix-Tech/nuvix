import { describe, expect, spyOn, test } from 'bun:test'
import {
  type ConnectionCrypto,
  createConnectionCrypto,
  type EncryptedConnection,
  type NonceGenerator,
} from '../src/connection-crypto'
import { ConnectionResolutionError, createConnectionResolver } from '../src/connection-resolver'
import type { ConnectionRepository } from '../src/connections'
import { parseKeyring } from '../src/keyring'

const PROJECT_ID = 'project-019'
const OTHER_PROJECT_ID = 'project-secret-wrong'
const CONNECTION = 'postgresql://tenant:uri-secret@db.internal:5432/app?sslmode=require'
const CAUSE_SECRET = `repository failed for ${PROJECT_ID} using ${CONNECTION}`

const key = (byte: number): string => new Uint8Array(32).fill(byte).toBase64()

function keyring(active = 'new') {
  return parseKeyring(active, JSON.stringify({ old: key(1), new: key(2) }))
}

function nonce(byte: number): NonceGenerator {
  return () => new Uint8Array(12).fill(byte)
}

function repository(
  result: EncryptedConnection | Error,
  calls: string[] = [],
): ConnectionRepository {
  return Object.freeze({
    resolve: async (projectID: string) => {
      calls.push(projectID)
      if (result instanceof Error) throw result
      return result
    },
  })
}

function plaintext(value: string): ConnectionCrypto {
  return {
    encrypt: async () => {
      throw new Error('unused')
    },
    decrypt: async () => value,
  }
}

async function encrypted(
  connectionString = CONNECTION,
  projectID = PROJECT_ID,
  active = 'new',
): Promise<EncryptedConnection> {
  return createConnectionCrypto(keyring(active), nonce(7)).encrypt(projectID, connectionString)
}

async function failure(action: () => Promise<unknown>): Promise<Error> {
  const error = await action().catch((caught: unknown) => caught)
  if (error instanceof Error) return error
  throw new Error('Expected an Error')
}

function expectRedacted(error: Error): void {
  expect(error).toBeInstanceOf(ConnectionResolutionError)
  expect(error.message).toBe('Connection metadata is unavailable')
  expect(error.cause).toBeUndefined()
  const observable = `${error.name}\n${error.message}\n${error.stack ?? ''}`
  for (const secret of [PROJECT_ID, OTHER_PROJECT_ID, CONNECTION, CAUSE_SECRET, 'old', 'new']) {
    expect(observable).not.toContain(secret)
  }
}

describe('createConnectionResolver', () => {
  test.each([
    'postgres://tenant:secret@db.internal:5432/app',
    'postgresql://tenant:secret@db.internal/app?sslmode=require',
  ])('returns only a normalized %s connection URI', async (connectionString) => {
    const envelope = await encrypted(connectionString)
    const resolver = createConnectionResolver(
      repository(envelope),
      createConnectionCrypto(keyring(), nonce(8)),
    )

    const resolved = await resolver.resolve(PROJECT_ID)

    expect(resolved).toEqual({ connectionString })
    expect(Object.keys(resolved)).toEqual(['connectionString'])
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.keys(resolver)).toEqual(['resolve'])
    expect(JSON.stringify(resolved)).not.toContain('keyVersion')
    expect(JSON.stringify(resolved)).not.toContain('ciphertext')
    expect(JSON.stringify(resolved)).not.toContain('nonce')
  })

  test('uses the exact same normalized project identity for lookup and AAD decryption', async () => {
    const repositoryCalls: string[] = []
    const cryptoCalls: string[] = []
    const envelope = await encrypted()
    const delegate = createConnectionCrypto(keyring(), nonce(8))
    const crypto: ConnectionCrypto = {
      encrypt: delegate.encrypt,
      decrypt: async (projectID, value) => {
        cryptoCalls.push(projectID)
        return delegate.decrypt(projectID, value)
      },
    }
    const resolver = createConnectionResolver(repository(envelope, repositoryCalls), crypto)

    await resolver.resolve(PROJECT_ID)

    expect(repositoryCalls).toEqual([PROJECT_ID])
    expect(cryptoCalls).toEqual([PROJECT_ID])
  })

  test.each([
    '',
    '   ',
    ` ${CONNECTION}`,
    `${CONNECTION} `,
    'postgresql:',
    'postgresql:///app',
    'postgresql://',
    'https://tenant:secret@db.internal/app',
    'mysql://tenant:secret@db.internal/app',
    'not a URI',
    'postgresql://db.in\tternal/app',
    'postgresql://tenant:se\rcret@db.internal/app',
    'postgresql://db.internal/ap\np',
    'postgresql://tenant:sec ret@db.internal/app',
    'POSTGRESQL://tenant:secret@db.internal/app',
    'postgresql://tenant:secret@db.internal/a/../app',
  ])('collapses invalid decrypted connection metadata into one redacted error', async (value) => {
    const resolver = createConnectionResolver(repository(await encrypted()), plaintext(value))

    const error = await failure(() => resolver.resolve(PROJECT_ID))

    expectRedacted(error)
    if (value !== '') expect(String(error)).not.toContain(value)
  })

  test.each(['', ` ${PROJECT_ID}`, `${PROJECT_ID} `, 'x'.repeat(129), null, undefined])(
    'rejects malformed project identities before repository lookup',
    async (projectID) => {
      const calls: string[] = []
      const envelope = await encrypted()
      const resolver = createConnectionResolver(
        repository(envelope, calls),
        createConnectionCrypto(keyring(), nonce(8)),
      )

      const error = await failure(() => resolver.resolve(projectID as never))

      expectRedacted(error)
      expect(calls).toEqual([])
    },
  )

  test('collapses missing and repository query failures into the same redacted error', async () => {
    const missing = await failure(() =>
      createConnectionResolver(
        repository(new Error('missing encrypted metadata')),
        createConnectionCrypto(keyring(), nonce(8)),
      ).resolve(PROJECT_ID),
    )
    const query = await failure(() =>
      createConnectionResolver(
        repository(new Error(CAUSE_SECRET)),
        createConnectionCrypto(keyring(), nonce(8)),
      ).resolve(PROJECT_ID),
    )

    expectRedacted(missing)
    expectRedacted(query)
  })

  test('rejects ciphertext tampering and a valid envelope bound to another project', async () => {
    const valid = await encrypted()
    const tampered = {
      ...valid,
      ciphertext: Uint8Array.from(valid.ciphertext, (byte, index) =>
        index === 0 ? byte ^ 1 : byte,
      ),
    }
    const wrongProject = await encrypted(CONNECTION, OTHER_PROJECT_ID)
    const crypto = createConnectionCrypto(keyring(), nonce(8))

    const errors = await Promise.all(
      [tampered, wrongProject].map((envelope) =>
        failure(() => createConnectionResolver(repository(envelope), crypto).resolve(PROJECT_ID)),
      ),
    )

    for (const error of errors) expectRedacted(error)
  })

  test('decrypts an old-key record after additive key rotation', async () => {
    const oldEnvelope = await encrypted(CONNECTION, PROJECT_ID, 'old')
    const resolver = createConnectionResolver(
      repository(oldEnvelope),
      createConnectionCrypto(keyring('new'), nonce(8)),
    )

    await expect(resolver.resolve(PROJECT_ID)).resolves.toEqual({
      connectionString: CONNECTION,
    })
  })

  test('collapses unknown-key and malformed encrypted metadata failures', async () => {
    const value = await encrypted()
    const unknownKey = { ...value, keyVersion: 'removed-secret-key' }
    const malformed = { ...value, nonce: new Uint8Array(11) }
    const crypto = createConnectionCrypto(keyring(), nonce(8))

    const errors = await Promise.all(
      [unknownKey, malformed].map((envelope) =>
        failure(() => createConnectionResolver(repository(envelope), crypto).resolve(PROJECT_ID)),
      ),
    )

    for (const error of errors) expectRedacted(error)
  })

  test('does not log successful or failed resolution details', async () => {
    const spies = [
      spyOn(console, 'debug').mockImplementation(() => {}),
      spyOn(console, 'info').mockImplementation(() => {}),
      spyOn(console, 'warn').mockImplementation(() => {}),
      spyOn(console, 'error').mockImplementation(() => {}),
      spyOn(console, 'log').mockImplementation(() => {}),
    ]

    try {
      const value = await encrypted()
      const crypto = createConnectionCrypto(keyring(), nonce(8))
      await createConnectionResolver(repository(value), crypto).resolve(PROJECT_ID)
      await failure(() =>
        createConnectionResolver(repository(new Error(CAUSE_SECRET)), crypto).resolve(PROJECT_ID),
      )
      await failure(() =>
        createConnectionResolver(
          repository({ ...value, nonce: new Uint8Array(11) }),
          crypto,
        ).resolve(PROJECT_ID),
      )

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
