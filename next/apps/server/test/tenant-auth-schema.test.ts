import { describe, expect, test } from 'bun:test'
import { IndexType } from '@nuvix/db'
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
  test.each(['PostgreSQL', 'SQLite'] as const)(
    'uses the same portable definitions for %s',
    async () => {
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
    },
  )

  test('stores secret verifiers but never recoverable bearer secrets', () => {
    const definitions = createTenantAuthCollectionDefinitions()
    const attributes = definitions.flatMap(({ attributes = [] }) =>
      attributes.map((item) => item.getId()),
    )

    expect(attributes).toContain('secretDigest')
    expect(attributes).toContain('secretSalt')
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
