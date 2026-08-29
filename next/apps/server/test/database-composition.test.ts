import { describe, expect, test } from 'bun:test'
import type { Session } from '@nuvix/db'
import type {
  ProjectAuthContext,
  ProjectContext,
  ProjectResolutionInput,
  ProjectResolver,
} from '../src/context/project'
import { createDatabaseComposition } from '../src/infrastructure/database-composition'
import type { PlatformConnectionMetadataResolver } from '../src/infrastructure/platform-connection-metadata'

const PROJECT_ONE: ProjectContext = {
  id: 'project-1',
  internalId: 'tenant-1',
  enabled: true,
}

const PROJECT_TWO: ProjectContext = {
  id: 'project-2',
  internalId: 'tenant-2',
  enabled: true,
}

function auth(projectId: string): ProjectAuthContext {
  return {
    type: 'session',
    sessionId: `session-${projectId}`,
    userId: `user-${projectId}`,
    projectId,
    verified: true,
    teams: [],
    labels: [],
    scopes: ['documents.read'],
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

interface HarnessOptions {
  readonly closeResource?: (projectId: string, attempt: number) => Promise<void>
  readonly idleMs?: number
  readonly sessionError?: Error
}

function harness(options: HarnessOptions = {}) {
  const projectInputs: ProjectResolutionInput[] = []
  const metadataProjects: string[] = []
  const constructedConnections: string[] = []
  const sessionRoles = new Map<string, string[][]>()
  const closedProjects: string[] = []
  const closeAttempts = new Map<string, number>()
  const projects = new Map([
    [PROJECT_ONE.id, PROJECT_ONE],
    [PROJECT_TWO.id, PROJECT_TWO],
  ])
  const projectResolver: ProjectResolver = {
    resolve: async (input) => {
      projectInputs.push(input)
      const project = input.requestedProjectId ? projects.get(input.requestedProjectId) : undefined
      return project ? { auth: auth(project.id), project } : null
    },
  }
  const connectionMetadataResolver: PlatformConnectionMetadataResolver = {
    resolve: async (projectId) => {
      metadataProjects.push(projectId)
      return {
        connectionString: `postgresql://tenant.example.test/${projectId}`,
      }
    },
  }
  const createResource = (connectionString: string) => {
    constructedConnections.push(connectionString)
    const projectId = connectionString.slice(connectionString.lastIndexOf('/') + 1)
    return {
      adapter: { kind: 'structural-fake' },
      cache: { kind: 'structural-fake' },
      database: {
        for: (...roles: string[]) => {
          const calls = sessionRoles.get(projectId) ?? []
          calls.push(roles)
          sessionRoles.set(projectId, calls)
          if (options.sessionError) throw options.sessionError
          return { projectId, roles } as unknown as Session
        },
        system: () => ({ privileged: true }),
      },
      close: async () => {
        closedProjects.push(projectId)
        const attempt = (closeAttempts.get(projectId) ?? 0) + 1
        closeAttempts.set(projectId, attempt)
        await options.closeResource?.(projectId, attempt)
      },
    }
  }

  const composition = createDatabaseComposition({
    connectionMetadataResolver,
    createResource,
    projectResolver,
    registryOptions: {
      idleMs: options.idleMs,
      onCloseError: () => {},
    },
  })

  return {
    closedProjects,
    closeAttempts,
    composition,
    constructedConnections,
    metadataProjects,
    projectInputs,
    sessionRoles,
  }
}

describe('database composition', () => {
  test('keeps resolution lazy and exposes only safe request capabilities', async () => {
    const state = harness()
    const input: ProjectResolutionInput = {
      auth: { type: 'guest' },
      requestedProjectId: PROJECT_ONE.id,
    }

    expect(state.metadataProjects).toEqual([])
    expect(Object.keys(state.composition).toSorted()).toEqual(['close', 'requests'])
    expect(Object.keys(state.composition.requests).toSorted()).toEqual([
      'databaseSessions',
      'projects',
    ])
    expect(Object.keys(state.composition.requests.projects)).toEqual(['resolve'])
    expect(Object.keys(state.composition.requests.databaseSessions)).toEqual(['acquire'])
    expect(state.composition.requests).not.toHaveProperty('close')

    const resolution = await state.composition.requests.projects.resolve(input)

    expect(resolution).toEqual({
      auth: auth(PROJECT_ONE.id),
      project: PROJECT_ONE,
    })
    expect(state.projectInputs).toEqual([input])
    expect(state.metadataProjects).toEqual([])
    for (const capability of [state.composition, state.composition.requests]) {
      expect(capability).not.toHaveProperty('registry')
      expect(capability).not.toHaveProperty('connectionMetadata')
      expect(capability).not.toHaveProperty('invalidate')
      expect(capability).not.toHaveProperty('sweep')
      expect(capability).not.toHaveProperty('closeAll')
      expect(capability).not.toHaveProperty('database')
      expect(capability).not.toHaveProperty('adapter')
      expect(capability).not.toHaveProperty('cache')
      expect(capability).not.toHaveProperty('system')
    }
  })

  test('deduplicates concurrent tenant creation and creates canonical request sessions', async () => {
    const state = harness()

    const [first, second] = await Promise.all([
      state.composition.requests.databaseSessions.acquire(PROJECT_ONE, auth(PROJECT_ONE.id)),
      state.composition.requests.databaseSessions.acquire(PROJECT_ONE, auth(PROJECT_ONE.id)),
    ])

    expect(state.metadataProjects).toEqual([PROJECT_ONE.id])
    expect(state.constructedConnections).toEqual([
      `postgresql://tenant.example.test/${PROJECT_ONE.id}`,
    ])
    expect(state.sessionRoles.get(PROJECT_ONE.id)).toEqual([
      ['any', 'users', 'users/verified', 'user:user-project-1', 'user:user-project-1/verified'],
      ['any', 'users', 'users/verified', 'user:user-project-1', 'user:user-project-1/verified'],
    ])
    expect((first.session as unknown as { projectId: string }).projectId).toBe(PROJECT_ONE.id)
    expect((second.session as unknown as { projectId: string }).projectId).toBe(PROJECT_ONE.id)
    expect(Object.keys(first).toSorted()).toEqual(['release', 'session'])
    expect(first).not.toHaveProperty('database')
    expect(first).not.toHaveProperty('system')
    await Promise.all([first.release(), second.release()])
  })

  test('selects distinct tenant resources for distinct projects', async () => {
    const state = harness()

    const [first, second] = await Promise.all([
      state.composition.requests.databaseSessions.acquire(PROJECT_ONE, auth(PROJECT_ONE.id)),
      state.composition.requests.databaseSessions.acquire(PROJECT_TWO, auth(PROJECT_TWO.id)),
    ])

    expect(state.metadataProjects.toSorted()).toEqual([PROJECT_ONE.id, PROJECT_TWO.id])
    expect(state.constructedConnections.toSorted()).toEqual([
      `postgresql://tenant.example.test/${PROJECT_ONE.id}`,
      `postgresql://tenant.example.test/${PROJECT_TWO.id}`,
    ])
    expect((first.session as unknown as { projectId: string }).projectId).toBe(PROJECT_ONE.id)
    expect((second.session as unknown as { projectId: string }).projectId).toBe(PROJECT_TWO.id)
    await Promise.all([first.release(), second.release()])
    expect(state.closedProjects).toEqual([])
  })

  test('owner close drains active leases, rejects later acquisition, and closes resources once', async () => {
    const closeStarted = deferred<void>()
    const allowClose = deferred<void>()
    const state = harness({
      closeResource: async (projectId) => {
        expect(projectId).toBe(PROJECT_ONE.id)
        closeStarted.resolve()
        await allowClose.promise
      },
    })
    const lease = await state.composition.requests.databaseSessions.acquire(
      PROJECT_ONE,
      auth(PROJECT_ONE.id),
    )
    let closeFinished = false

    const firstClose = state.composition.close()
    const secondClose = state.composition.close()
    void firstClose.then(() => {
      closeFinished = true
    })

    expect(secondClose).toBe(firstClose)
    await expect(
      state.composition.requests.databaseSessions.acquire(PROJECT_TWO, auth(PROJECT_TWO.id)),
    ).rejects.toThrow('registry is closed')
    expect(state.closedProjects).toEqual([])
    expect(closeFinished).toBe(false)

    const firstRelease = lease.release()
    expect(lease.release()).toBe(firstRelease)
    await closeStarted.promise
    expect(state.closedProjects).toEqual([PROJECT_ONE.id])
    expect(closeFinished).toBe(false)

    allowClose.resolve()
    await Promise.all([firstRelease, firstClose, secondClose])
    expect(state.closeAttempts.get(PROJECT_ONE.id)).toBe(1)
    expect(state.composition.close()).toBe(firstClose)
    await state.composition.close()
    expect(state.closeAttempts.get(PROJECT_ONE.id)).toBe(1)
  })

  test('owner close exposes failures and retries only resources whose close failed', async () => {
    const firstFailureStarted = deferred<void>()
    const rejectFirstFailure = deferred<void>()
    const retryStarted = deferred<void>()
    const allowRetry = deferred<void>()
    const state = harness({
      closeResource: async (projectId, attempt) => {
        if (projectId !== PROJECT_ONE.id) return
        if (attempt === 1) {
          firstFailureStarted.resolve()
          await rejectFirstFailure.promise
          return
        }
        retryStarted.resolve()
        await allowRetry.promise
      },
    })
    const [first, second] = await Promise.all([
      state.composition.requests.databaseSessions.acquire(PROJECT_ONE, auth(PROJECT_ONE.id)),
      state.composition.requests.databaseSessions.acquire(PROJECT_TWO, auth(PROJECT_TWO.id)),
    ])
    await Promise.all([first.release(), second.release()])

    const firstClose = state.composition.close()
    expect(state.composition.close()).toBe(firstClose)
    await firstFailureStarted.promise
    rejectFirstFailure.reject(new Error('project-1 close failed'))

    const failure = await firstClose.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors[0]).toEqual(new Error('project-1 close failed'))
    expect(state.closeAttempts.get(PROJECT_ONE.id)).toBe(1)
    expect(state.closeAttempts.get(PROJECT_TWO.id)).toBe(1)

    const retry = state.composition.close()
    expect(retry).not.toBe(firstClose)
    expect(state.composition.close()).toBe(retry)
    await retryStarted.promise
    expect(state.closeAttempts.get(PROJECT_ONE.id)).toBe(2)
    expect(state.closeAttempts.get(PROJECT_TWO.id)).toBe(1)

    allowRetry.resolve()
    await retry
    expect(state.composition.close()).toBe(retry)
    expect(state.closeAttempts.get(PROJECT_ONE.id)).toBe(2)
    expect(state.closeAttempts.get(PROJECT_TWO.id)).toBe(1)
  })

  test('request setup preserves its failure together with release cleanup failure', async () => {
    const sessionError = new Error('session construction failed')
    const closeError = new Error('release cleanup failed')
    const state = harness({
      idleMs: 0,
      sessionError,
      closeResource: async () => {
        throw closeError
      },
    })

    const failure = await state.composition.requests.databaseSessions
      .acquire(PROJECT_ONE, auth(PROJECT_ONE.id))
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors[0]).toBe(sessionError)
    const releaseFailure = (failure as AggregateError).errors[1]
    expect(releaseFailure).toBeInstanceOf(AggregateError)
    expect((releaseFailure as AggregateError).errors).toEqual([closeError])
    expect(state.closeAttempts.get(PROJECT_ONE.id)).toBe(1)

    await expect(state.composition.close()).rejects.toThrow(
      'Failed to close tenant databases: project-1',
    )
    expect(state.closeAttempts.get(PROJECT_ONE.id)).toBe(2)
  })
})
