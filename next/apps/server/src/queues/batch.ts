export interface BatchQueueOptions<T> {
  readonly batchSize?: number
  readonly intervalMs?: number
  readonly persist: (items: T[]) => Promise<void>
  readonly onError?: (error: unknown, items: T[]) => void
}

export interface BatchQueue<T> {
  push(item: T): Promise<void>
  pushMany(items: T[]): Promise<void>
  flush(): Promise<number>
  stop(): Promise<void>
  size(): number
}

export function createBatchQueue<T>(options: BatchQueueOptions<T>): BatchQueue<T> {
  const batchSize = options.batchSize ?? 1000
  const intervalMs = options.intervalMs ?? 3000
  const persist = options.persist
  const onError =
    options.onError ??
    ((err, items) => {
      console.error(`[BatchQueue] Failed to persist batch of ${items.length} items:`, err)
    })

  let buffer: T[] = []
  let isFlushing = false
  let timer: ReturnType<typeof setInterval> | null = null

  const flush = async (): Promise<number> => {
    if (isFlushing || buffer.length === 0) return 0
    isFlushing = true

    const snapshot = buffer
    buffer = []

    try {
      await persist(snapshot)
      return snapshot.length
    } catch (err) {
      onError(err, snapshot)
      // Restore failed items at the beginning of the buffer
      buffer.unshift(...snapshot)
      return 0
    } finally {
      isFlushing = false
    }
  }

  const startTimer = () => {
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      void flush()
    }, intervalMs)
    if (timer && typeof timer === 'object' && 'unref' in timer) {
      const unrefable = timer as { unref?: () => void }
      if (typeof unrefable.unref === 'function') {
        unrefable.unref()
      }
    }
  }

  startTimer()

  return {
    async push(item: T): Promise<void> {
      buffer.push(item)
      if (buffer.length >= batchSize) {
        await flush()
      }
    },

    async pushMany(items: T[]): Promise<void> {
      buffer.push(...items)
      if (buffer.length >= batchSize) {
        await flush()
      }
    },

    async flush(): Promise<number> {
      return await flush()
    },

    async stop(): Promise<void> {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      await flush()
    },

    size(): number {
      return buffer.length
    },
  }
}
