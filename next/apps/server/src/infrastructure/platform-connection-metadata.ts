import {
  createTenantDatabaseResource,
  type TenantDatabaseResource,
} from './tenant-database-resource'

export interface PlatformConnectionMetadata {
  readonly connectionString: string
}

export interface PlatformConnectionMetadataResolver {
  resolve(projectId: string): Promise<PlatformConnectionMetadata | null>
}

export type TenantDatabaseResourceFactory<Resource> = (connectionString: string) => Resource

function resolvedConnection(metadata: PlatformConnectionMetadata | null): string {
  if (metadata === null) throw new Error('Tenant database connection metadata was not found')
  if (typeof metadata !== 'object') {
    throw new TypeError('Tenant database connection metadata is invalid')
  }

  const connectionString = metadata.connectionString
  if (
    typeof connectionString !== 'string' ||
    connectionString === '' ||
    connectionString.trim() !== connectionString
  ) {
    throw new TypeError('Tenant database connection metadata is invalid')
  }

  try {
    const protocol = new URL(connectionString).protocol
    if (protocol !== 'postgres:' && protocol !== 'postgresql:') throw new Error('invalid protocol')
  } catch {
    throw new TypeError('Tenant database connection metadata is invalid')
  }

  return connectionString
}

async function resolveMetadata(
  resolver: PlatformConnectionMetadataResolver,
  projectId: string,
): Promise<PlatformConnectionMetadata | null> {
  try {
    return await resolver.resolve(projectId)
  } catch {
    throw new Error('Tenant database connection metadata resolution failed')
  }
}

export function createResolverBackedTenantDatabaseResource(
  projectId: string,
  resolver: PlatformConnectionMetadataResolver,
): Promise<TenantDatabaseResource>
export function createResolverBackedTenantDatabaseResource<Resource>(
  projectId: string,
  resolver: PlatformConnectionMetadataResolver,
  createResource: TenantDatabaseResourceFactory<Resource>,
): Promise<Resource>
export async function createResolverBackedTenantDatabaseResource(
  projectId: string,
  resolver: PlatformConnectionMetadataResolver,
  createResource: TenantDatabaseResourceFactory<unknown> = createTenantDatabaseResource,
): Promise<unknown> {
  if (projectId === '' || projectId.trim() !== projectId) {
    throw new TypeError('projectId must be a normalized, non-empty value')
  }

  const metadata = await resolveMetadata(resolver, projectId)
  return createResource(resolvedConnection(metadata))
}
