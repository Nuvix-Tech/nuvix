import { AttributeType, type Database, Doc, IndexType } from '@nuvix/db'
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

/** Portable tenant-auth schema; credentials stay inaccessible to caller sessions. */
export function createTenantAuthCollectionDefinitions(
  model: TenantAuthModel = TENANT_AUTH_MODEL,
): readonly TenantAuthCollectionDefinition[] {
  const { collections, fields } = model
  return [
    {
      id: collections.users,
      attributes: [
        boolean(fields.users.status, true),
        boolean(fields.users.emailVerified, false),
        boolean(fields.users.phoneVerified, false),
        string(fields.users.labels, 64, true, true),
      ],
      indexes: [],
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
      documentSecurity: false,
    },
    {
      id: collections.memberships,
      attributes: [
        string(fields.memberships.userId, 36),
        string(fields.memberships.teamId, 36),
        string(fields.memberships.roles, 64, true, true),
        string(fields.memberships.status, 32),
      ],
      indexes: [
        index('user_status', IndexType.Key, [fields.memberships.userId, fields.memberships.status]),
        index('user_team_unique', IndexType.Unique, [
          fields.memberships.userId,
          fields.memberships.teamId,
        ]),
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
