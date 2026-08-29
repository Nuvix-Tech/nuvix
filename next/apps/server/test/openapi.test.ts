import { describe, expect, test } from 'bun:test'

// app.ts loads config at import time — seed required env first
process.env.NUVIX_INTERNAL_DATABASE_URL ||= 'postgres://x:x@localhost:5432/x'
process.env.NUVIX_REDIS_URL ||= 'redis://localhost:6379'
process.env.NUVIX_JWT_SECRET ||= 'test-secret'

const { createApp } = await import('../src/app')
const app = await createApp({
  isProduction: false,
  geoip: { lookup: () => null },
})

describe('openapi', () => {
  test('serves spec including registered routes', async () => {
    const res = await app.handle(new Request('http://x/v2/openapi/json'))
    expect(res.status).toBe(200)

    const spec = (await res.json()) as { paths: Record<string, unknown> }
    expect(Object.keys(spec.paths)).toContain('/v2/health')
  })

  test('serves scalar UI', async () => {
    const res = await app.handle(new Request('http://x/v2/openapi'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<html')
  })
})
