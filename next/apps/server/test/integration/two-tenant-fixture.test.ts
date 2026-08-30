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
        current.tenants.a.credentials.scopeDeficient,
        current.tenants.b.credentials.full,
        current.tenants.b.credentials.teamsWriteOnly,
        current.tenants.b.credentials.scopeDeficient,
      ]
      const records = await Promise.all([
        current.owner.inspectApiKey('a', current.tenants.a.credentials.full.id),
        current.owner.inspectApiKey('a', current.tenants.a.credentials.teamsWriteOnly.id),
        current.owner.inspectApiKey('a', current.tenants.a.credentials.scopeDeficient.id),
        current.owner.inspectApiKey('b', current.tenants.b.credentials.full.id),
        current.owner.inspectApiKey('b', current.tenants.b.credentials.teamsWriteOnly.id),
        current.owner.inspectApiKey('b', current.tenants.b.credentials.scopeDeficient.id),
      ])

      expect(current.tenants.a.credentials.full.id).toBe(current.tenants.b.credentials.full.id)
      expect(
        current.tenants.a.credentials.full.token === current.tenants.b.credentials.full.token,
      ).toBe(false)
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
      expect(records[2]?.scopes).toEqual([])
      expect(records[0]?.modes).toEqual(['admin'])
    })

    test('authenticates each tenant-local key and rejects the other tenant secret', async () => {
      const current = initialized(fixture)
      const [authA, authB, teamsWriteOnly, scopeDeficient] = await Promise.all([
        current.owner.authenticateApiKey('a', current.tenants.a.credentials.full.token),
        current.owner.authenticateApiKey('b', current.tenants.b.credentials.full.token),
        current.owner.authenticateApiKey('a', current.tenants.a.credentials.teamsWriteOnly.token),
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
