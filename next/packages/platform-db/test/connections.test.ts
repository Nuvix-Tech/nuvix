import { describe, expect, spyOn, test } from 'bun:test'
import {
  ConnectionMetadataDuplicateError,
  ConnectionMetadataMalformedError,
  ConnectionMetadataMissingError,
  ConnectionMetadataQueryError,
  createConnectionRepository,
} from '../src/connections'
import type { PlatformSqlQuery } from '../src/pool'

const PROJECT_ID = 'project-secret-id-019'
const INTERNAL_ID = 'internal-secret-id-83'
const URI = 'postgresql://tenant:uri-secret@database.internal/application'
const NONCE_SECRET = 'nonce-secret-value'
const CIPHERTEXT_SECRET = 'ciphertext-secret-value'
const CAUSE_SECRET = `query failed for ${URI}; ${PROJECT_ID}; ${INTERNAL_ID}; ${NONCE_SECRET}; ${CIPHERTEXT_SECRET}`

interface QueryCall {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}

function row(
  nonce: Uint8Array | ArrayBuffer = new Uint8Array(12).fill(7),
  ciphertext: Uint8Array | ArrayBuffer = new Uint8Array(17).fill(9),
): Record<string, unknown> {
  return {
    encryption_version: 1,
    key_version: 'rotation-v2',
    nonce,
    ciphertext,
  }
}

function fake(result: unknown | Error): {
  readonly calls: QueryCall[]
  readonly sql: PlatformSqlQuery
} {
  const calls: QueryCall[] = []
  return {
    calls,
    sql: {
      query: <TResult>(strings: TemplateStringsArray, ...values: readonly unknown[]) => {
        calls.push({ strings: [...strings], values })
        if (result instanceof Error) return Promise.reject(result)
        return Promise.resolve(result as TResult)
      },
    },
  }
}

function structure(call: QueryCall): string {
  return call.strings.join('?').replaceAll(/\s+/g, ' ').trim()
}

async function failure(action: () => Promise<unknown>): Promise<Error> {
  const error = await action().catch((caught: unknown) => caught)
  if (error instanceof Error) return error
  throw new Error('Expected an Error')
}

function expectRedacted(error: Error): void {
  expect(error.message).toBe('Connection metadata is unavailable')
  expect(error.cause).toBeUndefined()
  const observable = `${error.name}\n${error.message}\n${error.stack ?? ''}`
  for (const secret of [
    PROJECT_ID,
    INTERNAL_ID,
    URI,
    NONCE_SECRET,
    CIPHERTEXT_SECRET,
    CAUSE_SECRET,
  ]) {
    expect(observable).not.toContain(secret)
  }
}

describe('createConnectionRepository', () => {
  test('returns only a strict connection-crypto envelope from the exact read-only query', async () => {
    const database = fake([row()])
    const repository = createConnectionRepository(database.sql)

    const encrypted = await repository.resolve(PROJECT_ID)

    expect(encrypted).toEqual({
      encryptionVersion: 1,
      keyVersion: 'rotation-v2',
      nonce: new Uint8Array(12).fill(7),
      ciphertext: new Uint8Array(17).fill(9),
    })
    expect(Object.keys(encrypted)).toEqual([
      'encryptionVersion',
      'keyVersion',
      'nonce',
      'ciphertext',
    ])
    expect(Object.isFrozen(encrypted)).toBe(true)
    expect(Object.keys(repository)).toEqual(['resolve'])
    expect(JSON.stringify(encrypted)).not.toContain(INTERNAL_ID)
    expect(JSON.stringify(encrypted)).not.toContain(URI)
    expect(database.calls).toHaveLength(1)
    expect(structure(database.calls[0]!)).toBe(
      'SELECT connection.encryption_version, connection.key_version, connection.nonce, connection.ciphertext FROM project_connections AS connection INNER JOIN projects AS project ON project.id = connection.project_id WHERE project.public_id = ? AND project.enabled = ? LIMIT 2',
    )
    expect(database.calls[0]?.values).toEqual([PROJECT_ID, true])
    expect(database.calls[0]?.strings.join('')).not.toContain(PROJECT_ID)
    expect(structure(database.calls[0]!)).not.toContain('project.id AS')
    expect(structure(database.calls[0]!)).not.toContain('connection_uri')
    expect(structure(database.calls[0]!)).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/,
    )
  })

  test('normalizes Uint8Array subclasses and ArrayBuffer values with defensive copies', async () => {
    class DatabaseBytes extends Uint8Array {}
    const nonce = new DatabaseBytes(12).fill(4)
    const ciphertextBuffer = new Uint8Array(18).fill(5).buffer
    const ciphertextSource = new Uint8Array(ciphertextBuffer)
    const repository = createConnectionRepository(fake([row(nonce, ciphertextBuffer)]).sql)

    const encrypted = await repository.resolve(PROJECT_ID)
    nonce.fill(0)
    ciphertextSource.fill(0)

    expect(encrypted.nonce).toEqual(new Uint8Array(12).fill(4))
    expect(encrypted.ciphertext).toEqual(new Uint8Array(18).fill(5))
    expect(encrypted.nonce).toBeInstanceOf(Uint8Array)
    expect(encrypted.nonce).not.toBeInstanceOf(DatabaseBytes)
    expect(encrypted.nonce).not.toBe(nonce)
    expect(encrypted.ciphertext.buffer).not.toBe(ciphertextBuffer)
  })

  test('distinguishes missing metadata with a stable cause-less typed error', async () => {
    const error = await failure(() => createConnectionRepository(fake([]).sql).resolve(PROJECT_ID))

    expect(error).toBeInstanceOf(ConnectionMetadataMissingError)
    expectRedacted(error)
  })

  test('detects duplicate metadata rather than selecting an arbitrary row', async () => {
    const error = await failure(() =>
      createConnectionRepository(fake([row(), row()]).sql).resolve(PROJECT_ID),
    )

    expect(error).toBeInstanceOf(ConnectionMetadataDuplicateError)
    expectRedacted(error)
  })

  test.each([
    null,
    {},
    { ...row(), unexpected: true },
    { ...row(), encryption_version: 2 },
    { ...row(), key_version: '' },
    { ...row(), key_version: ' rotation-v2 ' },
    { ...row(), key_version: '\trotation-v2' },
    { ...row(), key_version: 'rotation-v2\u00a0' },
    { ...row(), key_version: 'v'.repeat(129) },
    { ...row(), nonce: new Uint8Array(11) },
    { ...row(), nonce: NONCE_SECRET },
    { ...row(), ciphertext: new Uint8Array(16) },
    { ...row(), ciphertext: CIPHERTEXT_SECRET },
  ])('rejects malformed rows with a stable cause-less typed error', async (malformed) => {
    const error = await failure(() =>
      createConnectionRepository(fake([malformed]).sql).resolve(PROJECT_ID),
    )

    expect(error).toBeInstanceOf(ConnectionMetadataMalformedError)
    expectRedacted(error)
  })

  test.each([
    Object.defineProperty(row(), 'nonce', {
      enumerable: true,
      get: () => {
        throw new Error(CAUSE_SECRET)
      },
    }),
    new Proxy(row(), {
      ownKeys: () => {
        throw new Error(CAUSE_SECRET)
      },
    }),
  ])('redacts exceptions raised while inspecting malformed rows', async (malformed) => {
    const error = await failure(() =>
      createConnectionRepository(fake([malformed]).sql).resolve(PROJECT_ID),
    )

    expect(error).toBeInstanceOf(ConnectionMetadataMalformedError)
    expectRedacted(error)
  })

  test('redacts exceptions raised while inspecting a malformed result array', async () => {
    const malformed = new Proxy([row()], {
      get: (target, property, receiver) => {
        if (property === '0') throw new Error(CAUSE_SECRET)
        return Reflect.get(target, property, receiver)
      },
    })

    const error = await failure(() =>
      createConnectionRepository(fake(malformed).sql).resolve(PROJECT_ID),
    )

    expect(error).toBeInstanceOf(ConnectionMetadataMalformedError)
    expectRedacted(error)
  })

  test('rejects malformed query results and project identities before returning metadata', async () => {
    const malformedResult = await failure(() =>
      createConnectionRepository(fake(row()).sql).resolve(PROJECT_ID),
    )
    const database = fake([row()])
    const malformedProject = await failure(() =>
      createConnectionRepository(database.sql).resolve(` ${PROJECT_ID}`),
    )

    expect(malformedResult).toBeInstanceOf(ConnectionMetadataMalformedError)
    expect(malformedProject).toBeInstanceOf(ConnectionMetadataMalformedError)
    expectRedacted(malformedResult)
    expectRedacted(malformedProject)
    expect(database.calls).toEqual([])
  })

  test.each([
    '',
    `${PROJECT_ID} `,
    `\t${PROJECT_ID}`,
    `${PROJECT_ID}\n`,
    `\u00a0${PROJECT_ID}`,
    ' '.repeat(129),
    null,
    undefined,
    19,
  ])('rejects runtime-invalid project identities before querying', async (projectID) => {
    const database = fake([row()])
    const error = await failure(() =>
      createConnectionRepository(database.sql).resolve(projectID as never),
    )

    expect(error).toBeInstanceOf(ConnectionMetadataMalformedError)
    expectRedacted(error)
    expect(database.calls).toEqual([])
  })

  test('accepts schema-valid Unicode project identity boundaries', async () => {
    const projectID = '🔐'.repeat(128)
    const database = fake([row()])

    await expect(createConnectionRepository(database.sql).resolve(projectID)).resolves.toBeDefined()
    expect(database.calls[0]?.values).toEqual([projectID, true])
  })

  test('replaces query failures without retaining their cause or sensitive values', async () => {
    const original = new Error(CAUSE_SECRET)
    const error = await failure(() =>
      createConnectionRepository(fake(original).sql).resolve(PROJECT_ID),
    )

    expect(error).toBeInstanceOf(ConnectionMetadataQueryError)
    expect(error).not.toBe(original)
    expectRedacted(error)
  })

  test('does not log secrets or failures for any repository outcome', async () => {
    const spies = [
      spyOn(console, 'debug').mockImplementation(() => {}),
      spyOn(console, 'info').mockImplementation(() => {}),
      spyOn(console, 'warn').mockImplementation(() => {}),
      spyOn(console, 'error').mockImplementation(() => {}),
      spyOn(console, 'log').mockImplementation(() => {}),
    ]

    try {
      await createConnectionRepository(fake([row()]).sql).resolve(PROJECT_ID)
      await failure(() => createConnectionRepository(fake([]).sql).resolve(PROJECT_ID))
      await failure(() => createConnectionRepository(fake([row(), row()]).sql).resolve(PROJECT_ID))
      await failure(() =>
        createConnectionRepository(fake([{ ...row(), nonce: NONCE_SECRET }]).sql).resolve(
          PROJECT_ID,
        ),
      )
      await failure(() =>
        createConnectionRepository(fake(new Error(CAUSE_SECRET)).sql).resolve(PROJECT_ID),
      )

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
