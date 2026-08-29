import { describe, expect, test } from 'bun:test'
import { createPlatformRuntime } from '../src/infrastructure/platform-runtime'

describe('platform runtime', () => {
  test('owns an injectable SQLite platform and leaves schema setup explicit', async () => {
    const runtime = await createPlatformRuntime({
      database: { driver: 'sqlite', filename: ':memory:' },
      publishableKeyEnvironment: 'test',
      app: {
        isProduction: false,
        geoip: { lookup: () => null },
        uptime: () => 5,
      },
    })

    try {
      const response = await runtime.app.handle(new Request('http://nuvix.test/v2/health'))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        status: 'ok',
        version: '2.0.0-alpha.1',
        uptime: 5,
      })
      expect(Object.keys(runtime.requests)).toEqual(['withProject'])
    } finally {
      await runtime.close()
    }
  })

  test('closes process-owned resources idempotently', async () => {
    const runtime = await createPlatformRuntime({
      database: { driver: 'sqlite', filename: ':memory:' },
      publishableKeyEnvironment: 'test',
      app: { isProduction: false, geoip: { lookup: () => null } },
    })

    const first = runtime.close()

    expect(runtime.close()).toBe(first)
    await first
  })
})
