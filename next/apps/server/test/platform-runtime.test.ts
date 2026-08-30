import { describe, expect, test } from 'bun:test'
import type { Session } from '@nuvix/db'
import type { SchemaService } from '../src/database/service'
import { createDatabaseComposition } from '../src/infrastructure/database-composition'
import {
  createPlatformRuntime,
  type PlatformRuntimeConstruction,
} from '../src/infrastructure/platform-runtime'
import { createTenantTargetFilters } from '../src/infrastructure/tenant-target-codec'

const TENANT_TARGET_FILTERS = await createTenantTargetFilters(
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
)

const DATABASE_CAPABILITIES = Object.freeze({
  limits: Object.freeze({
    attributes: 100,
    documentBytes: 1_000_000,
    indexes: 100,
  }),
  features: Object.freeze({
    attributes: true,
    arrayIndexes: true,
    batchOperations: true,
    fullTextSearch: true,
    indexes: true,
    jsonOverlaps: true,
    relationships: true,
    schemas: true,
    timeouts: true,
    uniqueIndexes: true,
    updateLocks: true,
  }),
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function request(projectId: string): Request {
  return new Request('http://nuvix.test/v2/database/schemas', {
    headers: { 'x-test-project': projectId },
  })
}

function schemaService(
  projectId: string,
  onList: (projectId: string) => Promise<void>,
): SchemaService {
  return Object.freeze({
    list: async () => {
      await onList(projectId)
      return { data: [], meta: { total: 0 } }
    },
    get: async (name) => ({ name, description: null, type: 'managed' }),
    create: async (input) => ({
      ...input,
      description: input.description ?? null,
    }),
    update: async (name, description) => ({
      name,
      description: description ?? null,
      type: 'managed',
    }),
    remove: async () => {},
  })
}

function platformOwner(close: () => Promise<void>) {
  return Object.freeze({
    capabilities: DATABASE_CAPABILITIES,
    lookups: Object.freeze({
      find: async () => [],
      getDocument: async () => {
        throw new Error('Unused platform document lookup')
      },
      findOne: async () => {
        throw new Error('Unused platform document lookup')
      },
    }),
    close,
  })
}

describe('platform runtime', () => {
  test('owns an injectable SQLite platform and leaves schema setup explicit', async () => {
    const runtime = await createPlatformRuntime({
      database: { driver: 'sqlite', filename: ':memory:' },
      tenantTargetFilters: TENANT_TARGET_FILTERS,
      publishableKeyEnvironment: 'test',
      app: {
        isProduction: false,
        geoip: { lookup: () => null },
        uptime: () => 5,
      },
    })

    try {
      const response = await runtime.app.handle(new Request('http://nuvix.test/v2/health'))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        status: 'ok',
        version: '2.0.0-alpha.1',
        uptime: 5,
      })
      expect(Object.keys(runtime).toSorted()).toEqual(['app', 'close'])
    } finally {
      await runtime.close()
    }
  })

  test('closes process-owned resources idempotently', async () => {
    const runtime = await createPlatformRuntime({
      database: { driver: 'sqlite', filename: ':memory:' },
      tenantTargetFilters: TENANT_TARGET_FILTERS,
      publishableKeyEnvironment: 'test',
      app: { isProduction: false, geoip: { lookup: () => null } },
    })

    const first = runtime.close()

    expect(runtime.close()).toBe(first)
    await first
    expect(runtime.close()).toBe(first)
  })

  test('rejects acquisition, drains both tenant owners, and closes the platform last', async () => {
    const events: string[] = []
    const closeCounts = new Map<string, number>()
    const requestStarted = deferred<void>()
    const finishRequest = deferred<void>()
    const tenantCloseStarted = deferred<void>()
    const finishTenantClose = deferred<void>()
    const tenantBClosed = deferred<void>()
    const construction: PlatformRuntimeConstruction = {
      platform: async () =>
        platformOwner(async () => {
          events.push('close:platform')
        }),
      composition: () =>
        createDatabaseComposition({
          projectLocator: {
            resolve: async (headers) => ({
              id: headers.get('x-test-project') ?? 'project-missing',
              enabled: true,
            }),
          },
          tenantTargets: {
            resolve: async (projectId) => ({
              driver: 'postgresql',
              connectionString: `postgresql://example.test/${projectId}`,
            }),
          },
          tenantAuth: {
            resolve: async () => ({
              type: 'apiKey',
              keyId: 'lifecycle-key',
              mode: 'admin',
              scopes: ['schemas.read'],
            }),
          },
          createResource: async (target) => {
            const projectId = new URL(target.connectionString).pathname.slice(1)
            return {
              database: {
                for: () => ({}) as Session,
                system: () => ({
                  find: async () => [],
                  getDocument: async () => ({}) as never,
                }),
              },
              schemas: schemaService(projectId, async (selectedProjectId) => {
                if (selectedProjectId !== 'project-a') return
                events.push('request:project-a')
                requestStarted.resolve()
                await finishRequest.promise
              }),
              close: async () => {
                closeCounts.set(projectId, (closeCounts.get(projectId) ?? 0) + 1)
                events.push(`close:${projectId}:start`)
                if (projectId === 'project-a') {
                  tenantCloseStarted.resolve()
                  await finishTenantClose.promise
                }
                events.push(`close:${projectId}:end`)
                if (projectId === 'project-b') tenantBClosed.resolve()
              },
            }
          },
          registryOptions: { onCloseError: () => {} },
        }),
    }
    const runtime = await createPlatformRuntime(
      {
        database: { driver: 'sqlite', filename: ':memory:' },
        tenantTargetFilters: TENANT_TARGET_FILTERS,
        publishableKeyEnvironment: 'test',
        app: { isProduction: false, geoip: { lookup: () => null } },
      },
      construction,
    )

    const idleResponse = await runtime.app.handle(request('project-b'))
    expect(idleResponse.status).toBe(200)
    let requestSettled = false
    const activeRequest = runtime.app.handle(request('project-a')).then((response) => {
      requestSettled = true
      return response
    })
    await requestStarted.promise

    let runtimeSettled = false
    const sharedClose = runtime.close()
    expect(runtime.close()).toBe(sharedClose)
    const observedClose = sharedClose.then(
      () => {
        runtimeSettled = true
      },
      (error: unknown) => {
        runtimeSettled = true
        throw error
      },
    )
    const rejected = await runtime.app.handle(request('project-c'))
    expect(rejected.status).toBe(503)
    expect(await rejected.json()).toMatchObject({
      code: 'project_unavailable',
    })
    await tenantBClosed.promise
    expect(events).toContain('close:project-b:end')
    expect(events).not.toContain('close:platform')

    finishRequest.resolve()
    await tenantCloseStarted.promise
    await Promise.resolve()
    expect(requestSettled).toBe(false)
    expect(runtimeSettled).toBe(false)

    finishTenantClose.resolve()
    const activeResponse = await activeRequest
    await observedClose

    expect(activeResponse.status).toBe(200)
    expect(runtime.close()).toBe(sharedClose)
    expect(closeCounts).toEqual(
      new Map([
        ['project-b', 1],
        ['project-a', 1],
      ]),
    )
    expect(events.at(-1)).toBe('close:platform')
    expect(Object.keys(runtime).toSorted()).toEqual(['app', 'close'])
  })

  test('attempts every shutdown stage and exposes only redacted ordered failures', async () => {
    const events: string[] = []
    const construction: PlatformRuntimeConstruction = {
      platform: async () =>
        platformOwner(async () => {
          events.push('platform')
          throw new Error('/private/platform.sqlite provider cleanup failed')
        }),
      composition: () => ({
        requests: {
          withProject: async () => {
            throw new Error('Unused request scope')
          },
        },
        close: () => {
          events.push('tenants')
          throw new Error('postgresql://owner:tenant-secret@example.test/database')
        },
      }),
    }
    const runtime = await createPlatformRuntime(
      {
        database: { driver: 'sqlite', filename: ':memory:' },
        tenantTargetFilters: TENANT_TARGET_FILTERS,
        publishableKeyEnvironment: 'test',
        app: { isProduction: false, geoip: { lookup: () => null } },
      },
      construction,
    )

    const first = runtime.close()
    expect(runtime.close()).toBe(first)
    const failure = await first.catch((error: unknown) => error)

    expect(runtime.close()).toBe(first)
    expect(events).toEqual(['tenants', 'platform'])
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).message).toBe('Platform runtime close failed')
    expect((failure as AggregateError).errors.map((error) => (error as Error).message)).toEqual([
      'Tenant composition close failed',
      'Platform database close failed',
    ])
    const diagnostic = `${String(failure)} ${(failure as AggregateError).errors.join(' ')}`
    expect(diagnostic).not.toContain('tenant-secret')
    expect(diagnostic).not.toContain('platform.sqlite')
    expect(diagnostic).not.toContain('provider cleanup')
  })

  test('preserves a construction failure after attempting redacted rollback', async () => {
    const startupFailure = new Error('Application composition failed')
    const events: string[] = []
    const construction: PlatformRuntimeConstruction = {
      platform: async () =>
        platformOwner(async () => {
          events.push('platform')
          throw new Error('provider-secret cleanup failed')
        }),
      composition: () => {
        throw startupFailure
      },
    }

    const failure = await createPlatformRuntime(
      {
        database: { driver: 'sqlite', filename: ':memory:' },
        tenantTargetFilters: TENANT_TARGET_FILTERS,
        publishableKeyEnvironment: 'test',
        app: { isProduction: false, geoip: { lookup: () => null } },
      },
      construction,
    ).catch((error: unknown) => error)

    expect(failure).toBe(startupFailure)
    expect(events).toEqual(['platform'])
    expect(String(failure)).not.toContain('provider-secret')
  })
})
