import type { Session } from '@nuvix/db'
import type { ProjectLocator } from '../context/project-locator'
import type {
  ProjectRequestOperation,
  TenantAuthDocuments,
  TenantAuthResolver,
} from '../context/project-request'
import type { SchemaService } from '../database/service'
import type { TenantDatabaseTarget } from './platform-persistence-model'
import { ProjectRequestScope } from './project-request-scope'
import { createTenantDatabaseResource } from './tenant-database-resource'
import type { TenantTargetResolver } from './tenant-database-target'
import {
  type TenantDatabaseResource as RegistryTenantDatabaseResource,
  TenantDatabaseRegistry,
  type TenantDatabaseRegistryOptions,
} from './tenant-databases'

interface TenantDatabaseAdmin {
  for(...roles: string[]): Session
  system(): TenantAuthDocuments
}

interface RequestTenantDatabase extends TenantDatabaseAdmin {
  readonly schemas: SchemaService
}

interface CompositionTenantDatabaseResource
  extends RegistryTenantDatabaseResource<TenantDatabaseAdmin> {
  readonly schemas: SchemaService
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
  ) => CompositionTenantDatabaseResource | Promise<CompositionTenantDatabaseResource>
  readonly registryOptions: DatabaseRegistryOptions
}

export interface DatabaseRequestCapabilities {
  withProject<Result>(headers: Headers, operation: ProjectRequestOperation<Result>): Promise<Result>
}

export interface DatabaseComposition {
  readonly requests: DatabaseRequestCapabilities
  close(): Promise<void>
}

function requestResource(
  resource: CompositionTenantDatabaseResource,
): RegistryTenantDatabaseResource<RequestTenantDatabase> {
  const database = resource.database

  return {
    database: Object.freeze({
      for: database.for.bind(database),
      schemas: resource.schemas,
      system: database.system.bind(database),
    }),
    close: resource.close.bind(resource),
  }
}

async function createReadyResource(
  target: TenantDatabaseTarget,
): Promise<CompositionTenantDatabaseResource> {
  const resource = createTenantDatabaseResource(target)

  try {
    // Bun SQL connects lazily. Probing here keeps an unreachable target inside
    // tenant acquisition, before tenant-local authentication can misclassify it.
    await resource.postgres.raw<void>('select 1').execute()
    return resource
  } catch {
    await resource.close().catch(() => undefined)
    throw new Error('Tenant database resource initialization failed')
  }
}

/** Composes the only allowed project → tenant → auth request sequence. */
export function createDatabaseComposition(
  options: DatabaseCompositionOptions,
): DatabaseComposition {
  const createResource = options.createResource ?? createReadyResource
  const registry = new TenantDatabaseRegistry<RequestTenantDatabase>({
    ...options.registryOptions,
    create: async (projectId) =>
      requestResource(await createResource(await options.tenantTargets.resolve(projectId))),
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
