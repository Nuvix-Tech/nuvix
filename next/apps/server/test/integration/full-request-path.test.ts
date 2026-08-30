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

interface PublishableKeyFixture {
  readonly publishableKey: string
}

interface StableProblem {
  readonly status: number
  readonly type: string
  readonly title: string
  readonly detail: string
  readonly code?: string
}

const STABLE_PROBLEMS = Object.freeze({
  credentialInvalid: {
    status: 401,
    type: '/errors/unauthorized',
    title: 'Unauthorized',
    detail: 'Credential is invalid',
    code: 'credential_invalid',
  },
  forbidden: {
    status: 403,
    type: '/errors/forbidden',
    title: 'Forbidden',
    detail: 'Insufficient permissions',
  },
  projectNotFound: {
    status: 404,
    type: '/errors/not-found',
    title: 'Not Found',
    detail: 'Project not found',
    code: 'project_not_found',
  },
  projectUnavailable: {
    status: 503,
    type: '/errors/unavailable',
    title: 'Service Unavailable',
    detail: 'Project is temporarily unavailable',
    code: 'project_unavailable',
  },
} as const satisfies Readonly<Record<string, StableProblem>>)

function publishableKeyHeaders(fixture: PublishableKeyFixture): Readonly<Record<string, string>> {
  return Object.freeze({ [HEADERS.publishableKey]: fixture.publishableKey })
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

function sessionHeaders(tenant: TenantFixture): Readonly<Record<string, string>> {
  return Object.freeze({
    ...publishableKeyHeaders(tenant),
    [HEADERS.session]: tenant.credentials.session.token,
  })
}

function schemaName(): string {
  return `it_request_${crypto.randomUUID().replaceAll('-', '').toLowerCase()}`
}

function entityId(prefix: string): string {
  const suffix = crypto.randomUUID().replaceAll('-', '').toLowerCase().slice(0, 24)
  return `${prefix}_${suffix}`
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
    readonly code?: string
  },
): void {
  expect(result.data).toBeNull()
  expect(result.error?.status).toBe(expected.status)
  expect(result.response.headers.get('content-type')?.startsWith('application/problem+json')).toBe(
    true,
  )
  expect(problem(result.error?.value)).toMatchObject(expected)
}

function expectStableProblem(result: ProblemResult, expected: StableProblem): void {
  const body = problem(result.error?.value)
  const expectedBody: Readonly<Record<string, unknown>> = {
    type: expected.type,
    title: expected.title,
    status: expected.status,
    detail: expected.detail,
    instance: expected.detail,
    ...(expected.code === undefined ? {} : { code: expected.code }),
  }
  const matchesBody =
    Object.keys(body).length === Object.keys(expectedBody).length &&
    Object.entries(expectedBody).every(([key, value]) => body[key] === value)
  const hasProblemContentType =
    result.response.headers.get('content-type')?.startsWith('application/problem+json') === true

  if (
    result.data !== null ||
    result.error?.status !== expected.status ||
    !hasProblemContentType ||
    !matchesBody
  ) {
    throw new Error(
      `Request did not return the stable redacted ${expected.code ?? expected.type} problem`,
    )
  }
}

async function close(
  runtime: PlatformRuntime | undefined,
  fixture: TwoTenantFixture,
): Promise<void> {
  const failures: unknown[] = []
  if (runtime) await runtime.close().catch((error: unknown) => failures.push(error))
  await fixture.owner.close().catch((error: unknown) => failures.push(error))
  await fixture.owner.assertRemoved().catch((error: unknown) => failures.push(error))
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
    const teamsWriteHeadersA = apiKeyHeaders(
      fixture.tenants.a,
      fixture.tenants.a.credentials.teamsWriteOnly.token,
    )
    const sessionHeadersA = sessionHeaders(fixture.tenants.a)
    const usersReadHeadersA = apiKeyHeaders(
      fixture.tenants.a,
      fixture.tenants.a.credentials.usersReadOnly.token,
    )
    const usersWriteHeadersA = apiKeyHeaders(
      fixture.tenants.a,
      fixture.tenants.a.credentials.usersWriteOnly.token,
    )
    const usersReadHeadersB = apiKeyHeaders(
      fixture.tenants.b,
      fixture.tenants.b.credentials.usersReadOnly.token,
    )
    const usersWriteHeadersB = apiKeyHeaders(
      fixture.tenants.b,
      fixture.tenants.b.credentials.usersWriteOnly.token,
    )
    const observedResults: ProblemResult[] = []
    const observe = <Result extends ProblemResult>(result: Result): Result => {
      observedResults.push(result)
      return result
    }
    const scopeDeficientHeadersA = apiKeyHeaders(
      fixture.tenants.a,
      fixture.tenants.a.credentials.scopeDeficient.token,
    )

    // Negative authentication and acquisition run through the same production
    // request scope as the successful matrix below.
    expect(fixture.tenants.b.credentials.full.id).toBe(fixture.tenants.a.credentials.full.id)
    if (fixture.tenants.b.credentials.full.token === fixture.tenants.a.credentials.full.token) {
      throw new Error('Tenant fixture credentials must use distinct secrets')
    }
    const wrongTenantCredential = observe(
      await client.v2.database.schemas.get({
        headers: apiKeyHeaders(fixture.tenants.a, fixture.tenants.b.credentials.full.token),
      }),
    )
    expectStableProblem(wrongTenantCredential, STABLE_PROBLEMS.credentialInvalid)

    for (const selected of [fixture.platformFailures.unknown, fixture.platformFailures.disabled]) {
      const unavailableProject = observe(
        await client.v2.database.schemas.get({
          headers: publishableKeyHeaders(selected),
        }),
      )
      expectStableProblem(unavailableProject, STABLE_PROBLEMS.projectNotFound)
    }

    for (const selected of [
      fixture.platformFailures.missingTarget,
      fixture.platformFailures.corruptTarget,
      fixture.platformFailures.malformedTarget,
      fixture.platformFailures.unreachableTarget,
    ]) {
      const unavailableProject = observe(
        await client.v2.database.schemas.get({
          headers: publishableKeyHeaders(selected),
        }),
      )
      expectStableProblem(unavailableProject, STABLE_PROBLEMS.projectUnavailable)
    }

    const deniedSchemaName = schemaName()
    const schemaScopeDeficient = observe(
      await client.v2.database.schemas.post(
        { name: deniedSchemaName, type: 'managed' },
        { headers: scopeDeficientHeadersA },
      ),
    )
    expectStableProblem(schemaScopeDeficient, STABLE_PROBLEMS.forbidden)
    const schemaAfterDeniedWrite = observe(
      await client.v2.database.schemas({ name: deniedSchemaName }).get({ headers: headersA }),
    )
    expectProblem(schemaAfterDeniedWrite, {
      status: 404,
      type: '/errors/not-found',
      code: 'schema_not_found',
    })

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

    const teamsWriteRead = observe(await client.v2.teams.get({ headers: teamsWriteHeadersA }))
    expectProblem(teamsWriteRead, {
      status: 403,
      type: '/errors/forbidden',
    })

    const deniedTeamName = `Denied ${sharedName}`
    const teamScopeDeficient = observe(
      await client.v2.teams.post({ name: deniedTeamName }, { headers: scopeDeficientHeadersA }),
    )
    expectStableProblem(teamScopeDeficient, STABLE_PROBLEMS.forbidden)
    const teamsAfterDeniedWrite = observe(await client.v2.teams.get({ headers: headersA }))
    expect(teamsAfterDeniedWrite.status).toBe(200)
    expect(teamsAfterDeniedWrite.data?.data.map((team) => team.name)).not.toContain(deniedTeamName)

    const createdTeamA = observe(
      await client.v2.teams.post(
        { name: `Tenant A ${sharedName}` },
        { headers: teamsWriteHeadersA },
      ),
    )
    expect(createdTeamA.status).toBe(201)
    expect(createdTeamA.error).toBeNull()
    expect(createdTeamA.data).toMatchObject({
      name: `Tenant A ${sharedName}`,
      total: 0,
      prefs: {},
    })
    if (!createdTeamA.data) throw new Error('Tenant A team create response was empty')
    const teamIdA = createdTeamA.data.$id

    const missingTeamFromB = observe(
      await client.v2.teams({ teamId: teamIdA }).get({ headers: headersB }),
    )
    expectProblem(missingTeamFromB, {
      status: 404,
      type: '/errors/not-found',
      code: 'team_not_found',
    })

    const createdTeamB = observe(
      await client.v2.teams.post({ name: `Tenant B ${sharedName}` }, { headers: headersB }),
    )
    expect(createdTeamB.status).toBe(201)
    expect(createdTeamB.error).toBeNull()
    expect(createdTeamB.data).toMatchObject({
      name: `Tenant B ${sharedName}`,
      total: 0,
      prefs: {},
    })
    if (!createdTeamB.data) throw new Error('Tenant B team create response was empty')
    const teamIdB = createdTeamB.data.$id
    expect(teamIdB).not.toBe(teamIdA)

    const [listedTeamsAResult, listedTeamsBResult] = await Promise.all([
      client.v2.teams.get({ headers: headersA }),
      client.v2.teams.get({ headers: headersB }),
    ])
    const listedTeamsA = observe(listedTeamsAResult)
    const listedTeamsB = observe(listedTeamsBResult)
    expect(listedTeamsA.status).toBe(200)
    expect(listedTeamsB.status).toBe(200)
    expect(listedTeamsA.data?.data.map((team) => team.$id)).toContain(teamIdA)
    expect(listedTeamsA.data?.data.map((team) => team.$id)).not.toContain(teamIdB)
    expect(listedTeamsB.data?.data.map((team) => team.$id)).toContain(teamIdB)
    expect(listedTeamsB.data?.data.map((team) => team.$id)).not.toContain(teamIdA)

    const fetchedTeamA = observe(
      await client.v2.teams({ teamId: teamIdA }).get({ headers: headersA }),
    )
    expect(fetchedTeamA.status).toBe(200)
    expect(fetchedTeamA.data).toMatchObject({
      $id: teamIdA,
      name: `Tenant A ${sharedName}`,
    })

    const updatedTeamA = observe(
      await client.v2
        .teams({ teamId: teamIdA })
        .put({ name: `Tenant A updated ${sharedName}` }, { headers: teamsWriteHeadersA }),
    )
    expect(updatedTeamA.status).toBe(200)
    expect(updatedTeamA.error).toBeNull()
    expect(updatedTeamA.data).toMatchObject({
      $id: teamIdA,
      name: `Tenant A updated ${sharedName}`,
    })

    const updatedTeamPrefsA = observe(
      await client.v2
        .teams({ teamId: teamIdA })
        .prefs.put(
          { prefs: { tenant: 'a', theme: 'dark', nested: { isolated: true } } },
          { headers: teamsWriteHeadersA },
        ),
    )
    expect(updatedTeamPrefsA.status).toBe(200)
    expect(updatedTeamPrefsA.data).toEqual({
      tenant: 'a',
      theme: 'dark',
      nested: { isolated: true },
    })

    const fetchedTeamPrefsA = observe(
      await client.v2.teams({ teamId: teamIdA }).prefs.get({ headers: headersA }),
    )
    expect(fetchedTeamPrefsA.status).toBe(200)
    expect(fetchedTeamPrefsA.data).toEqual(updatedTeamPrefsA.data)

    const updatedTeamB = observe(
      await client.v2
        .teams({ teamId: teamIdB })
        .put({ name: `Tenant B updated ${sharedName}` }, { headers: headersB }),
    )
    expect(updatedTeamB.status).toBe(200)
    expect(updatedTeamB.data).toMatchObject({
      $id: teamIdB,
      name: `Tenant B updated ${sharedName}`,
    })

    const teamAAfterBUpdate = observe(
      await client.v2.teams({ teamId: teamIdA }).get({ headers: headersA }),
    )
    expect(teamAAfterBUpdate.status).toBe(200)
    expect(teamAAfterBUpdate.data).toMatchObject({
      $id: teamIdA,
      name: `Tenant A updated ${sharedName}`,
      prefs: { tenant: 'a', theme: 'dark', nested: { isolated: true } },
    })

    const removedTeamB = observe(
      await client.v2.teams({ teamId: teamIdB }).delete(undefined, { headers: headersB }),
    )
    expect(removedTeamB.status).toBe(204)
    expect(removedTeamB.error).toBeNull()

    const teamAAfterBDelete = observe(
      await client.v2.teams({ teamId: teamIdA }).get({ headers: headersA }),
    )
    expect(teamAAfterBDelete.status).toBe(200)
    expect(teamAAfterBDelete.data).toMatchObject({ $id: teamIdA })

    const removedTeamA = observe(
      await client.v2.teams({ teamId: teamIdA }).delete(undefined, { headers: teamsWriteHeadersA }),
    )
    expect(removedTeamA.status).toBe(204)
    expect(removedTeamA.error).toBeNull()

    const deletedTeamA = observe(
      await client.v2.teams({ teamId: teamIdA }).get({ headers: headersA }),
    )
    expectProblem(deletedTeamA, {
      status: 404,
      type: '/errors/not-found',
      code: 'team_not_found',
    })

    const sessionCreatedTeamA = observe(
      await client.v2.teams.post(
        { name: `Tenant A session ${sharedName}` },
        { headers: sessionHeadersA },
      ),
    )
    expect(sessionCreatedTeamA.status).toBe(201)
    expect(sessionCreatedTeamA.error).toBeNull()
    expect(sessionCreatedTeamA.data).toMatchObject({
      name: `Tenant A session ${sharedName}`,
      total: 1,
      prefs: {},
    })
    if (!sessionCreatedTeamA.data) throw new Error('Session team create response was empty')
    const sessionTeamIdA = sessionCreatedTeamA.data.$id
    expect(await fixture.owner.countTeamMemberships('a', sessionTeamIdA)).toBe(1)

    const removedSessionTeamA = observe(
      await client.v2
        .teams({ teamId: sessionTeamIdA })
        .delete(undefined, { headers: teamsWriteHeadersA }),
    )
    expect(removedSessionTeamA.status).toBe(204)
    expect(removedSessionTeamA.error).toBeNull()
    expect(await fixture.owner.countTeamMemberships('a', sessionTeamIdA)).toBe(0)

    const sharedUserId = entityId('user')
    const userEmailA = `${sharedUserId}.a@example.test`
    const userEmailB = `${sharedUserId}.b@example.test`
    const updatedUserEmailA = `${sharedUserId}.updated@example.test`

    const usersReadWriteAttempt = observe(
      await client.v2.users.post(
        {
          userId: entityId('denied'),
          email: `${entityId('email')}@example.test`,
        },
        { headers: usersReadHeadersA },
      ),
    )
    expectProblem(usersReadWriteAttempt, {
      status: 403,
      type: '/errors/forbidden',
    })

    const usersWriteReadAttempt = observe(
      await client.v2.users.get({ headers: usersWriteHeadersA }),
    )
    expectProblem(usersWriteReadAttempt, {
      status: 403,
      type: '/errors/forbidden',
    })

    const deniedUserId = entityId('denied')
    const usersScopeDeficient = observe(
      await client.v2.users.post(
        {
          userId: deniedUserId,
          email: `${deniedUserId}@example.test`,
        },
        { headers: scopeDeficientHeadersA },
      ),
    )
    expectStableProblem(usersScopeDeficient, STABLE_PROBLEMS.forbidden)
    const userAfterDeniedWrite = observe(
      await client.v2.users({ userId: deniedUserId }).get({ headers: usersReadHeadersA }),
    )
    expectProblem(userAfterDeniedWrite, {
      status: 404,
      type: '/errors/not-found',
      code: 'user_not_found',
    })

    const createdUserA = observe(
      await client.v2.users.post(
        {
          userId: sharedUserId,
          name: 'Tenant A User',
          email: userEmailA,
          phone: '+12025550101',
        },
        { headers: usersWriteHeadersA },
      ),
    )
    expect(createdUserA.status).toBe(201)
    expect(createdUserA.error).toBeNull()
    expect(createdUserA.data).toMatchObject({
      $id: sharedUserId,
      name: 'Tenant A User',
      email: userEmailA,
      phone: '+12025550101',
      status: true,
      labels: [],
      prefs: {},
    })

    const missingUserFromB = observe(
      await client.v2.users({ userId: sharedUserId }).get({ headers: usersReadHeadersB }),
    )
    expectProblem(missingUserFromB, {
      status: 404,
      type: '/errors/not-found',
      code: 'user_not_found',
    })

    const createdUserB = observe(
      await client.v2.users.post(
        {
          userId: sharedUserId,
          name: 'Tenant B User',
          email: userEmailB,
          phone: '+12025550102',
        },
        { headers: usersWriteHeadersB },
      ),
    )
    expect(createdUserB.status).toBe(201)
    expect(createdUserB.error).toBeNull()
    expect(createdUserB.data).toMatchObject({
      $id: sharedUserId,
      name: 'Tenant B User',
      email: userEmailB,
      phone: '+12025550102',
    })

    const [listedUsersAResult, listedUsersBResult] = await Promise.all([
      client.v2.users.get({ headers: usersReadHeadersA }),
      client.v2.users.get({ headers: usersReadHeadersB }),
    ])
    const listedUsersA = observe(listedUsersAResult)
    const listedUsersB = observe(listedUsersBResult)
    expect(listedUsersA.status).toBe(200)
    expect(listedUsersB.status).toBe(200)
    expect(listedUsersA.data?.data).toHaveLength(2)
    expect(listedUsersB.data?.data).toHaveLength(2)
    expect(listedUsersA.data?.data).toContainEqual(
      expect.objectContaining({ $id: sharedUserId, email: userEmailA }),
    )
    expect(listedUsersB.data?.data).toContainEqual(
      expect.objectContaining({ $id: sharedUserId, email: userEmailB }),
    )

    const [fetchedUserAResult, fetchedUserBResult] = await Promise.all([
      client.v2.users({ userId: sharedUserId }).get({ headers: usersReadHeadersA }),
      client.v2.users({ userId: sharedUserId }).get({ headers: usersReadHeadersB }),
    ])
    const fetchedUserA = observe(fetchedUserAResult)
    const fetchedUserB = observe(fetchedUserBResult)
    expect(fetchedUserA.status).toBe(200)
    expect(fetchedUserB.status).toBe(200)
    expect(fetchedUserA.data).toMatchObject({
      name: 'Tenant A User',
      email: userEmailA,
    })
    expect(fetchedUserB.data).toMatchObject({
      name: 'Tenant B User',
      email: userEmailB,
    })

    const updatedUserNameA = observe(
      await client.v2
        .users({ userId: sharedUserId })
        .name.patch({ name: 'Tenant A Updated' }, { headers: usersWriteHeadersA }),
    )
    expect(updatedUserNameA.status).toBe(200)
    expect(updatedUserNameA.data).toMatchObject({ name: 'Tenant A Updated' })

    const updatedUserEmailResultA = observe(
      await client.v2
        .users({ userId: sharedUserId })
        .email.patch({ email: updatedUserEmailA }, { headers: usersWriteHeadersA }),
    )
    expect(updatedUserEmailResultA.status).toBe(200)
    expect(updatedUserEmailResultA.data).toMatchObject({
      email: updatedUserEmailA,
      emailVerification: false,
    })

    const updatedUserPhoneA = observe(
      await client.v2
        .users({ userId: sharedUserId })
        .phone.patch({ phone: '+12025550103' }, { headers: usersWriteHeadersA }),
    )
    expect(updatedUserPhoneA.status).toBe(200)
    expect(updatedUserPhoneA.data).toMatchObject({
      phone: '+12025550103',
      phoneVerification: false,
    })

    const updatedUserPrefsA = observe(
      await client.v2
        .users({ userId: sharedUserId })
        .prefs.patch(
          { prefs: { tenant: 'a', notifications: { email: false } } },
          { headers: usersWriteHeadersA },
        ),
    )
    expect(updatedUserPrefsA.status).toBe(200)
    expect(updatedUserPrefsA.data).toEqual({
      tenant: 'a',
      notifications: { email: false },
    })

    const fetchedUserPrefsA = observe(
      await client.v2.users({ userId: sharedUserId }).prefs.get({ headers: usersReadHeadersA }),
    )
    expect(fetchedUserPrefsA.status).toBe(200)
    expect(fetchedUserPrefsA.data).toEqual(updatedUserPrefsA.data)

    const updatedUserLabelsA = observe(
      await client.v2
        .users({ userId: sharedUserId })
        .labels.put({ labels: ['tenant-a', 'integration'] }, { headers: usersWriteHeadersA }),
    )
    expect(updatedUserLabelsA.status).toBe(200)
    expect(updatedUserLabelsA.data).toMatchObject({
      labels: ['tenant-a', 'integration'],
    })

    const updatedUserStatusA = observe(
      await client.v2
        .users({ userId: sharedUserId })
        .status.patch({ status: false }, { headers: usersWriteHeadersA }),
    )
    expect(updatedUserStatusA.status).toBe(200)
    expect(updatedUserStatusA.data).toMatchObject({ status: false })

    const updatedUserNameB = observe(
      await client.v2
        .users({ userId: sharedUserId })
        .name.patch({ name: 'Tenant B Updated' }, { headers: usersWriteHeadersB }),
    )
    expect(updatedUserNameB.status).toBe(200)
    expect(updatedUserNameB.data).toMatchObject({
      name: 'Tenant B Updated',
      email: userEmailB,
      phone: '+12025550102',
      status: true,
      labels: [],
      prefs: {},
    })

    const [isolatedUserAResult, isolatedUserBResult] = await Promise.all([
      client.v2.users({ userId: sharedUserId }).get({ headers: usersReadHeadersA }),
      client.v2.users({ userId: sharedUserId }).get({ headers: usersReadHeadersB }),
    ])
    const isolatedUserA = observe(isolatedUserAResult)
    const isolatedUserB = observe(isolatedUserBResult)
    expect(isolatedUserA.data).toMatchObject({
      $id: sharedUserId,
      name: 'Tenant A Updated',
      email: updatedUserEmailA,
      phone: '+12025550103',
      prefs: { tenant: 'a', notifications: { email: false } },
      labels: ['tenant-a', 'integration'],
      status: false,
    })
    expect(isolatedUserB.data).toMatchObject({
      $id: sharedUserId,
      name: 'Tenant B Updated',
      email: userEmailB,
      phone: '+12025550102',
      prefs: {},
      labels: [],
      status: true,
    })

    const userAFilteredFromB = observe(
      await client.v2.users.get({
        query: { email: updatedUserEmailA },
        headers: usersReadHeadersB,
      }),
    )
    expect(userAFilteredFromB.status).toBe(200)
    expect(userAFilteredFromB.data?.data).toEqual([])

    const requestDiagnostics = JSON.stringify(
      observedResults.map((result) => ({
        data: result.data,
        status: result.error?.status ?? result.response.status,
        problem: result.error?.value ?? null,
      })),
    )
    await fixture.owner.assertNoSensitiveValues(requestDiagnostics)

    // Reopen the same platform backing with immediate idle eviction. A response
    // can settle only after release has closed its tenant owner, so the
    // container-side probes deterministically cover both success and auth failure.
    if (!runtime) throw new Error('Expected the primary platform runtime')
    const primaryRuntime = runtime
    const primaryClose = primaryRuntime.close()
    expect(primaryRuntime.close()).toBe(primaryClose)
    await primaryClose
    expect(primaryRuntime.close()).toBe(primaryClose)
    await Promise.all([
      fixture.owner.assertNoPlatformConnections(),
      fixture.owner.assertNoTenantConnections(),
    ])
    runtime = undefined

    const lifecycleRuntime = await createPlatformRuntime({
      ...fixture.runtime,
      tenantRegistry: { idleMs: 0 },
      app: {
        isProduction: false,
        geoip: { lookup: () => null },
        uptime: () => 42,
      },
    })
    runtime = lifecycleRuntime
    const lifecycleClient = treaty(lifecycleRuntime.app)

    const failedAfterRelease = await lifecycleClient.v2.database.schemas.get({
      headers: apiKeyHeaders(fixture.tenants.a, fixture.tenants.b.credentials.full.token),
    })
    expectStableProblem(failedAfterRelease, STABLE_PROBLEMS.credentialInvalid)
    await fixture.owner.assertNoTenantConnections()

    const successfulAfterRelease = await lifecycleClient.v2.database.schemas.get({
      headers: headersB,
    })
    expect(successfulAfterRelease.status).toBe(200)
    expect(successfulAfterRelease.error).toBeNull()
    await fixture.owner.assertNoTenantConnections()

    const lifecycleClose = lifecycleRuntime.close()
    expect(lifecycleRuntime.close()).toBe(lifecycleClose)
    await lifecycleClose
    expect(lifecycleRuntime.close()).toBe(lifecycleClose)
    await Promise.all([
      fixture.owner.assertNoPlatformConnections(),
      fixture.owner.assertNoTenantConnections(),
    ])

    const rejectedAfterClose = await lifecycleClient.v2.database.schemas.get({
      headers: headersA,
    })
    expectStableProblem(rejectedAfterClose, STABLE_PROBLEMS.projectUnavailable)
    await fixture.owner.assertNoTenantConnections()
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
