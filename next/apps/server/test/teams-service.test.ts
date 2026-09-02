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
const OWNER_AUTH: ProjectAuthContext = {
  ...SESSION_AUTH,
  teams: [{ teamId: 'team_a', roles: ['owner'] }],
}
const MEMBER_AUTH: ProjectAuthContext = {
  type: 'session',
  sessionId: 'session_b',
  userId: 'user_b',
  verified: true,
  scopes: [],
  teams: [{ teamId: 'team_a', roles: ['viewer'] }],
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
    decreaseDocumentAttribute: async (id, documentId, attribute, value, min) => {
      const current = collection(id).get(documentId)
      if (!current) throw new Error('Document not found')
      const currentValue: number = current.get(attribute, 0)
      if (currentValue - value < min) {
        throw new Error(`Attribute value exceeds minimum limit: ${min}`)
      }
      const updated = stored(new Doc({ ...current.getAll(), [attribute]: currentValue - value }))
      collection(id).set(documentId, updated)
      return updated
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

function seedUser(id: string, name: string, email?: string): Doc {
  return stored(
    new Doc({
      $id: id,
      name,
      ...(email ? { email } : {}),
    }),
  )
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

  test('grants exact membership permissions for the administration surface', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })

    await service.create(state.documents, SESSION_AUTH, { name: 'Core Team' })

    const membership = state.collection('memberships').get('membership_a')!
    expect(membership.getCreate()).toEqual([])
    expect(membership.getRead()).toEqual([
      Role.user('user_a').toString(),
      Role.team('team_a').toString(),
      Role.label(apiScopeLabel('teams.read')).toString(),
      Role.label(apiScopeLabel('teams.write')).toString(),
    ])
    expect(membership.getUpdate()).toEqual([
      Role.team('team_a', 'owner').toString(),
      Role.label(apiScopeLabel('teams.write')).toString(),
    ])
    expect(membership.getDelete()).toEqual([
      Role.team('team_a', 'owner').toString(),
      Role.label(apiScopeLabel('teams.write')).toString(),
    ])
  })

  test('lets scoped keys read a team for write and projection preconditions', async () => {
    const state = harness()
    const service = createTeamService({ id: () => 'team_api', now: () => NOW })
    await service.create(state.documents, API_WRITE_AUTH, {
      name: 'Automation',
    })

    expect(state.collection('teams').get('team_api')?.getRead()).toEqual([
      Role.team('team_api').toString(),
      Role.label(apiScopeLabel('teams.read')).toString(),
      Role.label(apiScopeLabel('teams.write')).toString(),
      Role.label(apiScopeLabel('users.read')).toString(),
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

  test('lists memberships with the envelope and readable user identity', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })
    state.collection('users').set('user_a', seedUser('user_a', 'Ada Lovelace', 'ada@example.com'))
    await service.create(state.documents, SESSION_AUTH, { name: 'Core Team' })

    const result = await service.listMemberships(state.documents, 'team_a', 25, 0)

    expect(result.meta).toEqual({ total: 1, limit: 25, offset: 0 })
    expect(result.data).toEqual([
      {
        $id: 'membership_a',
        userId: 'user_a',
        userName: 'Ada Lovelace',
        email: 'ada@example.com',
        roles: ['owner'],
        status: 'accepted',
        invited: NOW.toISOString(),
        joined: NOW.toISOString(),
      },
    ])
  })

  test('omits user identity the caller cannot read and unjoined timestamps', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })
    await service.create(state.documents, SESSION_AUTH, { name: 'Core Team' })
    state.collection('memberships').set(
      'membership_pending',
      stored(
        new Doc({
          $id: 'membership_pending',
          userId: 'user_ghost',
          teamId: 'team_a',
          roles: ['viewer'],
          status: 'invited',
          invited: NOW,
        }),
      ),
    )

    const [member, pending] = await Promise.all([
      service.getMembership(state.documents, 'team_a', 'membership_a'),
      service.getMembership(state.documents, 'team_a', 'membership_pending'),
    ])

    expect(member).not.toHaveProperty('userName')
    expect(member).not.toHaveProperty('email')
    expect(pending).not.toHaveProperty('joined')
    expect(pending.status).toBe('invited')
  })

  test('uses membership_not_found for missing and mismatched memberships', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a', 'team_b', 'membership_b']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })
    await service.create(state.documents, SESSION_AUTH, { name: 'A' })
    await service.create(state.documents, API_WRITE_AUTH, { name: 'B' })

    const missing = await service
      .getMembership(state.documents, 'team_a', 'missing')
      .catch((error: unknown) => error)
    expect((missing as { status: number }).status).toBe(404)
    expect((missing as { fields: { code?: string } }).fields.code).toBe('membership_not_found')

    const mismatched = await service
      .getMembership(state.documents, 'team_a', 'membership_b')
      .catch((error: unknown) => error)
    expect((mismatched as { fields: { code?: string } }).fields.code).toBe('membership_not_found')

    const missingTeam = await service
      .listMemberships(state.documents, 'missing', 25, 0)
      .catch((error: unknown) => error)
    expect((missingTeam as { fields: { code?: string } }).fields.code).toBe('team_not_found')
  })

  test('updates roles for API keys and team owners', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })
    await service.create(state.documents, SESSION_AUTH, { name: 'Core Team' })

    const byKey = await service.updateMembershipRoles(
      state.documents,
      'team_a',
      'membership_a',
      API_WRITE_AUTH,
      { roles: ['viewer', 'owner'] },
    )
    const byOwner = await service.updateMembershipRoles(
      state.documents,
      'team_a',
      'membership_a',
      OWNER_AUTH,
      { roles: [] },
    )

    expect(byKey.roles).toEqual(['owner', 'viewer'])
    expect(byOwner.roles).toEqual([])
    expect(state.collection('memberships').get('membership_a')!.get('roles')).toEqual([])
  })

  test('rejects role changes by non-owner sessions and guests', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })
    await service.create(state.documents, SESSION_AUTH, { name: 'Core Team' })

    const asMember = await service
      .updateMembershipRoles(state.documents, 'team_a', 'membership_a', MEMBER_AUTH, {
        roles: ['owner'],
      })
      .catch((error: unknown) => error)
    expect((asMember as { status: number }).status).toBe(403)
    expect(state.collection('memberships').get('membership_a')!.get('roles')).toEqual(['owner'])

    const asGuest = await service
      .updateMembershipRoles(
        state.documents,
        'team_a',
        'membership_a',
        {
          type: 'guest',
        },
        { roles: ['owner'] },
      )
      .catch((error: unknown) => error)
    expect((asGuest as { status: number }).status).toBe(403)
  })

  test('rejects invalid role values before any write', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })
    await service.create(state.documents, SESSION_AUTH, { name: 'Core Team' })

    const failure = await service
      .updateMembershipRoles(state.documents, 'team_a', 'membership_a', API_WRITE_AUTH, {
        roles: ['bad role!'],
      })
      .catch((error: unknown) => error)

    expect((failure as { status: number }).status).toBe(400)
    expect(state.collection('memberships').get('membership_a')!.get('roles')).toEqual(['owner'])
  })

  test('removes an accepted membership and decrements the team total', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })
    await service.create(state.documents, SESSION_AUTH, { name: 'Core Team' })

    await service.removeMembership(state.documents, 'team_a', 'membership_a', API_WRITE_AUTH)

    expect(state.collection('memberships').size).toBe(0)
    expect(state.collection('teams').get('team_a')!.get('total')).toBe(0)
  })

  test('keeps the team total for unaccepted memberships and honors removal authority', async () => {
    const state = harness()
    const ids = ['team_a', 'membership_a']
    const service = createTeamService({
      id: () => ids.shift()!,
      now: () => NOW,
    })
    await service.create(state.documents, SESSION_AUTH, { name: 'Core Team' })
    state.collection('memberships').set(
      'membership_pending',
      stored(
        new Doc({
          $id: 'membership_pending',
          userId: 'user_b',
          teamId: 'team_a',
          roles: ['viewer'],
          status: 'invited',
          invited: NOW,
        }),
      ),
    )

    const asMember = await service
      .removeMembership(state.documents, 'team_a', 'membership_pending', MEMBER_AUTH)
      .catch((error: unknown) => error)
    expect((asMember as { status: number }).status).toBe(403)

    await service.removeMembership(state.documents, 'team_a', 'membership_pending', OWNER_AUTH)

    expect(state.collection('memberships').size).toBe(1)
    expect(state.collection('teams').get('team_a')!.get('total')).toBe(1)

    const missing = await service
      .removeMembership(state.documents, 'team_a', 'membership_pending', API_WRITE_AUTH)
      .catch((error: unknown) => error)
    expect((missing as { fields: { code?: string } }).fields.code).toBe('membership_not_found')
  })
})
