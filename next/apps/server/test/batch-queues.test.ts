import { describe, expect, test } from 'bun:test'
import { Doc, type Session } from '@nuvix/db'
import { type AuditLogRecord, createAuditsBatchQueue } from '../src/queues/audits'
import { createBatchQueue } from '../src/queues/batch'
import { createDeletesWorker } from '../src/queues/deletes'
import {
  type ApiLogRecord,
  createApiLogsBatchQueue,
  isSensitiveKey,
  redactSensitiveData,
} from '../src/queues/logs'
import {
  type AggregatedMetric,
  createStatsBatchQueue,
  formatMetricTimestamp,
} from '../src/queues/stats'

describe('Batch Queues & Workers', () => {
  test('generic BatchQueue flushes when reaching batch size threshold', async () => {
    const flushed: number[][] = []
    const queue = createBatchQueue<number>({
      batchSize: 3,
      intervalMs: 10000,
      persist: async (items) => {
        flushed.push([...items])
      },
    })

    await queue.push(1)
    await queue.push(2)
    expect(flushed).toHaveLength(0)

    await queue.push(3) // Reaches threshold 3
    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toEqual([1, 2, 3])

    await queue.stop()
  })

  test('generic BatchQueue stop() flushes remaining buffer', async () => {
    const flushed: string[][] = []
    const queue = createBatchQueue<string>({
      batchSize: 10,
      intervalMs: 10000,
      persist: async (items) => {
        flushed.push([...items])
      },
    })

    await queue.push('itemA')
    await queue.push('itemB')
    expect(flushed).toHaveLength(0)

    await queue.stop()
    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toEqual(['itemA', 'itemB'])
  })

  test('AuditsBatchQueue flushes audit logs', async () => {
    const persisted: AuditLogRecord[] = []
    const auditsQueue = createAuditsBatchQueue({
      batchSize: 2,
      persist: async (batch) => {
        persisted.push(...batch)
      },
    })

    await auditsQueue.push({
      projectId: 'p_1',
      userId: 'u_1',
      event: 'users.create',
      resource: 'users',
      timestamp: new Date().toISOString(),
    })
    await auditsQueue.push({
      projectId: 'p_1',
      userId: 'u_2',
      event: 'users.create',
      resource: 'users',
      timestamp: new Date().toISOString(),
    })

    expect(persisted).toHaveLength(2)
    expect(persisted[0]?.event).toBe('users.create')
    await auditsQueue.stop()
  })

  test('ApiLogsBatchQueue redacts sensitive data recursively', async () => {
    expect(isSensitiveKey('authorization')).toBe(true)
    expect(isSensitiveKey('x-nuvix-key')).toBe(true)
    expect(isSensitiveKey('my_secret_token')).toBe(true)
    expect(isSensitiveKey('user_password')).toBe(true)
    expect(isSensitiveKey('normalField')).toBe(false)

    const rawMetadata = {
      user: {
        name: 'Alice',
        token: 'ey.sensitive.token',
        password: 'supersecretpassword',
        nested: {
          apiKey: 'key_123',
          safeData: 42,
        },
      },
      headers: {
        authorization: 'Bearer secret',
        'x-nuvix-signature': 'sig123',
        host: 'api.nuvix.io',
      },
    }

    const redacted = redactSensitiveData(rawMetadata) as Record<string, Record<string, unknown>>
    expect(redacted.user?.name).toBe('Alice')
    expect(redacted.user?.token).toBe('[REDACTED]')
    expect(redacted.user?.password).toBe('[REDACTED]')
    expect((redacted.user?.nested as Record<string, unknown>)?.apiKey).toBe('[REDACTED]')
    expect((redacted.user?.nested as Record<string, unknown>)?.safeData).toBe(42)
    expect(redacted.headers?.authorization).toBe('[REDACTED]')
    expect(redacted.headers?.['x-nuvix-signature']).toBe('[REDACTED]')
    expect(redacted.headers?.host).toBe('api.nuvix.io')

    const persistedLogs: ApiLogRecord[] = []
    const logsQueue = createApiLogsBatchQueue({
      batchSize: 1,
      persist: async (batch) => {
        persistedLogs.push(...batch)
      },
    })

    await logsQueue.push({
      requestId: 'req_1',
      method: 'POST',
      path: '/v2/users',
      status: 201,
      durationMs: 15,
      metadata: rawMetadata,
      timestamp: new Date().toISOString(),
    })

    expect(persistedLogs).toHaveLength(1)
    expect((persistedLogs[0]?.metadata?.user as Record<string, unknown>)?.token).toBe('[REDACTED]')
    await logsQueue.stop()
  })

  test('StatsBatchQueue aggregates metric sums and periods', async () => {
    const persistedStats: AggregatedMetric[] = []
    const statsQueue = createStatsBatchQueue({
      batchSize: 3,
      persist: async (aggregated) => {
        persistedStats.push(...aggregated)
      },
    })

    await statsQueue.push({ projectId: 'p1', key: 'api_requests', value: 1 })
    await statsQueue.push({ projectId: 'p1', key: 'api_requests', value: 4 })
    await statsQueue.push({ projectId: 'p1', key: 'bandwidth', value: 1024 })

    expect(persistedStats.length).toBeGreaterThan(0)
    const totalRequests = persistedStats.find(
      (s) => s.projectId === 'p1' && s.key === 'api_requests' && s.period === 'hour',
    )
    expect(totalRequests).toBeDefined()
    expect(totalRequests?.value).toBe(5) // 1 + 4 = 5

    const bandwidth = persistedStats.find(
      (s) => s.projectId === 'p1' && s.key === 'bandwidth' && s.period === 'day',
    )
    expect(bandwidth?.value).toBe(1024)

    expect(formatMetricTimestamp('inf', new Date())).toBe('inf')
    await statsQueue.stop()
  })

  test('DeletesWorker cascades user deletion and expired sessions', async () => {
    const worker = createDeletesWorker()
    const store = new Map<string, Doc[]>()

    store.set('sessions', [
      new Doc({ $id: 's_1', userId: 'u_target', $createdAt: '2026-01-01T00:00:00Z' }),
      new Doc({ $id: 's_2', userId: 'u_target', $createdAt: '2026-01-02T00:00:00Z' }),
      new Doc({ $id: 's_3', userId: 'u_other', $createdAt: '2026-01-03T00:00:00Z' }),
    ])
    store.set('memberships', [
      new Doc({ $id: 'm_1', userId: 'u_target' }),
      new Doc({ $id: 'm_2', userId: 'u_other' }),
    ])
    store.set('objects', [
      new Doc({ $id: 'obj_1', bucketId: 'b_target' }),
      new Doc({ $id: 'obj_2', bucketId: 'b_other' }),
    ])

    const mockSession = {
      find: async (
        col: string,
        queries?: Array<{ getAttribute(): string; getValues(): unknown[] }>,
      ) => {
        let docs = store.get(col) || []
        if (queries && queries.length > 0) {
          const q = queries[0]
          if (q) {
            const attr = q.getAttribute()
            const val = q.getValues()[0]
            if (attr === 'userId') {
              docs = docs.filter((d) => d.get('userId') === val)
            } else if (attr === 'bucketId') {
              docs = docs.filter((d) => d.get('bucketId') === val)
            } else if (attr === '$createdAt') {
              docs = docs.filter((d) => String(d.get('$createdAt')) < String(val))
            }
          }
        }
        return docs
      },
      deleteDocument: async (col: string, id: string) => {
        const docs = store.get(col) || []
        const next = docs.filter((d) => d.getId() !== id)
        store.set(col, next)
        return true
      },
    } as unknown as Session

    // 1. Delete user cascade
    const result = await worker.deleteUserCascade(mockSession, 'u_target')
    expect(result.sessionsDeleted).toBe(2)
    expect(result.membershipsDeleted).toBe(1)

    // 2. Delete bucket cascade
    let deletedPath = ''
    const mockDevice = {
      deletePath: async (path: string) => {
        deletedPath = path
        return true
      },
    }
    const bucketResult = await worker.deleteBucketCascade(mockSession, mockDevice, 'b_target')
    expect(bucketResult.objectsDeleted).toBe(1)
    expect(bucketResult.deviceCleaned).toBe(true)
    expect(deletedPath).toBe('b_target')

    // 3. Delete expired sessions
    const expiredCount = await worker.deleteExpiredSessions(mockSession, '2026-01-04T00:00:00Z')
    expect(expiredCount).toBe(1) // s_3
  })
})
