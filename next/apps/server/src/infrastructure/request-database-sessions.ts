import type { Session } from '@nuvix/db'
import { rolesFor } from '../context/database-roles'
import type { ProjectAuthContext, ProjectContext } from '../context/project'
import type { TenantDatabases } from './tenant-databases'

interface SessionDatabase {
  for(...roles: string[]): Session
}

type SessionDatabases = Pick<TenantDatabases<SessionDatabase>, 'acquire'>

export interface RequestDatabaseSessionLease {
  readonly session: Session
  /** Releases once; repeated calls return the same promise, including the same cleanup failure. */
  release(): Promise<void>
}

/** Acquires tenant ownership and exposes only a caller-scoped document session. */
export class RequestDatabaseSessions {
  constructor(private readonly databases: SessionDatabases) {}

  async acquire(
    project: ProjectContext,
    auth: ProjectAuthContext,
  ): Promise<RequestDatabaseSessionLease> {
    const tenantLease = await this.databases.acquire(project.id)
    let releasePromise: Promise<void> | undefined
    const release = () => {
      releasePromise ??= Promise.resolve().then(() => tenantLease.release())
      return releasePromise
    }

    try {
      const session = tenantLease.database.for(...rolesFor(auth, project))
      return { session, release }
    } catch (setupError) {
      try {
        await release()
      } catch (releaseError) {
        throw new AggregateError(
          [setupError, releaseError],
          'Request database session setup and cleanup failed',
        )
      }
      throw setupError
    }
  }
}
