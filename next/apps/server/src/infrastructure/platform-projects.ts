import { type Doc, Query } from '@nuvix/db'
import {
  PLATFORM_PERSISTENCE_MODEL,
  type PlatformPersistenceModel,
  type PlatformProject,
} from './platform-persistence-model'

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/

/** Least-privilege privileged-session capability required by this lookup. */
export interface PlatformProjectDocuments {
  find(collectionId: string, queries?: Query[]): Promise<Doc[]>
}

export interface PlatformProjectLookup {
  resolve(publicId: string): Promise<PlatformProject | null>
}

/** Redacted infrastructure failure. Source documents and causes stay private. */
export class PlatformProjectLookupError extends Error {
  readonly code = 'platform_project_lookup_failed'

  constructor() {
    super('Platform project lookup failed')
    this.name = 'PlatformProjectLookupError'
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_ID_PATTERN.test(value)
}

function project(document: Doc, model: PlatformPersistenceModel): PlatformProject {
  const publicId: unknown = document.get(model.fields.projects.publicId)
  const enabled: unknown = document.get(model.fields.projects.enabled)

  if (!validId(publicId) || typeof enabled !== 'boolean') {
    throw new PlatformProjectLookupError()
  }

  return Object.freeze({ id: publicId, enabled })
}

async function documents(
  lookup: PlatformProjectDocuments,
  publicId: string,
  model: PlatformPersistenceModel,
): Promise<Doc[]> {
  const result = await lookup
    .find(model.collections.projects, [
      Query.equal(model.fields.projects.publicId, [publicId]),
      Query.select([model.fields.projects.publicId, model.fields.projects.enabled]),
      Query.limit(2),
    ])
    .catch(() => {
      throw new PlatformProjectLookupError()
    })

  if (!Array.isArray(result)) throw new PlatformProjectLookupError()
  return result
}

/** Creates an adapter-neutral, layout-configurable project registry lookup. */
export function createPlatformProjectLookup(
  lookup: PlatformProjectDocuments,
  model: PlatformPersistenceModel = PLATFORM_PERSISTENCE_MODEL,
): PlatformProjectLookup {
  return Object.freeze({
    async resolve(publicId: string): Promise<PlatformProject | null> {
      if (!validId(publicId)) throw new PlatformProjectLookupError()

      const matches = await documents(lookup, publicId, model)
      if (matches.length === 0) return null
      if (matches.length !== 1) throw new PlatformProjectLookupError()

      const resolved = project(matches[0]!, model)
      if (resolved.id !== publicId) throw new PlatformProjectLookupError()
      if (!resolved.enabled) return null
      return resolved
    },
  })
}
