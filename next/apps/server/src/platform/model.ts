import { PLATFORM_PERSISTENCE_MODEL } from '../infrastructure/platform-persistence-model'

export interface PlatformModel {
  readonly collections: {
    readonly projects: string
    readonly tenantTargets: string
  }
  readonly fields: {
    readonly projects: {
      readonly publicId: string
      readonly name: string
      readonly description: string
      readonly enabled: string
      readonly authSettings: string
    }
    readonly tenantTargets: {
      readonly projectId: string
      readonly target: string
    }
  }
}

export const PLATFORM_MODEL: PlatformModel = Object.freeze({
  collections: {
    projects: PLATFORM_PERSISTENCE_MODEL.collections.projects,
    tenantTargets: PLATFORM_PERSISTENCE_MODEL.collections.tenantTargets,
  },
  fields: {
    projects: {
      publicId: PLATFORM_PERSISTENCE_MODEL.fields.projects.publicId,
      name: 'name',
      description: 'description',
      enabled: PLATFORM_PERSISTENCE_MODEL.fields.projects.enabled,
      authSettings: 'authSettings',
    },
    tenantTargets: {
      projectId: PLATFORM_PERSISTENCE_MODEL.fields.tenantTargets.projectId,
      target: PLATFORM_PERSISTENCE_MODEL.fields.tenantTargets.target,
    },
  },
})
