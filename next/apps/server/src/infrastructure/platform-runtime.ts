import { type AppOptions, createApp, type NuvixApp } from '../app'
import { createProjectLocator } from '../context/project-locator'
import type { PublishableKeyEnvironment } from '../context/publishable-key'
import { createTenantAuthResolver } from '../context/tenant-auth'
import type { DatabaseAdapterConfiguration } from './database-adapter-config'
import {
  createDatabaseComposition,
  type DatabaseRegistryOptions,
  type DatabaseRequestCapabilities,
} from './database-composition'
import { createPlatformDatabase } from './platform-database'
import { createPlatformProjectLookup } from './platform-projects'
import { createTenantTargetResolver } from './tenant-database-target'

export interface PlatformRuntimeOptions {
  readonly database: DatabaseAdapterConfiguration
  readonly publishableKeyEnvironment: PublishableKeyEnvironment
  readonly app?: AppOptions
  readonly tenantRegistry?: Pick<DatabaseRegistryOptions, 'idleMs' | 'maxTenants'>
  readonly onTenantCloseError?: (error: unknown) => void
}

export interface PlatformRuntime {
  readonly app: NuvixApp
  readonly requests: DatabaseRequestCapabilities
  close(): Promise<void>
}

async function closeInOrder(
  closeTenants: () => Promise<void>,
  closePlatform: () => Promise<void>,
): Promise<void> {
  const failures: unknown[] = []
  await closeTenants().catch((error: unknown) => failures.push(error))
  await closePlatform().catch((error: unknown) => failures.push(error))
  if (failures.length > 0) throw new AggregateError(failures, 'Platform runtime close failed')
}

/** Owns live platform and tenant resources; collection setup remains explicit provisioning. */
export async function createPlatformRuntime(
  options: PlatformRuntimeOptions,
): Promise<PlatformRuntime> {
  const platform = await createPlatformDatabase(options.database)
  let database: ReturnType<typeof createDatabaseComposition> | undefined

  try {
    const projects = createPlatformProjectLookup(platform.lookups)
    const projectLocator = createProjectLocator(projects, options.publishableKeyEnvironment)
    const tenantTargets = createTenantTargetResolver(platform.lookups)
    database = createDatabaseComposition({
      projectLocator,
      tenantTargets,
      tenantAuth: createTenantAuthResolver(),
      registryOptions: {
        ...options.tenantRegistry,
        onCloseError: (error) => options.onTenantCloseError?.(error),
      },
    })
    const app = await createApp(options.app)
    let closePromise: Promise<void> | undefined

    return Object.freeze({
      app,
      requests: database.requests,
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
