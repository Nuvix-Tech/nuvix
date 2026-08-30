import { describe, expect, test } from 'bun:test'
import { Permission, Role } from '@nuvix/db'
import { apiScopeLabel, rolesFor } from '../src/context/database-roles'
import { createTenantAuthCollectionDefinitions } from '../src/context/tenant-auth-schema'
import {
  createTeamCollectionDefinition,
  setupTeamSchema,
  type TeamSchemaDatabase,
} from '../src/teams/schema'

describe('teams persistence permissions', () => {
  test('makes credential collections explicitly private', () => {
    const definitions = createTenantAuthCollectionDefinitions()
    const credentials = definitions.filter(({ id }) => id === 'sessions' || id === 'api_keys')

    expect(credentials.map(({ permissions }) => permissions)).toEqual([[], []])
  })

  test('allows team creation only for users and scoped API keys', () => {
    const definition = createTeamCollectionDefinition()

    expect(definition.permissions).toEqual([
      Permission.create(Role.users()),
      Permission.create(Role.label(apiScopeLabel('teams.write'))),
    ])
  })

  test('maps persisted API-key scopes to reserved database roles', () => {
    const roles = rolesFor(
      {
        type: 'apiKey',
        keyId: 'key_a',
        mode: 'admin',
        scopes: ['teams.write', 'teams.read', 'teams.write'],
      },
      { id: 'project_a', enabled: true },
    )

    expect(roles).toEqual([
      'any',
      `label:${apiScopeLabel('teams.read')}`,
      `label:${apiScopeLabel('teams.write')}`,
    ])
  })

  test('provisions the team collection explicitly and idempotently', async () => {
    const created: string[] = []
    const existing = new Set<string>()
    const database = {
      exists: async (_database?: string, collection?: string) =>
        collection === undefined || existing.has(collection),
      createCollection: async (definition: ReturnType<typeof createTeamCollectionDefinition>) => {
        created.push(definition.id)
        existing.add(definition.id)
        return {} as never
      },
    } as TeamSchemaDatabase

    await setupTeamSchema(database)
    await setupTeamSchema(database)

    expect(created).toEqual(['teams'])
  })
})
