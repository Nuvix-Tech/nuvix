import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/app'

describe('application factory', () => {
  test('constructs an injectable app without platform or tenant resources', async () => {
    const app = await createApp({
      isProduction: false,
      geoip: { lookup: () => null },
      uptime: () => 42,
    })

    const response = await app.handle(new Request('http://nuvix.test/v2/health'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      version: '2.0.0-alpha.1',
      uptime: 42,
    })
  })

  test('keeps health and OpenAPI independent from project resolution', async () => {
    const app = await createApp({
      isProduction: false,
      geoip: { lookup: () => null },
    })

    const [health, spec] = await Promise.all([
      app.handle(new Request('http://nuvix.test/v2/health')),
      app.handle(new Request('http://nuvix.test/v2/openapi/json')),
    ])

    expect(health.status).toBe(200)
    expect(spec.status).toBe(200)
  })

  test('does not install the obsolete global whoami/auth route', async () => {
    const app = await createApp({
      isProduction: false,
      geoip: { lookup: () => null },
    })

    const response = await app.handle(new Request('http://nuvix.test/v2/whoami'))

    expect(response.status).toBe(404)
  })
})
