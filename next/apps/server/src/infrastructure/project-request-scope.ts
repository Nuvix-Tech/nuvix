import type { Session } from '@nuvix/db'
import { rolesFor } from '../context/database-roles'
import type { ProjectLocator } from '../context/project-locator'
import type {
  ProjectRequestContext,
  ProjectRequestOperation,
  TenantAuthDocuments,
  TenantAuthResolver,
} from '../context/project-request'
import type { SchemaService } from '../database/service'
import type { TenantDatabases } from './tenant-databases'

interface RequestTenantDatabase {
  for(...roles: string[]): Session
  readonly schemas: SchemaService
  system(): TenantAuthDocuments
}

type RequestTenantDatabases = Pick<TenantDatabases<RequestTenantDatabase>, 'acquire'>

async function release(
  lease: { release(): Promise<void> },
  operationError: unknown,
): Promise<void> {
  try {
    await lease.release()
  } catch (cleanupError) {
    if (operationError) {
      throw new AggregateError(
        [operationError, cleanupError],
        'Project request operation and cleanup failed',
      )
    }
    throw cleanupError
  }
}

/** Owns project resolution, tenant-local auth, caller session, and lease cleanup. */
export class ProjectRequestScope {
  constructor(
    private readonly projects: ProjectLocator,
    private readonly databases: RequestTenantDatabases,
    private readonly auth: TenantAuthResolver,
  ) {}

  async run<Result>(headers: Headers, operation: ProjectRequestOperation<Result>): Promise<Result> {
    const project = await this.projects.resolve(headers)
    const lease = await this.databases.acquire(project.id)
    let operationError: unknown

    try {
      const system = lease.database.system()
      const documents: TenantAuthDocuments = Object.freeze({
        find: system.find.bind(system),
        getDocument: system.getDocument.bind(system),
      })
      const auth = await this.auth.resolve({ headers, project, documents })
      const session = lease.database.for(...rolesFor(auth, project))
      const context: ProjectRequestContext = Object.freeze({
        project,
        auth,
        session,
        schemas: lease.database.schemas,
      })
      return await operation(context)
    } catch (error) {
      operationError = error
      throw error
    } finally {
      await release(lease, operationError)
    }
  }
}
