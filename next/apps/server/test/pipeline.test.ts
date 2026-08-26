import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { cors } from '../src/plugins/cors'
import { rateLimit } from '../src/plugins/rate-limit'
import { securityHeaders } from '../src/plugins/security'
import { RATE_LIMIT_HEADERS } from '../src/shared/constants'

const app = new Elysia({ prefix: '/v2' })
  .use(cors({ origin: ['http://allowed.com'] }))
  .use(securityHeaders)
  .use(rateLimit({ max: 3, windowMs: 60_000 }))
  .get('/ping', () => ({ pong: true }))

describe('cors', () => {
  test('allows whitelisted origin', async () => {
    const res = await app.handle(
      new Request('http://x/v2/ping', {
        headers: { origin: 'http://allowed.com' },
      }),
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('http://allowed.com')
  })

  test('no CORS header for unknown origin', async () => {
    const res = await app.handle(
      new Request('http://x/v2/ping', {
        headers: { origin: 'http://evil.com' },
      }),
    )
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('preflight returns 204 with method allowlist', async () => {
    const res = await app.handle(
      new Request('http://x/v2/ping', {
        method: 'OPTIONS',
        headers: { origin: 'http://allowed.com' },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })
})

describe('security headers', () => {
  test('applies headers to every response', async () => {
    const res = await app.handle(new Request('http://x/v2/ping'))
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })
})

describe('rate limiting', () => {
  test('sets ratelimit headers and 429s after max', async () => {
    // fresh instance — the shared `app` above already consumed its window
    const limited = new Elysia({ prefix: '/v2' })
      .use(rateLimit({ max: 3, windowMs: 60_000 }))
      .get('/ping', () => ({ pong: true }))

    const req = () => new Request('http://x/v2/ping')

    const r1 = await limited.handle(req())
    expect(r1.status).toBe(200)
    expect(Number(r1.headers.get(RATE_LIMIT_HEADERS.remaining))).toBeLessThanOrEqual(2)

    await limited.handle(req())
    await limited.handle(req())

    const r4 = await limited.handle(req())
    expect(r4.status).toBe(429)
    expect(r4.headers.get('content-type')).toContain('application/problem+json')
    expect(r4.headers.get('retry-after')).toBeDefined()

    const body = (await r4.json()) as Record<string, unknown>
    expect(body.type).toBe('/errors/rate-limited')
  })
})
