import { Doc, ID, Permission, Query, Role } from '@nuvix/db'
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
import type { JsonValue, TeamPreferences } from '../teams/service'
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

export interface UserFilters {
  readonly name?: string
  readonly email?: string
  readonly phone?: string
  readonly status?: boolean
  readonly emailVerification?: boolean
  readonly phoneVerification?: boolean
}

const LABEL_PATTERN = /^[\p{L}\p{M}\p{N}._-]{1,64}$/u
const RESERVED_LABEL_PREFIX = '_nuvix.scope.'
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
      label.startsWith(RESERVED_LABEL_PREFIX)
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

export function createUserService(options: { id?: () => string } = {}) {
  const createId = options.id ?? (() => ID.unique())
  const collection = TENANT_AUTH_MODEL.collections.users
  const fields = TENANT_AUTH_MODEL.fields.users

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
  }
}

export type UserService = ReturnType<typeof createUserService>
export type UserPreferences = Record<string, JsonValue>
