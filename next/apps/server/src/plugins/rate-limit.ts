import type { Elysia } from 'elysia'
import { RATE_LIMIT_HEADERS } from '../shared/constants'

/**
 * Rate limiting with a pluggable store.
 *
 * Phase 1 ships an in-memory fixed-window store (single-process dev/test).
 * The `Store` interface is designed so a Redis-backed store drops in later
 * (Phase 6) without touching call sites.
 */

export interface RateLimitStore {
  /** Increments the counter for key, returns [count, windowResetAt] (unix ms). */
  increment(key: string, windowMs: number): Promise<[count: number, resetAt: number]>
}

export class MemoryRateLimitStore implements RateLimitStore {
  private windows = new Map<string, { count: number; resetAt: number }>()

  async increment(key: string, windowMs: number): Promise<[number, number]> {
    const now = Date.now()
    let entry = this.windows.get(key)

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      this.windows.set(key, entry)
      // opportunistic cleanup to bound memory
      if (this.windows.size > 10_000) this.evictExpired(now)
    }

    entry.count += 1
    return [entry.count, entry.resetAt]
  }

  private evictExpired(now: number) {
    for (const [k, v] of this.windows) {
      if (v.resetAt <= now) this.windows.delete(k)
    }
  }
}

export interface RateLimitOptions {
  /** Max requests per window per key. */
  max: number
  /** Window size in milliseconds. */
  windowMs: number
  store?: RateLimitStore
  /** Bucket name — distinct limits can coexist (e.g. 'auth', 'api'). */
  bucket?: string
  /** Custom key function. Defaults to client IP. */
  keyBy?: (request: Request) => string
}

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

export function rateLimit(options: RateLimitOptions) {
  const store = options.store ?? new MemoryRateLimitStore()
  const bucket = options.bucket ?? 'api'

  return (app: Elysia) =>
    app.request(async ({ request, set }) => {
      const key = `${bucket}:${options.keyBy?.(request) ?? clientIp(request)}`
      const [count, resetAt] = await store.increment(key, options.windowMs)
      const remaining = Math.max(0, options.max - count)

      set.headers[RATE_LIMIT_HEADERS.limit] = String(options.max)
      set.headers[RATE_LIMIT_HEADERS.remaining] = String(remaining)
      set.headers[RATE_LIMIT_HEADERS.reset] = String(Math.floor(resetAt / 1000))

      if (count > options.max) {
        set.status = 429
        set.headers['retry-after'] = String(Math.ceil((resetAt - Date.now()) / 1000))
        return new Response(
          JSON.stringify({
            type: '/errors/rate-limited',
            title: 'Too Many Requests',
            status: 429,
            detail: 'Rate limit exceeded',
          }),
          {
            status: 429,
            headers: { 'content-type': 'application/problem+json' },
          },
        )
      }
    })
}
