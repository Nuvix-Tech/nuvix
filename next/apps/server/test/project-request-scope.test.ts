import { describe, expect, test } from 'bun:test'
import type { Session } from '@nuvix/db'
import type { ProjectAuthContext } from '../src/context/project'
import type { ProjectLocator } from '../src/context/project-locator'
import type { TenantAuthResolver } from '../src/context/project-request'
import { ProjectRequestScope } from '../src/infrastructure/project-request-scope'

const HEADERS = new Headers({
  'x-nuvix-publishable-key': 'pk_test_public',
  'x-nuvix-session': 'raw-session-secret',
})

function harness(
  options: { authError?: Error; operationError?: Error; releaseError?: Error } = {},
) {
  const order: string[] = []
  const roles: string[][] = []
  const documents = { plane: 'tenant-system' }
  const session = { plane: 'tenant-caller' } as unknown as Session
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
      return {
        database: {
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
    resolve: async (headers, receivedDocuments) => {
      order.push('auth')
      expect(headers).toBe(HEADERS)
      expect(receivedDocuments).toBe(documents as never)
      if (options.authError) throw options.authError
      return auth
    },
  }

  return {
    auth,
    order,
    roles,
    scope: new ProjectRequestScope(projects, databases, tenantAuth),
    session,
  }
}

describe('project request scope', () => {
  test('enforces project then tenant then auth then caller-session ordering', async () => {
    const state = harness()

    const result = await state.scope.run(HEADERS, async (context) => {
      state.order.push('handler')
      expect(Object.keys(context).toSorted()).toEqual(['auth', 'project', 'session'])
      expect(context.session).toBe(state.session)
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
      'release',
    ])
    expect(state.roles).toEqual([
      ['any', 'users', 'users/verified', 'user:user_a', 'user:user_a/verified'],
    ])
  })

  test('does not acquire a tenant when project resolution fails', async () => {
    const order: string[] = []
    const scope = new ProjectRequestScope(
      {
        resolve: async () => {
          order.push('project')
          throw new Error('project failed')
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

    await expect(scope.run(HEADERS, async () => undefined)).rejects.toThrow('project failed')
    expect(order).toEqual(['project'])
  })

  test('releases the tenant when authentication fails', async () => {
    const authError = new Error('credential invalid in selected tenant')
    const state = harness({ authError })

    await expect(state.scope.run(HEADERS, async () => undefined)).rejects.toBe(authError)
    expect(state.order).toEqual(['project', 'tenant:project_a', 'system', 'auth', 'release'])
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
