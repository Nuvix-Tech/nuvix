import type { Session } from '@nuvix/db'
import type { ProjectAuthContext, ProjectContext } from './project'

export type TenantAuthDocuments = Pick<Session, 'find' | 'getDocument'>

export interface TenantAuthInput {
  readonly headers: Headers
  readonly project: ProjectContext
  readonly documents: TenantAuthDocuments
}

/** Tenant-bound authentication; called only after the tenant database is acquired. */
export interface TenantAuthResolver {
  resolve(input: TenantAuthInput): Promise<ProjectAuthContext>
}

export interface ProjectRequestContext {
  readonly project: ProjectContext
  readonly auth: ProjectAuthContext
  readonly session: Session
}

export type ProjectRequestOperation<Result> = (
  context: ProjectRequestContext,
) => Result | Promise<Result>
