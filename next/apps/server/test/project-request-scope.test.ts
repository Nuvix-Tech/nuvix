import { describe, expect, test } from 'bun:test'
import type { Session } from '@nuvix/db'
import type { ProjectAuthContext } from '../src/context/project'
import type { ProjectLocator } from '../src/context/project-locator'
import type { TenantAuthResolver } from '../src/context/project-request'
import type { SchemaService } from '../src/database/service'
import { ProjectRequestScope } from '../src/infrastructure/project-request-scope'
import {
  BadRequestError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../src/shared/errors'

const HEADERS = new Headers({
  'x-nuvix-publishable-key': 'pk_test_public',
  'x-nuvix-session': 'raw-session-secret',
})

function harness(options: { acquireError?: Error; authError?: Error; releaseError?: Error } = {}) {
  const order: string[] = []
  const roles: string[][] = []
  const documents = {
    plane: 'tenant-system',
    find: async () => [],
    getDocument: async () => ({}) as never,
  }
  const session = { plane: 'tenant-caller' } as unknown as Session
  const schemas: SchemaService = Object.freeze({
    list: async () => {
      order.push('schema')
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
  const project = { id: 'project_a', enabled: true } as const
  const auth: ProjectAuthContext = {
    type: 'session',
    sessionId: 'session_a',
    userId: 'user_a',
    verified: true,
    scopes: [],
  }
  const projects: ProjectLocator = {
    resolve: async () => {
      order.push('project')
      return project
    },
  }
  const databases = {
    acquire: async (projectId: string) => {
      order.push(`tenant:${projectId}`)
      if (options.acquireError) throw options.acquireError
      return {
        database: {
          schemas,
          system: () => {
            order.push('system')
            return documents as never
          },
          for: (...input: string[]) => {
            order.push('roles')
            roles.push(input)
            return session
          },
        },
        release: async () => {
          order.push('release')
          if (options.releaseError) throw options.releaseError
        },
      }
    },
  }
  const tenantAuth: TenantAuthResolver = {
    resolve: async ({ headers, documents: receivedDocuments, project: resolvedProject }) => {
      order.push('auth')
      expect(headers).toBe(HEADERS)
      expect(Object.keys(receivedDocuments).toSorted()).toEqual(['find', 'getDocument'])
      expect(receivedDocuments).not.toHaveProperty('plane')
      expect(resolvedProject).toBe(project)
      if (options.authError) throw options.authError
      return auth
    },
  }

  return {
    auth,
    order,
    roles,
    scope: new ProjectRequestScope(projects, databases, tenantAuth),
    schemas,
    session,
  }
}

describe('project request scope', () => {
  test('enforces project then tenant then auth then caller-session ordering', async () => {
    const state = harness()

    const result = await state.scope.run(HEADERS, async (context) => {
      state.order.push('handler')
      expect(Object.keys(context).toSorted()).toEqual(['auth', 'project', 'schemas', 'session'])
      expect(context.session).toBe(state.session)
      expect(context.schemas).toBe(state.schemas)
      expect(Object.isFrozen(context.schemas)).toBe(true)
      expect(Object.keys(context.schemas)).toEqual(['list', 'get', 'create', 'update', 'remove'])
      await context.schemas.list()
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(state.order).toEqual([
      'project',
      'tenant:project_a',
      'system',
      'auth',
      'roles',
      'handler',
      'schema',
      'release',
    ])
    expect(state.roles).toEqual([
      ['any', 'users', 'users/verified', 'user:user_a', 'user:user_a/verified'],
    ])
    expect(state.order.filter((event) => event === 'release')).toHaveLength(1)
  })

  test.each([
    [
      'publishable_key_invalid',
      new BadRequestError('Publishable key is invalid', {
        code: 'publishable_key_invalid',
      }),
    ],
    ['project_not_found', new NotFoundError('Project', { code: 'project_not_found' })],
    [
      'project_unavailable',
      new ServiceUnavailableError('Project is temporarily unavailable', {
        code: 'project_unavailable',
      }),
    ],
  ] as const)(
    'preserves the %s project-locator error without tenant acquisition',
    async (_code, projectError) => {
      const order: string[] = []
      const scope = new ProjectRequestScope(
        {
          resolve: async () => {
            order.push('project')
            throw projectError
          },
        },
        {
          acquire: async () => {
            order.push('tenant')
            throw new Error('must not run')
          },
        },
        {
          resolve: async () => {
            order.push('auth')
            return { type: 'guest' }
          },
        },
      )

      await expect(scope.run(HEADERS, async () => undefined)).rejects.toBe(projectError)
      expect(order).toEqual(['project'])
    },
  )

  test('redacts registry acquisition failures without releasing a nonexistent lease', async () => {
    const cause = new Error(
      'registry_internal_code: postgresql://owner:recognizable-secret@tenant.example/project_a',
    )
    const state = harness({ acquireError: cause })

    const failure = await state.scope
      .run(HEADERS, async () => undefined)
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ServiceUnavailableError)
    expect((failure as ServiceUnavailableError).status).toBe(503)
    expect((failure as ServiceUnavailableError).fields).toEqual({
      type: '/errors/unavailable',
      detail: 'Project is temporarily unavailable',
      code: 'project_unavailable',
    })
    expect(failure).not.toHaveProperty('cause')
    expect(String(failure)).not.toContain('recognizable-secret')
    expect(String(failure)).not.toContain('registry_internal_code')
    expect(state.order).toEqual(['project', 'tenant:project_a'])
  })

  test.each([
    [
      'credential_invalid',
      new UnauthorizedError('Credential is invalid', {
        code: 'credential_invalid',
      }),
    ],
    [
      'authentication_unavailable',
      new ServiceUnavailableError('Authentication is temporarily unavailable', {
        code: 'authentication_unavailable',
      }),
    ],
  ] as const)(
    'preserves the %s tenant-auth error and releases the tenant',
    async (_code, authError) => {
      const state = harness({ authError })

      await expect(state.scope.run(HEADERS, async () => undefined)).rejects.toBe(authError)
      expect(state.order).toEqual(['project', 'tenant:project_a', 'system', 'auth', 'release'])
      expect(state.order.filter((event) => event === 'release')).toHaveLength(1)
    },
  )

  test('preserves handler errors and releases the tenant exactly once', async () => {
    const handlerError = new NotFoundError('Schema', {
      code: 'schema_not_found',
    })
    const state = harness()

    await expect(
      state.scope.run(HEADERS, async () => {
        state.order.push('handler')
        throw handlerError
      }),
    ).rejects.toBe(handlerError)
    expect(state.order.at(-1)).toBe('release')
    expect(state.order.filter((event) => event === 'release')).toHaveLength(1)
  })

  test('preserves operation and release failures in order', async () => {
    const operationError = new Error('handler failed')
    const releaseError = new Error('release failed')
    const state = harness({ releaseError })

    const failure = await state.scope
      .run(HEADERS, async () => {
        throw operationError
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([operationError, releaseError])
    expect(state.order.at(-1)).toBe('release')
  })

  test('returns a release failure after a successful operation', async () => {
    const releaseError = new Error('release failed')
    const state = harness({ releaseError })

    await expect(state.scope.run(HEADERS, async () => 'ok')).rejects.toBe(releaseError)
  })
})
