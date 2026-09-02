import { Doc, ID, Permission, Query, Role } from '@nuvix/db'
import type { AccountDocuments } from '../account/documents'
import {
  type AccountService,
  createAccountService,
  type SessionList,
  type SessionResponse,
} from '../account/service'
import { API_SCOPE_ROLE_PREFIX, apiScopeLabel } from '../context/database-roles'
import type { ProjectAuthContext } from '../context/project'
import { TENANT_AUTH_MODEL } from '../context/tenant-auth-model'
import { translatePackageError } from '../infrastructure/package-errors'
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../shared/errors'
import { TEAM_MODEL } from '../teams/model'
import type { JsonValue, TeamPreferences } from '../teams/service'
import { hashPassword, isValidPassword } from '../utils/passwords'
import type { UserDocuments } from './documents'

export interface UserResponse {
  $id: string
  name?: string
  email?: string
  phone?: string
  status: boolean
  labels: string[]
  prefs: TeamPreferences
  emailVerification: boolean
  phoneVerification: boolean
  registration: string
  $createdAt: string
  $updatedAt: string
}

export interface UserList {
  data: UserResponse[]
  meta: { total: number; limit: number; offset: number }
}

export interface UserMembershipResponse {
  readonly $id: string
  readonly teamId: string
  /** Omitted when the caller's session cannot read the referenced team. */
  readonly teamName?: string
  readonly roles: string[]
  readonly status: string
  readonly invited: string
  /** Omitted while the membership has not joined. */
  readonly joined?: string
}

export interface UserMembershipList {
  data: UserMembershipResponse[]
  meta: { total: number; limit: number; offset: number }
}

export interface UserFilters {
  readonly name?: string
  readonly email?: string
  readonly phone?: string
  readonly status?: boolean
  readonly emailVerification?: boolean
  readonly phoneVerification?: boolean
}

export interface CreateUserWithPasswordInput {
  readonly userId?: string
  readonly email?: string
  readonly phone?: string
  readonly password: string
  readonly name?: string
}

export interface UserServiceOptions {
  readonly id?: () => string
  readonly now?: () => Date
  readonly account?: AccountService
}

const LABEL_PATTERN = /^[\p{L}\p{M}\p{N}._-]{1,64}$/u
const MAX_PREFS_BYTES = 65_536

export function authorizeUsers(
  auth: ProjectAuthContext,
  scope: 'users.read' | 'users.write',
): void {
  if (auth.type !== 'apiKey' || !auth.scopes.includes(scope)) throw new ForbiddenError()
}

function iso(value: Date | string | null): string {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) throw new Error('User timestamp is invalid')
  return date.toISOString()
}

function optionalIso(value: Date | string | null): string | undefined {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return undefined
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

function response(document: Doc): UserResponse {
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
  return result
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase()
}

function normalizedLabels(input: readonly string[]): string[] {
  const output: string[] = []
  const seen = new Set<string>()
  for (const label of input) {
    if (
      label !== label.normalize('NFC') ||
      !LABEL_PATTERN.test(label) ||
      label.startsWith(API_SCOPE_ROLE_PREFIX)
    ) {
      throw new BadRequestError('Invalid user labels')
    }
    if (!seen.has(label)) {
      seen.add(label)
      output.push(label)
    }
  }
  return output
}

function validatePrefs(value: TeamPreferences): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_PREFS_BYTES) {
    throw new BadRequestError('User preferences are too large', {
      code: 'user_prefs_too_large',
      messageKey: 'errors.users.prefsTooLarge',
    })
  }
}

async function operation<Result>(name: string, run: () => Promise<Result>): Promise<Result> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof AppError) throw error
    throw translatePackageError(error, { operation: name })
  }
}

type MutableUserMembershipResponse = {
  -readonly [K in keyof UserMembershipResponse]: UserMembershipResponse[K]
}

export function createUserService(options: UserServiceOptions = {}) {
  const createId = options.id ?? (() => ID.unique())
  const now = options.now ?? (() => new Date())
  const account = options.account ?? createAccountService({ id: createId, now })
  const collection = TENANT_AUTH_MODEL.collections.users
  const fields = TENANT_AUTH_MODEL.fields.users
  const membershipCollection = TENANT_AUTH_MODEL.collections.memberships
  const membershipFields = TENANT_AUTH_MODEL.fields.memberships

  const get = async (documents: UserDocuments, userId: string): Promise<UserResponse> => {
    const user = await operation('get user', () => documents.get(collection, userId))
    if (user.empty()) {
      throw new NotFoundError('User', {
        code: 'user_not_found',
        messageKey: 'errors.users.notFound',
      })
    }
    return response(user)
  }

  const unique = async (
    documents: UserDocuments,
    field: string,
    value: string,
    currentId?: string,
  ) => {
    const existing = await operation('check user identity', () =>
      documents.findOne(collection, [Query.equal(field, [value]), Query.select(['$id'])]),
    )
    return !existing.empty() && existing.getId() !== currentId
  }

  return {
    async create(
      documents: UserDocuments,
      input: { userId?: string; email?: string; phone?: string; name?: string },
    ): Promise<UserResponse> {
      if (!input.userId && !input.email && !input.phone) {
        throw new BadRequestError('A user ID, email, or phone is required')
      }
      const userId = !input.userId || input.userId === 'unique()' ? createId() : input.userId
      const email = input.email ? normalizedEmail(input.email) : undefined
      if (!(await documents.get(collection, userId)).empty()) {
        throw new ConflictError('User already exists', {
          code: 'user_already_exists',
          messageKey: 'errors.users.alreadyExists',
        })
      }
      if (email && (await unique(documents, fields.email, email))) {
        throw new ConflictError('User email already exists', {
          code: 'user_email_exists',
          messageKey: 'errors.users.emailExists',
        })
      }
      if (input.phone && (await unique(documents, fields.phone, input.phone))) {
        throw new ConflictError('User phone already exists', {
          code: 'user_phone_exists',
          messageKey: 'errors.users.phoneExists',
        })
      }

      const created = await operation('create user', () =>
        documents.create(
          collection,
          new Doc({
            $id: userId,
            $permissions: [
              Permission.read(Role.user(userId)),
              // Team membership administration projects user identity fields.
              Permission.read(Role.label(apiScopeLabel('teams.read'))),
              Permission.read(Role.label(apiScopeLabel('teams.write'))),
              Permission.update(Role.user(userId)),
              Permission.delete(Role.user(userId)),
            ],
            ...(input.name ? { [fields.name]: input.name } : {}),
            ...(email ? { [fields.email]: email } : {}),
            ...(input.phone ? { [fields.phone]: input.phone } : {}),
            [fields.status]: true,
            [fields.emailVerified]: false,
            [fields.phoneVerified]: false,
            [fields.labels]: [],
            [fields.prefs]: {},
          }),
        ),
      )
      return response(created)
    },

    async list(
      documents: UserDocuments,
      filters: UserFilters,
      limit = 25,
      offset = 0,
    ): Promise<UserList> {
      const query: Query[] = []
      if (filters.name !== undefined) query.push(Query.equal(fields.name, [filters.name]))
      if (filters.email !== undefined) {
        query.push(Query.equal(fields.email, [normalizedEmail(filters.email)]))
      }
      if (filters.phone !== undefined) query.push(Query.equal(fields.phone, [filters.phone]))
      if (filters.status !== undefined) query.push(Query.equal(fields.status, [filters.status]))
      if (filters.emailVerification !== undefined) {
        query.push(Query.equal(fields.emailVerified, [filters.emailVerification]))
      }
      if (filters.phoneVerification !== undefined) {
        query.push(Query.equal(fields.phoneVerified, [filters.phoneVerification]))
      }
      const [users, total] = await operation('list users', () =>
        Promise.all([
          documents.find(collection, [
            ...query,
            Query.orderDesc('$createdAt'),
            Query.orderDesc('$id'),
            Query.limit(limit),
            Query.offset(offset),
          ]),
          documents.count(collection, query),
        ]),
      )
      return { data: users.map(response), meta: { total, limit, offset } }
    },

    get,

    async updateName(documents: UserDocuments, userId: string, name: string) {
      await get(documents, userId)
      return response(
        await operation('update user name', () =>
          documents.update(collection, userId, new Doc({ [fields.name]: name })),
        ),
      )
    },

    async updateEmail(documents: UserDocuments, userId: string, value: string) {
      await get(documents, userId)
      const email = normalizedEmail(value)
      if (await unique(documents, fields.email, email, userId)) {
        throw new ConflictError('User email already exists', {
          code: 'user_email_exists',
          messageKey: 'errors.users.emailExists',
        })
      }
      return response(
        await operation('update user email', () =>
          documents.update(
            collection,
            userId,
            new Doc({ [fields.email]: email, [fields.emailVerified]: false }),
          ),
        ),
      )
    },

    async updatePhone(documents: UserDocuments, userId: string, phone: string) {
      await get(documents, userId)
      if (await unique(documents, fields.phone, phone, userId)) {
        throw new ConflictError('User phone already exists', {
          code: 'user_phone_exists',
          messageKey: 'errors.users.phoneExists',
        })
      }
      return response(
        await operation('update user phone', () =>
          documents.update(
            collection,
            userId,
            new Doc({ [fields.phone]: phone, [fields.phoneVerified]: false }),
          ),
        ),
      )
    },

    async getPrefs(documents: UserDocuments, userId: string): Promise<TeamPreferences> {
      return (await get(documents, userId)).prefs
    },

    async updatePrefs(documents: UserDocuments, userId: string, prefs: TeamPreferences) {
      validatePrefs(prefs)
      await get(documents, userId)
      const updated = await operation('update user preferences', () =>
        documents.update(collection, userId, new Doc({ [fields.prefs]: prefs })),
      )
      return response(updated).prefs
    },

    async updateLabels(documents: UserDocuments, userId: string, labels: readonly string[]) {
      const normalized = normalizedLabels(labels)
      await get(documents, userId)
      return response(
        await operation('update user labels', () =>
          documents.update(collection, userId, new Doc({ [fields.labels]: normalized })),
        ),
      )
    },

    async updateStatus(documents: UserDocuments, userId: string, status: boolean) {
      await get(documents, userId)
      return response(
        await operation('update user status', () =>
          documents.update(collection, userId, new Doc({ [fields.status]: status })),
        ),
      )
    },

    async listMemberships(
      documents: UserDocuments,
      userId: string,
      limit = 25,
      offset = 0,
    ): Promise<UserMembershipList> {
      await get(documents, userId)
      const filter = [Query.equal(membershipFields.userId, [userId])]
      const [memberships, total] = await operation('list user memberships', () =>
        Promise.all([
          documents.find(membershipCollection, [
            ...filter,
            Query.orderDesc('$createdAt'),
            Query.orderDesc('$id'),
            Query.limit(limit),
            Query.offset(offset),
          ]),
          documents.count(membershipCollection, filter),
        ]),
      )

      const data = await Promise.all(
        memberships.map(async (membership) => {
          const teamId: unknown = membership.get(membershipFields.teamId)
          const result: MutableUserMembershipResponse = {
            $id: membership.getId(),
            teamId: typeof teamId === 'string' ? teamId : '',
            roles: strings(membership.get(membershipFields.roles)),
            status: membership.get(membershipFields.status, 'accepted'),
            invited: iso(membership.get(membershipFields.invited)),
          }
          const joined = optionalIso(membership.get(membershipFields.joined))
          if (joined) result.joined = joined
          if (result.teamId) {
            const team = await operation('read membership team', () =>
              documents.get(TEAM_MODEL.collection, result.teamId),
            )
            const teamName: unknown = team.empty() ? null : team.get(TEAM_MODEL.fields.name)
            if (typeof teamName === 'string' && teamName.length > 0) result.teamName = teamName
          }
          return Object.freeze(result)
        }),
      )
      return { data, meta: { total, limit, offset } }
    },

    async remove(documents: AccountDocuments, userId: string): Promise<void> {
      await account.deleteAccount(documents, userId)
    },

    async createWithPassword(
      documents: AccountDocuments,
      input: CreateUserWithPasswordInput,
      algorithm: 'argon2id' | 'bcrypt',
    ): Promise<UserResponse> {
      if (!isValidPassword(input.password)) {
        throw new BadRequestError('Password must be between 8 and 256 characters long.', {
          code: 'password_invalid',
          messageKey: 'errors.passwords.invalid',
        })
      }
      if (!input.userId && !input.email && !input.phone) {
        throw new BadRequestError('A user ID, email, or phone is required')
      }
      const userId = !input.userId || input.userId === 'unique()' ? createId() : input.userId
      const email = input.email ? normalizedEmail(input.email) : undefined
      const existing = await operation('check user existence', () => documents.getUser(userId))
      if (!existing.empty()) {
        throw new ConflictError('User already exists', {
          code: 'user_already_exists',
          messageKey: 'errors.users.alreadyExists',
        })
      }

      if (email) {
        const found = await operation('check email uniqueness', () =>
          documents.findUsers([Query.equal(fields.email, [email]), Query.limit(1)]),
        )
        if (found.length > 0) {
          throw new ConflictError('User email already exists', {
            code: 'user_email_exists',
            messageKey: 'errors.users.emailExists',
          })
        }
      }
      if (input.phone) {
        const found = await operation('check phone uniqueness', () =>
          documents.findUsers([Query.equal(fields.phone, [input.phone!]), Query.limit(1)]),
        )
        if (found.length > 0) {
          throw new ConflictError('User phone already exists', {
            code: 'user_phone_exists',
            messageKey: 'errors.users.phoneExists',
          })
        }
      }

      const passwordHash = await hashPassword(input.password, { algorithm })
      const timestamp = now()

      const created = await operation('create user with password', () =>
        documents.createUser(
          new Doc({
            $id: userId,
            $permissions: [
              Permission.read(Role.user(userId)),
              Permission.read(Role.label(apiScopeLabel('teams.read'))),
              Permission.read(Role.label(apiScopeLabel('teams.write'))),
              Permission.update(Role.user(userId)),
              Permission.delete(Role.user(userId)),
            ],
            ...(input.name ? { [fields.name]: input.name } : {}),
            ...(email ? { [fields.email]: email } : {}),
            ...(input.phone ? { [fields.phone]: input.phone } : {}),
            [fields.passwordHash]: passwordHash,
            [fields.passwordUpdate]: timestamp,
            [fields.status]: true,
            [fields.emailVerified]: false,
            [fields.phoneVerified]: false,
            [fields.labels]: [],
            [fields.prefs]: {},
          }),
        ),
      )

      return response(created)
    },

    async updatePassword(
      documents: AccountDocuments,
      userId: string,
      password: string,
    ): Promise<UserResponse> {
      if (!isValidPassword(password)) {
        throw new BadRequestError('Password must be between 8 and 256 characters long.', {
          code: 'password_invalid',
          messageKey: 'errors.passwords.invalid',
        })
      }
      const user = await operation('get user for password update', () => documents.getUser(userId))
      if (user.empty()) {
        throw new NotFoundError('User not found', {
          code: 'user_not_found',
          messageKey: 'errors.users.notFound',
        })
      }

      const passwordHash = await hashPassword(password, { algorithm: 'argon2id' })
      const timestamp = now()

      const updated = await operation('update user password', () =>
        documents.updateUser(
          userId,
          new Doc({
            [fields.passwordHash]: passwordHash,
            [fields.passwordUpdate]: timestamp,
          }),
        ),
      )

      await account.deleteSessions(documents, userId)

      return response(updated)
    },

    async listSessions(
      documents: AccountDocuments,
      userId: string,
      limit = 25,
      offset = 0,
    ): Promise<SessionList> {
      return await account.listSessions(documents, userId, limit, offset)
    },

    async createSession(documents: AccountDocuments, userId: string): Promise<SessionResponse> {
      return await account.createSessionForUser(documents, userId)
    },

    async deleteSession(
      documents: AccountDocuments,
      userId: string,
      sessionId: string,
    ): Promise<void> {
      await account.deleteSession(documents, userId, sessionId)
    },

    async deleteSessions(documents: AccountDocuments, userId: string): Promise<void> {
      await account.deleteSessions(documents, userId)
    },
  }
}

export type UserService = ReturnType<typeof createUserService>
export type UserPreferences = Record<string, JsonValue>
