import { describe, expect, spyOn, test } from 'bun:test'
import { TenantDatabaseRegistry } from '../src/infrastructure/tenant-databases'

interface FakeDatabase {
  readonly projectId: string
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

function harness(options: { maxTenants?: number; idleMs?: number } = {}) {
  let now = 0
  const created: string[] = []
  const closed: string[] = []
  const registry = new TenantDatabaseRegistry<FakeDatabase>({
    ...options,
    onCloseError: () => {},
    now: () => now,
    create: async (projectId) => {
      created.push(projectId)
      return {
        database: { projectId },
        close: async () => {
          closed.push(projectId)
        },
      }
    },
  })

  return {
    registry,
    created,
    closed,
    advance: (milliseconds: number) => (now += milliseconds),
  }
}

describe('tenant database registry', () => {
  test('deduplicates concurrent construction and reuses the resource', async () => {
    const { registry, created } = harness()

    const [first, second] = await Promise.all([
      registry.acquire('project-1'),
      registry.acquire('project-1'),
    ])

    expect(first.database).toBe(second.database)
    expect(created).toEqual(['project-1'])
    await first.release()
    await second.release()
  })

  test('shares deferred creation while returning independent idempotent leases', async () => {
    const creation = deferred<{
      database: FakeDatabase
      close(): Promise<void>
    }>()
    let createCalls = 0
    const registry = new TenantDatabaseRegistry<FakeDatabase>({
      onCloseError: () => {},
      create: (projectId) => {
        createCalls += 1
        expect(projectId).toBe('project-1')
        return creation.promise
      },
    })

    const firstPending = registry.acquire('project-1')
    const secondPending = registry.acquire('project-1')
    expect(createCalls).toBe(1)
    creation.resolve({
      database: { projectId: 'project-1' },
      close: async () => {},
    })

    const [first, second] = await Promise.all([firstPending, secondPending])
    expect(first.database).toBe(second.database)
    const firstRelease = first.release()
    expect(first.release()).toBe(firstRelease)
    await firstRelease
    const secondRelease = second.release()
    expect(second.release()).toBe(secondRelease)
    await secondRelease
    await registry.closeAll()
  })

  test('invalidation during deferred creation rejects waiters and closes once', async () => {
    const creation = deferred<{
      database: FakeDatabase
      close(): Promise<void>
    }>()
    let createCalls = 0
    let invalidatedCloseCalls = 0
    let replacementCloseCalls = 0
    const registry = new TenantDatabaseRegistry<FakeDatabase>({
      onCloseError: () => {},
      create: async (projectId) => {
        createCalls += 1
        if (createCalls === 1) return creation.promise
        return {
          database: { projectId },
          close: async () => {
            replacementCloseCalls += 1
          },
        }
      },
    })
    const acquiring = registry.acquire('project-1')
    const invalidating = registry.invalidate('project-1')

    creation.resolve({
      database: { projectId: 'project-1' },
      close: async () => {
        invalidatedCloseCalls += 1
      },
    })

    await expect(acquiring).rejects.toThrow('database is unavailable')
    await invalidating
    expect(invalidatedCloseCalls).toBe(1)
    const replacement = await registry.acquire('project-1')
    await replacement.release()
    await registry.closeAll()
    expect(createCalls).toBe(2)
    expect(invalidatedCloseCalls).toBe(1)
    expect(replacementCloseCalls).toBe(1)
  })

  test('shutdown during deferred creation rejects waiters and closes the late resource once', async () => {
    const creation = deferred<{
      database: FakeDatabase
      close(): Promise<void>
    }>()
    let closeCalls = 0
    const registry = new TenantDatabaseRegistry<FakeDatabase>({
      onCloseError: () => {},
      create: () => creation.promise,
    })
    const acquiring = registry.acquire('project-1')
    let shutdownComplete = false
    const closing = registry.closeAll().then(() => {
      shutdownComplete = true
    })

    await expect(registry.acquire('project-2')).rejects.toThrow('registry is closed')
    await Promise.resolve()
    expect(shutdownComplete).toBe(false)
    creation.resolve({
      database: { projectId: 'project-1' },
      close: async () => {
        closeCalls += 1
      },
    })

    await expect(acquiring).rejects.toThrow('registry is closed')
    await closing
    expect(shutdownComplete).toBe(true)
    expect(closeCalls).toBe(1)
  })

  test('capacity pressure does not evict a constructing tenant', async () => {
    const firstCreation = deferred<{
      database: FakeDatabase
      close(): Promise<void>
    }>()
    const closed: string[] = []
    const registry = new TenantDatabaseRegistry<FakeDatabase>({
      maxTenants: 1,
      idleMs: Number.MAX_SAFE_INTEGER,
      onCloseError: () => {},
      create: async (projectId) => {
        if (projectId === 'project-1') return firstCreation.promise
        return {
          database: { projectId },
          close: async () => {
            closed.push(projectId)
          },
        }
      },
    })
    const firstPending = registry.acquire('project-1')
    const second = await registry.acquire('project-2')

    expect(closed).toEqual([])
    await second.release()
    expect(closed).toEqual(['project-2'])
    firstCreation.resolve({
      database: { projectId: 'project-1' },
      close: async () => {
        closed.push('project-1')
      },
    })
    const first = await firstPending
    await first.release()
    await registry.closeAll()
    expect(closed).toEqual(['project-2', 'project-1'])
  })

  test('evicts the least recently used idle resource at capacity', async () => {
    const { registry, closed, advance } = harness({
      maxTenants: 2,
      idleMs: Number.MAX_SAFE_INTEGER,
    })
    const first = await registry.acquire('project-1')
    await first.release()
    advance(1)
    const second = await registry.acquire('project-2')
    await second.release()

    const third = await registry.acquire('project-3')

    expect(closed).toEqual(['project-1'])
    await third.release()
    await registry.closeAll()
  })

  test('breaks equal-recency eviction ties by project identifier', async () => {
    const { registry, closed } = harness({
      maxTenants: 2,
      idleMs: Number.MAX_SAFE_INTEGER,
    })
    const lexicalLast = await registry.acquire('project-z')
    await lexicalLast.release()
    const lexicalFirst = await registry.acquire('project-a')
    await lexicalFirst.release()

    const active = await registry.acquire('project-current')

    expect(closed).toEqual(['project-a'])
    await active.release()
    await registry.closeAll()
  })

  test('never evicts an in-use resource', async () => {
    const { registry, closed } = harness({ maxTenants: 1, idleMs: 0 })
    const first = await registry.acquire('project-1')
    const second = await registry.acquire('project-2')

    expect(closed).toEqual([])
    await second.release()
    expect(closed).toEqual(['project-2'])
    await first.release()
    await registry.closeAll()
  })

  test('releases all reservations after shared deferred construction fails', async () => {
    const firstCreation = deferred<{
      database: FakeDatabase
      close(): Promise<void>
    }>()
    let attempts = 0
    const registry = new TenantDatabaseRegistry<FakeDatabase>({
      onCloseError: () => {},
      create: async (projectId) => {
        attempts += 1
        if (attempts === 1) return firstCreation.promise
        return { database: { projectId }, close: async () => {} }
      },
    })

    const first = registry.acquire('project-1')
    const second = registry.acquire('project-1')
    expect(attempts).toBe(1)
    const failedGeneration = Promise.allSettled([first, second])
    firstCreation.reject(new Error('temporary failure'))
    const results = await failedGeneration
    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') {
        expect((result.reason as Error).message).toBe('temporary failure')
      }
    }
    const lease = await registry.acquire('project-1')
    expect(attempts).toBe(2)
    await lease.release()
    await registry.closeAll()
  })

  test('defers invalidation until the active lease is released', async () => {
    const { registry, closed } = harness()
    const lease = await registry.acquire('project-1')

    await registry.invalidate('project-1')
    expect(closed).toEqual([])
    await lease.release()
    expect(closed).toEqual(['project-1'])
  })

  test('rejects replacement while an invalidated generation is leased', async () => {
    const { registry, created } = harness()
    const lease = await registry.acquire('project-1')
    await registry.invalidate('project-1')

    await expect(registry.acquire('project-1')).rejects.toThrow('database is unavailable')
    expect(created).toEqual(['project-1'])
    await lease.release()

    const replacement = await registry.acquire('project-1')
    expect(created).toEqual(['project-1', 'project-1'])
    await replacement.release()
    await registry.closeAll()
  })

  test('graceful close waits for active leases', async () => {
    const { registry, closed } = harness()
    const lease = await registry.acquire('project-1')
    let finished = false
    const closing = registry.closeAll().then(() => {
      finished = true
    })

    await Promise.resolve()
    expect(finished).toBe(false)
    expect(closed).toEqual([])
    await lease.release()
    await closing
    expect(closed).toEqual(['project-1'])
  })

  test('concurrent shutdown callers both wait for active leases', async () => {
    const { registry } = harness()
    const lease = await registry.acquire('project-1')
    let completed = 0
    const first = registry.closeAll().then(() => {
      completed += 1
    })
    const second = registry.closeAll().then(() => {
      completed += 1
    })

    await Promise.resolve()
    expect(completed).toBe(0)
    await lease.release()
    await Promise.all([first, second])
    expect(completed).toBe(2)
  })

  test('release reports a failed eviction once and retains it for an explicit retry', async () => {
    let closeAttempts = 0
    let creations = 0
    const registry = new TenantDatabaseRegistry<FakeDatabase>({
      idleMs: 0,
      onCloseError: () => {},
      create: async (projectId) => {
        creations += 1
        return {
          database: { projectId },
          close: async () => {
            closeAttempts += 1
            if (closeAttempts === 1) throw new Error('close failed')
          },
        }
      },
    })
    const lease = await registry.acquire('project-1')

    const release = lease.release()
    await expect(release).rejects.toThrow('Failed to close tenant databases: project-1')
    expect(lease.release()).toBe(release)
    await expect(lease.release()).rejects.toThrow('Failed to close tenant databases: project-1')
    expect(closeAttempts).toBe(1)
    await expect(registry.acquire('project-1')).rejects.toThrow('unavailable')
    expect(creations).toBe(1)
    await registry.sweep()

    const replacement = await registry.acquire('project-1')
    expect(creations).toBe(2)
    await replacement.release()
    await registry.closeAll()
  })

  test('rejects unnormalized project identifiers', async () => {
    const { registry, created } = harness()
    await expect(registry.acquire(' project-1 ')).rejects.toThrow('normalized')
    expect(created).toEqual([])
    await registry.closeAll()
  })

  test('sweeps idle resources and closes every remaining resource once', async () => {
    const { registry, closed, advance } = harness({ idleMs: 100 })
    const first = await registry.acquire('project-1')
    await first.release()
    advance(101)
    await registry.sweep()
    expect(closed).toEqual(['project-1'])

    const second = await registry.acquire('project-2')
    await second.release()
    await registry.closeAll()
    await registry.closeAll()
    expect(closed).toEqual(['project-1', 'project-2'])
    await expect(registry.acquire('project-3')).rejects.toThrow('registry is closed')
  })

  test('invalidation close failure rejects and remains retryable', async () => {
    let closeAttempts = 0
    const registry = new TenantDatabaseRegistry<FakeDatabase>({
      onCloseError: () => {},
      create: async (projectId) => ({
        database: { projectId },
        close: async () => {
          closeAttempts += 1
          if (closeAttempts === 1) throw new Error('invalidation failed')
        },
      }),
    })
    const lease = await registry.acquire('project-1')
    await lease.release()

    await expect(registry.invalidate('project-1')).rejects.toThrow('invalidation failed')
    await expect(registry.acquire('project-1')).rejects.toThrow('unavailable')
    await registry.invalidate('project-1')

    expect(closeAttempts).toBe(2)
    const replacement = await registry.acquire('project-1')
    await replacement.release()
    await registry.closeAll()
  })

  test('release-triggered invalidation failure is idempotent and explicitly retryable', async () => {
    let closeAttempts = 0
    const registry = new TenantDatabaseRegistry<FakeDatabase>({
      onCloseError: () => {},
      create: async (projectId) => ({
        database: { projectId },
        close: async () => {
          closeAttempts += 1
          if (closeAttempts === 1) throw new Error('release cleanup failed')
        },
      }),
    })
    const lease = await registry.acquire('project-1')
    await registry.invalidate('project-1')

    const release = lease.release()
    await expect(release).rejects.toThrow('release cleanup failed')
    expect(lease.release()).toBe(release)
    await expect(lease.release()).rejects.toThrow('release cleanup failed')
    expect(closeAttempts).toBe(1)
    await registry.invalidate('project-1')

    expect(closeAttempts).toBe(2)
  })

  test('detached eviction reports every failure in deterministic project order', async () => {
    let now = 0
    const reported: Array<{ error: unknown; projectId: string }> = []
    let resolveReported: (() => void) | undefined
    const allReported = new Promise<void>((resolve) => {
      resolveReported = resolve
    })
    const attempts = new Map<string, number>()
    const registry = new TenantDatabaseRegistry<FakeDatabase>({
      idleMs: 100,
      now: () => now,
      onCloseError: (error, projectId) => {
        reported.push({ error, projectId })
        if (reported.length === 2) resolveReported?.()
      },
      create: async (projectId) => ({
        database: { projectId },
        close: async () => {
          const attempt = (attempts.get(projectId) ?? 0) + 1
          attempts.set(projectId, attempt)
          if (attempt === 1 && projectId !== 'project-3') {
            throw new Error(`${projectId} eviction failed`)
          }
        },
      }),
    })
    const first = await registry.acquire('project-1')
    await first.release()
    const second = await registry.acquire('project-2')
    await second.release()
    now = 101

    const third = await registry.acquire('project-3')
    await allReported

    expect(reported.map(({ projectId }) => projectId)).toEqual(['project-1', 'project-2'])
    expect(reported.map(({ error }) => (error as Error).message)).toEqual([
      'project-1 eviction failed',
      'project-2 eviction failed',
    ])
    await registry.sweep()
    await third.release()
    await registry.closeAll()
  })

  test('detached eviction continues reporting when the reporter throws', async () => {
    let now = 0
    const reported: string[] = []
    const attempts = new Map<string, number>()
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    const allReported = deferred<void>()
    const registry = new TenantDatabaseRegistry<FakeDatabase>({
      idleMs: 100,
      now: () => now,
      onCloseError: (_error, projectId) => {
        reported.push(projectId)
        if (reported.length === 2) allReported.resolve()
        if (projectId === 'project-1') throw new Error('reporter failed')
      },
      create: async (projectId) => ({
        database: { projectId },
        close: async () => {
          const attempt = (attempts.get(projectId) ?? 0) + 1
          attempts.set(projectId, attempt)
          if (projectId !== 'project-3' && attempt === 1)
            throw new Error(`${projectId} close failed`)
        },
      }),
    })
    const first = await registry.acquire('project-1')
    await first.release()
    const second = await registry.acquire('project-2')
    await second.release()
    now = 101

    const third = await registry.acquire('project-3')
    await allReported.promise

    expect(reported).toEqual(['project-1', 'project-2'])
    expect(consoleError).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
    await registry.sweep()
    await third.release()
    await registry.closeAll()
  })

  test('sweep attempts all closes and aggregates failures in deterministic order', async () => {
    let now = 0
    const attempts: string[] = []
    const firstClose = deferred<void>()
    const secondClose = deferred<void>()
    const allAttempted = deferred<void>()
    const registry = new TenantDatabaseRegistry<FakeDatabase>({
      idleMs: 100,
      now: () => now,
      onCloseError: () => {},
      create: async (projectId) => ({
        database: { projectId },
        close: () => {
          attempts.push(projectId)
          if (attempts.length === 2) allAttempted.resolve()
          return projectId === 'project-1' ? firstClose.promise : secondClose.promise
        },
      }),
    })
    const first = await registry.acquire('project-1')
    await first.release()
    const second = await registry.acquire('project-2')
    await second.release()
    now = 101

    const sweeping = registry.sweep()
    await allAttempted.promise
    secondClose.reject(new Error('project-2 sweep failed'))
    firstClose.reject(new Error('project-1 sweep failed'))
    const failure = await sweeping.catch((error: unknown) => error)

    expect(attempts).toEqual(['project-1', 'project-2'])
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).message).toBe(
      'Failed to close tenant databases: project-1, project-2',
    )
    expect((failure as AggregateError).errors.map((error) => (error as Error).message)).toEqual([
      'project-1 sweep failed',
      'project-2 sweep failed',
    ])
  })

  test('shutdown removes successful entries and retries only failed closes', async () => {
    const attempts: string[] = []
    const failedOnce = new Set<string>()
    const registry = new TenantDatabaseRegistry<FakeDatabase>({
      onCloseError: () => {},
      create: async (projectId) => ({
        database: { projectId },
        close: async () => {
          attempts.push(projectId)
          if (projectId !== 'project-2' && !failedOnce.has(projectId)) {
            failedOnce.add(projectId)
            throw new Error(`${projectId} shutdown failed`)
          }
        },
      }),
    })
    const leases = await Promise.all([
      registry.acquire('project-1'),
      registry.acquire('project-2'),
      registry.acquire('project-3'),
    ])
    await Promise.all(leases.map((lease) => lease.release()))

    const failure = await registry.closeAll().catch((error: unknown) => error)

    expect(attempts).toEqual(['project-1', 'project-2', 'project-3'])
    expect((failure as AggregateError).message).toBe(
      'Failed to close tenant databases: project-1, project-3',
    )
    await expect(registry.acquire('project-4')).rejects.toThrow('registry is closed')
    await registry.closeAll()
    expect(attempts).toEqual(['project-1', 'project-2', 'project-3', 'project-1', 'project-3'])
  })
})
