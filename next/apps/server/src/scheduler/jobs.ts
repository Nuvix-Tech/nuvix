import type { CronJobRegistration } from './cron'

export interface MaintenanceJobDependencies {
  pruneSessions?: () => Promise<number>
  rollupStats?: () => Promise<void>
  pruneAudits?: () => Promise<number>
  dispatchSchedules?: () => Promise<number>
}

/**
 * Creates standard maintenance jobs with typical enterprise schedules.
 */
export function createStandardMaintenanceJobs(
  deps: MaintenanceJobDependencies,
): CronJobRegistration[] {
  const jobs: CronJobRegistration[] = []

  if (deps.pruneSessions) {
    const prune = deps.pruneSessions
    jobs.push({
      name: 'maintenance.sessions.prune',
      schedule: '0 * * * *', // hourly
      handler: async () => {
        await prune()
      },
    })
  }

  if (deps.rollupStats) {
    const rollup = deps.rollupStats
    jobs.push({
      name: 'maintenance.stats.rollup',
      schedule: '5 * * * *', // 5 minutes past each hour
      handler: async () => {
        await rollup()
      },
    })
  }

  if (deps.pruneAudits) {
    const prune = deps.pruneAudits
    jobs.push({
      name: 'maintenance.audits.prune',
      schedule: '0 2 * * *', // 2:00 AM daily
      handler: async () => {
        await prune()
      },
    })
  }

  if (deps.dispatchSchedules) {
    const dispatch = deps.dispatchSchedules
    jobs.push({
      name: 'maintenance.schedules.dispatch',
      schedule: '* * * * *', // every minute
      handler: async () => {
        await dispatch()
      },
    })
  }

  return jobs
}
