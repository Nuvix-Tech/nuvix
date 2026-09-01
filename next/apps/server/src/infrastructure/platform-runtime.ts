import { type AppOptions, createApp, type NuvixApp } from '../app'
import { createProjectLocator } from '../context/project-locator'
import type { PublishableKeyEnvironment } from '../context/publishable-key'
import { createTenantAuthResolver } from '../context/tenant-auth'
import type { PlatformDatabaseConfiguration } from './database-adapter-config'
import {
  createDatabaseComposition,
  type DatabaseComposition,
  type DatabaseCompositionOptions,
  type DatabaseRegistryOptions,
} from './database-composition'
import {
  createPlatformDatabase,
  type PlatformDatabaseOptions,
  type PlatformDatabaseOwner,
} from './platform-database'
import { createPlatformProjectLookup } from './platform-projects'
import { createTenantTargetResolver } from './tenant-database-target'
import type { TenantTargetFilters } from './tenant-target-codec'

export interface PlatformRuntimeOptions {
  readonly database: PlatformDatabaseConfiguration
  readonly tenantTargetFilters: TenantTargetFilters
  readonly publishableKeyEnvironment: PublishableKeyEnvironment
  readonly app?: AppOptions
  readonly tenantRegistry?: Pick<DatabaseRegistryOptions, 'idleMs' | 'maxTenants'>
  readonly onTenantCloseError?: (error: unknown, projectId: string) => void
}

export interface PlatformRuntime {
  readonly app: NuvixApp
  close(): Promise<void>
}

/** Process-owner construction seam; none of these capabilities enter request context. */
export interface PlatformRuntimeConstruction {
  readonly platform: (
    database: PlatformDatabaseConfiguration,
    options: PlatformDatabaseOptions,
  ) => Promise<PlatformDatabaseOwner>
  readonly composition: (options: DatabaseCompositionOptions) => DatabaseComposition
}

const DEFAULT_CONSTRUCTION: PlatformRuntimeConstruction = {
  platform: createPlatformDatabase,
  composition: createDatabaseComposition,
}

async function closeInOrder(
  closeTenants: () => Promise<void>,
  closePlatform: () => Promise<void>,
): Promise<void> {
  const failures: Error[] = []
  await Promise.resolve()
    .then(closeTenants)
    .catch(() => failures.push(new Error('Tenant composition close failed')))
  await Promise.resolve()
    .then(closePlatform)
    .catch(() => failures.push(new Error('Platform database close failed')))
  if (failures.length > 0) throw new AggregateError(failures, 'Platform runtime close failed')
}

/** Owns live platform and tenant resources; collection setup remains explicit provisioning. */
export async function createPlatformRuntime(
  options: PlatformRuntimeOptions,
  construction: PlatformRuntimeConstruction = DEFAULT_CONSTRUCTION,
): Promise<PlatformRuntime> {
  const platform = await construction.platform(options.database, {
    tenantTargetFilters: options.tenantTargetFilters,
  })
  let database: DatabaseComposition | undefined

  try {
    const projects = createPlatformProjectLookup(platform.lookups)
    const projectLocator = createProjectLocator(projects, options.publishableKeyEnvironment)
    const tenantTargets = createTenantTargetResolver(platform.lookups)
    database = construction.composition({
      projectLocator,
      tenantTargets,
      tenantAuth: createTenantAuthResolver(),
      registryOptions: {
        ...options.tenantRegistry,
        onCloseError: (error, projectId) => options.onTenantCloseError?.(error, projectId),
      },
    })
    const app = await createApp({
      ...options.app,
      projectRequests: database.requests,
    })
    let closePromise: Promise<void> | undefined

    return Object.freeze({
      app,
      close: () => {
        closePromise ??= closeInOrder(database!.close, platform.close)
        return closePromise
      },
    })
  } catch (error) {
    await closeInOrder(database?.close ?? (async () => {}), platform.close).catch(() => undefined)
    throw error
  }
}
