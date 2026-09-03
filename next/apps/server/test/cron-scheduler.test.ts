import { describe, expect, test } from 'bun:test'
import { createCronScheduler } from '../src/scheduler/cron'
import { createStandardMaintenanceJobs } from '../src/scheduler/jobs'

describe('CronScheduler (Bun.cron)', () => {
  test('registers and triggers jobs manually', async () => {
    let runs = 0
    const scheduler = createCronScheduler({
      cronFactory: () => ({ stop: () => {}, unref: () => {} }),
    })

    scheduler.register({
      name: 'test.job',
      schedule: '0 * * * *',
      handler: () => {
        runs++
      },
    })

    const statusBefore = scheduler.getJob('test.job')
    expect(statusBefore).toBeDefined()
    expect(statusBefore?.runCount).toBe(0)

    await scheduler.trigger('test.job')
    expect(runs).toBe(1)

    const statusAfter = scheduler.getJob('test.job')
    expect(statusAfter?.runCount).toBe(1)
    expect(statusAfter?.lastRun).toBeDefined()
  })

  test('rejects duplicate job names', () => {
    const scheduler = createCronScheduler({
      cronFactory: () => ({ stop: () => {}, unref: () => {} }),
    })

    scheduler.register({
      name: 'dup.job',
      schedule: '* * * * *',
      handler: () => {},
    })

    expect(() =>
      scheduler.register({
        name: 'dup.job',
        schedule: '0 * * * *',
        handler: () => {},
      }),
    ).toThrow('is already registered')
  })

  test('start and stop activates and deactivates cron handles', () => {
    let stoppedCount = 0
    let factoryCalled = 0

    const mockFactory = (_sched: string, _cb: () => void) => {
      factoryCalled++
      return {
        stop: () => {
          stoppedCount++
        },
        unref: () => {},
      }
    }

    const scheduler = createCronScheduler({ cronFactory: mockFactory })

    scheduler.register({
      name: 'job1',
      schedule: '0 * * * *',
      handler: () => {},
    })

    scheduler.register({
      name: 'job2',
      schedule: '*/5 * * * *',
      handler: () => {},
    })

    expect(factoryCalled).toBe(0)

    scheduler.start()
    expect(factoryCalled).toBe(2)
    expect(scheduler.listJobs().every((j) => j.active)).toBe(true)

    scheduler.stop()
    expect(stoppedCount).toBe(2)
    expect(scheduler.listJobs().every((j) => !j.active)).toBe(true)
  })

  test('createStandardMaintenanceJobs configures standard maintenance tasks', async () => {
    let prunedSessions = 0
    let rolledStats = 0
    let prunedAudits = 0
    let dispatched = 0

    const jobs = createStandardMaintenanceJobs({
      pruneSessions: async () => {
        prunedSessions++
        return 10
      },
      rollupStats: async () => {
        rolledStats++
      },
      pruneAudits: async () => {
        prunedAudits++
        return 50
      },
      dispatchSchedules: async () => {
        dispatched++
        return 2
      },
    })

    expect(jobs).toHaveLength(4)

    const scheduler = createCronScheduler({
      cronFactory: () => ({ stop: () => {}, unref: () => {} }),
    })

    for (const job of jobs) {
      scheduler.register(job)
    }

    await scheduler.trigger('maintenance.sessions.prune')
    expect(prunedSessions).toBe(1)

    await scheduler.trigger('maintenance.stats.rollup')
    expect(rolledStats).toBe(1)

    await scheduler.trigger('maintenance.audits.prune')
    expect(prunedAudits).toBe(1)

    await scheduler.trigger('maintenance.schedules.dispatch')
    expect(dispatched).toBe(1)
  })

  test('real Bun.cron integration starts and stops cleanly', () => {
    const scheduler = createCronScheduler() // uses default Bun.cron

    scheduler.register({
      name: 'native.test',
      schedule: '0 0 1 1 *', // runs once a year
      handler: () => {},
    })

    scheduler.start()
    expect(scheduler.getJob('native.test')?.active).toBe(true)
    scheduler.stop()
    expect(scheduler.getJob('native.test')?.active).toBe(false)
  })
})
