import { describe, expect, test } from 'bun:test'
import type { Session } from '@nuvix/db'
import type { ProjectAuthContext, ProjectContext } from '../src/context/project'
import { RequestDatabaseSessions } from '../src/infrastructure/request-database-sessions'

const PROJECT: ProjectContext = {
  id: 'project-1',
  enabled: true,
}

const AUTH: ProjectAuthContext = {
  type: 'session',
  sessionId: 'session-1',
  userId: 'user-1',
  verified: true,
  teams: [{ teamId: 'team-1', roles: ['viewer'] }],
  labels: ['staff'],
  scopes: ['documents.read'],
}

interface HarnessOptions {
  readonly releaseError?: Error
  readonly sessionError?: Error
}

function harness(options: HarnessOptions = {}) {
  const acquiredProjects: string[] = []
  const receivedRoles: string[][] = []
  const session = { plane: 'documents' } as unknown as Session
  let releaseCalls = 0
  let systemCalls = 0
  const database = {
    adapter: { kind: 'fake' },
    for: (...roles: string[]) => {
      receivedRoles.push(roles)
      if (options.sessionError) throw options.sessionError
      return session
    },
    system: () => {
      systemCalls += 1
      return { plane: 'system' } as const
    },
  }
  const databases = {
    acquire: async (projectId: string) => {
      acquiredProjects.push(projectId)
      return {
        database,
        release: async () => {
          releaseCalls += 1
          if (options.releaseError) throw options.releaseError
        },
      }
    },
  }

  return {
    acquiredProjects,
    databases,
    receivedRoles,
    session,
    releaseCalls: () => releaseCalls,
    systemCalls: () => systemCalls,
  }
}

describe('request database sessions', () => {
  test('selects the project and creates a session with exact canonical roles', async () => {
    const state = harness()
    const sessions = new RequestDatabaseSessions(state.databases)

    const lease = await sessions.acquire(PROJECT, AUTH)

    expect(state.acquiredProjects).toEqual(['project-1'])
    expect(state.receivedRoles).toEqual([
      [
        'any',
        'users',
        'users/verified',
        'user:user-1',
        'user:user-1/verified',
        'team:team-1',
        'team:team-1/viewer',
        'label:staff',
      ],
    ])
    expect(lease.session).toBe(state.session)
    await lease.release()
  })

  test('narrows the request lease to the session and release capability', async () => {
    const state = harness()
    const sessions = new RequestDatabaseSessions(state.databases)

    const lease = await sessions.acquire(PROJECT, AUTH)

    expect(Object.keys(lease).toSorted()).toEqual(['release', 'session'])
    expect(lease).not.toHaveProperty('database')
    expect(lease).not.toHaveProperty('adapter')
    expect(lease).not.toHaveProperty('system')
    expect(state.systemCalls()).toBe(0)
    await lease.release()
  })

  test('releases once when role validation fails after acquisition', async () => {
    const state = harness()
    const sessions = new RequestDatabaseSessions(state.databases)

    await expect(sessions.acquire({ ...PROJECT, enabled: false }, AUTH)).rejects.toThrow(
      'Project is disabled',
    )

    expect(state.receivedRoles).toEqual([])
    expect(state.releaseCalls()).toBe(1)
  })

  test('releases once when session construction fails after acquisition', async () => {
    const sessionError = new Error('session construction failed')
    const state = harness({ sessionError })
    const sessions = new RequestDatabaseSessions(state.databases)

    await expect(sessions.acquire(PROJECT, AUTH)).rejects.toBe(sessionError)

    expect(state.releaseCalls()).toBe(1)
  })

  test('delegates release once and preserves its cleanup failure', async () => {
    const releaseError = new Error('tenant cleanup failed')
    const state = harness({ releaseError })
    const sessions = new RequestDatabaseSessions(state.databases)
    const lease = await sessions.acquire(PROJECT, AUTH)

    const firstRelease = lease.release()

    expect(lease.release()).toBe(firstRelease)
    await expect(firstRelease).rejects.toBe(releaseError)
    await expect(lease.release()).rejects.toBe(releaseError)
    expect(state.releaseCalls()).toBe(1)
  })

  test.each([
    {
      name: 'role validation',
      project: { ...PROJECT, enabled: false },
      sessionError: undefined,
      setupMessage: 'Project is disabled',
    },
    {
      name: 'session construction',
      project: PROJECT,
      sessionError: new Error('session construction failed'),
      setupMessage: 'session construction failed',
    },
  ])(
    'preserves $name and cleanup failures together',
    async ({ project, sessionError, setupMessage }) => {
      const releaseError = new Error('tenant cleanup failed')
      const state = harness({ releaseError, sessionError })
      const sessions = new RequestDatabaseSessions(state.databases)

      const failure = await sessions.acquire(project, AUTH).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(AggregateError)
      expect((failure as AggregateError).message).toBe(
        'Request database session setup and cleanup failed',
      )
      expect((failure as AggregateError).errors).toHaveLength(2)
      expect(((failure as AggregateError).errors[0] as Error).message).toBe(setupMessage)
      expect((failure as AggregateError).errors[1]).toBe(releaseError)
      expect(state.releaseCalls()).toBe(1)
    },
  )
})
