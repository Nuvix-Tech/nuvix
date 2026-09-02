import { describe, expect, test } from 'bun:test'
import { Doc, type Query, QueryType, Role } from '@nuvix/db'
import { apiScopeLabel } from '../src/context/database-roles'
import type { UserDocuments } from '../src/users/documents'
import { createUserService } from '../src/users/service'

const NOW = new Date('2026-08-30T10:00:00.000Z')

function matches(document: Doc, queries: Query[] = []): boolean {
  return queries
    .filter((query) => query.getMethod() === QueryType.Equal)
    .every((query) => query.getValues().includes(document.get(query.getAttribute()) as never))
}

function stored(document: Doc): Doc {
  return new Doc({
    ...document.getAll(),
    $createdAt: document.createdAt() ?? NOW,
    $updatedAt: document.updatedAt() ?? NOW,
  })
}

function harness() {
  const collections = new Map<string, Map<string, Doc>>()
  const collection = (id: string) => {
    const existing = collections.get(id) ?? new Map<string, Doc>()
    collections.set(id, existing)
    return existing
  }
  const users = collection('users')
  const documents: UserDocuments = {
    find: async (collectionId, queries) =>
      [...collection(collectionId).values()].filter((doc) => matches(doc, queries)),
    findOne: async (collectionId, queries) =>
      [...collection(collectionId).values()].find((doc) => matches(doc, queries)) ?? new Doc(),
    count: async (collectionId, queries) =>
      [...collection(collectionId).values()].filter((doc) => matches(doc, queries)).length,
    get: async (collectionId, id) => collection(collectionId).get(id) ?? new Doc(),
    create: async (collectionId, document) => {
      const created = stored(document)
      collection(collectionId).set(created.getId(), created)
      return created
    },
    update: async (collectionId, id, changes) => {
      const current = collection(collectionId).get(id)
      if (!current) return new Doc()
      const updated = stored(new Doc({ ...current.getAll(), ...changes.getAll() }))
      collection(collectionId).set(id, updated)
      return updated
    },
  }
  return { documents, users, collection }
}

function seedMembership(
  state: ReturnType<typeof harness>,
  id: string,
  userId: string,
  teamId: string,
  extra: Record<string, unknown> = {},
): void {
  state.collection('memberships').set(
    id,
    stored(
      new Doc({
        $id: id,
        userId,
        teamId,
        roles: ['owner'],
        status: 'accepted',
        invited: NOW,
        joined: NOW,
        ...extra,
      }),
    ),
  )
}

describe('users service', () => {
  test('creates a credentialless user with normalized identity and safe defaults', async () => {
    const state = harness()
    const service = createUserService({ id: () => 'user_a' })

    const user = await service.create(state.documents, {
      email: '  ADA@Example.COM ',
      name: 'Ada Lovelace',
    })

    expect(user).toMatchObject({
      $id: 'user_a',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      status: true,
      labels: [],
      prefs: {},
      emailVerification: false,
      phoneVerification: false,
    })
    expect(state.users.get('user_a')?.get('password')).toBeNull()
  })

  test('grants team scopes read access to user documents for membership projection', async () => {
    const state = harness()
    const service = createUserService({ id: () => 'user_a' })
    await service.create(state.documents, { email: 'ada@example.com' })

    expect(state.users.get('user_a')?.getRead()).toEqual([
      Role.user('user_a').toString(),
      Role.label(apiScopeLabel('teams.read')).toString(),
      Role.label(apiScopeLabel('teams.write')).toString(),
    ])
  })

  test('rejects empty identity and duplicate normalized email', async () => {
    const state = harness()
    const ids = ['user_a', 'user_b']
    const service = createUserService({ id: () => ids.shift()! })

    const empty = await service
      .create(state.documents, { name: 'Name only' })
      .catch((error) => error)
    await service.create(state.documents, { email: 'ada@example.com' })
    const duplicate = await service
      .create(state.documents, { email: 'ADA@EXAMPLE.COM' })
      .catch((error) => error)

    expect((empty as { status: number }).status).toBe(400)
    expect((duplicate as { fields: { code?: string } }).fields.code).toBe('user_email_exists')
  })

  test('lists users with exact filters and pagination metadata', async () => {
    const state = harness()
    const ids = ['user_a', 'user_b']
    const service = createUserService({ id: () => ids.shift()! })
    await service.create(state.documents, { email: 'ada@example.com' })
    await service.create(state.documents, { phone: '+16175551212' })

    const result = await service.list(state.documents, { email: 'ADA@example.com' }, 25, 0)

    expect(result.data.map(({ $id }) => $id)).toEqual(['user_a'])
    expect(result.meta).toEqual({ total: 1, limit: 25, offset: 0 })
  })

  test('updates profile fields, resets verification, and replaces prefs and labels', async () => {
    const state = harness()
    const service = createUserService({ id: () => 'user_a' })
    await service.create(state.documents, { email: 'old@example.com' })
    state.users.get('user_a')!.set('emailVerified', true).set('phoneVerified', true)

    await service.updateName(state.documents, 'user_a', 'Ada')
    await service.updateEmail(state.documents, 'user_a', 'NEW@EXAMPLE.COM')
    await service.updatePhone(state.documents, 'user_a', '+16175551212')
    await service.updatePrefs(state.documents, 'user_a', { theme: 'dark' })
    const user = await service.updateLabels(state.documents, 'user_a', ['staff', 'staff', 'beta'])

    expect(user).toMatchObject({
      name: 'Ada',
      email: 'new@example.com',
      phone: '+16175551212',
      emailVerification: false,
      phoneVerification: false,
      prefs: { theme: 'dark' },
      labels: ['staff', 'beta'],
    })
  })

  test('blocking a user updates the auth-critical status field', async () => {
    const state = harness()
    const service = createUserService({ id: () => 'user_a' })
    await service.create(state.documents, { userId: 'user_a' })

    const blocked = await service.updateStatus(state.documents, 'user_a', false)

    expect(blocked.status).toBe(false)
    expect(state.users.get('user_a')?.get('status')).toBe(false)
  })

  test('rejects reserved labels and returns stable missing-user errors', async () => {
    const state = harness()
    const service = createUserService()

    const missing = await service.get(state.documents, 'missing').catch((error) => error)
    const reserved = await service
      .updateLabels(state.documents, 'missing', ['nxsreserved'])
      .catch((error) => error)

    expect((missing as { fields: { code?: string } }).fields.code).toBe('user_not_found')
    expect((reserved as { status: number }).status).toBe(400)
  })

  test('lists user memberships with the team projection', async () => {
    const state = harness()
    const service = createUserService({ id: () => 'user_a' })
    await service.create(state.documents, {
      userId: 'user_a',
      email: 'ada@example.com',
    })
    state
      .collection('teams')
      .set('team_a', stored(new Doc({ $id: 'team_a', name: 'Design', total: 1, prefs: {} })))
    seedMembership(state, 'membership_a', 'user_a', 'team_a')

    const result = await service.listMemberships(state.documents, 'user_a', 25, 0)

    expect(result.meta).toEqual({ total: 1, limit: 25, offset: 0 })
    expect(result.data).toEqual([
      {
        $id: 'membership_a',
        teamId: 'team_a',
        teamName: 'Design',
        roles: ['owner'],
        status: 'accepted',
        invited: NOW.toISOString(),
        joined: NOW.toISOString(),
      },
    ])
  })

  test('omits unjoined timestamps and unreadable team names', async () => {
    const state = harness()
    const service = createUserService({ id: () => 'user_a' })
    await service.create(state.documents, { userId: 'user_a' })
    seedMembership(state, 'membership_pending', 'user_a', 'team_ghost', {
      status: 'invited',
      roles: ['viewer'],
      joined: null,
    })

    const result = await service.listMemberships(state.documents, 'user_a', 25, 0)

    expect(result.data).toEqual([
      {
        $id: 'membership_pending',
        teamId: 'team_ghost',
        roles: ['viewer'],
        status: 'invited',
        invited: NOW.toISOString(),
      },
    ])
  })

  test('reports user_not_found before projecting memberships', async () => {
    const state = harness()
    const service = createUserService()

    const failure = await service
      .listMemberships(state.documents, 'missing', 25, 0)
      .catch((error) => error)

    expect((failure as { fields: { code?: string } }).fields.code).toBe('user_not_found')
  })
})
