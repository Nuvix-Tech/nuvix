import type { AuthContext } from './auth'

/** Safe request-visible project metadata. Connection credentials stay internal. */
export interface ProjectContext {
  readonly id: string
  readonly internalId: string
  readonly enabled: boolean
}

export interface TeamClaim {
  readonly teamId: string
  readonly roles: readonly string[]
}

interface ProjectBinding {
  readonly projectId: string
  readonly scopes: readonly string[]
}

interface UserClaims extends ProjectBinding {
  readonly verified: boolean
  readonly teams?: readonly TeamClaim[]
  readonly labels?: readonly string[]
}

/**
 * Auth context after a credential has been bound to a project.
 * Claims stay structured so only `rolesFor` assembles database role strings.
 */
export type ProjectAuthContext =
  | Extract<AuthContext, { type: 'guest' }>
  | (Extract<AuthContext, { type: 'session' | 'jwt' }> & UserClaims)
  | (Extract<AuthContext, { type: 'apiKey' }> & ProjectBinding)

export interface ProjectResolutionInput {
  readonly auth: AuthContext
  /** Untrusted request locator; the resolver must verify credential binding. */
  readonly requestedProjectId: string | null
}

/** Resolves safe project metadata and validates credential/project binding. */
export interface ProjectResolver {
  resolve(input: ProjectResolutionInput): Promise<{
    auth: ProjectAuthContext
    project: ProjectContext
  } | null>
}
