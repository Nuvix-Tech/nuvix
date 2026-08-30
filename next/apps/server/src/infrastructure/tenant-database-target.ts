import { type Doc, Query } from '@nuvix/db'
import {
  PLATFORM_PERSISTENCE_MODEL,
  type PlatformPersistenceModel,
  type TenantDatabaseTarget,
} from './platform-persistence-model'

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/

export interface TenantTargetDocuments {
  find(collectionId: string, queries?: Query[]): Promise<Doc[]>
}

export interface TenantTargetResolver {
  resolve(projectId: string): Promise<TenantDatabaseTarget>
}

export class TenantTargetResolutionError extends Error {
  readonly code = 'tenant_target_resolution_failed'

  constructor() {
    super('Tenant database target resolution failed')
    this.name = 'TenantTargetResolutionError'
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string') return null

  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function target(value: unknown): TenantDatabaseTarget {
  const input = record(value)
  if (!input) throw new TenantTargetResolutionError()

  if (
    input.driver !== 'postgresql' ||
    Object.keys(input).toSorted().join() !== 'connectionString,driver' ||
    typeof input.connectionString !== 'string' ||
    input.connectionString.length === 0 ||
    input.connectionString.trim() !== input.connectionString ||
    input.connectionString.includes('\0')
  ) {
    throw new TenantTargetResolutionError()
  }

  try {
    const protocol = new URL(input.connectionString).protocol
    if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
      throw new TenantTargetResolutionError()
    }
    return Object.freeze({
      driver: 'postgresql',
      connectionString: input.connectionString,
    })
  } catch {
    throw new TenantTargetResolutionError()
  }
}

async function matches(
  documents: TenantTargetDocuments,
  projectId: string,
  model: PlatformPersistenceModel,
): Promise<Doc[]> {
  return await documents
    .find(model.collections.tenantTargets, [
      Query.equal(model.fields.tenantTargets.projectId, [projectId]),
      Query.select([model.fields.tenantTargets.projectId, model.fields.tenantTargets.target]),
      Query.limit(2),
    ])
    .catch(() => {
      throw new TenantTargetResolutionError()
    })
}

/** Resolves owner-only target data; callers must consume it inside composition. */
export function createTenantTargetResolver(
  documents: TenantTargetDocuments,
  model: PlatformPersistenceModel = PLATFORM_PERSISTENCE_MODEL,
): TenantTargetResolver {
  return Object.freeze({
    async resolve(projectId: string): Promise<TenantDatabaseTarget> {
      if (!PROJECT_ID_PATTERN.test(projectId)) throw new TenantTargetResolutionError()

      const found = await matches(documents, projectId, model)
      if (!Array.isArray(found) || found.length !== 1) throw new TenantTargetResolutionError()

      const storedProjectId: unknown = found[0]!.get(model.fields.tenantTargets.projectId)
      const storedTarget: unknown = found[0]!.get(model.fields.tenantTargets.target)
      if (storedProjectId !== projectId) throw new TenantTargetResolutionError()

      return target(storedTarget)
    },
  })
}
