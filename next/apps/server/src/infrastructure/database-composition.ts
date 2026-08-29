import type { Session } from '@nuvix/db'
import type { ProjectLocator } from '../context/project-locator'
import type {
  ProjectRequestOperation,
  TenantAuthDocuments,
  TenantAuthResolver,
} from '../context/project-request'
import type { TenantDatabaseTarget } from './platform-persistence-model'
import { ProjectRequestScope } from './project-request-scope'
import { createTenantDatabaseResource } from './tenant-database-resource'
import type { TenantTargetResolver } from './tenant-database-target'
import {
  TenantDatabaseRegistry,
  type TenantDatabaseRegistryOptions,
  type TenantDatabaseResource,
} from './tenant-databases'

interface RequestTenantDatabase {
  for(...roles: string[]): Session
  system(): TenantAuthDocuments
}

export type DatabaseRegistryOptions = Omit<
  TenantDatabaseRegistryOptions<RequestTenantDatabase>,
  'create'
>

export interface DatabaseCompositionOptions {
  readonly projectLocator: ProjectLocator
  readonly tenantTargets: TenantTargetResolver
  readonly tenantAuth: TenantAuthResolver
  readonly createResource?: (
    target: TenantDatabaseTarget,
  ) =>
    | TenantDatabaseResource<RequestTenantDatabase>
    | Promise<TenantDatabaseResource<RequestTenantDatabase>>
  readonly registryOptions: DatabaseRegistryOptions
}

export interface DatabaseRequestCapabilities {
  withProject<Result>(headers: Headers, operation: ProjectRequestOperation<Result>): Promise<Result>
}

export interface DatabaseComposition {
  readonly requests: DatabaseRequestCapabilities
  close(): Promise<void>
}

/** Composes the only allowed project → tenant → auth request sequence. */
export function createDatabaseComposition(
  options: DatabaseCompositionOptions,
): DatabaseComposition {
  const createResource = options.createResource ?? createTenantDatabaseResource
  const registry = new TenantDatabaseRegistry<RequestTenantDatabase>({
    ...options.registryOptions,
    create: async (projectId) => createResource(await options.tenantTargets.resolve(projectId)),
  })
  const scope = new ProjectRequestScope(options.projectLocator, registry, options.tenantAuth)

  return Object.freeze({
    requests: Object.freeze({
      withProject: <Result>(headers: Headers, operation: ProjectRequestOperation<Result>) =>
        scope.run(headers, operation),
    }),
    close: () => registry.closeAll(),
  })
}
