import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/app'
import { startProcess } from '../src/process'

describe('server process owner', () => {
  test('stops HTTP before closing runtime and shares the close promise', async () => {
    const order: string[] = []
    const app = await createApp({
      isProduction: false,
      geoip: { lookup: () => null },
    })
    const owner = await startProcess(
      {
        app,
        close: async () => {
          order.push('runtime')
        },
      },
      { host: '127.0.0.1', port: 4000 },
      () => ({
        hostname: '127.0.0.1',
        port: 4000,
        stop: async () => {
          order.push('http')
        },
      }),
    )

    const first = owner.close()

    expect(owner.close()).toBe(first)
    await first
    expect(owner.close()).toBe(first)
    expect(order).toEqual(['http', 'runtime'])
  })

  test('attempts every stage and redacts ordered shutdown failures', async () => {
    const order: string[] = []
    const app = await createApp({
      isProduction: false,
      geoip: { lookup: () => null },
    })
    const owner = await startProcess(
      {
        app,
        close: async () => {
          order.push('runtime')
          throw new Error('postgresql://owner:runtime-secret@example.test/database')
        },
      },
      { host: '127.0.0.1', port: 4000 },
      () => ({
        hostname: '127.0.0.1',
        port: 4000,
        stop: () => {
          order.push('http')
          throw new Error('provider stop failed with http-secret')
        },
      }),
    )

    const first = owner.close()
    expect(owner.close()).toBe(first)
    const failure = await first.catch((error: unknown) => error)

    expect(owner.close()).toBe(first)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).message).toBe('Server process close failed')
    expect((failure as AggregateError).errors.map((error) => (error as Error).message)).toEqual([
      'HTTP server stop failed',
      'Runtime resource close failed',
    ])
    expect(order).toEqual(['http', 'runtime'])
    const diagnostic = `${String(failure)} ${(failure as AggregateError).errors.join(' ')}`
    expect(diagnostic).not.toContain('http-secret')
    expect(diagnostic).not.toContain('runtime-secret')
    expect(diagnostic).not.toContain('postgresql://')
  })

  test('preserves an HTTP startup failure after awaited runtime rollback', async () => {
    const startupFailure = new Error('HTTP listener startup failed')
    const order: string[] = []
    const app = await createApp({
      isProduction: false,
      geoip: { lookup: () => null },
    })

    const failure = await startProcess(
      {
        app,
        close: async () => {
          order.push('runtime')
          throw new Error('postgresql://owner:rollback-secret@example.test/database')
        },
      },
      { host: '127.0.0.1', port: 4000 },
      () => {
        order.push('http')
        throw startupFailure
      },
    ).catch((error: unknown) => error)

    expect(failure).toBe(startupFailure)
    expect(order).toEqual(['http', 'runtime'])
    expect(String(failure)).not.toContain('rollback-secret')
  })
})
