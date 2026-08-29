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
    const owner = startProcess(
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
    expect(order).toEqual(['http', 'runtime'])
  })

  test('attempts runtime cleanup when HTTP stop fails', async () => {
    const order: string[] = []
    const app = await createApp({
      isProduction: false,
      geoip: { lookup: () => null },
    })
    const owner = startProcess(
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
          throw new Error('stop failed')
        },
      }),
    )

    const failure = await owner.close().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect(order).toEqual(['http', 'runtime'])
  })
})
