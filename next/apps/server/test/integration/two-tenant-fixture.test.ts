import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PLATFORM_FIXTURE_DRIVERS } from './support/platform-fixture'
import {
  createTwoTenantFixture,
  TENANT_FIXTURE_COLLECTIONS,
  TENANT_FULL_SCOPES,
  type TwoTenantFixture,
} from './support/two-tenant-fixture'

const live = process.env.NUVIX_LIVE_POSTGRES === '1' ? describe : describe.skip

function initialized(fixture: TwoTenantFixture | undefined): TwoTenantFixture {
  if (!fixture) throw new Error('Two-tenant fixture was not initialized')
  return fixture
}

function isVerifier(value: unknown): boolean {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value)
}

for (const driver of PLATFORM_FIXTURE_DRIVERS) {
  live(`two isolated nuvix/postgres:18.1 tenants with ${driver} platform`, () => {
    let fixture: TwoTenantFixture | undefined

    beforeAll(async () => {
      fixture = await createTwoTenantFixture({ driver })
    }, 60_000)

    afterAll(async () => {
      if (!fixture) return
      const first = fixture.owner.close()
      expect(fixture.owner.close()).toBe(first)
      await first
    }, 60_000)

    test('retains the image foundation and provisions every tenant collection', async () => {
      const current = initialized(fixture)
      const [tenantA, tenantB] = await Promise.all([
        current.owner.inspectTenant('a'),
        current.owner.inspectTenant('b'),
      ])

      expect(tenantA).toEqual({
        imageFoundation: true,
        collections: TENANT_FIXTURE_COLLECTIONS,
      })
      expect(tenantB).toEqual(tenantA)
    })

    test('persists only verifier material and explicit API-key policy fields', async () => {
      const current = initialized(fixture)
      const credentials = [
        current.tenants.a.credentials.full,
        current.tenants.a.credentials.teamsWriteOnly,
        current.tenants.a.credentials.usersReadOnly,
        current.tenants.a.credentials.usersWriteOnly,
        current.tenants.a.credentials.scopeDeficient,
        current.tenants.b.credentials.full,
        current.tenants.b.credentials.teamsWriteOnly,
        current.tenants.b.credentials.usersReadOnly,
        current.tenants.b.credentials.usersWriteOnly,
        current.tenants.b.credentials.scopeDeficient,
      ]
      const records = await Promise.all([
        current.owner.inspectApiKey('a', current.tenants.a.credentials.full.id),
        current.owner.inspectApiKey('a', current.tenants.a.credentials.teamsWriteOnly.id),
        current.owner.inspectApiKey('a', current.tenants.a.credentials.usersReadOnly.id),
        current.owner.inspectApiKey('a', current.tenants.a.credentials.usersWriteOnly.id),
        current.owner.inspectApiKey('a', current.tenants.a.credentials.scopeDeficient.id),
        current.owner.inspectApiKey('b', current.tenants.b.credentials.full.id),
        current.owner.inspectApiKey('b', current.tenants.b.credentials.teamsWriteOnly.id),
        current.owner.inspectApiKey('b', current.tenants.b.credentials.usersReadOnly.id),
        current.owner.inspectApiKey('b', current.tenants.b.credentials.usersWriteOnly.id),
        current.owner.inspectApiKey('b', current.tenants.b.credentials.scopeDeficient.id),
      ])

      for (const name of [
        'full',
        'teamsWriteOnly',
        'usersReadOnly',
        'usersWriteOnly',
        'scopeDeficient',
      ] as const) {
        expect(current.tenants.a.credentials[name].id).toBe(current.tenants.b.credentials[name].id)
        expect(current.tenants.a.credentials[name].token).not.toBe(
          current.tenants.b.credentials[name].token,
        )
      }
      for (const [index, record] of records.entries()) {
        expect(record.fieldNames).toEqual(
          expect.arrayContaining([
            'secretDigest',
            'secretSalt',
            'scopes',
            'modes',
            'enabled',
            'expiresAt',
            'revokedAt',
          ]),
        )
        expect(record.fieldNames).not.toEqual(expect.arrayContaining(['secret', 'token', 'bearer']))
        expect(isVerifier(record.secretDigest)).toBe(true)
        expect(isVerifier(record.secretSalt)).toBe(true)
        expect(record.enabled).toBe(true)
        expect(record.expiresAt).toBeNull()
        expect(record.revokedAt).toBeNull()
        expect(JSON.stringify(record).includes(credentials[index]!.token)).toBe(false)
      }
      expect(records[0]?.scopes).toEqual(TENANT_FULL_SCOPES)
      expect(records[1]?.scopes).toEqual(['teams.write'])
      expect(records[2]?.scopes).toEqual(['users.read'])
      expect(records[3]?.scopes).toEqual(['users.write'])
      expect(records[4]?.scopes).toEqual([])
      expect(records[0]?.modes).toEqual(['admin'])
    })

    test('persists real user sessions as salted HMAC verifiers without bearer tokens', async () => {
      const current = initialized(fixture)
      const sessions = [
        current.tenants.a.credentials.session,
        current.tenants.b.credentials.session,
      ]
      const records = await Promise.all([
        current.owner.inspectSession('a', sessions[0]!.id),
        current.owner.inspectSession('b', sessions[1]!.id),
      ])

      expect(sessions[0]!.id).toBe(sessions[1]!.id)
      expect(sessions[0]!.userId).toBe(sessions[1]!.userId)
      expect(sessions[0]!.token).not.toBe(sessions[1]!.token)
      for (const [index, record] of records.entries()) {
        expect(record.fieldNames).toEqual(
          expect.arrayContaining([
            'userId',
            'secretDigest',
            'secretSalt',
            'expiresAt',
            'revokedAt',
          ]),
        )
        expect(record.fieldNames).not.toEqual(expect.arrayContaining(['secret', 'token', 'bearer']))
        expect(record.userId).toBe(sessions[index]!.userId)
        expect(isVerifier(record.secretDigest)).toBe(true)
        expect(isVerifier(record.secretSalt)).toBe(true)
        expect(record.revokedAt).toBeNull()
        const persisted = JSON.stringify(record)
        expect(persisted).not.toContain(sessions[index]!.token)
        expect(persisted).not.toContain(sessions[index]!.token.split('.').at(-1))
      }
      const canaryFailure = await current.owner
        .assertNoSensitiveValues(sessions[0]!.token)
        .catch((error: unknown) => error)
      expect(String(canaryFailure)).toBe(
        'Error: Tenant fixture sensitive value leaked into request diagnostics',
      )
    })

    test('authenticates each tenant-local key and rejects the other tenant secret', async () => {
      const current = initialized(fixture)
      const [authA, authB, teamsWriteOnly, usersReadOnly, usersWriteOnly, scopeDeficient] =
        await Promise.all([
          current.owner.authenticateApiKey('a', current.tenants.a.credentials.full.token),
          current.owner.authenticateApiKey('b', current.tenants.b.credentials.full.token),
          current.owner.authenticateApiKey('a', current.tenants.a.credentials.teamsWriteOnly.token),
          current.owner.authenticateApiKey('a', current.tenants.a.credentials.usersReadOnly.token),
          current.owner.authenticateApiKey('a', current.tenants.a.credentials.usersWriteOnly.token),
          current.owner.authenticateApiKey('a', current.tenants.a.credentials.scopeDeficient.token),
        ])

      expect(authA).toEqual({
        type: 'apiKey',
        keyId: current.tenants.a.credentials.full.id,
        mode: 'admin',
        scopes: TENANT_FULL_SCOPES,
      })
      expect(authB).toEqual(authA)
      expect(teamsWriteOnly).toMatchObject({
        type: 'apiKey',
        scopes: ['teams.write'],
      })
      expect(usersReadOnly).toMatchObject({
        type: 'apiKey',
        scopes: ['users.read'],
      })
      expect(usersWriteOnly).toMatchObject({
        type: 'apiKey',
        scopes: ['users.write'],
      })
      expect(scopeDeficient).toMatchObject({ type: 'apiKey', scopes: [] })

      const failure = await current.owner
        .authenticateApiKey('a', current.tenants.b.credentials.full.token)
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({
        status: 401,
        fields: { type: '/errors/unauthorized', code: 'credential_invalid' },
      })
      expect(String(failure).includes(current.tenants.b.credentials.full.token)).toBe(false)
    })

    test('authenticates each tenant-local session through its persisted user', async () => {
      const current = initialized(fixture)
      const [authA, authB] = await Promise.all([
        current.owner.authenticateSession('a', current.tenants.a.credentials.session.token),
        current.owner.authenticateSession('b', current.tenants.b.credentials.session.token),
      ])

      expect(authA).toEqual({
        type: 'session',
        sessionId: current.tenants.a.credentials.session.id,
        userId: current.tenants.a.credentials.session.userId,
        verified: true,
        scopes: [],
        labels: [],
        teams: [],
      })
      expect(authB).toEqual(authA)

      const failure = await current.owner
        .authenticateSession('a', current.tenants.b.credentials.session.token)
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({
        status: 401,
        fields: { type: '/errors/unauthorized', code: 'credential_invalid' },
      })
      expect(String(failure).includes(current.tenants.b.credentials.session.token)).toBe(false)
    })

    test('stores two encrypted tenant targets without exposing them in runtime options', async () => {
      const current = initialized(fixture)
      const [targetA, targetB] = await Promise.all([
        current.owner.inspectTargetCiphertext(current.tenants.a.project.id),
        current.owner.inspectTargetCiphertext(current.tenants.b.project.id),
      ])

      expect(/^ntt1\.[a-zA-Z0-9_-]+$/.test(targetA)).toBe(true)
      expect(/^ntt1\.[a-zA-Z0-9_-]+$/.test(targetB)).toBe(true)
      expect(targetA === targetB).toBe(false)
      expect(Object.keys(current.runtime).sort()).toEqual([
        'database',
        'publishableKeyEnvironment',
        'tenantTargetFilters',
      ])
    })
  })
}
