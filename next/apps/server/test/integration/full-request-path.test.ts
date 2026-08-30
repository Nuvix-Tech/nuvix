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
const RESERVED_SCHEMAS = Object.freeze(['core', 'system', 'internal'] as const)
const live = process.env.NUVIX_LIVE_POSTGRES === '1' ? describe : describe.skip

interface ProblemResult {
  readonly data: unknown
  readonly error: {
    readonly status: unknown
    readonly value: unknown
  } | null
  readonly response: Response
}

interface SchemaListData {
  readonly data: readonly { readonly name: string }[]
}

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

function schemaName(): string {
  return `it_request_${crypto.randomUUID().replaceAll('-', '').toLowerCase()}`
}

function schemaNames(data: SchemaListData | null): readonly string[] {
  if (!data) throw new Error('Schema list response was empty')
  return data.data.map((schema) => schema.name)
}

function problem(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected a problem details object')
  }
  return value as Readonly<Record<string, unknown>>
}

function expectProblem(
  result: ProblemResult,
  expected: {
    readonly status: number
    readonly type: string
    readonly code: string
  },
): void {
  expect(result.data).toBeNull()
  expect(result.error?.status).toBe(expected.status)
  expect(result.response.headers.get('content-type')?.startsWith('application/problem+json')).toBe(
    true,
  )
  expect(problem(result.error?.value)).toMatchObject(expected)
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
    const headersA = apiKeyHeaders(fixture.tenants.a)
    const headersB = apiKeyHeaders(fixture.tenants.b)
    const sharedName = schemaName()
    const schemaA = {
      name: sharedName,
      description: 'Tenant A managed schema',
      type: 'managed' as const,
    }
    const schemaB = {
      name: sharedName,
      description: 'Tenant B document schema',
      type: 'document' as const,
    }

    const [initialA, initialB] = await Promise.all([
      client.v2.database.schemas.get({ headers: headersA }),
      client.v2.database.schemas.get({ headers: headersB }),
    ])
    expect(initialA.status).toBe(200)
    expect(initialA.error).toBeNull()
    expect(initialB.status).toBe(200)
    expect(initialB.error).toBeNull()
    for (const names of [schemaNames(initialA.data), schemaNames(initialB.data)]) {
      for (const reserved of RESERVED_SCHEMAS) expect(names).not.toContain(reserved)
      expect(names).not.toContain(sharedName)
    }

    const createdA = await client.v2.database.schemas.post(schemaA, {
      headers: headersA,
    })
    expect(createdA.status).toBe(201)
    expect(createdA.error).toBeNull()
    expect(createdA.data).toEqual(schemaA)

    const duplicateA = await client.v2.database.schemas.post(
      { name: sharedName, type: 'unmanaged' },
      { headers: headersA },
    )
    expectProblem(duplicateA, {
      status: 409,
      type: '/errors/conflict',
      code: 'schema_already_exists',
    })

    const missingFromB = await client.v2.database.schemas({ name: sharedName }).get({
      headers: headersB,
    })
    expectProblem(missingFromB, {
      status: 404,
      type: '/errors/not-found',
      code: 'schema_not_found',
    })

    const createdB = await client.v2.database.schemas.post(schemaB, {
      headers: headersB,
    })
    expect(createdB.status).toBe(201)
    expect(createdB.error).toBeNull()
    expect(createdB.data).toEqual(schemaB)

    const [managedA, managedB, documentA, documentB] = await Promise.all([
      client.v2.database.schemas.get({
        query: { type: 'managed' },
        headers: headersA,
      }),
      client.v2.database.schemas.get({
        query: { type: 'managed' },
        headers: headersB,
      }),
      client.v2.database.schemas.get({
        query: { type: 'document' },
        headers: headersA,
      }),
      client.v2.database.schemas.get({
        query: { type: 'document' },
        headers: headersB,
      }),
    ])
    expect(schemaNames(managedA.data)).toContain(sharedName)
    expect(schemaNames(managedB.data)).not.toContain(sharedName)
    expect(schemaNames(documentA.data)).not.toContain(sharedName)
    expect(schemaNames(documentB.data)).toContain(sharedName)

    const [metadataA, metadataB, fetchedA, fetchedB] = await Promise.all([
      fixture.owner.inspectSchemaMetadata('a', sharedName),
      fixture.owner.inspectSchemaMetadata('b', sharedName),
      client.v2.database.schemas({ name: sharedName }).get({ headers: headersA }),
      client.v2.database.schemas({ name: sharedName }).get({ headers: headersB }),
    ])
    expect(metadataA.initialized).toBe(false)
    expect(metadataB.initialized).toBe(true)
    expect(fetchedA.status).toBe(200)
    expect(fetchedA.error).toBeNull()
    expect(fetchedB.status).toBe(200)
    expect(fetchedB.error).toBeNull()
    expect(fetchedA.data).toEqual(schemaA)
    expect(fetchedB.data).toEqual(schemaB)

    const updatedA = await client.v2.database
      .schemas({ name: sharedName })
      .patch({ description: 'Tenant A updated schema' }, { headers: headersA })
    expect(updatedA.status).toBe(200)
    expect(updatedA.error).toBeNull()
    expect(updatedA.data).toEqual({
      ...schemaA,
      description: 'Tenant A updated schema',
    })

    const unchangedB = await client.v2.database.schemas({ name: sharedName }).get({
      headers: headersB,
    })
    expect(unchangedB.status).toBe(200)
    expect(unchangedB.data).toEqual(schemaB)

    const removedA = await client.v2.database.schemas({ name: sharedName }).delete(undefined, {
      headers: headersA,
    })
    expect(removedA.status).toBe(204)
    expect(removedA.error).toBeNull()

    const [deletedFromA, retainedInB] = await Promise.all([
      client.v2.database.schemas({ name: sharedName }).get({ headers: headersA }),
      client.v2.database.schemas({ name: sharedName }).get({ headers: headersB }),
    ])
    expectProblem(deletedFromA, {
      status: 404,
      type: '/errors/not-found',
      code: 'schema_not_found',
    })
    expect(retainedInB.status).toBe(200)
    expect(retainedInB.data).toEqual(schemaB)

    const removedB = await client.v2.database.schemas({ name: sharedName }).delete(undefined, {
      headers: headersB,
    })
    expect(removedB.status).toBe(204)
    expect(removedB.error).toBeNull()
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
