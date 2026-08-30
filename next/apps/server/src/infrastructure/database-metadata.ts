export interface DatabaseMetadata {
  readonly schema: string
  readonly sharedTables: boolean
  readonly namespace: string
}

/** Canonical @nuvix/db adapter metadata for every supported database role. */
export const DATABASE_METADATA = Object.freeze({
  platform: Object.freeze({
    postgresql: Object.freeze({
      schema: 'internal',
      sharedTables: false,
      namespace: 'platform',
    } satisfies DatabaseMetadata),
    sqlite: Object.freeze({
      schema: 'main',
      sharedTables: false,
      namespace: 'platform',
    } satisfies DatabaseMetadata),
  }),
  tenant: Object.freeze({
    postgresql: Object.freeze({
      schema: 'public',
      sharedTables: false,
      namespace: 'nx',
    } satisfies DatabaseMetadata),
  }),
})
