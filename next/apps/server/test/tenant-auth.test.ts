import { describe, expect, test } from 'bun:test'
import { Doc } from '@nuvix/db'
import {
  createCredentialToken,
  createSecretVerifier,
  parseCredentialToken,
  verifyCredentialSecret,
} from '../src/context/credential-secret'
import type { TenantAuthInput } from '../src/context/project-request'
import { createTenantAuthResolver } from '../src/context/tenant-auth'
import { TENANT_AUTH_MODEL } from '../src/context/tenant-auth-model'
import { HEADERS } from '../src/shared/constants'

const SECRET = new Uint8Array(32).fill(7)
const OTHER_SECRET = new Uint8Array(32).fill(9)
const NOW = new Date('2026-08-29T12:00:00.000Z')

async function authHarness(
  options: {
    session?: Record<string, unknown>
    user?: Record<string, unknown>
    memberships?: Doc[]
    apiKey?: Record<string, unknown>
    persistenceError?: Error
  } = {},
) {
  const sessionVerifier = await createSecretVerifier('session', SECRET, new Uint8Array(32).fill(1))
  const keyVerifier = await createSecretVerifier('apiKey', SECRET, new Uint8Array(32).fill(2))
  const records = new Map<string, Doc>([
    [
      `${TENANT_AUTH_MODEL.collections.sessions}:session_a`,
      new Doc({
        userId: 'user_a',
        secretDigest: sessionVerifier.digest,
        secretSalt: sessionVerifier.salt,
        expiresAt: '2026-08-29T13:00:00.000Z',
        revokedAt: null,
        ...options.session,
      }),
    ],
    [
      `${TENANT_AUTH_MODEL.collections.users}:user_a`,
      new Doc({
        status: true,
        emailVerified: true,
        phoneVerified: false,
        labels: ['staff', 'beta', 'staff'],
        ...options.user,
      }),
    ],
    [
      `${TENANT_AUTH_MODEL.collections.apiKeys}:key_a`,
      new Doc({
        secretDigest: keyVerifier.digest,
        secretSalt: keyVerifier.salt,
        scopes: ['schemas.write', 'schemas.read', 'schemas.write'],
        modes: ['admin'],
        enabled: true,
        expiresAt: null,
        revokedAt: null,
        ...options.apiKey,
      }),
    ],
  ])
  const memberships = options.memberships ?? [
    new Doc({ teamId: 'team_a', roles: ['viewer', 'owner'] }),
  ]
  let reads = 0
  const input = (headers: Headers): TenantAuthInput => ({
    headers,
    project: { id: 'project_a', enabled: true },
    documents: {
      getDocument: async (collection: string, id: string) => {
        reads += 1
        if (options.persistenceError) throw options.persistenceError
        return records.get(`${collection}:${id}`) ?? new Doc()
      },
      find: async () => {
        reads += 1
        if (options.persistenceError) throw options.persistenceError
        return memberships
      },
    },
  })
  return {
    input,
    reads: () => reads,
    apiKeyToken: createCredentialToken('apiKey', 'key_a', SECRET),
    sessionToken: createCredentialToken('session', 'session_a', SECRET),
  }
}

describe('credential secret primitives', () => {
  test('creates canonical opaque tokens and verifies secrets with native HMAC', async () => {
    const verifier = await createSecretVerifier('session', SECRET, new Uint8Array(32).fill(3))
    const token = createCredentialToken('session', 'session_a', SECRET)

    expect(parseCredentialToken('session', token)).toEqual({
      id: 'session_a',
      secret: SECRET,
    })
    expect(await verifyCredentialSecret('session', SECRET, verifier)).toBe(true)
    expect(await verifyCredentialSecret('session', OTHER_SECRET, verifier)).toBe(false)
  })

  test('does not accept one credential kind as another', () => {
    const token = createCredentialToken('apiKey', 'key_a', SECRET)

    expect(parseCredentialToken('session', token)).toBeNull()
  })
})

describe('tenant-local authentication', () => {
  const resolver = createTenantAuthResolver({ now: () => NOW })

  test('returns guest without touching tenant auth collections when no credential exists', async () => {
    const state = await authHarness()

    const auth = await resolver.resolve(state.input(new Headers()))

    expect(auth).toEqual({ type: 'guest' })
    expect(state.reads()).toBe(0)
  })

  test('rejects multiple credential mechanisms before persistence', async () => {
    const state = await authHarness()
    const headers = new Headers({
      [HEADERS.session]: state.sessionToken,
      [HEADERS.apiKey]: state.apiKeyToken,
    })

    const failure = await resolver.resolve(state.input(headers)).catch((error: unknown) => error)

    expect((failure as { status: number }).status).toBe(400)
    expect((failure as { fields: { code?: string } }).fields.code).toBe('auth_credentials_conflict')
    expect(state.reads()).toBe(0)
  })

  test('verifies a session and hydrates current user and membership claims', async () => {
    const state = await authHarness()

    const auth = await resolver.resolve(
      state.input(new Headers({ [HEADERS.session]: state.sessionToken })),
    )

    expect(auth).toEqual({
      type: 'session',
      sessionId: 'session_a',
      userId: 'user_a',
      verified: true,
      scopes: [],
      labels: ['beta', 'staff'],
      teams: [{ teamId: 'team_a', roles: ['owner', 'viewer'] }],
    })
    expect(JSON.stringify(auth)).not.toContain(state.sessionToken)
    expect(Object.isFrozen(auth)).toBe(true)
  })

  test.each([
    ['unknown', undefined, createCredentialToken('session', 'unknown', SECRET)],
    ['wrong secret', undefined, createCredentialToken('session', 'session_a', OTHER_SECRET)],
    ['expired', { expiresAt: NOW.toISOString() }, undefined],
    ['revoked', { revokedAt: NOW.toISOString() }, undefined],
  ] as const)(
    'returns the same credential_invalid result for an %s session',
    async (_case, patch, token) => {
      const state = await authHarness({ session: patch })

      const failure = await resolver
        .resolve(state.input(new Headers({ [HEADERS.session]: token ?? state.sessionToken })))
        .catch((error: unknown) => error)

      expect((failure as { status: number }).status).toBe(401)
      expect((failure as { fields: { code?: string } }).fields.code).toBe('credential_invalid')
    },
  )

  test('verifies an API key, stored modes, and deterministic scopes', async () => {
    const state = await authHarness()

    const auth = await resolver.resolve(
      state.input(
        new Headers({
          [HEADERS.apiKey]: state.apiKeyToken,
          [HEADERS.mode]: 'admin',
        }),
      ),
    )

    expect(auth).toEqual({
      type: 'apiKey',
      keyId: 'key_a',
      mode: 'admin',
      scopes: ['schemas.read', 'schemas.write'],
    })
  })

  test.each([
    ['unknown mode', 'owner', undefined],
    ['disallowed mode', 'console', undefined],
    ['disabled key', 'admin', { enabled: false }],
    ['revoked key', 'admin', { revokedAt: NOW.toISOString() }],
  ] as const)('rejects an API key with $case', async (_case, mode, patch) => {
    const state = await authHarness({ apiKey: patch })

    const failure = await resolver
      .resolve(
        state.input(
          new Headers({
            [HEADERS.apiKey]: state.apiKeyToken,
            [HEADERS.mode]: mode,
          }),
        ),
      )
      .catch((error: unknown) => error)

    expect((failure as { fields: { code?: string } }).fields.code).toBe('credential_invalid')
  })

  test('fails JWT authentication closed until tenant signing keys are implemented', async () => {
    const state = await authHarness()

    const failure = await resolver
      .resolve(state.input(new Headers({ [HEADERS.jwt]: 'header.payload.signature' })))
      .catch((error: unknown) => error)

    expect((failure as { fields: { code?: string } }).fields.code).toBe('credential_invalid')
    expect(state.reads()).toBe(0)
  })

  test('turns tenant persistence failures into a redacted availability error', async () => {
    const state = await authHarness({
      persistenceError: new Error('postgresql://user:secret@example.test/tenant failed'),
    })

    const failure = await resolver
      .resolve(state.input(new Headers({ [HEADERS.session]: state.sessionToken })))
      .catch((error: unknown) => error)

    expect((failure as { status: number }).status).toBe(503)
    expect((failure as { fields: { code?: string } }).fields.code).toBe(
      'authentication_unavailable',
    )
    expect(String(failure)).not.toContain('secret')
  })
})
