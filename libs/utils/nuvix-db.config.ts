import type { NuvixDBConfig } from '@nuvix/db'
import collections from './src/collections'

const config: NuvixDBConfig = {
  collections: Object.values({
    ...collections.auth,
    ...collections.project,
    ...collections.database,
    ...collections.bucket,
    ...collections.internal,
  })
    .map((c: any) => ({
      ...c,
      documentSecurity: false,
      enabled: true,
    }))
    .filter(Boolean)
    .filter(c => c.attributes?.length > 0),

  typeGeneration: {
    outputPath: './types/generated.ts',
    packageName: '@nuvix/db',
    includeDocTypes: true,
    generateUtilityTypes: true,
    generateQueryTypes: false,
    generateInputTypes: true,
  },

  options: {
    debug: false,
    strict: true,
  },
}

export default config
