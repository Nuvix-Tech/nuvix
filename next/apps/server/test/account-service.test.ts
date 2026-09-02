import { describe, expect, test } from 'bun:test'
import { Doc } from '@nuvix/db'
import { createAccountService } from '../src/account/service'
import { ConflictError, NotFoundError, UnauthorizedError } from '../src/shared/errors'

import { memoryDocuments } from './helpers/memory-documents'

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
