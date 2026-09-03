export interface CronJobRegistration {
  readonly name: string
  readonly schedule: string
  readonly handler: () => Promise<void> | void
  readonly enabled?: boolean
}

export interface CronJobStatus {
  readonly name: string
  readonly schedule: string
  readonly active: boolean
  readonly runCount: number
  readonly lastRun?: string
  readonly lastError?: string
}

export interface CronSchedulerOptions {
  readonly cronFactory?: (
    schedule: string,
    callback: () => void | Promise<void>,
  ) => { stop(): void; unref?: () => void }
  readonly onError?: (error: unknown, jobName: string) => void
}

export interface CronScheduler {
  register(job: CronJobRegistration): void
  start(): void
  stop(): void
  trigger(name: string): Promise<void>
  listJobs(): CronJobStatus[]
  getJob(name: string): CronJobStatus | undefined
}

interface ActiveJobState {
  registration: CronJobRegistration
  active: boolean
  runCount: number
  lastRun?: string
  lastError?: string
  cronHandle?: { stop(): void }
}

export function createCronScheduler(options: CronSchedulerOptions = {}): CronScheduler {
  const cronFactory =
    options.cronFactory ??
    ((schedule, cb) => {
      const job = Bun.cron(schedule, cb)
      job.unref() // Do not hold event loop open
      return job
    })

  const onError =
    options.onError ??
    ((err, name) => {
      console.error(`[CronScheduler] Error in job "${name}":`, err)
    })

  const jobs = new Map<string, ActiveJobState>()
  let isStarted = false

  return {
    register(job: CronJobRegistration): void {
      if (jobs.has(job.name)) {
        throw new Error(`Cron job "${job.name}" is already registered`)
      }

      jobs.set(job.name, {
        registration: job,
        active: false,
        runCount: 0,
      })

      if (isStarted && (job.enabled ?? true)) {
        const state = jobs.get(job.name)!
        state.active = true
        state.cronHandle = cronFactory(job.schedule, async () => {
          try {
            state.runCount++
            state.lastRun = new Date().toISOString()
            await job.handler()
          } catch (err) {
            state.lastError = err instanceof Error ? err.message : String(err)
            onError(err, job.name)
          }
        })
      }
    },

    start(): void {
      if (isStarted) return
      isStarted = true

      for (const [name, state] of jobs.entries()) {
        if ((state.registration.enabled ?? true) && !state.active) {
          state.active = true
          state.cronHandle = cronFactory(state.registration.schedule, async () => {
            try {
              state.runCount++
              state.lastRun = new Date().toISOString()
              await state.registration.handler()
            } catch (err) {
              state.lastError = err instanceof Error ? err.message : String(err)
              onError(err, name)
            }
          })
        }
      }
    },

    stop(): void {
      isStarted = false
      for (const state of jobs.values()) {
        if (state.cronHandle) {
          state.cronHandle.stop()
          state.cronHandle = undefined
        }
        state.active = false
      }
    },

    async trigger(name: string): Promise<void> {
      const state = jobs.get(name)
      if (!state) {
        throw new Error(`Cron job "${name}" not found`)
      }

      try {
        state.runCount++
        state.lastRun = new Date().toISOString()
        await state.registration.handler()
      } catch (err) {
        state.lastError = err instanceof Error ? err.message : String(err)
        onError(err, name)
        throw err
      }
    },

    listJobs(): CronJobStatus[] {
      return Array.from(jobs.values()).map((state) => ({
        name: state.registration.name,
        schedule: state.registration.schedule,
        active: state.active,
        runCount: state.runCount,
        lastRun: state.lastRun,
        lastError: state.lastError,
      }))
    },

    getJob(name: string): CronJobStatus | undefined {
      const state = jobs.get(name)
      if (!state) return undefined
      return {
        name: state.registration.name,
        schedule: state.registration.schedule,
        active: state.active,
        runCount: state.runCount,
        lastRun: state.lastRun,
        lastError: state.lastError,
      }
    },
  }
}
