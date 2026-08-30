import { describe, expect, test } from 'bun:test'
import { Doc, type Query, QueryType } from '@nuvix/db'
import type { UserDocuments } from '../src/users/documents'
import { createUserService } from '../src/users/service'

const NOW = new Date('2026-08-30T10:00:00.000Z')

function matches(document: Doc, queries: Query[] = []): boolean {
  return queries
    .filter((query) => query.getMethod() === QueryType.Equal)
    .every((query) => query.getValues().includes(document.get(query.getAttribute()) as never))
}

function harness() {
  const users = new Map<string, Doc>()
  const documents: UserDocuments = {
    find: async (_collection, queries) =>
      [...users.values()].filter((user) => matches(user, queries)),
    findOne: async (_collection, queries) =>
      [...users.values()].find((user) => matches(user, queries)) ?? new Doc(),
    count: async (_collection, queries) =>
      [...users.values()].filter((user) => matches(user, queries)).length,
    get: async (_collection, id) => users.get(id) ?? new Doc(),
    create: async (_collection, document) => {
      const created = new Doc({
        ...document.getAll(),
        $createdAt: NOW,
        $updatedAt: NOW,
      })
      users.set(created.getId(), created)
      return created
    },
    update: async (_collection, id, changes) => {
      const current = users.get(id)
      if (!current) return new Doc()
      const updated = new Doc({
        ...current.getAll(),
        ...changes.getAll(),
        $updatedAt: NOW,
      })
      users.set(id, updated)
      return updated
    },
  }
  return { documents, users }
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
})
