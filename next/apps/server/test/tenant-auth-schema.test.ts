import { describe, expect, test } from 'bun:test'
import { IndexType, Permission, Role } from '@nuvix/db'
import { apiScopeLabel } from '../src/context/database-roles'
import {
  assertTenantAuthSchemaCapabilities,
  createTenantAuthCollectionDefinitions,
  setupTenantAuthSchema,
  type TenantAuthCollectionDefinition,
  type TenantAuthSchemaCapabilities,
  type TenantAuthSchemaDatabase,
} from '../src/context/tenant-auth-schema'

const CAPABILITIES: TenantAuthSchemaCapabilities = {
  $limitForAttributes: 1_600,
  $limitForIndexes: 64,
  $supportForIndex: true,
  $supportForUniqueIndex: true,
}

function harness() {
  const created: TenantAuthCollectionDefinition[] = []
  const existing = new Set<string>()
  const database = {
    createCollection: async (definition: TenantAuthCollectionDefinition) => {
      created.push(definition)
      existing.add(definition.id)
      return {} as never
    },
    exists: async (_database?: string, collection?: string) =>
      collection === undefined || existing.has(collection),
    getAdapter: () => CAPABILITIES,
  } as unknown as TenantAuthSchemaDatabase
  return { created, database, existing }
}

describe('tenant auth schema', () => {
  test('uses PostgreSQL-compatible definitions without optional full-text features', async () => {
    const state = harness()

    await setupTenantAuthSchema(state.database)

    expect(state.created.map(({ id }) => id)).toEqual([
      'users',
      'sessions',
      'memberships',
      'api_keys',
    ])
    expect(
      state.created.flatMap(({ indexes = [] }) => indexes.map((item) => item.get('type'))),
    ).not.toContain(IndexType.FullText)
  })

  test('stores secret verifiers but never recoverable bearer secrets', () => {
    const definitions = createTenantAuthCollectionDefinitions()
    const attributes = definitions.flatMap(({ attributes = [] }) =>
      attributes.map((item) => item.getId()),
    )

    expect(attributes).toContain('secretDigest')
    expect(attributes).toContain('secretSalt')
    expect(attributes).toContain('passwordHash')
    expect(attributes).toContain('passwordUpdate')
    expect(attributes).not.toContain('secret')
    expect(attributes).not.toContain('password')
    expect(attributes).toEqual(expect.arrayContaining(['name', 'email', 'phone', 'prefs']))
  })

  test('does not expose credential collections through document permissions', () => {
    const definitions = createTenantAuthCollectionDefinitions()
    const credentialCollections = definitions.filter(
      ({ id }) => id === 'sessions' || id === 'api_keys',
    )

    expect(credentialCollections.every(({ documentSecurity }) => documentSecurity === false)).toBe(
      true,
    )
  })

  test('allows users.write precondition reads without granting write access to users.read', () => {
    const users = createTenantAuthCollectionDefinitions().find(({ id }) => id === 'users')

    expect(users?.permissions).toEqual([
      Permission.create(Role.label(apiScopeLabel('users.write'))),
      Permission.read(Role.label(apiScopeLabel('users.read'))),
      Permission.read(Role.label(apiScopeLabel('users.write'))),
      Permission.update(Role.label(apiScopeLabel('users.write'))),
    ])
  })

  test('rejects unsupported auth indexes before persistence', () => {
    const definitions = createTenantAuthCollectionDefinitions()

    expect(() =>
      assertTenantAuthSchemaCapabilities(
        { ...CAPABILITIES, $supportForUniqueIndex: false },
        definitions,
      ),
    ).toThrow('does not support the auth index contract')
  })
})
