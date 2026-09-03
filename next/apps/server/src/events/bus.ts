import { eventMatchesPattern } from '../webhooks/matcher'
import type { EventPayload } from './types'

export type EventHandler<T = unknown> = (payload: EventPayload<T>) => Promise<void> | void

export type Unsubscribe = () => void

export interface EventBusOptions {
  onError?: (error: unknown, event: string, payload: EventPayload) => void
}

export interface EventBus {
  emit<T = unknown>(payload: EventPayload<T>): Promise<void>
  on<T = unknown>(pattern: string, handler: EventHandler<T>): Unsubscribe
  once<T = unknown>(pattern: string, handler: EventHandler<T>): Unsubscribe
  listenerCount(pattern?: string): number
  clear(): void
}

type InternalHandler = (payload: EventPayload<unknown>) => Promise<void> | void

interface Subscription {
  pattern: string
  handler: InternalHandler
  once?: boolean
}

export function createEventBus(options: EventBusOptions = {}): EventBus {
  const subscriptions = new Set<Subscription>()
  const onError =
    options.onError ??
    ((err, ev) => {
      console.error(`[EventBus] Unhandled error in listener for event "${ev}":`, err)
    })

  return {
    async emit<T = unknown>(payload: EventPayload<T>): Promise<void> {
      const matching: Subscription[] = []

      for (const sub of subscriptions) {
        if (eventMatchesPattern(payload.event, sub.pattern)) {
          matching.push(sub)
          if (sub.once) {
            subscriptions.delete(sub)
          }
        }
      }

      // Execute all matching handlers concurrently with error isolation
      await Promise.all(
        matching.map(async (sub) => {
          try {
            await sub.handler(payload as EventPayload<unknown>)
          } catch (err) {
            onError(err, payload.event, payload)
          }
        }),
      )
    },

    on<T = unknown>(pattern: string, handler: EventHandler<T>): Unsubscribe {
      const sub: Subscription = {
        pattern,
        handler: handler as unknown as InternalHandler,
      }
      subscriptions.add(sub)
      return () => {
        subscriptions.delete(sub)
      }
    },

    once<T = unknown>(pattern: string, handler: EventHandler<T>): Unsubscribe {
      const sub: Subscription = {
        pattern,
        handler: handler as unknown as InternalHandler,
        once: true,
      }
      subscriptions.add(sub)
      return () => {
        subscriptions.delete(sub)
      }
    },

    listenerCount(pattern?: string): number {
      if (!pattern) return subscriptions.size
      let count = 0
      for (const sub of subscriptions) {
        if (sub.pattern === pattern) count++
      }
      return count
    },

    clear(): void {
      subscriptions.clear()
    },
  }
}
