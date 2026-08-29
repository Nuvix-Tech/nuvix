import { describe, expect, test } from 'bun:test'
import { resolveAuth } from '../../../apps/server/src/context/auth'
import { migrations } from '../src/migrations'
import type { PlatformSqlQuery } from '../src/pool'
import { createProjectRepository, type ProjectCredential } from '../src/projects'

const PROJECT_ID = 'project_demo'
const INTERNAL_ID = '5dc1c4ab-f7cd-44a0-ae30-46f71dc10766'
const QUERY_SECRET = 'postgresql://registry-user:registry-secret@database.internal/platform'

interface QueryCall {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}

interface QueryFake {
  readonly sql: PlatformSqlQuery
  readonly calls: QueryCall[]
}

function fakeQuery(results: readonly (readonly unknown[] | Error)[]): QueryFake {
  const calls: QueryCall[] = []
  let next = 0
  const sql: PlatformSqlQuery = {
    query: <TResult>(strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      calls.push({ strings: [...strings], values })
      const result = results[next]
      next += 1
      if (result instanceof Error) return Promise.reject(result)
      if (!result) return Promise.reject(new Error('Unexpected query'))
      return Promise.resolve(result as TResult)
    },
  }
  return { sql, calls }
}

function structure(call: QueryCall): string {
  return call.strings.join('?').replaceAll(/\s+/g, ' ').trim()
}

function expectReadOnlyQuery(call: QueryCall): void {
  const text = structure(call)
  expect(text.startsWith('SELECT ')).toBe(true)
  expect(text).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/)
}

function expectRedacted(error: unknown, original: Error, secrets: readonly string[]): void {
  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw new Error('Expected an Error')

  expect(error).not.toBe(original)
  expect(error.message).toBe('Platform project repository query failed')
  expect(error.cause).toBeUndefined()
  const observable = `${error.name}\n${error.message}\n${error.stack ?? ''}`
  for (const secret of secrets) expect(observable).not.toContain(secret)
}

describe('createProjectRepository', () => {
  test('resolves only safe public metadata for an enabled normalized project', async () => {
    const fake = fakeQuery([[{ found: true, id: INTERNAL_ID, enabled: true }]])
    const repository = createProjectRepository(fake.sql)

    const project = await repository.resolve(PROJECT_ID)

    expect(project).toEqual({ id: PROJECT_ID })
    expect(Object.keys(project ?? {})).toEqual(['id'])
    expect(JSON.stringify(project)).not.toContain(INTERNAL_ID)
    expect(fake.calls[0]?.values).toEqual([PROJECT_ID, true])
    expect(structure(fake.calls[0]!)).toBe(
      'SELECT TRUE AS found FROM projects WHERE public_id = ? AND enabled = ? LIMIT 1',
    )
  })

  test('makes unknown and disabled projects indistinguishable', async () => {
    const unknown = fakeQuery([[]])
    const disabled = fakeQuery([[]])

    const unknownResult = await createProjectRepository(unknown.sql).resolve(PROJECT_ID)
    const disabledResult = await createProjectRepository(disabled.sql).resolve(PROJECT_ID)

    expect(unknownResult).toBeNull()
    expect(disabledResult).toBeNull()
    expect(unknown.calls).toEqual(disabled.calls)
    expect(unknown.calls[0]?.values).toEqual([PROJECT_ID, true])
  })

  test('rejects unnormalized project identifiers before querying', async () => {
    const fake = fakeQuery([])
    const repository = createProjectRepository(fake.sql)

    for (const projectId of ['', ` ${PROJECT_ID}`, `${PROJECT_ID} `, 'x'.repeat(129)]) {
      await expect(repository.resolve(projectId)).rejects.toThrow(
        'Project identifier must be normalized',
      )
    }

    expect(fake.calls).toHaveLength(0)
  })

  const credentials: ReadonlyArray<{
    readonly name: string
    readonly credential: ProjectCredential
    readonly values: readonly unknown[]
  }> = [
    {
      name: 'session identity and its user identity',
      credential: { type: 'session', sessionId: 'session-1', userId: 'user-1' },
      values: [PROJECT_ID, true, 'session', 'session-1', 'user-1', null, true],
    },
    {
      name: 'JWT user identity without trusting its optional session claim',
      credential: {
        type: 'jwt',
        userId: 'user-2',
        sessionId: 'claimed-session',
      },
      values: [PROJECT_ID, true, 'user', 'user-2', null, null, true],
    },
    {
      name: 'API-key identity and verified mode',
      credential: { type: 'apiKey', keyId: 'key-1', mode: 'console' },
      values: [PROJECT_ID, true, 'api_key', 'key-1', null, 'console', true],
    },
  ]

  for (const entry of credentials) {
    test(`independently verifies ${entry.name} against the requested project`, async () => {
      const fake = fakeQuery([[{ bound: true }]])
      const repository = createProjectRepository(fake.sql)

      const bound = await repository.verifyBinding(PROJECT_ID, entry.credential)

      expect(bound).toBe(true)
      expect(fake.calls).toHaveLength(1)
      expect(structure(fake.calls[0]!)).toContain('INNER JOIN project_credential_bindings')
      expect(structure(fake.calls[0]!)).toContain('project.public_id = ?')
      expect(structure(fake.calls[0]!)).toContain('project.enabled = ?')
      expect(structure(fake.calls[0]!)).toContain('binding.credential_type = ?')
      expect(structure(fake.calls[0]!)).toContain('binding.credential_id = ?')
      expect(structure(fake.calls[0]!)).toContain('binding.subject_id IS NOT DISTINCT FROM ?')
      expect(structure(fake.calls[0]!)).toContain('binding.api_key_mode IS NOT DISTINCT FROM ?')
      expect(fake.calls[0]?.values).toEqual(entry.values)
    })
  }

  for (const entry of credentials) {
    test(`returns false for a mismatched ${entry.credential.type} binding`, async () => {
      const fake = fakeQuery([[]])
      const repository = createProjectRepository(fake.sql)

      const result = await repository.verifyBinding(PROJECT_ID, entry.credential)

      expect(result).toBe(false)
      expect(typeof result).toBe('boolean')
    })
  }

  test('requires current enabled, unrevoked, unexpired bindings', async () => {
    const fake = fakeQuery([[{ bound: true }]])
    const repository = createProjectRepository(fake.sql)

    await repository.verifyBinding(PROJECT_ID, credentials[0]!.credential)

    const sql = structure(fake.calls[0]!)
    expect(sql).toContain('binding.enabled = ?')
    expect(sql).toContain('binding.revoked_at IS NULL')
    expect(sql).toContain('(binding.expires_at IS NULL OR binding.expires_at > CURRENT_TIMESTAMP)')
  })

  test('receives only the canonical session identity across the authentication boundary', async () => {
    const rawSessionToken = 'raw-bearer-token-must-not-reach-platform-sql'
    const canonicalSessionId = 'session-record-42'
    const verifiedTokens: string[] = []
    const auth = await resolveAuth(new Headers({ 'x-nuvix-session': rawSessionToken }), {
      verifySession: async (token) => {
        verifiedTokens.push(token)
        return { sessionId: canonicalSessionId, userId: 'user-42' }
      },
    })
    if (auth.type !== 'session') throw new Error('Expected verified session authentication')
    const fake = fakeQuery([[{ bound: true }]])

    await createProjectRepository(fake.sql).verifyBinding(PROJECT_ID, auth)

    expect(verifiedTokens).toEqual([rawSessionToken])
    expect(fake.calls[0]?.values).toEqual([
      PROJECT_ID,
      true,
      'session',
      canonicalSessionId,
      'user-42',
      null,
      true,
    ])
    expect(fake.calls[0]?.strings.join('')).not.toContain(rawSessionToken)
    expect(fake.calls[0]?.values).not.toContain(rawSessionToken)
  })

  test('uses only relations declared by the authoritative migration catalog', async () => {
    const fake = fakeQuery([
      [{ found: true }],
      [{ bound: true }],
      [{ bound: true }],
      [{ bound: true }],
    ])
    const repository = createProjectRepository(fake.sql)

    await repository.resolve(PROJECT_ID)
    for (const entry of credentials) {
      await repository.verifyBinding(PROJECT_ID, entry.credential)
    }

    const declared = new Set(
      migrations.flatMap((migration) =>
        [...migration.sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)/gi)].flatMap(
          (match) => (match[1] ? [match[1]] : []),
        ),
      ),
    )
    const queried = new Set(
      fake.calls.flatMap((call) =>
        [...structure(call).matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)].flatMap((match) =>
          match[1] ? [match[1]] : [],
        ),
      ),
    )
    const catalogSql = migrations.map((migration) => migration.sql).join('\n')
    const columns = new Map(
      [...catalogSql.matchAll(/CREATE TABLE\s+([a-z_]+)\s+\(([\s\S]*?)\n\);/gi)].map((table) => [
        table[1] ?? '',
        new Set(
          [...(table[2] ?? '').matchAll(/^\s+([a-z_]+)\s+(?:uuid|text|boolean|timestamptz)\b/gim)]
            .map((column) => column[1])
            .filter((column): column is string => column !== undefined),
        ),
      ]),
    )
    const bindingQuery = structure(fake.calls[1]!)
    const aliases = new Map([
      ['project', 'projects'],
      ['binding', 'project_credential_bindings'],
    ])

    expect([...queried].toSorted()).toEqual(['project_credential_bindings', 'projects'])
    for (const relation of queried) expect(declared.has(relation)).toBe(true)
    expect(bindingQuery).toContain(
      'INNER JOIN project_credential_bindings AS binding ON binding.project_id = project.id',
    )
    for (const reference of bindingQuery.matchAll(/\b(project|binding)\.([a-z_]+)\b/g)) {
      const relation = aliases.get(reference[1] ?? '')
      expect(relation).toBeDefined()
      expect(columns.get(relation ?? '')?.has(reference[2] ?? '')).toBe(true)
    }
  })

  test('keeps injection-shaped project and credential values out of query text', async () => {
    const hostileProject = "project' OR TRUE --"
    const hostileValues: readonly ProjectCredential[] = [
      {
        type: 'session',
        sessionId: "session' OR TRUE --",
        userId: "user' UNION SELECT id FROM projects --",
      },
      {
        type: 'jwt',
        userId: "jwt-user' OR TRUE --",
        sessionId: 'untrusted-claim',
      },
      {
        type: 'apiKey',
        keyId: "key' UNION SELECT id FROM projects --",
        mode: 'admin',
      },
    ]
    const fake = fakeQuery([
      [{ found: true }],
      [{ bound: true }],
      [{ bound: true }],
      [{ bound: true }],
    ])
    const repository = createProjectRepository(fake.sql)

    await repository.resolve(hostileProject)
    for (const credential of hostileValues) {
      await repository.verifyBinding(hostileProject, credential)
    }

    expect(fake.calls).toHaveLength(4)
    for (const call of fake.calls) {
      expect(call.strings.join('')).not.toContain(hostileProject)
      expectReadOnlyQuery(call)
      for (const value of call.values) {
        if (typeof value === 'string' && value.includes("'")) {
          expect(call.strings.join('')).not.toContain(value)
        }
      }
    }
    expect(fake.calls[0]?.values).toEqual([hostileProject, true])
    expect(fake.calls[1]?.values).toEqual([
      hostileProject,
      true,
      'session',
      "session' OR TRUE --",
      "user' UNION SELECT id FROM projects --",
      null,
      true,
    ])
    expect(fake.calls[2]?.values).toEqual([
      hostileProject,
      true,
      'user',
      "jwt-user' OR TRUE --",
      null,
      null,
      true,
    ])
    expect(fake.calls[3]?.values).toEqual([
      hostileProject,
      true,
      'api_key',
      "key' UNION SELECT id FROM projects --",
      null,
      'admin',
      true,
    ])
  })

  test('replaces project query failures with a stable cause-less error', async () => {
    const original = new Error(`SELECT * FROM projects; ${QUERY_SECRET}; ${PROJECT_ID}`)
    const repository = createProjectRepository(fakeQuery([original]).sql)

    const error = await repository.resolve(PROJECT_ID).catch((caught: unknown) => caught)

    expectRedacted(error, original, [QUERY_SECRET, PROJECT_ID, 'SELECT * FROM projects'])
  })

  for (const entry of credentials) {
    test(`redacts ${entry.credential.type} binding query failures`, async () => {
      const credentialSecrets = entry.values.filter(
        (value): value is string => typeof value === 'string',
      )
      const original = new Error(
        `binding query failed for ${credentialSecrets.join(':')}; ${QUERY_SECRET}`,
      )
      const repository = createProjectRepository(fakeQuery([original]).sql)

      const error = await repository
        .verifyBinding(PROJECT_ID, entry.credential)
        .catch((caught: unknown) => caught)

      expectRedacted(error, original, [QUERY_SECRET, ...credentialSecrets])
    })
  }

  test('exposes no provisioning or write capability', () => {
    const repository = createProjectRepository(fakeQuery([]).sql)

    expect(Object.keys(repository).sort()).toEqual(['resolve', 'verifyBinding'])
  })
})
