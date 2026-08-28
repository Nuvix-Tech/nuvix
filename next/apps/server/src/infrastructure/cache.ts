import {
  Cache,
  type CacheDriver,
  Memory,
  None,
  Redis,
  type RedisAdapterOptions,
} from '@nuvix/cache'

export interface MemoryCacheOptions {
  readonly namespace?: string
  readonly defaultTTL?: number
}

export type CacheConfiguration =
  | { readonly kind: 'memory'; readonly options?: MemoryCacheOptions }
  | { readonly kind: 'redis'; readonly options: RedisAdapterOptions }
  | { readonly kind: 'none' }

export interface CacheResources {
  readonly driver: CacheDriver
  readonly cache: Cache
}

export interface CacheConstruction {
  readonly memory: (options?: MemoryCacheOptions) => CacheDriver
  readonly redis: (options: RedisAdapterOptions) => CacheDriver
  readonly none: () => CacheDriver
  readonly facade: (driver: CacheDriver) => Cache
}

const DEFAULT_CONSTRUCTION: CacheConstruction = {
  memory: (options) => new Memory(options),
  redis: (options) => new Redis(options),
  none: () => new None(),
  facade: (driver) => new Cache(driver),
}

function resources(driver: CacheDriver, facade: CacheConstruction['facade']): CacheResources {
  return { driver, cache: facade(driver) }
}

export function createCache(
  configuration: CacheConfiguration,
  construction: Partial<CacheConstruction> = {},
): CacheResources {
  const dependencies = { ...DEFAULT_CONSTRUCTION, ...construction }

  switch (configuration.kind) {
    case 'memory':
      return resources(dependencies.memory(configuration.options), dependencies.facade)
    case 'redis':
      return resources(dependencies.redis(configuration.options), dependencies.facade)
    case 'none':
      return resources(dependencies.none(), dependencies.facade)
  }
}
