import { describe, expect, test } from 'bun:test'
import type { Session } from '@nuvix/db'
import type { ProjectLocator } from '../src/context/project-locator'
import type { TenantAuthResolver } from '../src/context/project-request'
import { createDatabaseComposition } from '../src/infrastructure/database-composition'
import type { TenantDatabaseTarget } from '../src/infrastructure/platform-persistence-model'

function harness() {
  const events: string[] = []
  const targets = new Map<string, TenantDatabaseTarget>([
    ['project_a', { driver: 'sqlite', filename: 'project_a.sqlite' }],
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
      const projectId = target.driver === 'sqlite' ? 'project_a' : 'project_b'
      events.push(`create:${projectId}`)
      return {
        database: {
          system: () => ({
            find: async () => [],
            getDocument: async () => ({}) as never,
          }),
          for: (...roles: string[]) => ({ projectId, roles }) as unknown as Session,
        },
        close: async () => {
          events.push(`close:${projectId}`)
        },
      }
    },
    registryOptions: { onCloseError: () => {} },
  })
  return { composition, events }
}

const headers = (projectId: string, credentialProject = projectId) =>
  new Headers({
    'x-test-project': projectId,
    'x-test-user-project': credentialProject,
  })

describe('database composition', () => {
  test('selects target, constructs tenant, and authenticates inside it', async () => {
    const state = harness()

    const context = await state.composition.requests.withProject(
      headers('project_a'),
      (value) => value,
    )

    expect(context.project.id).toBe('project_a')
    expect(context.auth.type).toBe('session')
    expect((context.session as unknown as { projectId: string }).projectId).toBe('project_a')
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

    await Promise.all([
      state.composition.requests.withProject(headers('project_b'), async () => undefined),
      state.composition.requests.withProject(headers('project_b'), async () => undefined),
    ])
    await state.composition.close()

    expect(state.events.filter((event) => event === 'create:project_b')).toHaveLength(1)
    expect(state.events.filter((event) => event === 'close:project_b')).toHaveLength(1)
    expect(Object.keys(state.composition.requests)).toEqual(['withProject'])
  })
})
