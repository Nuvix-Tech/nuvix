import { Doc, ID, Permission, Query, Role } from '@nuvix/db'
import { apiScopeLabel } from '../context/database-roles'
import type { ProjectAuthContext } from '../context/project'
import { TENANT_AUTH_MODEL } from '../context/tenant-auth-model'
import { translatePackageError } from '../infrastructure/package-errors'
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from '../shared/errors'
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

export interface TeamServiceOptions {
  readonly model?: TeamModel
  readonly id?: () => string
  readonly now?: () => Date
}

const ROLE_PATTERN = /^[\p{L}\p{M}\p{N}._-]{1,32}$/u

export function authorizeTeams(
  auth: ProjectAuthContext,
  scope: 'teams.read' | 'teams.write',
): void {
  if (auth.type === 'guest') throw new ForbiddenError()
  if (auth.type === 'apiKey' && !auth.scopes.includes(scope)) throw new ForbiddenError()
}

function roles(input: readonly string[]): readonly string[] {
  const normalized = [...new Set(input)]
  if (normalized.length > 100 || normalized.some((role) => !ROLE_PATTERN.test(role))) {
    throw new BadRequestError('Invalid team roles')
  }
  if (!normalized.includes('owner')) normalized.push('owner')
  return Object.freeze(normalized.toSorted())
}

function iso(value: Date | string | null): string {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) throw new Error('Team timestamp is invalid')
  return date.toISOString()
}

function prefs(value: unknown): TeamPreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as TeamPreferences
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
    Permission.update(Role.user(userId)),
    Permission.update(Role.team(teamId, 'owner')),
    Permission.delete(Role.user(userId)),
    Permission.delete(Role.team(teamId, 'owner')),
  ]
}

export function createTeamService(options: TeamServiceOptions = {}) {
  const model = options.model ?? TEAM_MODEL
  const createId = options.id ?? (() => ID.unique())
  const now = options.now ?? (() => new Date())

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
  }
}

export type TeamService = ReturnType<typeof createTeamService>
