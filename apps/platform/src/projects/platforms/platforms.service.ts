import { Injectable } from '@nestjs/common'
import { CoreService } from '@nuvix/core'
import { Exception } from '@nuvix/core/extend/exception'
import { Hostname } from '@nuvix/core/validators/network/hostname'
import { Database, Doc, ID, Permission, Query, Role } from '@nuvix/db'
import { Platforms } from '@nuvix/utils/types'
import { CreatePlatformDTO, UpdatePlatformDTO } from './DTO/platform.dto'

@Injectable()
export class PlatformsService {
  private readonly db: Database

  constructor(private coreService: CoreService) {
    this.db = this.coreService.getInternalDatabase()
  }

  /**
   * Get platforms of a project.
   */
  async getPlatforms(id: string) {
    const project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    const platforms = await this.db.find('platforms', [
      Query.equal('projectInternalId', [project.getSequence()]),
      Query.limit(5000),
    ])

    return {
      total: platforms.length,
      data: platforms,
    }
  }

  /**
   * Create a platform for a project.
   */
  async createPlatform(id: string, input: CreatePlatformDTO) {
    if (input.hostname) {
      const validator = new Hostname()
      if (!validator.$valid(input.hostname)) {
        throw new Exception(
          Exception.GENERAL_ARGUMENT_INVALID,
          validator.$description,
        )
      }
    }

    const project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    const platform = new Doc<Platforms>({
      $id: ID.unique(),
      $permissions: [
        Permission.read(Role.any()),
        Permission.update(Role.any()),
        Permission.delete(Role.any()),
      ],
      projectInternalId: project.getSequence(),
      projectId: project.getId(),
      type: input.type,
      name: input.name,
      key: input.key ?? null,
      store: input.store ?? null,
      hostname: input.hostname ?? null,
    })

    const createdPlatform = await this.db.createDocument('platforms', platform)

    await this.db.purgeCachedDocument('projects', project.getId())

    return createdPlatform
  }

  /**
   * Get a Platform.
   */
  async getPlatform(id: string, platformId: string) {
    const project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    const platform = await this.db.findOne('platforms', [
      Query.equal('$id', [platformId]),
      Query.equal('projectInternalId', [project.getSequence()]),
    ])

    if (platform.empty()) {
      throw new Exception(Exception.PLATFORM_NOT_FOUND)
    }

    return platform
  }

  /**
   * Update a Platform.
   */
  async updatePlatform(
    id: string,
    platformId: string,
    input: UpdatePlatformDTO,
  ) {
    const project = await this.db.getDocument('projects', id)
    if (input.hostname) {
      const validator = new Hostname()
      if (!validator.$valid(input.hostname)) {
        throw new Exception(
          Exception.GENERAL_ARGUMENT_INVALID,
          validator.$description,
        )
      }
    }

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    const platform = await this.db.findOne('platforms', [
      Query.equal('$id', [platformId]),
      Query.equal('projectInternalId', [project.getSequence()]),
    ])

    if (platform.empty()) {
      throw new Exception(Exception.PLATFORM_NOT_FOUND)
    }

    platform
      .update('name', input.name)
      .update('key', input.key)
      .update('store', input.store)
      .update('hostname', input.hostname)

    await this.db.updateDocument('platforms', platform.getId(), platform)
    await this.db.purgeCachedDocument('projects', project.getId())

    return platform
  }

  /**
   * Delete a Platform.
   */
  async deletePlatform(id: string, platformId: string) {
    const project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    const platform = await this.db.findOne('platforms', [
      Query.equal('$id', [platformId]),
      Query.equal('projectInternalId', [project.getSequence()]),
    ])

    if (platform.empty()) {
      throw new Exception(Exception.PLATFORM_NOT_FOUND)
    }

    await this.db.deleteDocument('platforms', platformId)
    await this.db.purgeCachedDocument('projects', project.getId())
  }
}
