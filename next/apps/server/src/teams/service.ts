import { randomBytes } from 'node:crypto'
import { Doc, ID, Permission, Query, Role } from '@nuvix/db'
import { createSecretVerifier, verifyCredentialSecret } from '../context/credential-secret'
import { apiScopeLabel } from '../context/database-roles'
import type { ProjectAuthContext } from '../context/project'
import { TENANT_AUTH_MODEL } from '../context/tenant-auth-model'
import { translatePackageError } from '../infrastructure/package-errors'
import {
  createMessagingGateway,
  type MessagingGateway,
  type ProviderConfig,
} from '../messaging/gateway'
import { MESSAGING_MODEL } from '../messaging/model'
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../shared/errors'
import type { TeamDocuments } from './documents'
import { TEAM_MODEL, type TeamModel } from './model'

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }
export type TeamPreferences = Record<string, JsonValue>

export interface TeamResponse {
  readonly $id: string
  readonly name: string
  readonly total: number
  readonly prefs: TeamPreferences
  readonly $createdAt: string
  readonly $updatedAt: string
}

export interface TeamList {
  data: TeamResponse[]
  meta: {
    total: number
    limit: number
    offset: number
  }
}

export interface MembershipResponse {
  readonly $id: string
  readonly userId: string
  /** Omitted when the caller's session cannot read the referenced user. */
  readonly userName?: string
  readonly email?: string
  readonly roles: string[]
  readonly status: string
  readonly invited: string
  /** Omitted while the membership has not joined. */
  readonly joined?: string
}

export interface MembershipList {
  data: MembershipResponse[]
  meta: {
    total: number
    limit: number
    offset: number
  }
}

export interface TeamServiceOptions {
  readonly model?: TeamModel
  readonly id?: () => string
  readonly now?: () => Date
  readonly messaging?: MessagingGateway
}

const ROLE_PATTERN = /^[\p{L}\p{M}\p{N}._-]{1,32}$/u

export function authorizeTeams(
  auth: ProjectAuthContext,
  scope: 'teams.read' | 'teams.write',
): void {
  if (auth.type === 'guest') throw new ForbiddenError()
  if (auth.type === 'apiKey' && !auth.scopes.includes(scope)) throw new ForbiddenError()
}

/**
 * Role mutation and member removal are team-owner actions. API keys hold the
 * scope already enforced by the route; sessions need the `owner` role.
 */
export function authorizeMembershipManagement(auth: ProjectAuthContext, teamId: string): void {
  if (auth.type === 'guest') throw new ForbiddenError()
  if (auth.type === 'apiKey') return
  const owns = (auth.teams ?? []).some(
    (team) => team.teamId === teamId && team.roles.includes('owner'),
  )
  if (!owns) throw new ForbiddenError()
}

function normalizeRoles(input: readonly string[]): string[] {
  const normalized = [...new Set(input)]
  if (normalized.length > 100 || normalized.some((role) => !ROLE_PATTERN.test(role))) {
    throw new BadRequestError('Invalid team roles')
  }
  return normalized.toSorted()
}

function roles(input: readonly string[]): readonly string[] {
  const normalized = normalizeRoles(input)
  if (!normalized.includes('owner')) normalized.push('owner')
  return Object.freeze(normalized.toSorted())
}

function iso(value: Date | string | null): string {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) throw new Error('Team timestamp is invalid')
  return date.toISOString()
}

function optionalIso(value: Date | string | null): string | undefined {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

function prefs(value: unknown): TeamPreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as TeamPreferences
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null
}

function response(document: Doc, model: TeamModel): TeamResponse {
  return Object.freeze({
    $id: document.getId(),
    name: document.get(model.fields.name, ''),
    total: document.get(model.fields.total, 0),
    prefs: prefs(document.get(model.fields.prefs, {})),
    $createdAt: iso(document.createdAt()),
    $updatedAt: iso(document.updatedAt()),
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

function teamPermissions(teamId: string) {
  return [
    Permission.read(Role.team(teamId)),
    Permission.read(Role.label(apiScopeLabel('teams.read'))),
    // Write handlers perform caller-scoped precondition reads; read routes still require teams.read.
    Permission.read(Role.label(apiScopeLabel('teams.write'))),
    // The users membership projection reads team names through this label.
    Permission.read(Role.label(apiScopeLabel('users.read'))),
    Permission.update(Role.team(teamId, 'owner')),
    Permission.update(Role.label(apiScopeLabel('teams.write'))),
    Permission.delete(Role.team(teamId, 'owner')),
    Permission.delete(Role.label(apiScopeLabel('teams.write'))),
  ]
}

function membershipPermissions(teamId: string, userId: string) {
  return [
    Permission.read(Role.user(userId)),
    Permission.read(Role.team(teamId)),
    Permission.read(Role.label(apiScopeLabel('teams.read'))),
    Permission.read(Role.label(apiScopeLabel('teams.write'))),
    Permission.update(Role.team(teamId, 'owner')),
    Permission.update(Role.label(apiScopeLabel('teams.write'))),
    Permission.delete(Role.team(teamId, 'owner')),
    Permission.delete(Role.label(apiScopeLabel('teams.write'))),
  ]
}

const MEMBERSHIP_COLLECTION = TENANT_AUTH_MODEL.collections.memberships
const MEMBERSHIP_FIELDS = TENANT_AUTH_MODEL.fields.memberships
const USER_COLLECTION = TENANT_AUTH_MODEL.collections.users
const USER_FIELDS = TENANT_AUTH_MODEL.fields.users

function membershipNotFound(): NotFoundError {
  return new NotFoundError('Membership', {
    code: 'membership_not_found',
    messageKey: 'errors.teams.membershipNotFound',
  })
}

/** Projects the referenced user's identity when the caller may read it. */
async function userIdentity(documents: TeamDocuments, userId: unknown) {
  if (typeof userId !== 'string' || userId.length === 0) return {}
  const user = await operation('read membership user', () => documents.get(USER_COLLECTION, userId))
  const identity: { userName?: string; email?: string } = {}
  if (!user.empty()) {
    const name = user.get(USER_FIELDS.name)
    const email = user.get(USER_FIELDS.email)
    if (typeof name === 'string' && name.length > 0) identity.userName = name
    if (typeof email === 'string' && email.length > 0) identity.email = email
  }
  return identity
}

type MutableMembershipResponse = {
  -readonly [K in keyof MembershipResponse]: MembershipResponse[K]
}

async function membershipResponse(
  documents: TeamDocuments,
  membership: Doc,
): Promise<MembershipResponse> {
  const userId: unknown = membership.get(MEMBERSHIP_FIELDS.userId)
  const result: MutableMembershipResponse = {
    $id: membership.getId(),
    userId: typeof userId === 'string' ? userId : '',
    roles: strings(membership.get(MEMBERSHIP_FIELDS.roles)) ?? [],
    status: membership.get(MEMBERSHIP_FIELDS.status, 'accepted'),
    invited: iso(membership.get(MEMBERSHIP_FIELDS.invited)),
  }
  const joined = optionalIso(membership.get(MEMBERSHIP_FIELDS.joined))
  if (joined) result.joined = joined
  const identity = await userIdentity(documents, userId)
  if (identity.userName) result.userName = identity.userName
  if (identity.email) result.email = identity.email
  return Object.freeze(result)
}

export function createTeamService(options: TeamServiceOptions = {}) {
  const model = options.model ?? TEAM_MODEL
  const createId = options.id ?? (() => ID.unique())
  const now = options.now ?? (() => new Date())
  const messaging = options.messaging ?? createMessagingGateway()

  const get = async (documents: TeamDocuments, teamId: string): Promise<TeamResponse> => {
    const team = await operation('get team', () => documents.get(model.collection, teamId))
    if (team.empty()) {
      throw new NotFoundError('Team', {
        code: 'team_not_found',
        messageKey: 'errors.teams.notFound',
      })
    }
    return response(team, model)
  }

  const requireMembership = async (
    documents: TeamDocuments,
    teamId: string,
    membershipId: string,
  ): Promise<Doc> => {
    await get(documents, teamId)
    const membership = await operation('get membership', () =>
      documents.get(MEMBERSHIP_COLLECTION, membershipId),
    )
    if (membership.empty() || membership.get(MEMBERSHIP_FIELDS.teamId) !== teamId) {
      throw membershipNotFound()
    }
    return membership
  }

  return {
    async create(
      documents: TeamDocuments,
      auth: ProjectAuthContext,
      input: { name: string; roles?: readonly string[] },
    ): Promise<TeamResponse> {
      authorizeTeams(auth, 'teams.write')
      const teamId = createId()
      const userAuth = auth.type === 'session' || auth.type === 'jwt' ? auth : null
      const total = userAuth ? 1 : 0

      return await operation('create team', () =>
        documents.transaction(async (transaction) => {
          const team = await transaction.create(
            model.collection,
            new Doc({
              $id: teamId,
              $permissions: teamPermissions(teamId),
              [model.fields.name]: input.name,
              [model.fields.total]: total,
              [model.fields.prefs]: {},
            }),
          )
          if (userAuth) {
            const timestamp = now()
            await transaction.create(
              TENANT_AUTH_MODEL.collections.memberships,
              new Doc({
                $id: createId(),
                $permissions: membershipPermissions(teamId, userAuth.userId),
                userId: userAuth.userId,
                teamId,
                roles: roles(input.roles ?? ['owner']),
                status: 'accepted',
                invited: timestamp,
                joined: timestamp,
              }),
            )
          }
          return response(team, model)
        }),
      )
    },

    async list(documents: TeamDocuments, limit = 25, offset = 0): Promise<TeamList> {
      const [data, total] = await operation('list teams', () =>
        Promise.all([
          documents.find(model.collection, [
            Query.orderDesc('$createdAt'),
            Query.orderDesc('$id'),
            Query.limit(limit),
            Query.offset(offset),
          ]),
          documents.count(model.collection),
        ]),
      )
      return {
        data: data.map((team) => response(team, model)),
        meta: { total, limit, offset },
      }
    },

    get,

    async update(documents: TeamDocuments, teamId: string, name: string): Promise<TeamResponse> {
      await get(documents, teamId)
      const updated = await operation('update team', () =>
        documents.update(model.collection, teamId, new Doc({ [model.fields.name]: name })),
      )
      return response(updated, model)
    },

    async getPrefs(documents: TeamDocuments, teamId: string): Promise<TeamPreferences> {
      return (await get(documents, teamId)).prefs
    },

    async updatePrefs(
      documents: TeamDocuments,
      teamId: string,
      preferences: TeamPreferences,
    ): Promise<TeamPreferences> {
      await get(documents, teamId)
      const updated = await operation('update team preferences', () =>
        documents.update(model.collection, teamId, new Doc({ [model.fields.prefs]: preferences })),
      )
      return response(updated, model).prefs
    },

    async remove(documents: TeamDocuments, teamId: string): Promise<void> {
      await operation('delete team', () =>
        documents.transaction(async (transaction) => {
          const team = await transaction.get(model.collection, teamId)
          if (team.empty()) {
            throw new NotFoundError('Team', {
              code: 'team_not_found',
              messageKey: 'errors.teams.notFound',
            })
          }
          await transaction.removeMany(TENANT_AUTH_MODEL.collections.memberships, [
            Query.equal(TENANT_AUTH_MODEL.fields.memberships.teamId, [teamId]),
          ])
          if (!(await transaction.remove(model.collection, teamId))) {
            throw new NotFoundError('Team', {
              code: 'team_not_found',
              messageKey: 'errors.teams.notFound',
            })
          }
        }),
      )
    },

    async listMemberships(
      documents: TeamDocuments,
      teamId: string,
      limit = 25,
      offset = 0,
    ): Promise<MembershipList> {
      await get(documents, teamId)
      const filter = [Query.equal(MEMBERSHIP_FIELDS.teamId, [teamId])]
      const [memberships, total] = await operation('list memberships', () =>
        Promise.all([
          documents.find(MEMBERSHIP_COLLECTION, [
            ...filter,
            Query.orderDesc('$createdAt'),
            Query.orderDesc('$id'),
            Query.limit(limit),
            Query.offset(offset),
          ]),
          documents.count(MEMBERSHIP_COLLECTION, filter),
        ]),
      )
      return {
        data: await Promise.all(
          memberships.map((membership) => membershipResponse(documents, membership)),
        ),
        meta: { total, limit, offset },
      }
    },

    async getMembership(
      documents: TeamDocuments,
      teamId: string,
      membershipId: string,
    ): Promise<MembershipResponse> {
      const membership = await requireMembership(documents, teamId, membershipId)
      return membershipResponse(documents, membership)
    },

    async createMembership(
      documents: TeamDocuments,
      teamId: string,
      auth: ProjectAuthContext,
      input: {
        email?: string
        userId?: string
        phone?: string
        roles: readonly string[]
        url: string
      },
    ): Promise<MembershipResponse> {
      const team = await get(documents, teamId)
      authorizeMembershipManagement(auth, teamId)

      let inviteeId = input.userId
      if (!inviteeId && input.email) {
        const users = await documents.find(USER_COLLECTION, [
          Query.equal(USER_FIELDS.email, [input.email]),
        ])
        if (users.length > 0) inviteeId = users[0]?.getId()
      }
      if (!inviteeId && input.phone) {
        const users = await documents.find(USER_COLLECTION, [
          Query.equal(USER_FIELDS.phone, [input.phone]),
        ])
        if (users.length > 0) inviteeId = users[0]?.getId()
      }
      if (!inviteeId) {
        inviteeId = createId()
        await documents.create(
          USER_COLLECTION,
          new Doc({
            $id: inviteeId,
            $permissions: [
              Permission.read(Role.user(inviteeId)),
              Permission.update(Role.user(inviteeId)),
              Permission.delete(Role.user(inviteeId)),
            ],
            [USER_FIELDS.email]: input.email || '',
            [USER_FIELDS.phone]: input.phone || '',
            [USER_FIELDS.name]: '',
            [USER_FIELDS.status]: 'unverified',
            [USER_FIELDS.emailVerified]: false,
            [USER_FIELDS.phoneVerified]: false,
          }),
        )
      }

      const existing = await documents.find(MEMBERSHIP_COLLECTION, [
        Query.equal(MEMBERSHIP_FIELDS.teamId, [teamId]),
        Query.equal(MEMBERSHIP_FIELDS.userId, [inviteeId]),
      ])
      if (existing.length > 0) {
        throw new ConflictError('Membership already exists', { code: 'team_invite_already_exists' })
      }

      const membershipId = createId()
      const secret = randomBytes(32).toString('hex')
      const verifier = await createSecretVerifier('session', new TextEncoder().encode(secret))

      const timestamp = now()
      const membership = new Doc({
        $id: membershipId,
        $permissions: membershipPermissions(teamId, inviteeId),
        userId: inviteeId,
        teamId,
        roles: roles(input.roles ?? []),
        status: 'invited',
        invited: timestamp,
        joined: null,
        secretDigest: verifier.digest,
        secretSalt: verifier.salt,
        inviteExpiresAt: new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      await operation('create membership', () =>
        documents.create(MEMBERSHIP_COLLECTION, membership),
      )

      const channel = input.phone && !input.email ? 'sms' : 'email'
      let provider: ProviderConfig | undefined
      try {
        const providers = await documents.find(MESSAGING_MODEL.collections.providers, [
          Query.equal(MESSAGING_MODEL.fields.providers.type, [channel]),
          Query.equal(MESSAGING_MODEL.fields.providers.enabled, [true]),
        ])
        const providerDoc = providers[0]
        if (providerDoc) {
          provider = {
            type: providerDoc.get('type') as 'email' | 'sms' | 'push',
            adapter: providerDoc.get('adapter') as string,
            options: providerDoc.get('options') as Record<string, unknown>,
          }
        }
      } catch (_e) {
        // ignore
      }

      if (provider) {
        const url = new URL(input.url)
        url.searchParams.append('membershipId', membershipId)
        url.searchParams.append('userId', inviteeId)
        url.searchParams.append('secret', secret)
        url.searchParams.append('teamId', teamId)
        url.searchParams.append('expiry', membership.get('inviteExpiresAt', ''))

        await messaging
          .send(
            {
              channel,
              recipients: [input.email || input.phone || ''],
              payload: {
                subject: `Invitation to join ${team.name}`,
                content: `Click here to join: ${url.toString()}`,
              },
            },
            provider,
          )
          .catch(() => {})
      }

      return membershipResponse(documents, membership)
    },

    async updateMembershipStatus(
      documents: TeamDocuments,
      teamId: string,
      membershipId: string,
      _auth: ProjectAuthContext,
      input: { userId: string; secret: string },
    ): Promise<MembershipResponse> {
      const membership = await requireMembership(documents, teamId, membershipId)

      if (membership.get(MEMBERSHIP_FIELDS.userId) !== input.userId) {
        throw new ForbiddenError('Invalid invite user', { code: 'invalid_invite_secret' })
      }

      const digest = membership.get('secretDigest')
      const salt = membership.get('secretSalt')
      if (typeof digest !== 'string' || typeof salt !== 'string') {
        throw new ForbiddenError('Invalid invite secret', { code: 'invalid_invite_secret' })
      }

      const isValid = await verifyCredentialSecret(
        'session',
        new TextEncoder().encode(input.secret),
        { digest, salt },
      )
      if (!isValid) {
        throw new ForbiddenError('Invalid invite secret', { code: 'invalid_invite_secret' })
      }

      if (membership.get(MEMBERSHIP_FIELDS.status) === 'accepted') {
        return membershipResponse(documents, membership)
      }

      await operation('update membership status', () =>
        documents.transaction(async (tx) => {
          const team = await tx.get(model.collection, teamId)
          if (team.empty()) throw new NotFoundError('Team', { code: 'team_not_found' })

          membership.set(MEMBERSHIP_FIELDS.status, 'accepted')
          membership.set(MEMBERSHIP_FIELDS.joined, now())
          await tx.update(MEMBERSHIP_COLLECTION, membershipId, membership)

          team.set(model.fields.total, Number(team.get(model.fields.total, 0)) + 1)
          await tx.update(model.collection, teamId, team)
        }),
      )

      return membershipResponse(documents, membership)
    },
    async updateMembershipRoles(
      documents: TeamDocuments,
      teamId: string,
      membershipId: string,
      auth: ProjectAuthContext,
      input: { roles: readonly string[] },
    ): Promise<MembershipResponse> {
      await requireMembership(documents, teamId, membershipId)
      authorizeMembershipManagement(auth, teamId)
      const updated = await operation('update membership roles', () =>
        documents.update(
          MEMBERSHIP_COLLECTION,
          membershipId,
          new Doc({ [MEMBERSHIP_FIELDS.roles]: normalizeRoles(input.roles) }),
        ),
      )
      return membershipResponse(documents, updated)
    },

    async removeMembership(
      documents: TeamDocuments,
      teamId: string,
      membershipId: string,
      auth: ProjectAuthContext,
    ): Promise<void> {
      const membership = await requireMembership(documents, teamId, membershipId)
      authorizeMembershipManagement(auth, teamId)
      const accepted = membership.get(MEMBERSHIP_FIELDS.status) === 'accepted'

      await operation('remove membership', () =>
        documents.transaction(async (transaction) => {
          if (!(await transaction.remove(MEMBERSHIP_COLLECTION, membershipId))) {
            throw membershipNotFound()
          }
          if (accepted) {
            await transaction.decreaseDocumentAttribute(
              model.collection,
              teamId,
              model.fields.total,
              1,
              0,
            )
          }
        }),
      )
    },
  }
}

export type TeamService = ReturnType<typeof createTeamService>
