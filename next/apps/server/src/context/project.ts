import type { AuthContext } from './auth'

/** Safe request-visible project metadata. Connection credentials stay internal. */
export interface ProjectContext {
  readonly id: string
  readonly enabled: boolean
}

export interface TeamClaim {
  readonly teamId: string
  readonly roles: readonly string[]
}

interface ScopeClaims {
  readonly scopes: readonly string[]
}

interface UserClaims extends ScopeClaims {
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
  | (Extract<AuthContext, { type: 'apiKey' }> & ScopeClaims)

/** Resolves safe project metadata from an already-decoded public project ID. */
export interface ProjectResolver {
  resolve(projectId: string): Promise<ProjectContext | null>
}
