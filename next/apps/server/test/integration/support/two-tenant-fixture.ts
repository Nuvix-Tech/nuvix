import { Database, Doc, Permission, Query, Role } from '@nuvix/db'
import type { AuthMode } from '../../../src/context/auth'
import {
  createCredentialToken,
  createSecretVerifier,
  type SecretVerifier,
} from '../../../src/context/credential-secret'
import type { ProjectAuthContext, ProjectContext } from '../../../src/context/project'
import { createPublishableKey } from '../../../src/context/publishable-key'
import { createTenantAuthResolver } from '../../../src/context/tenant-auth'
import { TENANT_AUTH_MODEL } from '../../../src/context/tenant-auth-model'
import {
  type PlatformDatabaseDriver,
  provisionTenantDatabase,
} from '../../../src/infrastructure/database-provisioning'
import type { TenantDatabaseTarget } from '../../../src/infrastructure/platform-persistence-model'
import {
  createTenantDatabaseResource,
  type TenantDatabaseResource,
} from '../../../src/infrastructure/tenant-database-resource'
import { HEADERS } from '../../../src/shared/constants'
import { TEAM_MODEL } from '../../../src/teams/model'
import {
  createPlatformFixture,
  type PlatformFixture,
  type PlatformFixtureRuntimeOptions,
} from './platform-fixture'
import { type PostgresTestResource, startPostgresResource } from './postgres-resource'

const API_KEY_MODES = Object.freeze(['admin'] as const satisfies readonly AuthMode[])
const SHARED_KEY_ID = 'integration_full_key'
const TEAMS_WRITE_KEY_ID = 'integration_teams_write_key'
const USERS_READ_KEY_ID = 'integration_users_read_key'
const USERS_WRITE_KEY_ID = 'integration_users_write_key'
const SCOPE_DEFICIENT_KEY_ID = 'integration_scope_deficient_key'
const SESSION_USER_ID = 'integration_session_user'
const SESSION_ID = 'integration_user_session'
const SESSION_EXPIRES_AT = '2100-01-01T00:00:00.000Z'
const FAILURE_PROJECT_IDS = Object.freeze({
  unknown: 'integration_unknown_project',
  disabled: 'integration_disabled_project',
  missingTarget: 'integration_missing_target',
  corruptTarget: 'integration_corrupt_target',
  malformedTarget: 'integration_malformed_target',
  unreachableTarget: 'integration_unreachable_target',
} as const)

export const TENANT_FULL_SCOPES = Object.freeze([
  'schemas.read',
  'schemas.write',
  'teams.read',
  'teams.write',
  'users.read',
  'users.write',
] as const)

export const TENANT_FIXTURE_COLLECTIONS = Object.freeze([
  Database.METADATA,
  TENANT_AUTH_MODEL.collections.users,
  TENANT_AUTH_MODEL.collections.sessions,
  TENANT_AUTH_MODEL.collections.memberships,
  TENANT_AUTH_MODEL.collections.apiKeys,
  TEAM_MODEL.collection,
] as const)

export type TwoTenantName = 'a' | 'b'

export interface TenantApiKeyFixture {
  readonly id: string
  readonly token: string
  readonly scopes: readonly string[]
  readonly modes: readonly AuthMode[]
}

export interface TenantSessionFixture {
  readonly id: string
  readonly token: string
  readonly userId: string
}

export interface TenantFixture {
  readonly project: ProjectContext
  readonly publishableKey: string
  readonly credentials: {
    readonly session: TenantSessionFixture
    readonly full: TenantApiKeyFixture
    readonly teamsWriteOnly: TenantApiKeyFixture
    readonly usersReadOnly: TenantApiKeyFixture
    readonly usersWriteOnly: TenantApiKeyFixture
    readonly scopeDeficient: TenantApiKeyFixture
  }
}

export interface PlatformFailureFixture {
  readonly projectId: string
  readonly publishableKey: string
}

export interface PlatformFailureFixtures {
  readonly unknown: PlatformFailureFixture
  readonly disabled: PlatformFailureFixture
  readonly missingTarget: PlatformFailureFixture
  readonly corruptTarget: PlatformFailureFixture
  readonly malformedTarget: PlatformFailureFixture
  readonly unreachableTarget: PlatformFailureFixture
}

export interface TenantFixtureInspection {
  readonly imageFoundation: boolean
  readonly collections: readonly string[]
}

export interface TenantSchemaMetadataInspection {
  readonly initialized: boolean
}

export interface TenantApiKeyInspection {
  readonly id: string
  readonly fieldNames: readonly string[]
  readonly secretDigest: unknown
  readonly secretSalt: unknown
  readonly scopes: unknown
  readonly modes: unknown
  readonly enabled: unknown
  readonly expiresAt: unknown
  readonly revokedAt: unknown
}

export interface TenantSessionInspection {
  readonly id: string
  readonly fieldNames: readonly string[]
  readonly userId: unknown
  readonly secretDigest: unknown
  readonly secretSalt: unknown
  readonly expiresAt: unknown
  readonly revokedAt: unknown
}

export interface TwoTenantFixtureRuntimeOptions extends PlatformFixtureRuntimeOptions {
  readonly publishableKeyEnvironment: 'test'
}

export interface TwoTenantFixtureOwner {
  inspectTenant(tenant: TwoTenantName): Promise<TenantFixtureInspection>
  inspectSchemaMetadata(
    tenant: TwoTenantName,
    schemaName: string,
  ): Promise<TenantSchemaMetadataInspection>
  inspectApiKey(tenant: TwoTenantName, keyId: string): Promise<TenantApiKeyInspection>
  inspectSession(tenant: TwoTenantName, sessionId: string): Promise<TenantSessionInspection>
  countTeamMemberships(tenant: TwoTenantName, teamId: string): Promise<number>
  authenticateApiKey(
    tenant: TwoTenantName,
    token: string,
    mode?: AuthMode,
  ): Promise<ProjectAuthContext>
  authenticateSession(tenant: TwoTenantName, token: string): Promise<ProjectAuthContext>
  inspectTargetCiphertext(projectId: string): Promise<string>
  assertNoSensitiveValues(value: string): Promise<void>
  assertNoPlatformConnections(): Promise<void>
  assertNoTenantConnections(): Promise<void>
  assertRemoved(): Promise<void>
  close(): Promise<void>
}

export interface TwoTenantFixture {
  readonly driver: PlatformDatabaseDriver
  readonly tenants: Readonly<Record<TwoTenantName, TenantFixture>>
  readonly platformFailures: PlatformFailureFixtures
  readonly runtime: TwoTenantFixtureRuntimeOptions
  readonly owner: TwoTenantFixtureOwner
}

export interface TwoTenantFixtureOptions {
  readonly driver: PlatformDatabaseDriver
  readonly sqliteFilename?: string
}

interface SeededApiKey {
  readonly fixture: TenantApiKeyFixture
  readonly verifier: SecretVerifier
}

interface SeededSession {
  readonly fixture: TenantSessionFixture
  readonly verifier: SecretVerifier
}

interface SeededCredentials {
  readonly session: SeededSession
  readonly full: SeededApiKey
  readonly teamsWriteOnly: SeededApiKey
  readonly usersReadOnly: SeededApiKey
  readonly usersWriteOnly: SeededApiKey
  readonly scopeDeficient: SeededApiKey
}

interface OwnedTenant {
  readonly fixture: TenantFixture
  readonly target: TenantDatabaseTarget
}

function randomSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

async function apiKey(id: string, scopes: readonly string[]): Promise<SeededApiKey> {
  const secret = randomSecret()
  const verifier = await createSecretVerifier('apiKey', secret)
  const fixture = Object.freeze({
    id,
    token: createCredentialToken('apiKey', id, secret),
    scopes: Object.freeze([...scopes]),
    modes: API_KEY_MODES,
  })
  return Object.freeze({ fixture, verifier })
}

async function userSession(): Promise<SeededSession> {
  const secret = randomSecret()
  const verifier = await createSecretVerifier('session', secret)
  const fixture = Object.freeze({
    id: SESSION_ID,
    token: createCredentialToken('session', SESSION_ID, secret),
    userId: SESSION_USER_ID,
  })
  return Object.freeze({ fixture, verifier })
}

async function credentials(): Promise<SeededCredentials> {
  const [session, full, teamsWriteOnly, usersReadOnly, usersWriteOnly, scopeDeficient] =
    await Promise.all([
      userSession(),
      apiKey(SHARED_KEY_ID, TENANT_FULL_SCOPES),
      apiKey(TEAMS_WRITE_KEY_ID, ['teams.write']),
      apiKey(USERS_READ_KEY_ID, ['users.read']),
      apiKey(USERS_WRITE_KEY_ID, ['users.write']),
      apiKey(SCOPE_DEFICIENT_KEY_ID, []),
    ])
  return Object.freeze({
    session,
    full,
    teamsWriteOnly,
    usersReadOnly,
    usersWriteOnly,
    scopeDeficient,
  })
}

function target(postgres: PostgresTestResource): TenantDatabaseTarget {
  return Object.freeze({
    driver: 'postgresql' as const,
    connectionString: postgres.owner.connectionString(),
  })
}

function unreachableTarget(selected: TenantDatabaseTarget): TenantDatabaseTarget {
  const connection = new URL(selected.connectionString)
  connection.hostname = '127.0.0.1'
  connection.port = '1'
  return Object.freeze({
    driver: 'postgresql',
    connectionString: connection.toString(),
  })
}

function malformedTarget(): TenantDatabaseTarget {
  const connection = new URL('https://malformed-target.example.test/database')
  connection.username = 'malformed-owner'
  connection.password = crypto.randomUUID().replaceAll('-', '')
  return Object.freeze({
    driver: 'postgresql',
    connectionString: connection.toString(),
  })
}

function failureFixture(projectId: string): PlatformFailureFixture {
  return Object.freeze({
    projectId,
    publishableKey: createPublishableKey(projectId, 'test'),
  })
}

function platformFailures(): PlatformFailureFixtures {
  return Object.freeze({
    unknown: failureFixture(FAILURE_PROJECT_IDS.unknown),
    disabled: failureFixture(FAILURE_PROJECT_IDS.disabled),
    missingTarget: failureFixture(FAILURE_PROJECT_IDS.missingTarget),
    corruptTarget: failureFixture(FAILURE_PROJECT_IDS.corruptTarget),
    malformedTarget: failureFixture(FAILURE_PROJECT_IDS.malformedTarget),
    unreachableTarget: failureFixture(FAILURE_PROJECT_IDS.unreachableTarget),
  })
}

async function imageFoundation(resource: TenantDatabaseResource): Promise<boolean> {
  const rows = await resource.postgres
    .raw<readonly { exists: boolean }[]>(
      'select exists (select 1 from information_schema.tables where table_schema = ? and table_name = ?) as "exists"',
      ['system', 'schemas'],
    )
    .execute()
  return rows[0]?.exists === true
}

async function withTenantResource<Result>(
  selectedTarget: TenantDatabaseTarget,
  operation: (resource: TenantDatabaseResource) => Result | Promise<Result>,
): Promise<Result> {
  const resource = createTenantDatabaseResource(selectedTarget)
  const outcome = await Promise.resolve(operation(resource)).then(
    (value) => ({ ok: true, value }) as const,
    (error: unknown) => ({ ok: false, error }) as const,
  )
  const cleanupFailure = await resource.close().then(
    () => undefined,
    (error: unknown) => error,
  )

  if (!outcome.ok && cleanupFailure) {
    throw new AggregateError(
      [outcome.error, cleanupFailure],
      'Tenant fixture operation and cleanup failed',
    )
  }
  if (!outcome.ok) throw outcome.error
  if (cleanupFailure) throw cleanupFailure
  return outcome.value
}

async function seedApiKeys(
  resource: TenantDatabaseResource,
  seeded: SeededCredentials,
): Promise<void> {
  const fields = TENANT_AUTH_MODEL.fields.apiKeys
  // Fixture bootstrap is an owner-only boundary; bearer tokens never enter this session.
  const system = resource.database.system()

  for (const credential of [
    seeded.full,
    seeded.teamsWriteOnly,
    seeded.usersReadOnly,
    seeded.usersWriteOnly,
    seeded.scopeDeficient,
  ]) {
    await system.createDocument(
      TENANT_AUTH_MODEL.collections.apiKeys,
      new Doc({
        $id: credential.fixture.id,
        [fields.secretDigest]: credential.verifier.digest,
        [fields.secretSalt]: credential.verifier.salt,
        [fields.scopes]: [...credential.fixture.scopes],
        [fields.modes]: [...credential.fixture.modes],
        [fields.enabled]: true,
        [fields.expiresAt]: null,
        [fields.revokedAt]: null,
      }),
    )
  }
}

async function seedUserSession(
  resource: TenantDatabaseResource,
  seeded: SeededSession,
): Promise<void> {
  const userFields = TENANT_AUTH_MODEL.fields.users
  const sessionFields = TENANT_AUTH_MODEL.fields.sessions
  // Fixture bootstrap is an owner-only boundary; only the salted HMAC verifier is persisted.
  const system = resource.database.system()
  await system.createDocument(
    TENANT_AUTH_MODEL.collections.users,
    new Doc({
      $id: seeded.fixture.userId,
      $permissions: [
        Permission.read(Role.user(seeded.fixture.userId)),
        Permission.update(Role.user(seeded.fixture.userId)),
        Permission.delete(Role.user(seeded.fixture.userId)),
      ],
      [userFields.name]: 'Integration Session User',
      [userFields.status]: true,
      [userFields.emailVerified]: true,
      [userFields.phoneVerified]: false,
      [userFields.labels]: [],
      [userFields.prefs]: {},
    }),
  )
  await system.createDocument(
    TENANT_AUTH_MODEL.collections.sessions,
    new Doc({
      $id: seeded.fixture.id,
      [sessionFields.userId]: seeded.fixture.userId,
      [sessionFields.secretDigest]: seeded.verifier.digest,
      [sessionFields.secretSalt]: seeded.verifier.salt,
      [sessionFields.expiresAt]: SESSION_EXPIRES_AT,
      [sessionFields.revokedAt]: null,
    }),
  )
}

async function provision(selectedTarget: TenantDatabaseTarget, seeded: SeededCredentials) {
  await withTenantResource(selectedTarget, async (resource) => {
    if (!(await imageFoundation(resource))) {
      throw new Error('Tenant fixture requires the system.schemas image foundation')
    }
    await provisionTenantDatabase(resource.database)
    await seedUserSession(resource, seeded.session)
    await seedApiKeys(resource, seeded)
  })
}

function publicCredentials(seeded: SeededCredentials): TenantFixture['credentials'] {
  return Object.freeze({
    session: seeded.session.fixture,
    full: seeded.full.fixture,
    teamsWriteOnly: seeded.teamsWriteOnly.fixture,
    usersReadOnly: seeded.usersReadOnly.fixture,
    usersWriteOnly: seeded.usersWriteOnly.fixture,
    scopeDeficient: seeded.scopeDeficient.fixture,
  })
}

async function createTenant(
  name: TwoTenantName,
  postgres: PostgresTestResource,
  seeded: SeededCredentials,
): Promise<OwnedTenant> {
  const project = Object.freeze({
    id: `integration_tenant_${name}`,
    enabled: true,
  })
  const selectedTarget = target(postgres)
  await provision(selectedTarget, seeded)

  return Object.freeze({
    fixture: Object.freeze({
      project,
      publishableKey: createPublishableKey(project.id, 'test'),
      credentials: publicCredentials(seeded),
    }),
    target: selectedTarget,
  })
}

function tenant(tenants: Readonly<Record<TwoTenantName, OwnedTenant>>, name: TwoTenantName) {
  return tenants[name]
}

async function inspectTenant(selected: OwnedTenant): Promise<TenantFixtureInspection> {
  return await withTenantResource(selected.target, async (resource) => {
    const availability = await Promise.all(
      TENANT_FIXTURE_COLLECTIONS.map(async (collection) => ({
        collection,
        exists: await resource.database.exists(undefined, collection),
      })),
    )
    return Object.freeze({
      imageFoundation: await imageFoundation(resource),
      collections: Object.freeze(
        availability.filter(({ exists }) => exists).map(({ collection }) => collection),
      ),
    })
  })
}

async function inspectSchemaMetadata(
  selected: OwnedTenant,
  schemaName: string,
): Promise<TenantSchemaMetadataInspection> {
  return await withTenantResource(selected.target, async (resource) => {
    // Physical bootstrap state is observable only through this test-owner seam.
    const rows = await resource.postgres
      .raw<readonly { exists: boolean }[]>(
        'select exists (select 1 from information_schema.tables where table_schema = ? and table_name = ?) as "exists"',
        [schemaName, 'nx__metadata'],
      )
      .execute()
    return Object.freeze({ initialized: rows[0]?.exists === true })
  })
}

async function inspectApiKey(
  selected: OwnedTenant,
  keyId: string,
): Promise<TenantApiKeyInspection> {
  return await withTenantResource(selected.target, async (resource) => {
    const fields = TENANT_AUTH_MODEL.fields.apiKeys
    const document = await resource.database
      .system()
      .getDocument(TENANT_AUTH_MODEL.collections.apiKeys, keyId)
    if (document.empty()) throw new Error('Tenant fixture API key was not found')

    return Object.freeze({
      id: document.getId(),
      fieldNames: Object.freeze(Object.keys(document.getAll()).toSorted()),
      secretDigest: document.get(fields.secretDigest),
      secretSalt: document.get(fields.secretSalt),
      scopes: document.get(fields.scopes),
      modes: document.get(fields.modes),
      enabled: document.get(fields.enabled),
      expiresAt: document.get(fields.expiresAt),
      revokedAt: document.get(fields.revokedAt),
    })
  })
}

async function inspectSession(
  selected: OwnedTenant,
  sessionId: string,
): Promise<TenantSessionInspection> {
  return await withTenantResource(selected.target, async (resource) => {
    const fields = TENANT_AUTH_MODEL.fields.sessions
    const document = await resource.database
      .system()
      .getDocument(TENANT_AUTH_MODEL.collections.sessions, sessionId)
    if (document.empty()) throw new Error('Tenant fixture session was not found')

    return Object.freeze({
      id: document.getId(),
      fieldNames: Object.freeze(Object.keys(document.getAll()).toSorted()),
      userId: document.get(fields.userId),
      secretDigest: document.get(fields.secretDigest),
      secretSalt: document.get(fields.secretSalt),
      expiresAt: document.get(fields.expiresAt),
      revokedAt: document.get(fields.revokedAt),
    })
  })
}

async function countTeamMemberships(selected: OwnedTenant, teamId: string): Promise<number> {
  return await withTenantResource(selected.target, async (resource) =>
    resource.database
      .system()
      .count(TENANT_AUTH_MODEL.collections.memberships, [
        Query.equal(TENANT_AUTH_MODEL.fields.memberships.teamId, [teamId]),
      ]),
  )
}

async function authenticateApiKey(
  selected: OwnedTenant,
  token: string,
  mode: AuthMode,
): Promise<ProjectAuthContext> {
  return await withTenantResource(selected.target, async (resource) =>
    createTenantAuthResolver().resolve({
      headers: new Headers({ [HEADERS.apiKey]: token, [HEADERS.mode]: mode }),
      project: selected.fixture.project,
      documents: resource.database.system(),
    }),
  )
}

async function authenticateSession(
  selected: OwnedTenant,
  token: string,
): Promise<ProjectAuthContext> {
  return await withTenantResource(selected.target, async (resource) =>
    createTenantAuthResolver().resolve({
      headers: new Headers({ [HEADERS.session]: token }),
      project: selected.fixture.project,
      documents: resource.database.system(),
    }),
  )
}

function credentialCanaries(seeded: readonly SeededCredentials[]): readonly string[] {
  return seeded.flatMap((credentials) =>
    Object.values(credentials).flatMap(({ fixture, verifier }) => [
      fixture.token,
      fixture.token.split('.').at(-1) ?? '',
      verifier.digest,
      verifier.salt,
    ]),
  )
}

async function assertNoSensitiveValues(
  value: string,
  seeded: readonly SeededCredentials[],
  tenants: Readonly<Record<TwoTenantName, OwnedTenant>>,
  failures: PlatformFailureFixtures,
  platform: PlatformFixture,
): Promise<void> {
  const canaries = [
    ...credentialCanaries(seeded),
    ...Object.values(tenants).map(({ fixture }) => fixture.publishableKey),
    ...Object.values(failures).map(({ publishableKey }) => publishableKey),
  ]
  if (canaries.some((canary) => canary.length > 0 && value.includes(canary))) {
    throw new Error('Tenant fixture sensitive value leaked into request diagnostics')
  }
  await platform.owner.assertNoSensitiveValues(value)
}

async function closeOwned(
  platform: PlatformFixture | undefined,
  postgresResources: readonly PostgresTestResource[],
): Promise<void> {
  const failures: unknown[] = []
  if (platform) await platform.owner.close().catch((error: unknown) => failures.push(error))
  for (const postgres of postgresResources.toReversed()) {
    await postgres.close().catch((error: unknown) => failures.push(error))
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Two-tenant fixture cleanup failed')
}

async function assertRemoved(
  platform: PlatformFixture,
  postgresResources: readonly PostgresTestResource[],
): Promise<void> {
  await Promise.all([
    platform.owner.assertRemoved(),
    ...postgresResources.map((postgres) => postgres.owner.assertRemoved()),
  ])
}

export async function createTwoTenantFixture(
  options: TwoTenantFixtureOptions,
): Promise<TwoTenantFixture> {
  const postgresResources: PostgresTestResource[] = []
  let platform: PlatformFixture | undefined

  try {
    const credentialsA = await credentials()
    const credentialsB = await credentials()
    if (credentialsA.full.fixture.token === credentialsB.full.fixture.token) {
      throw new Error('Tenant fixture credential generation failed')
    }

    const postgresA = await startPostgresResource()
    postgresResources.push(postgresA)
    const postgresB = await startPostgresResource()
    postgresResources.push(postgresB)

    const tenantA = await createTenant('a', postgresA, credentialsA)
    const tenantB = await createTenant('b', postgresB, credentialsB)
    const ownedTenants = Object.freeze({ a: tenantA, b: tenantB })
    const failureProjects = platformFailures()
    platform = await createPlatformFixture({
      driver: options.driver,
      projects: [
        { ...tenantA.fixture.project, target: tenantA.target },
        { ...tenantB.fixture.project, target: tenantB.target },
        {
          id: failureProjects.disabled.projectId,
          enabled: false,
          target: tenantA.target,
        },
        { id: failureProjects.missingTarget.projectId, enabled: true },
        {
          id: failureProjects.corruptTarget.projectId,
          enabled: true,
          target: tenantA.target,
        },
        {
          id: failureProjects.malformedTarget.projectId,
          enabled: true,
          target: malformedTarget(),
        },
        {
          id: failureProjects.unreachableTarget.projectId,
          enabled: true,
          target: unreachableTarget(tenantA.target),
        },
      ],
      sqliteFilename: options.sqliteFilename,
    })
    await platform.owner.corruptTargetCiphertext(failureProjects.corruptTarget.projectId)

    const selectedPlatform = platform
    let closePromise: Promise<void> | undefined
    return Object.freeze({
      driver: options.driver,
      tenants: Object.freeze({ a: tenantA.fixture, b: tenantB.fixture }),
      platformFailures: failureProjects,
      runtime: Object.freeze({
        ...selectedPlatform.runtime,
        publishableKeyEnvironment: 'test' as const,
      }),
      owner: Object.freeze({
        // Targets and privileged database access remain confined to test-owner methods.
        inspectTenant: (name: TwoTenantName) => inspectTenant(tenant(ownedTenants, name)),
        inspectSchemaMetadata: (name: TwoTenantName, schemaName: string) =>
          inspectSchemaMetadata(tenant(ownedTenants, name), schemaName),
        inspectApiKey: (name: TwoTenantName, keyId: string) =>
          inspectApiKey(tenant(ownedTenants, name), keyId),
        inspectSession: (name: TwoTenantName, sessionId: string) =>
          inspectSession(tenant(ownedTenants, name), sessionId),
        countTeamMemberships: (name: TwoTenantName, teamId: string) =>
          countTeamMemberships(tenant(ownedTenants, name), teamId),
        authenticateApiKey: (name: TwoTenantName, token: string, mode: AuthMode = 'admin') =>
          authenticateApiKey(tenant(ownedTenants, name), token, mode),
        authenticateSession: (name: TwoTenantName, token: string) =>
          authenticateSession(tenant(ownedTenants, name), token),
        inspectTargetCiphertext: (projectId: string) =>
          selectedPlatform.owner.inspectTargetCiphertext(projectId),
        assertNoSensitiveValues: (value: string) =>
          assertNoSensitiveValues(
            value,
            [credentialsA, credentialsB],
            ownedTenants,
            failureProjects,
            selectedPlatform,
          ),
        assertNoPlatformConnections: () => selectedPlatform.owner.assertNoClientConnections(),
        assertNoTenantConnections: async () => {
          await Promise.all(
            postgresResources.map((postgres) => postgres.owner.assertNoClientConnections()),
          )
        },
        assertRemoved: () => assertRemoved(selectedPlatform, postgresResources),
        close: () => {
          closePromise ??= closeOwned(selectedPlatform, postgresResources)
          return closePromise
        },
      }),
    })
  } catch (error) {
    const cleanupFailure = await closeOwned(platform, postgresResources).catch(
      (failure: unknown) => failure,
    )
    if (cleanupFailure) {
      throw new AggregateError(
        [error, cleanupFailure],
        'Two-tenant fixture setup and cleanup failed',
      )
    }
    throw error
  }
}
