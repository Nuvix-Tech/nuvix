import type { Session } from '@nuvix/db'
import type { ProjectResolver } from '../context/project'
import {
  createResolverBackedTenantDatabaseResource,
  type PlatformConnectionMetadataResolver,
  type TenantDatabaseResourceFactory,
} from './platform-connection-metadata'
import { RequestDatabaseSessions } from './request-database-sessions'
import { createTenantDatabaseResource } from './tenant-database-resource'
import {
  TenantDatabaseRegistry,
  type TenantDatabaseRegistryOptions,
  type TenantDatabaseResource,
} from './tenant-databases'

interface SessionDatabase {
  for(...roles: string[]): Session
}

export type DatabaseRegistryOptions = Omit<TenantDatabaseRegistryOptions<SessionDatabase>, 'create'>

export interface DatabaseCompositionOptions {
  readonly projectResolver: ProjectResolver
  readonly connectionMetadataResolver: PlatformConnectionMetadataResolver
  /** Omit to construct the production tenant resource after metadata resolution. */
  readonly createResource?: TenantDatabaseResourceFactory<TenantDatabaseResource<SessionDatabase>>
  /** Includes the required detached-close error reporter; registry defaults remain unchanged. */
  readonly registryOptions: DatabaseRegistryOptions
}

export interface DatabaseRequestCapabilities {
  readonly projects: Pick<ProjectResolver, 'resolve'>
  readonly databaseSessions: Pick<RequestDatabaseSessions, 'acquire'>
}

export interface DatabaseComposition {
  readonly requests: DatabaseRequestCapabilities
  /** Owner-only shutdown; drains request leases and preserves registry close retry semantics. */
  close(): Promise<void>
}

/** Composes injected project and metadata resolution into least-privilege request capabilities. */
export function createDatabaseComposition(
  options: DatabaseCompositionOptions,
): DatabaseComposition {
  const createResource = options.createResource ?? createTenantDatabaseResource
  const registry = new TenantDatabaseRegistry<SessionDatabase>({
    ...options.registryOptions,
    create: (projectId) =>
      createResolverBackedTenantDatabaseResource(
        projectId,
        options.connectionMetadataResolver,
        createResource,
      ),
  })
  const databaseSessions = new RequestDatabaseSessions(registry)

  return {
    close: () => registry.closeAll(),
    requests: {
      projects: {
        resolve: (input) => options.projectResolver.resolve(input),
      },
      databaseSessions: {
        acquire: (project, auth) => databaseSessions.acquire(project, auth),
      },
    },
  }
}
