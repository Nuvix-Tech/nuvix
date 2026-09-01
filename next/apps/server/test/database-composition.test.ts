import { describe, expect, test } from 'bun:test'
import { None } from '@nuvix/cache'
import type { Session } from '@nuvix/db'
import type { ProjectLocator } from '../src/context/project-locator'
import type { TenantAuthDocuments, TenantAuthResolver } from '../src/context/project-request'
import type { SchemaCatalog } from '../src/database/catalog'
import type { SchemaService } from '../src/database/service'
import {
  createDatabaseComposition,
  type DatabaseCompositionOptions,
} from '../src/infrastructure/database-composition'
import type { TenantDatabaseTarget } from '../src/infrastructure/platform-persistence-model'
import {
  createTenantDatabaseResource,
  type TenantDatabaseConstruction,
} from '../src/infrastructure/tenant-database-resource'
import { ServiceUnavailableError } from '../src/shared/errors'

function harness() {
  const events: string[] = []
  const resourceSchemas = new Map<string, SchemaService>()
  const targets = new Map<string, TenantDatabaseTarget>([
    ['project_a', { driver: 'postgresql', connectionString: 'postgresql://example.test/a' }],
    ['project_b', { driver: 'postgresql', connectionString: 'postgresql://example.test/b' }],
  ])
  const locator: ProjectLocator = {
    resolve: async (headers) => {
      const projectId = headers.get('x-test-project')!
      events.push(`project:${projectId}`)
      return { id: projectId, enabled: true }
    },
  }
  const tenantAuth: TenantAuthResolver = {
    resolve: async ({ headers, project }) => {
      const projectId = project.id
      events.push(`auth:${projectId}`)
      return headers.get('x-test-user-project') === projectId
        ? {
            type: 'session',
            sessionId: `session_${projectId}`,
            userId: `user_${projectId}`,
            verified: true,
            scopes: [],
          }
        : { type: 'guest' }
    },
  }
  const composition = createDatabaseComposition({
    projectLocator: locator,
    tenantTargets: {
      resolve: async (projectId) => {
        events.push(`target:${projectId}`)
        return targets.get(projectId)!
      },
    },
    tenantAuth,
    createResource: async (target) => {
      const projectId = target.connectionString.endsWith('/a') ? 'project_a' : 'project_b'
      events.push(`create:${projectId}`)
      const schemas: SchemaService = Object.freeze({
        list: async () => ({ data: [], meta: { total: 0 } }),
        get: async (name: string) => ({
          name,
          description: null,
          type: 'managed' as const,
        }),
        create: async (input: Parameters<SchemaService['create']>[0]) => ({
          ...input,
          description: input.description ?? null,
        }),
        update: async (name: string, description?: string | null) => ({
          name,
          description: description ?? null,
          type: 'managed' as const,
        }),
        remove: async () => {},
      })
      resourceSchemas.set(projectId, schemas)
      return {
        database: {
          system: () => ({
            find: async () => [],
            getDocument: async () => ({}) as never,
          }),
          for: (...roles: string[]) => ({ projectId, roles }) as unknown as Session,
        },
        schemas,
        close: async () => {
          events.push(`close:${projectId}`)
        },
      }
    },
    registryOptions: { onCloseError: () => {} },
  })
  return { composition, events, resourceSchemas }
}

const headers = (projectId: string, credentialProject = projectId) =>
  new Headers({
    'x-test-project': projectId,
    'x-test-user-project': credentialProject,
  })

function failureHarness(options: {
  readonly createResource?: NonNullable<DatabaseCompositionOptions['createResource']>
  readonly onCloseError?: (error: unknown, projectId: string) => void
  readonly target?: TenantDatabaseTarget
  readonly targetError?: Error
  readonly resourceError?: Error
}) {
  const events: string[] = []
  const createResource =
    options.createResource ??
    (options.resourceError
      ? async () => {
          events.push('create')
          throw options.resourceError
        }
      : undefined)
  const composition = createDatabaseComposition({
    projectLocator: {
      resolve: async () => {
        events.push('project')
        return { id: 'project_a', enabled: true }
      },
    },
    tenantTargets: {
      resolve: async () => {
        events.push('target')
        if (options.targetError) throw options.targetError
        return (
          options.target ?? {
            driver: 'postgresql',
            connectionString: 'postgresql://tenant.example/project_a',
          }
        )
      },
    },
    tenantAuth: {
      resolve: async () => {
        events.push('auth')
        return { type: 'guest' }
      },
    },
    ...(createResource ? { createResource } : {}),
    registryOptions: { onCloseError: options.onCloseError ?? (() => {}) },
  })
  return { composition, events }
}

function expectProjectUnavailable(failure: unknown, redacted: readonly string[]): void {
  expect(failure).toBeInstanceOf(ServiceUnavailableError)
  const unavailable = failure as ServiceUnavailableError
  expect(unavailable.status).toBe(503)
  expect(unavailable.fields).toEqual({
    type: '/errors/unavailable',
    detail: 'Project is temporarily unavailable',
    code: 'project_unavailable',
  })
  expect(unavailable).not.toHaveProperty('cause')

  const publicValue = `${String(unavailable)} ${JSON.stringify(unavailable.fields)}`
  for (const value of redacted) expect(publicValue).not.toContain(value)
}

describe('database composition', () => {
  test('redacts tenant target resolver failures before authentication', async () => {
    const state = failureHarness({
      targetError: new Error(
        'target_resolver_internal: postgresql://owner:resolver-secret@tenant.example/project_a',
      ),
    })

    const failure = await state.composition.requests
      .withProject(headers('project_a'), async () => 'unexpected')
      .catch((error: unknown) => error)

    expectProjectUnavailable(failure, [
      'target_resolver_internal',
      'postgresql://',
      'resolver-secret',
    ])
    expect(state.events).toEqual(['project', 'target'])
  })

  test('redacts malformed tenant targets during resource construction', async () => {
    const state = failureHarness({
      target: {
        driver: 'postgresql',
        connectionString: 'redis://owner:malformed-target-secret@tenant.example/project_a',
      },
    })

    const failure = await state.composition.requests
      .withProject(headers('project_a'), async () => 'unexpected')
      .catch((error: unknown) => error)

    expectProjectUnavailable(failure, ['redis://', 'malformed-target-secret', 'tenant.example'])
    expect(state.events).toEqual(['project', 'target'])
  })

  test('redacts tenant resource construction failures before authentication', async () => {
    const state = failureHarness({
      target: {
        driver: 'postgresql',
        connectionString: 'postgresql://owner:target-secret@tenant.example/project_a',
      },
      resourceError: new Error(
        'PG_DRIVER_42 provider refused ciphertext=ciphertext-secret credential=driver-secret',
      ),
    })

    const failure = await state.composition.requests
      .withProject(headers('project_a'), async () => 'unexpected')
      .catch((error: unknown) => error)

    expectProjectUnavailable(failure, [
      'target-secret',
      'tenant.example',
      'PG_DRIVER_42',
      'provider refused',
      'ciphertext-secret',
      'driver-secret',
    ])
    expect(state.events).toEqual(['project', 'target', 'create'])
  })

  test('keeps failed initialization cleanup diagnostics at the project owner boundary', async () => {
    const readinessFailure = new Error(
      'readiness failed for postgresql://owner:tenant-secret@tenant.example/project_a',
    )
    const closeFailure = new Error('provider close failed with socket=/private/provider.sock')
    const reported: Array<{ error: unknown; projectId: string }> = []
    const catalog: SchemaCatalog = {
      list: async () => [],
      get: async () => undefined,
      create: async () => {},
      update: async () => undefined,
      remove: async () => {},
    }
    let closes = 0
    const construction: TenantDatabaseConstruction<
      { close(): Promise<void> },
      object,
      { for(...roles: string[]): Session; system(): TenantAuthDocuments },
      object
    > = {
      sql: () => ({
        close: async () => {
          closes += 1
          throw closeFailure
        },
      }),
      postgresql: () => ({}),
      database: () => ({
        for: () => ({}) as Session,
        system: () => ({
          find: async () => [],
          getDocument: async () => ({}) as never,
        }),
      }),
      postgres: () => ({}),
      ready: async () => {
        throw readinessFailure
      },
      catalog: () => catalog,
      documentAdmin: () => ({ create: async () => {} }),
      none: () => new None(),
    }
    const state = failureHarness({
      createResource: (target, reportCloseError) =>
        createTenantDatabaseResource(target, undefined, construction, reportCloseError),
      onCloseError: (error, projectId) => reported.push({ error, projectId }),
    })

    const failure = await state.composition.requests
      .withProject(headers('project_a'), async () => 'unexpected')
      .catch((error: unknown) => error)

    expectProjectUnavailable(failure, [
      'tenant-secret',
      'tenant.example',
      'provider close failed',
      '/private/provider.sock',
    ])
    expect(reported).toEqual([{ error: closeFailure, projectId: 'project_a' }])
    expect(closes).toBe(1)
    expect(state.events).toEqual(['project', 'target'])
  })

  test('selects target, constructs tenant, and authenticates inside it', async () => {
    const state = harness()

    const context = await state.composition.requests.withProject(
      headers('project_a'),
      (value) => value,
    )
    const expectedSchemas = state.resourceSchemas.get('project_a')
    if (!expectedSchemas) throw new Error('Expected project_a schema capability')

    expect(context.project.id).toBe('project_a')
    expect(context.auth.type).toBe('session')
    expect((context.session as unknown as { projectId: string }).projectId).toBe('project_a')
    expect(Object.keys(context.schemas)).toEqual(['list', 'get', 'create', 'update', 'remove'])
    expect(Object.isFrozen(context.schemas)).toBe(true)
    expect(context.schemas).toBe(expectedSchemas)
    expect(context).not.toHaveProperty('database')
    expect(context).not.toHaveProperty('registry')
    expect(context).not.toHaveProperty('close')
    expect(state.events).toEqual([
      'project:project_a',
      'target:project_a',
      'create:project_a',
      'auth:project_a',
    ])
  })

  test('does not let a credential from another tenant change tenant selection', async () => {
    const state = harness()

    const context = await state.composition.requests.withProject(
      headers('project_a', 'project_b'),
      (value) => value,
    )

    expect(context.project.id).toBe('project_a')
    expect(context.auth).toEqual({ type: 'guest' })
    expect((context.session as unknown as { projectId: string }).projectId).toBe('project_a')
    expect(state.events).not.toContain('target:project_b')
  })

  test('deduplicates tenant construction and closes through owner capability', async () => {
    const state = harness()

    const services = await Promise.all([
      state.composition.requests.withProject(
        headers('project_b'),
        async (context) => context.schemas,
      ),
      state.composition.requests.withProject(
        headers('project_b'),
        async (context) => context.schemas,
      ),
    ])
    await Promise.all([state.composition.close(), state.composition.close()])

    expect(services[0]).toBe(services[1])
    expect(state.events.filter((event) => event === 'create:project_b')).toHaveLength(1)
    expect(state.events.filter((event) => event === 'close:project_b')).toHaveLength(1)
    expect(Object.keys(state.composition.requests)).toEqual(['withProject'])
  })

  test('keeps schema capability identity tenant-local', async () => {
    const state = harness()

    const [projectA, projectB] = await Promise.all([
      state.composition.requests.withProject(
        headers('project_a'),
        async (context) => context.schemas,
      ),
      state.composition.requests.withProject(
        headers('project_b'),
        async (context) => context.schemas,
      ),
    ])
    const expectedProjectA = state.resourceSchemas.get('project_a')
    const expectedProjectB = state.resourceSchemas.get('project_b')
    if (!expectedProjectA || !expectedProjectB) {
      throw new Error('Expected tenant-local schema capabilities')
    }

    expect(projectA).not.toBe(projectB)
    expect(projectA).toBe(expectedProjectA)
    expect(projectB).toBe(expectedProjectB)
  })
})
