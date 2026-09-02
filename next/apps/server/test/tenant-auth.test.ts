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
import { signJwt } from '../src/utils/jwt'

const SECRET = new Uint8Array(32).fill(7)
const OTHER_SECRET = new Uint8Array(32).fill(9)
const JWT_SECRET = 'test-tenant-jwt-secret-material-123456789'
const NOW = new Date('2026-08-29T12:00:00.000Z')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)
const sign = (payload: Parameters<typeof signJwt>[0], secret: string, ttl: number) =>
  signJwt(payload, secret, ttl, NOW_SECONDS)

async function authHarness(
  options: {
    session?: Record<string, unknown>
    user?: Record<string, unknown>
    memberships?: Doc[]
    apiKey?: Record<string, unknown>
    jwtKeys?: Doc[]
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
      find: async (collection: string) => {
        reads += 1
        if (options.persistenceError) throw options.persistenceError
        if (collection === TENANT_AUTH_MODEL.collections.jwtKeys) {
          return (
            options.jwtKeys ?? [
              new Doc({
                signingKey: JWT_SECRET,
                algorithm: 'HS256',
                active: true,
                expiresAt: null,
              }),
            ]
          )
        }
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

  test('authenticates valid JWT and resolves user claims', async () => {
    const state = await authHarness()
    const token = await sign(
      {
        sub: 'user_a',
        iss: 'nuvix:project_a',
        aud: 'nuvix:project',
      },
      JWT_SECRET,
      900,
    )

    const auth = await resolver.resolve(state.input(new Headers({ [HEADERS.jwt]: token })))

    expect(auth).toEqual({
      type: 'jwt',
      userId: 'user_a',
      verified: true,
      labels: ['beta', 'staff'],
      teams: [{ teamId: 'team_a', roles: ['owner', 'viewer'] }],
      scopes: [],
    })
  })

  test('authenticates valid JWT with active backing session', async () => {
    const state = await authHarness()
    const token = await sign(
      {
        sub: 'user_a',
        sid: 'session_a',
        iss: 'nuvix:project_a',
        aud: 'nuvix:project',
      },
      JWT_SECRET,
      900,
    )

    const auth = await resolver.resolve(state.input(new Headers({ [HEADERS.jwt]: token })))

    expect(auth).toEqual({
      type: 'jwt',
      userId: 'user_a',
      sessionId: 'session_a',
      verified: true,
      labels: ['beta', 'staff'],
      teams: [{ teamId: 'team_a', roles: ['owner', 'viewer'] }],
      scopes: [],
    })
  })

  test('rejects JWT when backing session is revoked or expired', async () => {
    const state = await authHarness({
      session: { revokedAt: NOW.toISOString() },
    })
    const token = await sign(
      {
        sub: 'user_a',
        sid: 'session_a',
        iss: 'nuvix:project_a',
        aud: 'nuvix:project',
      },
      JWT_SECRET,
      900,
    )

    const failure = await resolver
      .resolve(state.input(new Headers({ [HEADERS.jwt]: token })))
      .catch((error: unknown) => error)

    expect((failure as { fields: { code?: string } }).fields.code).toBe('credential_invalid')
  })

  test('rejects JWT when issuer does not match project', async () => {
    const state = await authHarness()
    const token = await sign(
      {
        sub: 'user_a',
        iss: 'nuvix:different_project',
        aud: 'nuvix:project',
      },
      JWT_SECRET,
      900,
    )

    const failure = await resolver
      .resolve(state.input(new Headers({ [HEADERS.jwt]: token })))
      .catch((error: unknown) => error)

    expect((failure as { fields: { code?: string } }).fields.code).toBe('credential_invalid')
  })

  test('rejects expired or tampered JWT', async () => {
    const state = await authHarness()
    const expiredToken = await sign(
      {
        sub: 'user_a',
        iss: 'nuvix:project_a',
        aud: 'nuvix:project',
      },
      JWT_SECRET,
      -10,
    )

    const failure = await resolver
      .resolve(state.input(new Headers({ [HEADERS.jwt]: expiredToken })))
      .catch((error: unknown) => error)

    expect((failure as { fields: { code?: string } }).fields.code).toBe('credential_invalid')

    const tamperedToken = `${expiredToken.slice(0, -5)}abcde`
    const tamperedFailure = await resolver
      .resolve(state.input(new Headers({ [HEADERS.jwt]: tamperedToken })))
      .catch((error: unknown) => error)

    expect((tamperedFailure as { fields: { code?: string } }).fields.code).toBe(
      'credential_invalid',
    )
  })

  test('supports key rotation: verifies unexpired retired keys and rejects expired keys', async () => {
    const retiredSecret = 'retired-jwt-signing-key-123456789012'
    const expiredSecret = 'expired-jwt-signing-key-123456789012'
    const state = await authHarness({
      jwtKeys: [
        new Doc({
          signingKey: JWT_SECRET,
          algorithm: 'HS256',
          active: true,
          expiresAt: null,
        }),
        new Doc({
          signingKey: retiredSecret,
          algorithm: 'HS256',
          active: false,
          expiresAt: new Date(NOW.getTime() + 3600_000).toISOString(),
        }),
        new Doc({
          signingKey: expiredSecret,
          algorithm: 'HS256',
          active: false,
          expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
        }),
      ],
    })

    const retiredToken = await sign(
      { sub: 'user_a', iss: 'nuvix:project_a', aud: 'nuvix:project' },
      retiredSecret,
      900,
    )
    const retiredAuth = await resolver.resolve(
      state.input(new Headers({ [HEADERS.jwt]: retiredToken })),
    )
    expect(retiredAuth.type).toBe('jwt')

    const expiredKeyToken = await sign(
      { sub: 'user_a', iss: 'nuvix:project_a', aud: 'nuvix:project' },
      expiredSecret,
      900,
    )
    const failure = await resolver
      .resolve(state.input(new Headers({ [HEADERS.jwt]: expiredKeyToken })))
      .catch((error: unknown) => error)
    expect((failure as { fields: { code?: string } }).fields.code).toBe('credential_invalid')
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
