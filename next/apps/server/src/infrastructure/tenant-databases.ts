export interface TenantDatabaseResource<Database> {
  readonly database: Database
  close(): Promise<void>
}

export interface TenantDatabaseLease<Database> {
  readonly database: Database
  /** Releases once; repeated calls return the same promise, including the same cleanup failure. */
  release(): Promise<void>
}

export interface TenantDatabases<Database> {
  acquire(projectId: string): Promise<TenantDatabaseLease<Database>>
  /** Marks the resource unavailable and rejects if an immediately eligible close fails. */
  invalidate(projectId: string): Promise<void>
  /** Attempts all eligible closes and rejects with failures ordered by eviction order. */
  sweep(): Promise<void>
  /** Permanently stops acquisition and remains callable to retry resources that failed to close. */
  closeAll(): Promise<void>
}

interface RegistryEntry<Database> {
  resource?: TenantDatabaseResource<Database>
  ready: Promise<void>
  leases: number
  lastUsedAt: number
  invalidated: boolean
  closing?: Promise<void>
  readonly idleWaiters: Set<() => void>
}

export interface TenantDatabaseRegistryOptions<Database> {
  readonly create: (projectId: string) => Promise<TenantDatabaseResource<Database>>
  readonly maxTenants?: number
  readonly idleMs?: number
  readonly now?: () => number
  /** Receives failures from cleanup started after acquire, where no caller can await the result. */
  readonly onCloseError: (error: unknown, projectId: string) => void
}

interface CloseFailure {
  readonly projectId: string
  readonly error: unknown
}

const DEFAULT_MAX_TENANTS = 100
const DEFAULT_IDLE_MS = 5 * 60_000

/**
 * Owns one database resource per project and leases it to request scopes.
 * Concurrent creation is deduplicated and in-use resources are never evicted.
 */
export class TenantDatabaseRegistry<Database> implements TenantDatabases<Database> {
  private readonly entries = new Map<string, RegistryEntry<Database>>()
  private readonly create: TenantDatabaseRegistryOptions<Database>['create']
  private readonly onCloseError: TenantDatabaseRegistryOptions<Database>['onCloseError']
  private readonly maxTenants: number
  private readonly idleMs: number
  private readonly now: () => number
  private closed = false
  private closePromise?: Promise<void>

  constructor(options: TenantDatabaseRegistryOptions<Database>) {
    const maxTenants = options.maxTenants ?? DEFAULT_MAX_TENANTS
    const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
    if (!Number.isInteger(maxTenants) || maxTenants < 1) {
      throw new RangeError('maxTenants must be a positive integer')
    }
    if (!Number.isFinite(idleMs) || idleMs < 0) {
      throw new RangeError('idleMs must be a non-negative number')
    }
    if (typeof options.onCloseError !== 'function') {
      throw new TypeError('onCloseError must be a function')
    }

    this.create = options.create
    this.onCloseError = options.onCloseError
    this.maxTenants = maxTenants
    this.idleMs = idleMs
    this.now = options.now ?? Date.now
  }

  async acquire(projectId: string): Promise<TenantDatabaseLease<Database>> {
    if (this.closed) throw new Error('Tenant database registry is closed')
    if (projectId === '' || projectId !== projectId.trim()) {
      throw new TypeError('projectId must be a normalized, non-empty value')
    }

    let entry = this.entries.get(projectId)
    if (entry?.invalidated || entry?.closing) {
      throw new Error(`Tenant database is unavailable: ${projectId}`)
    }
    if (!entry) entry = this.createEntry(projectId)

    // Reserve before awaiting construction so cleanup cannot see this as idle.
    entry.leases += 1
    entry.lastUsedAt = this.now()
    try {
      await entry.ready
    } catch (error) {
      this.releaseReservation(entry)
      throw error
    }

    if (this.closed || entry.invalidated) {
      await this.releaseEntry(projectId, entry)
      if (this.closed) throw new Error('Tenant database registry is closed')
      throw new Error(`Tenant database is unavailable: ${projectId}`)
    }

    void this.evictEligible(projectId, true).catch((error) => {
      this.reportCloseFailure({ error, projectId })
    })
    let releasePromise: Promise<void> | undefined
    return {
      database: entry.resource!.database,
      release: () => {
        if (releasePromise) return releasePromise
        releasePromise = this.releaseEntry(projectId, entry)
        return releasePromise
      },
    }
  }

  /** Invalidates immediately; a close failure rejects and remains retryable by invalidating again. */
  async invalidate(projectId: string): Promise<void> {
    const entry = this.entries.get(projectId)
    if (!entry) return
    entry.invalidated = true
    await entry.ready
    if (entry.leases === 0) await this.closeEntry(projectId, entry)
  }

  /** Attempts every eligible close and rejects with ordered failures after all attempts settle. */
  async sweep(): Promise<void> {
    await this.evictEligible()
  }

  /** Stops acquisition, drains leases, attempts every close, and rejects with ordered failures. */
  closeAll(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true

    this.closePromise = this.drainAndClose().catch((error) => {
      this.closePromise = undefined
      throw error
    })
    return this.closePromise
  }

  private async drainAndClose(): Promise<void> {
    const entries = [...this.entries.entries()]
    for (const [, entry] of entries) entry.invalidated = true
    const closes = await Promise.all(
      entries.map(async ([projectId, entry]) => {
        try {
          await entry.ready
        } catch {
          await this.waitUntilIdle(entry)
          return undefined
        }
        await this.waitUntilIdle(entry)
        return { projectId, result: this.closeEntry(projectId, entry) }
      }),
    )
    await this.settleCloses(closes.filter((close) => close !== undefined))
  }

  private createEntry(projectId: string): RegistryEntry<Database> {
    const entry: RegistryEntry<Database> = {
      ready: Promise.resolve(),
      leases: 0,
      lastUsedAt: this.now(),
      invalidated: false,
      idleWaiters: new Set(),
    }

    entry.ready = this.create(projectId)
      .then((resource) => {
        entry.resource = resource
      })
      .catch((error) => {
        if (this.entries.get(projectId) === entry) this.entries.delete(projectId)
        throw error
      })
    this.entries.set(projectId, entry)
    return entry
  }

  private async releaseEntry(projectId: string, entry: RegistryEntry<Database>): Promise<void> {
    this.releaseReservation(entry)
    if (entry.invalidated && entry.leases === 0) {
      await this.closeEntry(projectId, entry)
      return
    }
    await this.evictEligible()
  }

  private releaseReservation(entry: RegistryEntry<Database>): void {
    entry.leases -= 1
    entry.lastUsedAt = this.now()
    if (entry.leases !== 0) return
    for (const resolve of entry.idleWaiters) resolve()
    entry.idleWaiters.clear()
  }

  private waitUntilIdle(entry: RegistryEntry<Database>): Promise<void> {
    if (entry.leases === 0) return Promise.resolve()
    return new Promise((resolve) => entry.idleWaiters.add(resolve))
  }

  private async evictEligible(excludedProjectId?: string, reportFailures = false): Promise<void> {
    const now = this.now()
    const candidates = [...this.entries.entries()].sort(
      ([leftProjectId, left], [rightProjectId, right]) =>
        left.lastUsedAt - right.lastUsedAt || leftProjectId.localeCompare(rightProjectId),
    )
    const closes: Array<{ projectId: string; result: Promise<void> }> = []

    for (const [projectId, entry] of candidates) {
      if (projectId === excludedProjectId || entry.leases !== 0 || entry.closing) continue
      const idle = entry.invalidated || now - entry.lastUsedAt >= this.idleMs
      const openEntries = [...this.entries.values()].filter(
        (candidate) => !candidate.closing,
      ).length
      const overCapacity = openEntries > this.maxTenants
      if (!idle && !overCapacity) continue
      closes.push({ projectId, result: this.closeEntry(projectId, entry) })
    }

    const failures = await this.settleCloses(closes, false)
    if (failures.length === 0) return
    if (!reportFailures) throw this.closeError(failures)
    for (const failure of failures) this.reportCloseFailure(failure)
  }

  private async settleCloses(
    closes: ReadonlyArray<{ projectId: string; result: Promise<void> }>,
    reject = true,
  ): Promise<CloseFailure[]> {
    const results = await Promise.allSettled(closes.map((close) => close.result))
    const failures = results.flatMap((result, index): CloseFailure[] => {
      if (result.status === 'fulfilled') return []
      return [{ projectId: closes[index]!.projectId, error: result.reason }]
    })
    if (reject && failures.length > 0) throw this.closeError(failures)
    return failures
  }

  private closeError(failures: readonly CloseFailure[]): AggregateError {
    const projectIds = failures.map((failure) => failure.projectId).join(', ')
    return new AggregateError(
      failures.map((failure) => failure.error),
      `Failed to close tenant databases: ${projectIds}`,
    )
  }

  private reportCloseFailure(failure: CloseFailure): void {
    try {
      this.onCloseError(failure.error, failure.projectId)
    } catch (reportError) {
      console.error('Tenant database close failure reporter threw', {
        closeError: failure.error,
        projectId: failure.projectId,
        reportError,
      })
    }
  }

  private closeEntry(projectId: string, entry: RegistryEntry<Database>): Promise<void> {
    if (entry.closing) return entry.closing
    if (!entry.resource) {
      return entry.ready.then(() => this.closeEntry(projectId, entry))
    }

    entry.invalidated = true
    entry.closing = Promise.resolve()
      .then(() => entry.resource!.close())
      .then(
        () => {
          if (this.entries.get(projectId) === entry) this.entries.delete(projectId)
        },
        (error) => {
          entry.closing = undefined
          throw error
        },
      )
    return entry.closing
  }
}
