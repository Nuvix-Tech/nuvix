import type { ProjectAuthContext } from '../context/project'

export type PolicyEffect = 'allow' | 'deny'

export interface BucketPolicyStatement {
  readonly sid?: string
  readonly effect: PolicyEffect
  readonly principal: string | readonly string[]
  readonly actions: readonly string[]
  readonly resources: readonly string[]
}

export interface BucketPolicy {
  readonly version?: string
  readonly statements: readonly BucketPolicyStatement[]
}

export const STORAGE_ACTIONS = {
  get: 'storage:GetObject',
  put: 'storage:PutObject',
  delete: 'storage:DeleteObject',
  list: 'storage:ListBucket',
  all: 'storage:*',
} as const

export type StorageAction = (typeof STORAGE_ACTIONS)[keyof typeof STORAGE_ACTIONS]

/** Fast pattern matching for resource keys supporting trailing wildcards (e.g. "avatars/*" or "*"). */
function matchResource(pattern: string, key: string): boolean {
  if (pattern === '*' || pattern === '/*') return true
  const cleanPattern = pattern.startsWith('/') ? pattern.slice(1) : pattern
  const cleanKey = key.startsWith('/') ? key.slice(1) : key

  if (cleanPattern.endsWith('/*')) {
    const prefix = cleanPattern.slice(0, -1) // e.g. "avatars/"
    return cleanKey.startsWith(prefix)
  }
  if (cleanPattern.endsWith('*')) {
    const prefix = cleanPattern.slice(0, -1)
    return cleanKey.startsWith(prefix)
  }
  return cleanPattern === cleanKey
}

/** Matches action against pattern (supports wildcards like "storage:*" or exact matches). */
function matchAction(actionPattern: string, targetAction: string): boolean {
  if (actionPattern === '*' || actionPattern === 'storage:*') return true
  if (actionPattern.toLowerCase() === targetAction.toLowerCase()) return true
  if (actionPattern.endsWith('*')) {
    const prefix = actionPattern.slice(0, -1).toLowerCase()
    return targetAction.toLowerCase().startsWith(prefix)
  }
  return false
}

/** Matches caller identity against S3 statement principal. */
function matchPrincipal(principalPattern: string, auth: ProjectAuthContext): boolean {
  if (principalPattern === '*') return true

  // API Key admin mode has broad access
  if (auth.type === 'apiKey') {
    if (principalPattern === 'apiKey' || principalPattern === `apiKey:${auth.keyId}`) return true
    if (auth.mode === 'admin') return true
  }

  // Authenticated users
  if (auth.type === 'session' || auth.type === 'jwt') {
    if (principalPattern === 'users') return true
    if (principalPattern === `user:${auth.userId}`) return true
    if (auth.teams && auth.teams.length > 0) {
      for (const team of auth.teams) {
        if (principalPattern === `team:${team.teamId}`) return true
        for (const role of team.roles) {
          if (principalPattern === `team:${team.teamId}:${role}`) return true
        }
      }
    }
  }

  if (auth.type === 'guest' && principalPattern === 'guest') return true

  return false
}

export interface EvaluatePolicyOptions {
  readonly auth: ProjectAuthContext
  readonly action: StorageAction
  readonly resourceKey: string
  readonly policy?: BucketPolicy | null
  readonly objectPermissions?: readonly string[]
  readonly bucketPermissions?: readonly string[]
}

export type PolicyDecision = 'allow' | 'deny'

/**
 * Evaluates S3 Bucket Policy and Nuvix ACL permissions.
 *
 * Rules:
 * 1. An explicit DENY statement in the S3 Bucket Policy overrides everything -> DENY.
 * 2. An explicit ALLOW statement in the S3 Bucket Policy -> ALLOW.
 * 3. If policy does not explicitly allow/deny, fallback to Nuvix Role-Based permissions:
 *    - API-keys with relevant scopes (files.read / files.write)
 *    - Document-level permissions: read("any"), write("user:{userId}"), etc.
 * 4. Default -> DENY.
 */
export function evaluateStorageAccess(options: EvaluatePolicyOptions): PolicyDecision {
  const {
    auth,
    action,
    resourceKey,
    policy,
    objectPermissions = [],
    bucketPermissions = [],
  } = options

  // Evaluate S3 Policy if present
  if (policy && Array.isArray(policy.statements)) {
    let hasExplicitAllow = false

    for (const stmt of policy.statements) {
      const actionMatches = stmt.actions.some((a: string) => matchAction(a, action))
      if (!actionMatches) continue

      const resourceMatches = stmt.resources.some((r: string) => matchResource(r, resourceKey))
      if (!resourceMatches) continue

      const principals = Array.isArray(stmt.principal) ? stmt.principal : [stmt.principal]
      const principalMatches = principals.some((p: string) => matchPrincipal(p, auth))
      if (!principalMatches) continue

      if (stmt.effect === 'deny') {
        return 'deny' // Immediate explicit deny
      }
      if (stmt.effect === 'allow') {
        hasExplicitAllow = true
      }
    }

    if (hasExplicitAllow) {
      return 'allow'
    }
  }

  // Fallback to Nuvix scopes & document permissions
  if (auth.type === 'apiKey') {
    const requiredScope =
      action === STORAGE_ACTIONS.get || action === STORAGE_ACTIONS.list
        ? 'files.read'
        : 'files.write'
    if (auth.scopes.includes(requiredScope) || auth.scopes.includes('files.*')) {
      return 'allow'
    }
  }

  // Check Nuvix document permissions on the object (or bucket)
  const isReadAction = action === STORAGE_ACTIONS.get || action === STORAGE_ACTIONS.list
  const effectivePermissions = [...new Set([...objectPermissions, ...bucketPermissions])]
  const teams = auth.type === 'session' || auth.type === 'jwt' ? auth.teams : undefined
  const userId = auth.type === 'session' || auth.type === 'jwt' ? auth.userId : undefined

  for (const perm of effectivePermissions) {
    if (isReadAction && perm.startsWith('read(')) {
      const target = perm.slice(5, -1).replace(/^"|"$/g, '')
      if (target === 'any') return 'allow'
      if (target === 'users' && (auth.type === 'session' || auth.type === 'jwt')) return 'allow'
      if (userId && target === `user:${userId}`) return 'allow'
      if (teams?.some((t) => target === `team:${t.teamId}`)) return 'allow'
    }
    if (!isReadAction && perm.startsWith('write(')) {
      const target = perm.slice(6, -1).replace(/^"|"$/g, '')
      if (target === 'any') return 'allow'
      if (target === 'users' && (auth.type === 'session' || auth.type === 'jwt')) return 'allow'
      if (userId && target === `user:${userId}`) return 'allow'
      if (teams?.some((t) => target === `team:${t.teamId}`)) return 'allow'
    }
  }

  return 'deny'
}
