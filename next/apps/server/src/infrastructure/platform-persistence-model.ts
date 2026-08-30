/** Safe project state returned by the platform registry. */
export interface PlatformProject {
  readonly id: string
  readonly enabled: boolean
}

/** Process-owner-only configuration used to construct a tenant database resource. */
export type TenantDatabaseTarget = {
  readonly driver: 'postgresql'
  readonly connectionString: string
}

export interface PlatformTenantTarget {
  readonly projectId: string
  readonly target: TenantDatabaseTarget
}

export interface PlatformPersistenceModel {
  readonly collections: {
    readonly projects: string
    readonly tenantTargets: string
  }
  readonly fields: {
    readonly projects: {
      readonly publicId: string
      readonly enabled: string
    }
    readonly tenantTargets: {
      readonly projectId: string
      readonly target: string
    }
  }
}

/**
 * Module-owned v2 collection contract. Legacy collection layouts can be mapped
 * into these fields without becoming part of the request-facing model.
 */
export const PLATFORM_PERSISTENCE_MODEL = {
  collections: {
    projects: 'platform_projects',
    tenantTargets: 'platform_tenant_targets',
  },
  fields: {
    projects: {
      publicId: 'publicId',
      enabled: 'enabled',
    },
    tenantTargets: {
      projectId: 'projectId',
      target: 'target',
    },
  },
} as const satisfies PlatformPersistenceModel
