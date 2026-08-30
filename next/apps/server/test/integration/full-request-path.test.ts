import { describe, expect, test } from 'bun:test'
import { treaty } from '@elysia/eden'
import {
  createPlatformRuntime,
  type PlatformRuntime,
} from '../../src/infrastructure/platform-runtime'
import { HEADERS } from '../../src/shared/constants'
import { PLATFORM_FIXTURE_DRIVERS } from './support/platform-fixture'
import {
  createTwoTenantFixture,
  type TenantFixture,
  type TwoTenantFixture,
} from './support/two-tenant-fixture'

const TENANT_IMAGE = 'nuvix/postgres:18.1'
const SCENARIOS = PLATFORM_FIXTURE_DRIVERS.map((driver) => [driver, TENANT_IMAGE] as const)
const live = process.env.NUVIX_LIVE_POSTGRES === '1' ? describe : describe.skip

function publishableKeyHeaders(tenant: TenantFixture): Readonly<Record<string, string>> {
  return Object.freeze({ [HEADERS.publishableKey]: tenant.publishableKey })
}

function apiKeyHeaders(
  tenant: TenantFixture,
  token = tenant.credentials.full.token,
): Readonly<Record<string, string>> {
  return Object.freeze({
    ...publishableKeyHeaders(tenant),
    [HEADERS.apiKey]: token,
    [HEADERS.mode]: 'admin',
  })
}

async function close(
  runtime: PlatformRuntime | undefined,
  fixture: TwoTenantFixture,
): Promise<void> {
  const failures: unknown[] = []
  if (runtime) await runtime.close().catch((error: unknown) => failures.push(error))
  await fixture.owner.close().catch((error: unknown) => failures.push(error))
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Full request-path scenario cleanup failed')
  }
}

async function runScenario(driver: (typeof PLATFORM_FIXTURE_DRIVERS)[number]): Promise<void> {
  const fixture = await createTwoTenantFixture({ driver })
  let runtime: PlatformRuntime | undefined
  const outcome = await (async () => {
    runtime = await createPlatformRuntime({
      ...fixture.runtime,
      app: {
        isProduction: false,
        geoip: { lookup: () => null },
        uptime: () => 42,
      },
    })
    const client = treaty(runtime.app)

    const [health, openapi, openapiUi] = await Promise.all([
      client.v2.health.get(),
      runtime.app.handle(new Request('http://nuvix.test/v2/openapi/json')),
      runtime.app.handle(new Request('http://nuvix.test/v2/openapi')),
    ])
    expect(health.status).toBe(200)
    expect(health.data).toMatchObject({ status: 'ok', uptime: 42 })
    expect(openapi.status).toBe(200)
    expect(await openapi.json()).not.toBeNull()
    expect(openapiUi.status).toBe(200)

    expect(fixture.tenants.a.project.id).not.toBe(fixture.tenants.b.project.id)
    const tenantA = await client.v2.database.schemas.get({
      headers: apiKeyHeaders(fixture.tenants.a),
    })
    const tenantB = await client.v2.database.schemas.get({
      headers: apiKeyHeaders(fixture.tenants.b),
    })

    expect(tenantA.status).toBe(200)
    expect(tenantA.error).toBeNull()
    expect(tenantB.status).toBe(200)
    expect(tenantB.error).toBeNull()
  })().then(
    () => ({ ok: true }) as const,
    (error: unknown) => ({ ok: false, error }) as const,
  )
  const cleanupError = await close(runtime, fixture).catch((error: unknown) => error)

  if (!outcome.ok && cleanupError) {
    throw new AggregateError(
      [outcome.error, cleanupError],
      'Full request-path scenario and cleanup failed',
    )
  }
  if (!outcome.ok) throw outcome.error
  if (cleanupError) throw cleanupError
}

live('full composed request path', () => {
  test.each(SCENARIOS)(
    'uses %s platform persistence with two isolated %s tenants',
    async (driver) => {
      await runScenario(driver)
    },
    180_000,
  )
})
