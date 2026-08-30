import { Role, RoleName, UserDimension } from '@nuvix/db'
import { ForbiddenError } from '../shared/errors'
import type { ProjectAuthContext, ProjectContext } from './project'

const ROLE_COMPONENT = /^[\p{L}\p{M}\p{N}._-]+$/u
export const API_SCOPE_ROLE_PREFIX = 'nxs'

function component(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.normalize('NFC') ||
    !ROLE_COMPONENT.test(value)
  ) {
    throw new ForbiddenError('Credential contains invalid role claims')
  }

  return value
}

function serialize(
  role: RoleName,
  identifier: string | null = null,
  dimension: string | null = null,
): string {
  return Role.custom(role, identifier, dimension).toString()
}

function compare(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/** Maps a public scope to a reserved @nuvix/db-compatible label identifier. */
export function apiScopeLabel(scope: string): string {
  const digest = new Bun.CryptoHasher('sha256').update(component(scope)).digest('hex').slice(0, 32)
  return `${API_SCOPE_ROLE_PREFIX}${digest}`
}

/** The only request boundary allowed to assemble @nuvix/db role strings. */
export function rolesFor(auth: ProjectAuthContext, project: ProjectContext): readonly string[] {
  if (!project.enabled) throw new ForbiddenError('Project is disabled')
  if (auth.type === 'guest') {
    return [serialize(RoleName.ANY), serialize(RoleName.GUESTS)]
  }

  const roles = new Set<string>([serialize(RoleName.ANY)])
  if (auth.type === 'apiKey') {
    for (const scope of auth.scopes.map(component).toSorted(compare)) {
      roles.add(serialize(RoleName.LABEL, apiScopeLabel(scope)))
    }
    return [...roles]
  }

  const userId = component(auth.userId)
  const dimension = auth.verified ? UserDimension.VERIFIED : UserDimension.UNVERIFIED
  roles.add(serialize(RoleName.USERS))
  roles.add(serialize(RoleName.USERS, null, dimension))
  roles.add(serialize(RoleName.USER, userId))
  roles.add(serialize(RoleName.USER, userId, dimension))

  const teams = new Map<string, Set<string>>()
  for (const team of auth.teams ?? []) {
    if (!Array.isArray(team.roles)) {
      throw new ForbiddenError('Credential contains invalid role claims')
    }
    const teamId = component(team.teamId)
    const membershipRoles = teams.get(teamId) ?? new Set<string>()
    for (const membershipRole of team.roles) {
      membershipRoles.add(component(membershipRole))
    }
    teams.set(teamId, membershipRoles)
  }

  for (const [teamId, membershipRoles] of [...teams.entries()].toSorted(([left], [right]) =>
    compare(left, right),
  )) {
    roles.add(serialize(RoleName.TEAM, teamId))
    for (const membershipRole of [...membershipRoles].toSorted(compare)) {
      roles.add(serialize(RoleName.TEAM, teamId, membershipRole))
    }
  }

  for (const label of (auth.labels ?? []).map(component).toSorted(compare)) {
    if (label.startsWith(API_SCOPE_ROLE_PREFIX)) {
      throw new ForbiddenError('Credential contains invalid role claims')
    }
    roles.add(serialize(RoleName.LABEL, label))
  }

  return [...roles]
}
