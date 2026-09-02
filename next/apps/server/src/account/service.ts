import { Doc, ID, Permission, Query, Role } from '@nuvix/db'
import { createCredentialToken, createSecretVerifier } from '../context/credential-secret'
import { apiScopeLabel } from '../context/database-roles'
import { TENANT_AUTH_MODEL } from '../context/tenant-auth-model'
import { translatePackageError } from '../infrastructure/package-errors'
import { AppError, ConflictError, NotFoundError, UnauthorizedError } from '../shared/errors'
import type { TeamPreferences } from '../teams/service'
import type { UserResponse } from '../users/service'
import { signJwt } from '../utils/jwt'
import { hashPassword, verifyPassword } from '../utils/passwords'
import type { JwtResponse } from './contracts'
import type { AccountDocuments } from './documents'

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface SessionResponse {
  readonly $id: string
  readonly userId: string
  readonly token?: string
  readonly expiresAt: string
  readonly $createdAt: string
  readonly $updatedAt: string
}

export interface SessionList {
  data: SessionResponse[]
  meta: { total: number; limit: number; offset: number }
}

export interface RegisterInput {
  readonly userId?: string
  readonly email: string
  readonly password: string
  readonly name?: string
}

export interface LoginInput {
  readonly email: string
  readonly password: string
}

export interface UpdatePasswordInput {
  readonly password: string
  readonly oldPassword?: string
}

export interface UpdateEmailInput {
  readonly email: string
  readonly password: string
}

export interface AccountServiceOptions {
  readonly id?: () => string
  readonly now?: () => Date
}

function iso(value: Date | string | null | undefined): string {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return new Date(0).toISOString()
  return date.toISOString()
}

function strings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []
}

function preferences(value: unknown): TeamPreferences {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as TeamPreferences)
    : {}
}

function userResponse(document: Doc): UserResponse {
  const fields = TENANT_AUTH_MODEL.fields.users
  const createdAt = iso(document.createdAt())
  const result: UserResponse = {
    $id: document.getId(),
    status: document.get(fields.status, false),
    labels: strings(document.get(fields.labels, [])),
    prefs: preferences(document.get(fields.prefs, {})),
    emailVerification: document.get(fields.emailVerified, false),
    phoneVerification: document.get(fields.phoneVerified, false),
    registration: createdAt,
    $createdAt: createdAt,
    $updatedAt: iso(document.updatedAt()),
  }
  const name: unknown = document.get(fields.name)
  const email: unknown = document.get(fields.email)
  const phone: unknown = document.get(fields.phone)
  if (typeof name === 'string') result.name = name
  if (typeof email === 'string') result.email = email
  if (typeof phone === 'string') result.phone = phone
  return Object.freeze(result)
}

function sessionResponse(document: Doc, token?: string): SessionResponse {
  const sessionFields = TENANT_AUTH_MODEL.fields.sessions
  const expiresAt = document.get(sessionFields.expiresAt)
  const result: SessionResponse = {
    $id: document.getId(),
    userId: document.get(sessionFields.userId, ''),
    expiresAt: iso(expiresAt),
    $createdAt: iso(document.createdAt()),
    $updatedAt: iso(document.updatedAt()),
    ...(token ? { token } : {}),
  }
  return Object.freeze(result)
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase()
}

function userNotFound(): NotFoundError {
  return new NotFoundError('User', {
    code: 'user_not_found',
    messageKey: 'errors.users.notFound',
  })
}

function sessionNotFound(): NotFoundError {
  return new NotFoundError('Session', {
    code: 'session_not_found',
    messageKey: 'errors.users.sessionNotFound',
  })
}

function userEmailExists(): ConflictError {
  return new ConflictError('A user with this email already exists.', {
    code: 'user_email_exists',
    messageKey: 'errors.users.emailExists',
  })
}

function userAlreadyExists(): ConflictError {
  return new ConflictError('User already exists.', {
    code: 'user_already_exists',
    messageKey: 'errors.users.alreadyExists',
  })
}

function userBlocked(): UnauthorizedError {
  return new UnauthorizedError('The current user has been blocked.', {
    code: 'user_blocked',
    messageKey: 'errors.users.blocked',
  })
}

function invalidCredentials(): UnauthorizedError {
  return new UnauthorizedError('Invalid credentials.', {
    code: 'invalid_credentials',
    messageKey: 'errors.unauthorized',
  })
}

export function userSessionAlreadyExists(): ConflictError {
  return new ConflictError('User session already exists.', {
    code: 'user_session_already_exists',
    messageKey: 'errors.users.sessionAlreadyExists',
  })
}

async function operation<Result>(name: string, run: () => Promise<Result>): Promise<Result> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof AppError) throw error
    throw translatePackageError(error, { operation: name })
  }
}

function userPermissions(userId: string) {
  return [
    Permission.read(Role.user(userId)),
    Permission.read(Role.label(apiScopeLabel('teams.read'))),
    Permission.read(Role.label(apiScopeLabel('teams.write'))),
    Permission.update(Role.user(userId)),
    Permission.delete(Role.user(userId)),
  ]
}

async function getOrGenerateSigningKey(
  documents: AccountDocuments,
  now: Date,
  createId: () => string,
): Promise<string> {
  const jwtFields = TENANT_AUTH_MODEL.fields.jwtKeys
  const keys = await documents.findJwtKeys([Query.equal(jwtFields.active, [true]), Query.limit(1)])
  const firstKey = keys[0]
  if (firstKey) {
    const existingSecret = firstKey.get(jwtFields.signingKey)
    if (typeof existingSecret === 'string' && existingSecret.length > 0) {
      return existingSecret
    }
  }

  const secretBytes = crypto.getRandomValues(new Uint8Array(32))
  const secret = Buffer.from(secretBytes).toString('base64url')
  const keyId = createId()
  await documents.createJwtKey(
    new Doc({
      $id: keyId,
      [jwtFields.signingKey]: secret,
      [jwtFields.algorithm]: 'HS256',
      [jwtFields.active]: true,
      $createdAt: now,
      $updatedAt: now,
    }),
  )
  return secret
}

async function rotateTenantSigningKey(
  documents: AccountDocuments,
  now: Date,
  createId: () => string,
): Promise<string> {
  const jwtFields = TENANT_AUTH_MODEL.fields.jwtKeys
  const activeKeys = await documents.findJwtKeys([Query.equal(jwtFields.active, [true])])
  const retireExpiration = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  for (const k of activeKeys) {
    await documents.updateJwtKey(
      k.getId(),
      new Doc({
        [jwtFields.active]: false,
        [jwtFields.expiresAt]: retireExpiration,
      }),
    )
  }

  const secretBytes = crypto.getRandomValues(new Uint8Array(32))
  const secret = Buffer.from(secretBytes).toString('base64url')
  const keyId = createId()
  await documents.createJwtKey(
    new Doc({
      $id: keyId,
      [jwtFields.signingKey]: secret,
      [jwtFields.algorithm]: 'HS256',
      [jwtFields.active]: true,
      $createdAt: now,
      $updatedAt: now,
    }),
  )
  return secret
}

export function createAccountService(options: AccountServiceOptions = {}) {
  const createId = options.id ?? (() => ID.unique())
  const now = options.now ?? (() => new Date())
  const userFields = TENANT_AUTH_MODEL.fields.users
  const sessionFields = TENANT_AUTH_MODEL.fields.sessions
  const membershipFields = TENANT_AUTH_MODEL.fields.memberships

  const self = {
    async register(documents: AccountDocuments, input: RegisterInput): Promise<UserResponse> {
      const email = normalizedEmail(input.email)
      const existing = await operation('check email uniqueness', () =>
        documents.findUsers([Query.equal(userFields.email, [email]), Query.limit(1)]),
      )
      if (existing.length > 0) throw userEmailExists()

      const requestedId = input.userId && input.userId !== 'unique()' ? input.userId : undefined
      if (requestedId) {
        const existingUser = await operation('check user id uniqueness', () =>
          documents.getUser(requestedId),
        )
        if (!existingUser.empty()) throw userAlreadyExists()
      }

      const userId = requestedId ?? createId()
      const timestamp = now()
      const hash = await hashPassword(input.password)

      const created = await operation('register user', () =>
        documents.createUser(
          new Doc({
            $id: userId,
            $permissions: userPermissions(userId),
            [userFields.name]: input.name ?? null,
            [userFields.email]: email,
            [userFields.phone]: null,
            [userFields.status]: true,
            [userFields.emailVerified]: false,
            [userFields.phoneVerified]: false,
            [userFields.labels]: [],
            [userFields.prefs]: {},
            [userFields.passwordHash]: hash,
            [userFields.passwordUpdate]: timestamp,
          }),
        ),
      )
      return userResponse(created)
    },

    async get(documents: AccountDocuments, userId: string): Promise<UserResponse> {
      const user = await operation('get user', () => documents.getUser(userId))
      if (user.empty()) throw userNotFound()
      return userResponse(user)
    },

    async createEmailSession(
      documents: AccountDocuments,
      input: LoginInput,
    ): Promise<SessionResponse> {
      const email = normalizedEmail(input.email)
      const found = await operation('find user by email', () =>
        documents.findUsers([Query.equal(userFields.email, [email]), Query.limit(1)]),
      )
      if (found.length === 0) throw invalidCredentials()

      const user = found[0]!
      if (!user.get(userFields.status, true)) throw invalidCredentials()

      const storedHash: unknown = user.get(userFields.passwordHash)
      if (typeof storedHash !== 'string' || !(await verifyPassword(input.password, storedHash))) {
        throw invalidCredentials()
      }

      const sessionId = createId()
      const secretBytes = crypto.getRandomValues(new Uint8Array(32))
      const verifier = await createSecretVerifier('session', secretBytes)
      const token = createCredentialToken('session', sessionId, secretBytes)
      const expiresAt = new Date(now().getTime() + SESSION_DURATION_MS)

      const session = await operation('create session', () =>
        documents.createSession(
          new Doc({
            $id: sessionId,
            [sessionFields.userId]: user.getId(),
            [sessionFields.secretDigest]: verifier.digest,
            [sessionFields.secretSalt]: verifier.salt,
            [sessionFields.expiresAt]: expiresAt,
            [sessionFields.revokedAt]: null,
          }),
        ),
      )

      return sessionResponse(session, token)
    },

    async createSessionForUser(
      documents: AccountDocuments,
      userId: string,
    ): Promise<SessionResponse> {
      const user = await operation('verify user exists', () => documents.getUser(userId))
      if (user.empty()) throw userNotFound()
      if (!user.get(userFields.status, true)) throw userBlocked()

      const sessionId = createId()
      const secretBytes = crypto.getRandomValues(new Uint8Array(32))
      const verifier = await createSecretVerifier('session', secretBytes)
      const token = createCredentialToken('session', sessionId, secretBytes)
      const expiresAt = new Date(now().getTime() + SESSION_DURATION_MS)

      const session = await operation('create session', () =>
        documents.createSession(
          new Doc({
            $id: sessionId,
            [sessionFields.userId]: user.getId(),
            [sessionFields.secretDigest]: verifier.digest,
            [sessionFields.secretSalt]: verifier.salt,
            [sessionFields.expiresAt]: expiresAt,
            [sessionFields.revokedAt]: null,
          }),
        ),
      )

      return sessionResponse(session, token)
    },

    async listSessions(
      documents: AccountDocuments,
      userId: string,
      limit = 25,
      offset = 0,
    ): Promise<SessionList> {
      const user = await operation('verify user exists', () => documents.getUser(userId))
      if (user.empty()) throw userNotFound()

      const filter = [
        Query.equal(sessionFields.userId, [userId]),
        Query.isNull(sessionFields.revokedAt),
      ]

      const [sessions, total] = await operation('list sessions', () =>
        Promise.all([
          documents.findSessions([
            ...filter,
            Query.orderDesc('$createdAt'),
            Query.orderDesc('$id'),
            Query.limit(limit),
            Query.offset(offset),
          ]),
          documents.countSessions(filter),
        ]),
      )

      return {
        data: sessions.map((item) => sessionResponse(item)),
        meta: { total, limit, offset },
      }
    },

    async getSession(
      documents: AccountDocuments,
      userId: string,
      sessionId: string,
    ): Promise<SessionResponse> {
      const session = await operation('get session', () => documents.getSession(sessionId))
      if (
        session.empty() ||
        session.get(sessionFields.userId) !== userId ||
        session.get(sessionFields.revokedAt) !== null
      ) {
        throw sessionNotFound()
      }
      return sessionResponse(session)
    },

    async deleteSession(
      documents: AccountDocuments,
      userId: string,
      sessionId: string,
    ): Promise<void> {
      const session = await operation('get session for deletion', () =>
        documents.getSession(sessionId),
      )
      if (
        session.empty() ||
        session.get(sessionFields.userId) !== userId ||
        session.get(sessionFields.revokedAt) !== null
      ) {
        throw sessionNotFound()
      }
      await operation('revoke session', () =>
        documents.updateSession(sessionId, new Doc({ [sessionFields.revokedAt]: now() })),
      )
    },

    async deleteSessions(documents: AccountDocuments, userId: string): Promise<void> {
      const user = await operation('verify user for session deletion', () =>
        documents.getUser(userId),
      )
      if (user.empty()) throw userNotFound()

      const sessions = await operation('find active sessions for deletion', () =>
        documents.findSessions([
          Query.equal(sessionFields.userId, [userId]),
          Query.isNull(sessionFields.revokedAt),
        ]),
      )

      const timestamp = now()
      await operation('revoke all sessions', () =>
        Promise.all(
          sessions.map((s) =>
            documents.updateSession(s.getId(), new Doc({ [sessionFields.revokedAt]: timestamp })),
          ),
        ),
      )
    },

    async updatePassword(
      documents: AccountDocuments,
      userId: string,
      input: UpdatePasswordInput,
      currentSessionId?: string,
    ): Promise<UserResponse> {
      const user = await operation('get user for password update', () => documents.getUser(userId))
      if (user.empty()) throw userNotFound()

      const currentHash: unknown = user.get(userFields.passwordHash)
      if (typeof currentHash === 'string' && currentHash.length > 0) {
        if (!input.oldPassword || !(await verifyPassword(input.oldPassword, currentHash))) {
          throw invalidCredentials()
        }
      }

      const newHash = await hashPassword(input.password)
      const timestamp = now()

      const updated = await operation('update password and revoke other sessions', () =>
        documents.transaction(async (tx) => {
          const res = await tx.updateUser(
            userId,
            new Doc({
              [userFields.passwordHash]: newHash,
              [userFields.passwordUpdate]: timestamp,
            }),
          )

          const otherSessions = await tx.findSessions([
            Query.equal(sessionFields.userId, [userId]),
            Query.isNull(sessionFields.revokedAt),
          ])

          for (const s of otherSessions) {
            if (s.getId() !== currentSessionId) {
              await tx.updateSession(s.getId(), new Doc({ [sessionFields.revokedAt]: timestamp }))
            }
          }

          return res
        }),
      )
      return userResponse(updated)
    },

    async updateName(
      documents: AccountDocuments,
      userId: string,
      name: string,
    ): Promise<UserResponse> {
      const user = await operation('get user for name update', () => documents.getUser(userId))
      if (user.empty()) throw userNotFound()

      const updated = await operation('update user name', () =>
        documents.updateUser(userId, new Doc({ [userFields.name]: name })),
      )
      return userResponse(updated)
    },

    async updateEmail(
      documents: AccountDocuments,
      userId: string,
      input: UpdateEmailInput,
    ): Promise<UserResponse> {
      const user = await operation('get user for email update', () => documents.getUser(userId))
      if (user.empty()) throw userNotFound()

      const currentHash: unknown = user.get(userFields.passwordHash)
      if (typeof currentHash !== 'string' || !(await verifyPassword(input.password, currentHash))) {
        throw invalidCredentials()
      }

      const email = normalizedEmail(input.email)
      const existing = await operation('check email in use', () =>
        documents.findUsers([Query.equal(userFields.email, [email]), Query.limit(1)]),
      )
      if (existing.length > 0 && existing[0]!.getId() !== userId) {
        throw userEmailExists()
      }

      const updated = await operation('update user email', () =>
        documents.updateUser(
          userId,
          new Doc({
            [userFields.email]: email,
            [userFields.emailVerified]: false,
          }),
        ),
      )
      return userResponse(updated)
    },

    async updatePrefs(
      documents: AccountDocuments,
      userId: string,
      prefs: TeamPreferences,
    ): Promise<UserResponse> {
      const user = await operation('get user for prefs update', () => documents.getUser(userId))
      if (user.empty()) throw userNotFound()

      const updated = await operation('update user prefs', () =>
        documents.updateUser(userId, new Doc({ [userFields.prefs]: prefs })),
      )
      return userResponse(updated)
    },

    async deleteAccount(documents: AccountDocuments, userId: string): Promise<void> {
      const user = await operation('get user for account deletion', () => documents.getUser(userId))
      if (user.empty()) throw userNotFound()

      await operation('delete account and cascade cleanup', () =>
        documents.transaction(async (tx) => {
          const memberships = await tx.findMemberships([
            Query.equal(membershipFields.userId, [userId]),
          ])
          for (const membership of memberships) {
            await tx.deleteMembership(membership.getId())
            if (membership.get(membershipFields.status) === 'accepted') {
              const teamId: unknown = membership.get(membershipFields.teamId)
              if (typeof teamId === 'string' && teamId.length > 0) {
                await tx.decreaseTeamTotal(teamId)
              }
            }
          }

          const sessions = await tx.findSessions([Query.equal(sessionFields.userId, [userId])])
          for (const s of sessions) {
            await tx.deleteSession(s.getId())
          }

          await tx.deleteUser(userId)
        }),
      )
    },

    async createAnonymousSession(documents: AccountDocuments): Promise<SessionResponse> {
      const userId = createId()
      const timestamp = now()
      await operation('create anonymous user', () =>
        documents.createUser(
          new Doc({
            $id: userId,
            $permissions: userPermissions(userId),
            [userFields.status]: true,
            [userFields.labels]: [],
            [userFields.prefs]: {},
            $createdAt: timestamp,
            $updatedAt: timestamp,
          }),
        ),
      )
      return await self.createSessionForUser(documents, userId)
    },

    async createJWT(
      documents: AccountDocuments,
      projectId: string,
      userId: string,
      sessionId?: string,
      durationSeconds: number = 900,
    ): Promise<JwtResponse> {
      const user = await operation('verify user for jwt', () => documents.getUser(userId))
      if (user.empty()) throw userNotFound()
      if (!user.get(userFields.status, true)) throw userBlocked()

      if (sessionId) {
        const session = await operation('verify session for jwt', () =>
          documents.getSession(sessionId),
        )
        if (
          session.empty() ||
          session.get(sessionFields.userId) !== userId ||
          session.get(sessionFields.revokedAt) !== null
        ) {
          throw sessionNotFound()
        }
      }

      const secret = await operation('get signing key', () =>
        getOrGenerateSigningKey(documents, now(), createId),
      )

      const payload: Record<string, unknown> = {
        sub: userId,
        userId,
        iss: `nuvix:${projectId}`,
        aud: 'nuvix:project',
      }
      if (sessionId) {
        payload.sid = sessionId
        payload.sessionId = sessionId
      }

      const token = await signJwt(payload as never, secret, durationSeconds)
      return { jwt: token }
    },

    async rotateSigningKey(documents: AccountDocuments): Promise<{ secret: string }> {
      const secret = await operation('rotate signing key', () =>
        rotateTenantSigningKey(documents, now(), createId),
      )
      return { secret }
    },
  }

  return self
}

export type AccountService = ReturnType<typeof createAccountService>
