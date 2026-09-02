import { describe, expect, test } from 'bun:test'
import { Doc, type Query } from '@nuvix/db'
import type { AccountDocuments } from '../src/account/documents'
import { createAccountService } from '../src/account/service'
import { ConflictError, NotFoundError, UnauthorizedError } from '../src/shared/errors'

function memoryDocuments(): AccountDocuments & {
  readonly users: Map<string, Doc>
  readonly sessions: Map<string, Doc>
  readonly memberships: Map<string, Doc>
  readonly teamTotals: Map<string, number>
} {
  const users = new Map<string, Doc>()
  const sessions = new Map<string, Doc>()
  const memberships = new Map<string, Doc>()
  const teamTotals = new Map<string, number>()

  const self: AccountDocuments = {
    getUser: async (id: string) => users.get(id) ?? new Doc(),
    findUsers: async (queries: Query[] = []) => {
      const all = [...users.values()]
      let result = all
      for (const q of queries) {
        if (q.getMethod() === 'equal' && q.getAttribute() === 'email') {
          const target = (q.getValues() as string[])[0]
          result = result.filter((u) => u.get('email') === target)
        }
      }
      return result
    },
    createUser: async (doc: Doc) => {
      users.set(doc.getId(), doc)
      return doc
    },
    updateUser: async (id: string, doc: Doc) => {
      const existing = users.get(id) ?? new Doc({ $id: id })
      const merged = new Doc({ ...existing.getAll(), ...doc.getAll(), $id: id })
      users.set(id, merged)
      return merged
    },
    deleteUser: async (id: string) => users.delete(id),

    getSession: async (id: string) => sessions.get(id) ?? new Doc(),
    findSessions: async (queries: Query[] = []) => {
      let result = [...sessions.values()]
      for (const q of queries) {
        if (q.getMethod() === 'equal' && q.getAttribute() === 'userId') {
          const target = (q.getValues() as string[])[0]
          result = result.filter((s) => s.get('userId') === target)
        }
        if (q.getMethod() === 'isNull' && q.getAttribute() === 'revokedAt') {
          result = result.filter(
            (s) => s.get('revokedAt') === null || s.get('revokedAt') === undefined,
          )
        }
      }
      return result
    },
    countSessions: async (queries: Query[] = []) => {
      const res = await self.findSessions(queries)
      return res.length
    },
    createSession: async (doc: Doc) => {
      sessions.set(doc.getId(), doc)
      return doc
    },
    updateSession: async (id: string, doc: Doc) => {
      const existing = sessions.get(id) ?? new Doc({ $id: id })
      const merged = new Doc({ ...existing.getAll(), ...doc.getAll(), $id: id })
      sessions.set(id, merged)
      return merged
    },
    deleteSession: async (id: string) => sessions.delete(id),

    findMemberships: async (queries: Query[] = []) => {
      let result = [...memberships.values()]
      for (const q of queries) {
        if (q.getMethod() === 'equal' && q.getAttribute() === 'userId') {
          const target = (q.getValues() as string[])[0]
          result = result.filter((m) => m.get('userId') === target)
        }
      }
      return result
    },
    deleteMembership: async (id: string) => memberships.delete(id),
    decreaseTeamTotal: async (teamId: string) => {
      const current = teamTotals.get(teamId) ?? 1
      const next = Math.max(0, current - 1)
      teamTotals.set(teamId, next)
      return new Doc({ $id: teamId, total: next })
    },

    transaction: async <Result>(op: (docs: AccountDocuments) => Promise<Result>) => op(self),
  }

  return {
    ...self,
    users,
    sessions,
    memberships,
    teamTotals,
  }
}

describe('account service', () => {
  const service = createAccountService({
    now: () => new Date('2026-09-02T12:00:00.000Z'),
  })

  test('registers new user with argon2id hash and strips sensitive fields from response', async () => {
    const docs = memoryDocuments()
    const user = await service.register(docs, {
      userId: 'user_1',
      email: 'Jane.Doe@Example.COM',
      password: 'super-secure-password',
      name: 'Jane Doe',
    })

    expect(user.$id).toBe('user_1')
    expect(user.email).toBe('jane.doe@example.com')
    expect(user.name).toBe('Jane Doe')
    expect(user.status).toBe(true)
    expect((user as unknown as Record<string, unknown>).password).toBeUndefined()
    expect((user as unknown as Record<string, unknown>).passwordHash).toBeUndefined()

    const stored = docs.users.get('user_1')
    expect(stored).toBeDefined()
    expect(stored!.get('passwordHash')).toStartWith('$argon2id$')
  })

  test('rejects duplicate email or duplicate user id on registration', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'test@example.com',
      password: 'password123',
    })

    expect(
      service.register(docs, {
        userId: 'user_2',
        email: 'test@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow(ConflictError)

    expect(
      service.register(docs, {
        userId: 'user_1',
        email: 'other@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow(ConflictError)
  })

  test('creates email session with valid credentials and returns session token', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'correct-password',
    })

    const session = await service.createEmailSession(docs, {
      email: 'user@example.com',
      password: 'correct-password',
    })

    expect(session.userId).toBe('user_1')
    expect(session.token).toBeDefined()
    expect(session.token).toStartWith('ses_v1.')
    expect(session.expiresAt).toBe('2026-10-02T12:00:00.000Z')

    const stored = docs.sessions.get(session.$id)
    expect(stored).toBeDefined()
    expect(stored!.get('secretDigest')).toBeDefined()
    expect(stored!.get('secretSalt')).toBeDefined()
  })

  test('rejects login on invalid password, unknown email, or disabled user', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'correct-password',
    })

    expect(
      service.createEmailSession(docs, {
        email: 'user@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toThrow(UnauthorizedError)

    expect(
      service.createEmailSession(docs, {
        email: 'unknown@example.com',
        password: 'correct-password',
      }),
    ).rejects.toThrow(UnauthorizedError)

    // Disable user
    await docs.updateUser('user_1', new Doc({ status: false }))
    expect(
      service.createEmailSession(docs, {
        email: 'user@example.com',
        password: 'correct-password',
      }),
    ).rejects.toThrow(UnauthorizedError)
  })

  test('lists active sessions and retrieves specific session', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'correct-password',
    })

    const sessionA = await service.createEmailSession(docs, {
      email: 'user@example.com',
      password: 'correct-password',
    })
    await service.createEmailSession(docs, {
      email: 'user@example.com',
      password: 'correct-password',
    })

    const list = await service.listSessions(docs, 'user_1')
    expect(list.meta.total).toBe(2)
    expect(list.data.length).toBe(2)
    expect(list.data[0]!.token).toBeUndefined()

    const fetched = await service.getSession(docs, 'user_1', sessionA.$id)
    expect(fetched.$id).toBe(sessionA.$id)
    expect(fetched.token).toBeUndefined()
  })

  test('deletes specific session and deletes all sessions', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'correct-password',
    })

    const sessionA = await service.createEmailSession(docs, {
      email: 'user@example.com',
      password: 'correct-password',
    })
    await service.createEmailSession(docs, {
      email: 'user@example.com',
      password: 'correct-password',
    })

    await service.deleteSession(docs, 'user_1', sessionA.$id)
    expect(service.getSession(docs, 'user_1', sessionA.$id)).rejects.toThrow(NotFoundError)

    const listAfterOne = await service.listSessions(docs, 'user_1')
    expect(listAfterOne.meta.total).toBe(1)

    await service.deleteSessions(docs, 'user_1')
    const listAfterAll = await service.listSessions(docs, 'user_1')
    expect(listAfterAll.meta.total).toBe(0)
  })

  test('updates password, verifies old password, and revokes other sessions', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'old-password-123',
    })

    const sessionA = await service.createEmailSession(docs, {
      email: 'user@example.com',
      password: 'old-password-123',
    })
    const sessionB = await service.createEmailSession(docs, {
      email: 'user@example.com',
      password: 'old-password-123',
    })

    expect(
      service.updatePassword(docs, 'user_1', {
        password: 'new-password-123',
        oldPassword: 'wrong-old-password',
      }),
    ).rejects.toThrow(UnauthorizedError)

    await service.updatePassword(
      docs,
      'user_1',
      {
        password: 'new-password-123',
        oldPassword: 'old-password-123',
      },
      sessionA.$id,
    )

    // sessionA kept alive, sessionB revoked
    expect(docs.sessions.get(sessionA.$id)!.get('revokedAt')).toBeNull()
    expect(docs.sessions.get(sessionB.$id)!.get('revokedAt')).toBeDefined()

    // Can log in with new password
    const newSession = await service.createEmailSession(docs, {
      email: 'user@example.com',
      password: 'new-password-123',
    })
    expect(newSession.token).toBeDefined()
  })

  test('updates email with password verification and rejects email conflicts', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'first@example.com',
      password: 'password123',
    })
    await service.register(docs, {
      userId: 'user_2',
      email: 'second@example.com',
      password: 'password123',
    })

    expect(
      service.updateEmail(docs, 'user_1', {
        email: 'new@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toThrow(UnauthorizedError)

    expect(
      service.updateEmail(docs, 'user_1', {
        email: 'second@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow(ConflictError)

    const updated = await service.updateEmail(docs, 'user_1', {
      email: 'new@example.com',
      password: 'password123',
    })
    expect(updated.email).toBe('new@example.com')
    expect(updated.emailVerification).toBe(false)
  })

  test('deletes account and cascades cleanup of memberships and sessions', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'password123',
    })

    await service.createEmailSession(docs, {
      email: 'user@example.com',
      password: 'password123',
    })

    docs.memberships.set(
      'memb_1',
      new Doc({
        $id: 'memb_1',
        userId: 'user_1',
        teamId: 'team_1',
        status: 'accepted',
      }),
    )
    docs.teamTotals.set('team_1', 1)

    await service.deleteAccount(docs, 'user_1')

    expect(docs.users.has('user_1')).toBe(false)
    expect(docs.sessions.size).toBe(0)
    expect(docs.memberships.has('memb_1')).toBe(false)
    expect(docs.teamTotals.get('team_1')).toBe(0)
  })
})
