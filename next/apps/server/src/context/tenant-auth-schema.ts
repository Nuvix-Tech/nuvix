import { AttributeType, type Database, Doc, IndexType, Permission, Role } from '@nuvix/db'
import { apiScopeLabel } from './database-roles'
import { TENANT_AUTH_MODEL, type TenantAuthModel } from './tenant-auth-model'

export type TenantAuthCollectionDefinition = Parameters<Database['createCollection']>[0]
export type TenantAuthSchemaDatabase = Pick<Database, 'createCollection' | 'exists' | 'getAdapter'>

export interface TenantAuthSchemaCapabilities {
  readonly $limitForAttributes: number
  readonly $limitForIndexes: number
  readonly $supportForIndex: boolean
  readonly $supportForUniqueIndex: boolean
}

const string = (id: string, size: number, required = true, array = false) =>
  new Doc({
    $id: id,
    key: id,
    type: AttributeType.String,
    size,
    required,
    array,
  })

const boolean = (id: string, defaultValue: boolean) =>
  new Doc({
    $id: id,
    key: id,
    type: AttributeType.Boolean,
    required: true,
    default: defaultValue,
  })

const timestamp = (id: string, required: boolean) =>
  new Doc({ $id: id, key: id, type: AttributeType.Timestamptz, required })

const index = (id: string, type: IndexType, attributes: readonly string[]) =>
  new Doc({ $id: id, key: id, type, attributes: [...attributes] })

/** Tenant-auth schema expressed through public @nuvix/db APIs for PostgreSQL tenants. */
export function createTenantAuthCollectionDefinitions(
  model: TenantAuthModel = TENANT_AUTH_MODEL,
): readonly TenantAuthCollectionDefinition[] {
  const { collections, fields } = model
  return [
    {
      id: collections.users,
      attributes: [
        string(fields.users.name, 128, false),
        string(fields.users.email, 320, false),
        string(fields.users.phone, 16, false),
        boolean(fields.users.status, true),
        boolean(fields.users.emailVerified, false),
        boolean(fields.users.phoneVerified, false),
        new Doc({
          $id: fields.users.labels,
          key: fields.users.labels,
          type: AttributeType.String,
          size: 64,
          required: true,
          array: true,
          default: [],
        }),
        new Doc({
          $id: fields.users.prefs,
          key: fields.users.prefs,
          type: AttributeType.Json,
          required: true,
          default: {},
        }),
        boolean(fields.users.mfa, false),
        new Doc({
          $id: fields.users.mfaRecoveryCodes,
          key: fields.users.mfaRecoveryCodes,
          type: AttributeType.String,
          size: 64,
          required: true,
          array: true,
          default: [],
        }),
        string(fields.users.passwordHash, 256, false),
        timestamp(fields.users.passwordUpdate, false),
      ],
      indexes: [
        index('name', IndexType.Key, [fields.users.name]),
        index('email_unique', IndexType.Unique, [fields.users.email]),
        index('phone_unique', IndexType.Unique, [fields.users.phone]),
        index('status', IndexType.Key, [fields.users.status]),
        index('email_verified', IndexType.Key, [fields.users.emailVerified]),
        index('phone_verified', IndexType.Key, [fields.users.phoneVerified]),
      ],
      permissions: [
        Permission.create(Role.label(apiScopeLabel('users.write'))),
        Permission.read(Role.label(apiScopeLabel('users.read'))),
        Permission.read(Role.label(apiScopeLabel('users.write'))),
        Permission.update(Role.label(apiScopeLabel('users.write'))),
      ],
      documentSecurity: true,
    },
    {
      id: collections.sessions,
      attributes: [
        string(fields.sessions.userId, 36),
        string(fields.sessions.secretDigest, 128),
        string(fields.sessions.secretSalt, 128),
        timestamp(fields.sessions.expiresAt, true),
        timestamp(fields.sessions.revokedAt, false),
      ],
      indexes: [
        index('user_id', IndexType.Key, [fields.sessions.userId]),
        index('expires_at', IndexType.Key, [fields.sessions.expiresAt]),
      ],
      permissions: [],
      documentSecurity: false,
    },
    {
      id: collections.memberships,
      attributes: [
        string(fields.memberships.userId, 36),
        string(fields.memberships.teamId, 36),
        string(fields.memberships.roles, 64, true, true),
        string(fields.memberships.status, 32),
        timestamp(fields.memberships.invited, true),
        timestamp(fields.memberships.joined, false),
        string(fields.memberships.secretDigest, 128, false),
        string(fields.memberships.secretSalt, 128, false),
        timestamp(fields.memberships.inviteExpiresAt, false),
      ],
      indexes: [
        index('user_status', IndexType.Key, [fields.memberships.userId, fields.memberships.status]),
        index('team_id', IndexType.Key, [fields.memberships.teamId]),
        index('team_status', IndexType.Key, [fields.memberships.teamId, fields.memberships.status]),
        index('user_team_unique', IndexType.Unique, [
          fields.memberships.userId,
          fields.memberships.teamId,
        ]),
      ],
      permissions: [
        Permission.create(Role.users()),
        Permission.create(Role.label(apiScopeLabel('teams.write'))),
        Permission.read(Role.label(apiScopeLabel('users.read'))),
      ],
      documentSecurity: true,
    },
    {
      id: collections.apiKeys,
      attributes: [
        string(fields.apiKeys.secretDigest, 128),
        string(fields.apiKeys.secretSalt, 128),
        string(fields.apiKeys.scopes, 128, true, true),
        string(fields.apiKeys.modes, 32, true, true),
        boolean(fields.apiKeys.enabled, true),
        timestamp(fields.apiKeys.expiresAt, false),
        timestamp(fields.apiKeys.revokedAt, false),
      ],
      indexes: [index('expires_at', IndexType.Key, [fields.apiKeys.expiresAt])],
      permissions: [],
      documentSecurity: false,
    },
    {
      id: collections.jwtKeys,
      attributes: [
        string(fields.jwtKeys.signingKey, 256),
        string(fields.jwtKeys.algorithm, 32),
        boolean(fields.jwtKeys.active, true),
        timestamp(fields.jwtKeys.expiresAt, false),
      ],
      indexes: [
        index('active', IndexType.Key, [fields.jwtKeys.active]),
        index('expires_at', IndexType.Key, [fields.jwtKeys.expiresAt]),
      ],
      permissions: [],
      documentSecurity: false,
    },
    {
      id: collections.tokens,
      attributes: [
        string(fields.tokens.userId, 36),
        string(fields.tokens.type, 32),
        string(fields.tokens.secretDigest, 128),
        string(fields.tokens.secretSalt, 128),
        timestamp(fields.tokens.expiresAt, true),
      ],
      indexes: [
        index('tokens_user_id', IndexType.Key, [fields.tokens.userId]),
        index('tokens_type_user', IndexType.Key, [fields.tokens.type, fields.tokens.userId]),
      ],
      permissions: [],
      documentSecurity: false,
    },
    {
      id: collections.targets,
      attributes: [
        string(fields.targets.userId, 36),
        string(fields.targets.providerType, 32),
        string(fields.targets.identifier, 256),
      ],
      indexes: [
        index('targets_user_id', IndexType.Key, [fields.targets.userId]),
        index('targets_identifier', IndexType.Unique, [fields.targets.identifier]),
      ],
      permissions: [],
      documentSecurity: false,
    },
    {
      id: collections.authenticators,
      attributes: [
        string(fields.authenticators.userId, 36),
        string(fields.authenticators.type, 32),
        string(fields.authenticators.secretData, 256),
        boolean(fields.authenticators.verified, false),
      ],
      indexes: [index('auth_user_id', IndexType.Key, [fields.authenticators.userId])],
      permissions: [],
      documentSecurity: false,
    },
  ]
}

export function assertTenantAuthSchemaCapabilities(
  capabilities: TenantAuthSchemaCapabilities,
  definitions: readonly TenantAuthCollectionDefinition[],
): void {
  if (!capabilities.$supportForIndex || !capabilities.$supportForUniqueIndex) {
    throw new Error('Tenant database does not support the auth index contract')
  }
  for (const definition of definitions) {
    if (
      capabilities.$limitForAttributes > 0 &&
      (definition.attributes?.length ?? 0) > capabilities.$limitForAttributes
    ) {
      throw new Error('Tenant auth collection exceeds the adapter attribute limit')
    }
    if (
      capabilities.$limitForIndexes > 0 &&
      (definition.indexes?.length ?? 0) > capabilities.$limitForIndexes
    ) {
      throw new Error('Tenant auth collection exceeds the adapter index limit')
    }
  }
}

/** Explicit provisioning operation; request and server startup never invoke it. */
export async function setupTenantAuthSchema(
  database: TenantAuthSchemaDatabase,
  model: TenantAuthModel = TENANT_AUTH_MODEL,
): Promise<void> {
  const definitions = createTenantAuthCollectionDefinitions(model)
  assertTenantAuthSchemaCapabilities(database.getAdapter(), definitions)
  for (const definition of definitions) {
    if (!(await database.exists(undefined, definition.id))) {
      await database.createCollection(definition)
    }
  }
}
