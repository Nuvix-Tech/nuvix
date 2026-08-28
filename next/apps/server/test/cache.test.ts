import { describe, expect, test } from 'bun:test'
import { Cache, type CacheDriver, Memory, None, type RedisAdapterOptions } from '@nuvix/cache'
import {
  type CacheConstruction,
  createCache,
  type MemoryCacheOptions,
} from '../src/infrastructure/cache'

function construction(overrides: Partial<CacheConstruction>): Partial<CacheConstruction> {
  return overrides
}

describe('cache construction factory', () => {
  test('selects memory, forwards its options, and shares the driver with the facade', async () => {
    // Arrange
    const options = { namespace: 'sessions', defaultTTL: 120 } as const
    const driver = new Memory()
    let receivedOptions: MemoryCacheOptions | undefined
    let facadeDriver: CacheDriver | undefined

    // Act
    const result = createCache(
      { kind: 'memory', options },
      construction({
        memory: (input) => {
          receivedOptions = input
          return driver
        },
        facade: (input) => {
          facadeDriver = input
          return new Cache(input)
        },
      }),
    )
    await result.driver.set('shared', 'value')
    const value = await result.cache.get<string>('shared')

    // Assert
    expect({
      selectedDriver: result.driver === driver,
      facadeDriver: facadeDriver === driver,
      forwardedExactly: receivedOptions === options,
      value,
    }).toEqual({
      selectedDriver: true,
      facadeDriver: true,
      forwardedExactly: true,
      value: 'value',
    })
  })

  test('selects redis and forwards its options without constructing a Redis client', () => {
    // Arrange
    const options = {
      url: 'redis://cache.example.test:6379/2',
      namespace: 'projects',
      defaultTTL: 300,
      keyPrefix: 'test:',
    } satisfies RedisAdapterOptions
    const driver = new Memory()
    let receivedOptions: RedisAdapterOptions | undefined

    // Act
    const result = createCache(
      { kind: 'redis', options },
      construction({
        redis: (input) => {
          receivedOptions = input
          return driver
        },
      }),
    )

    // Assert
    expect({
      selectedDriver: result.driver === driver,
      forwardedExactly: receivedOptions === options,
    }).toEqual({ selectedDriver: true, forwardedExactly: true })
  })

  test('selects the injected disabled adapter', () => {
    // Arrange
    const driver = new None()
    let selections = 0

    // Act
    const result = createCache(
      { kind: 'none' },
      construction({
        none: () => {
          selections += 1
          return driver
        },
      }),
    )

    // Assert
    expect({ selectedDriver: result.driver === driver, selections }).toEqual({
      selectedDriver: true,
      selections: 1,
    })
  })

  test('disabled cache accepts writes and always returns a miss', async () => {
    // Arrange
    const result = createCache({ kind: 'none' })

    // Act
    const written = await result.cache.set('discarded', { id: 'value' })
    const cached = await result.cache.get('discarded')

    // Assert
    expect({ written, cached }).toEqual({ written: true, cached: null })
  })
})
