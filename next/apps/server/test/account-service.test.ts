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

  test('creates anonymous session and permits setting initial password without oldPassword', async () => {
    const docs = memoryDocuments()
    const session = await service.createAnonymousSession(docs)

    expect(session.userId).toBeDefined()
    expect(session.token).toBeDefined()
    expect(docs.users.has(session.userId)).toBe(true)

    const user = docs.users.get(session.userId)
    expect(user?.get('status')).toBe(true)
    expect(user?.get('passwordHash')).toBeNull()

    // Anonymous user can set initial password with no oldPassword
    const updatedUser = await service.updatePassword(docs, session.userId, {
      password: 'brand-new-password-123',
    })
    expect(updatedUser.$id).toBe(session.userId)
    const storedWithPassword = docs.users.get(session.userId)
    expect(storedWithPassword?.get('passwordHash')).toStartWith('$argon2id$')
  })

  test('creates tenant JWT with active session and signing key bootstrap', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'password123',
    })
    const session = await service.createEmailSession(docs, {
      email: 'user@example.com',
      password: 'password123',
    })

    const jwtRes = await service.createJWT(docs, 'project_a', 'user_1', session.$id)
    expect(jwtRes.jwt).toBeDefined()
    expect(typeof jwtRes.jwt).toBe('string')
    expect(jwtRes.jwt.split('.')).toHaveLength(3)

    expect(docs.jwtKeys.size).toBe(1)
    const storedKey = [...docs.jwtKeys.values()][0]!
    expect(storedKey.get('active')).toBe(true)
    expect(storedKey.get('signingKey')).toBeDefined()

    const rotateRes = await service.rotateSigningKey(docs)
    expect(rotateRes.secret).toBeDefined()
    const updatedPriorKey = docs.jwtKeys.get(storedKey.getId())
    expect(updatedPriorKey?.get('active')).toBe(false)
    expect(updatedPriorKey?.get('expiresAt')).toBeDefined()
  })

  test('updates phone number with password confirmation', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'password123',
    })

    const updated = await service.updatePhone(docs, 'user_1', {
      phone: '+1234567890',
      password: 'password123',
    })
    expect(updated.phone).toBe('+1234567890')
    expect(updated.phoneVerification).toBe(false)
  })

  test('updates account status and revokes sessions when disabled', async () => {
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

    const updated = await service.updateStatus(docs, 'user_1', false)
    expect(updated.status).toBe(false)

    const sessions = await service.listSessions(docs, 'user_1')
    expect(sessions.data).toHaveLength(0)
  })

  test('creates magic URL token and confirms session', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'password123',
    })

    const token = await service.createMagicUrlToken(docs, 'user_1')
    expect(token.secret).toBeDefined()
    expect(token.userId).toBe('user_1')

    const session = await service.confirmMagicUrlSession(docs, 'user_1', token.secret)
    expect(session.userId).toBe('user_1')
    expect(session.token).toStartWith('ses_v1.')
  })

  test('creates phone OTP token and confirms session', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'password123',
    })

    const token = await service.createPhoneToken(docs, 'user_1')
    expect(token.secret).toHaveLength(6)

    const session = await service.confirmPhoneSession(docs, 'user_1', token.secret)
    expect(session.userId).toBe('user_1')
  })

  test('email verification token flow marks email as verified', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'password123',
    })

    const token = await service.createVerification(docs, 'user_1')
    expect(token.secret).toBeDefined()

    await service.confirmVerification(docs, 'user_1', token.secret)
    const user = await service.get(docs, 'user_1')
    expect(user.emailVerification).toBe(true)
  })

  test('password recovery flow resets password and allows login with new password', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'password123',
    })

    const token = await service.createPasswordRecovery(docs, 'user@example.com')
    expect(token.secret).toBeDefined()

    await service.confirmPasswordRecovery(docs, 'user_1', token.secret, 'new-password-456')

    const session = await service.createEmailSession(docs, {
      email: 'user@example.com',
      password: 'new-password-456',
    })
    expect(session.userId).toBe('user_1')
  })

  test('full MFA lifecycle: factors, authenticator enrollment, recovery codes, and challenge', async () => {
    const docs = memoryDocuments()
    await service.register(docs, {
      userId: 'user_1',
      email: 'user@example.com',
      password: 'password123',
    })

    const initialFactors = await service.getMfaFactors(docs, 'user_1')
    expect(initialFactors.totp).toBe(false)
    expect(initialFactors.recoveryCodes).toBe(false)

    // Create TOTP authenticator
    const auth = await service.createMfaAuthenticator(docs, 'user_1', 'totp', 'TestProject')
    expect(auth.type).toBe('totp')
    expect(auth.secret).toBeDefined()
    expect(auth.uri).toStartWith('otpauth://totp/')

    // Generate valid TOTP token for verification
    const { generateTotp } = await import('../src/utils/totp')
    const code = await generateTotp(auth.secret)

    // Verify authenticator
    const verifiedUser = await service.verifyMfaAuthenticator(docs, 'user_1', 'totp', code)
    expect(verifiedUser.mfa).toBe(true)

    // Recovery codes
    const recoveryRes = await service.createMfaRecoveryCodes(docs, 'user_1')
    expect(recoveryRes.recoveryCodes).toHaveLength(10)

    const factorsAfter = await service.getMfaFactors(docs, 'user_1')
    expect(factorsAfter.totp).toBe(true)
    expect(factorsAfter.recoveryCodes).toBe(true)

    // Challenge flow with TOTP
    const challenge = await service.createMfaChallenge(docs, 'user_1', 'totp')
    expect(challenge.factor).toBe('totp')

    const newCode = await generateTotp(auth.secret)
    const success = await service.verifyMfaChallenge(docs, 'user_1', newCode, challenge.$id)
    expect(success).toBe(true)

    // Challenge flow with recovery code
    const recoveryCode = recoveryRes.recoveryCodes[0]!
    const recSuccess = await service.verifyMfaChallenge(docs, 'user_1', recoveryCode)
    expect(recSuccess).toBe(true)

    const remainingCodes = await service.getMfaRecoveryCodes(docs, 'user_1')
    expect(remainingCodes.recoveryCodes).toHaveLength(9)
  })
})
