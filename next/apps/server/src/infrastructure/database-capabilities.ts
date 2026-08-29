export interface DatabaseCapabilitySource {
  readonly $documentSizeLimit: number
  readonly $limitForAttributes: number
  readonly $limitForIndexes: number
  readonly $supportForAttributes: boolean
  readonly $supportForBatchOperations: boolean
  readonly $supportForFulltextIndex: boolean
  readonly $supportForIndex: boolean
  readonly $supportForIndexArray: boolean
  readonly $supportForJSONOverlaps: boolean
  readonly $supportForRelationships: boolean
  readonly $supportForSchemas: boolean
  readonly $supportForTimeouts: boolean
  readonly $supportForUniqueIndex: boolean
  readonly $supportForUpdateLock: boolean
}

export interface DatabaseCapabilities {
  readonly limits: {
    readonly attributes: number
    readonly documentBytes: number
    readonly indexes: number
  }
  readonly features: {
    readonly attributes: boolean
    readonly arrayIndexes: boolean
    readonly batchOperations: boolean
    readonly fullTextSearch: boolean
    readonly indexes: boolean
    readonly jsonOverlaps: boolean
    readonly relationships: boolean
    readonly schemas: boolean
    readonly timeouts: boolean
    readonly uniqueIndexes: boolean
    readonly updateLocks: boolean
  }
}

export type OptionalDatabaseFeature = keyof DatabaseCapabilities['features']

export class UnsupportedDatabaseFeatureError extends Error {
  readonly code = 'database_feature_unsupported'

  constructor(readonly feature: OptionalDatabaseFeature) {
    super(`Database feature is not supported: ${feature}`)
    this.name = 'UnsupportedDatabaseFeatureError'
  }
}

/** Derives application policy only from common adapter capabilities. */
export function deriveDatabaseCapabilities(source: DatabaseCapabilitySource): DatabaseCapabilities {
  return Object.freeze({
    limits: Object.freeze({
      attributes: source.$limitForAttributes,
      documentBytes: source.$documentSizeLimit,
      indexes: source.$limitForIndexes,
    }),
    features: Object.freeze({
      attributes: source.$supportForAttributes,
      arrayIndexes: source.$supportForIndexArray,
      batchOperations: source.$supportForBatchOperations,
      fullTextSearch: source.$supportForFulltextIndex,
      indexes: source.$supportForIndex,
      jsonOverlaps: source.$supportForJSONOverlaps,
      relationships: source.$supportForRelationships,
      schemas: source.$supportForSchemas,
      timeouts: source.$supportForTimeouts,
      uniqueIndexes: source.$supportForUniqueIndex,
      updateLocks: source.$supportForUpdateLock,
    }),
  })
}

/** Rejects optional work before it can call persistence. */
export function requireDatabaseFeature(
  capabilities: DatabaseCapabilities,
  feature: OptionalDatabaseFeature,
): void {
  if (!capabilities.features[feature]) throw new UnsupportedDatabaseFeatureError(feature)
}

/** Runs optional persistence work only after the capability gate succeeds. */
export async function runDatabaseFeature<T>(
  capabilities: DatabaseCapabilities,
  feature: OptionalDatabaseFeature,
  operation: () => Promise<T>,
): Promise<T> {
  requireDatabaseFeature(capabilities, feature)
  return await operation()
}
