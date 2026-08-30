import { describe, expect, test } from 'bun:test'
import { Doc, type Query, Role } from '@nuvix/db'
import { apiScopeLabel } from '../src/context/database-roles'
import type { ProjectAuthContext } from '../src/context/project'
import type { TeamDocuments } from '../src/teams/documents'
import { createTeamService } from '../src/teams/service'

const NOW = new Date('2026-08-29T12:00:00.000Z')
const SESSION_AUTH: ProjectAuthContext = {
  type: 'session',
  sessionId: 'session_a',
  userId: 'user_a',
  verified: true,
  scopes: [],
}
const API_WRITE_AUTH: ProjectAuthContext = {
  type: 'apiKey',
  keyId: 'key_a',
  mode: 'admin',
  scopes: ['teams.write'],
}

function stored(document: Doc, updatedAt = NOW): Doc {
  return new Doc({
    ...document.getAll(),
    $createdAt: document.createdAt() ?? NOW,
    $updatedAt: updatedAt,
  })
}

function harness() {
  let state = new Map<string, Map<string, Doc>>()
  const collection = (id: string) => {
    const existing = state.get(id) ?? new Map<string, Doc>()
    state.set(id, existing)
    return existing
  }
  const documents: TeamDocuments = {
    find: async (id) => [...collection(id).values()],
    count: async (id) => collection(id).size,
    get: async (id, documentId) => collection(id).get(documentId) ?? new Doc(),
    create: async (id, document) => {
      const created = stored(document)
      collection(id).set(created.getId(), created)
      return created
    },
    update: async (id, documentId, changes) => {
      const current = collection(id).get(documentId)
      if (!current) return new Doc()
      const updated = stored(new Doc({ ...current.getAll(), ...changes.getAll() }), NOW)
      collection(id).set(documentId, updated)
      return updated
    },
    remove: async (id, documentId) => collection(id).delete(documentId),
    removeMany: async (id, _queries?: Query[]) => {
      const ids = [...collection(id).keys()]
      collection(id).clear()
      return ids
    },
    transaction: async (operation) => {
      const snapshot = new Map(
        [...state].map(([id, documents]) => [id, new Map(documents)] as const),
      )
      try {
        return await operation(documents)
      } catch (error) {
        state = snapshot
        throw error
      }
    },
  }
  return { collection, documents }
}

describe('teams service', () => {
  test('creates a team and accepted owner membership atomically for a user', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })

    const team = await service.create(state.documents, SESSION_AUTH, {
      name: 'Core Team',
      roles: ['viewer', 'viewer'],
    })

    expect(team).toMatchObject({
      $id: 'team_a',
      name: 'Core Team',
      total: 1,
      prefs: {},
    })
    const membership = state.collection('memberships').get('membership_a')!
    expect(membership.get('userId')).toBe('user_a')
    expect(membership.get('teamId')).toBe('team_a')
    expect(membership.get('roles')).toEqual(['owner', 'viewer'])
    expect(membership.get('status')).toBe('accepted')
  })

  test('creates an API-key-owned aggregate without inventing a user membership', async () => {
    const state = harness()
    const service = createTeamService({ id: () => 'team_api', now: () => NOW })

    const team = await service.create(state.documents, API_WRITE_AUTH, {
      name: 'Automation',
    })

    expect(team.total).toBe(0)
    expect(state.collection('memberships').size).toBe(0)
  })

  test('lets a teams.write session read a team for write-operation preconditions', async () => {
    const state = harness()
    const service = createTeamService({ id: () => 'team_api', now: () => NOW })
    await service.create(state.documents, API_WRITE_AUTH, {
      name: 'Automation',
    })

    expect(state.collection('teams').get('team_api')?.getRead()).toEqual([
      Role.team('team_api').toString(),
      Role.label(apiScopeLabel('teams.read')).toString(),
      Role.label(apiScopeLabel('teams.write')).toString(),
    ])
  })

  test('lists teams with the v2 pagination envelope', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a', 'team_b']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })
    await service.create(state.documents, SESSION_AUTH, { name: 'A' })
    await service.create(state.documents, API_WRITE_AUTH, { name: 'B' })

    const result = await service.list(state.documents, 25, 0)

    expect(result.meta).toEqual({ total: 2, limit: 25, offset: 0 })
    expect(result.data.map(({ name }) => name)).toEqual(['A', 'B'])
  })

  test('updates name and replaces preferences', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })
    await service.create(state.documents, SESSION_AUTH, { name: 'Before' })

    const updated = await service.update(state.documents, 'team_a', 'After')
    const preferences = await service.updatePrefs(state.documents, 'team_a', {
      theme: 'dark',
      nested: { enabled: true },
    })

    expect(updated.name).toBe('After')
    expect(preferences).toEqual({ theme: 'dark', nested: { enabled: true } })
    expect(await service.getPrefs(state.documents, 'team_a')).toEqual(preferences)
  })

  test('deletes the team and its memberships in one transaction', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })
    await service.create(state.documents, SESSION_AUTH, { name: 'Disposable' })

    await service.remove(state.documents, 'team_a')

    expect(state.collection('teams').size).toBe(0)
    expect(state.collection('memberships').size).toBe(0)
  })

  test('uses the stable team_not_found code', async () => {
    const state = harness()
    const service = createTeamService()

    const failure = await service.get(state.documents, 'missing').catch((error: unknown) => error)

    expect((failure as { status: number }).status).toBe(404)
    expect((failure as { fields: { code?: string } }).fields.code).toBe('team_not_found')
  })
})
