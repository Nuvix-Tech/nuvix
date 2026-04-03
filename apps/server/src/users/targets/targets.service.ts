import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CoreService } from '@nuvix/core/core.service'
import { Exception } from '@nuvix/core/extend/exception'
import { ID } from '@nuvix/core/helpers'
import { DeletesJobData } from '@nuvix/core/resolvers'
import { EmailValidator, PhoneValidator } from '@nuvix/core/validators'
import {
  Database,
  Doc,
  DuplicateException,
  Permission,
  Query,
  Role,
} from '@nuvix/db'
import {
  AppEvents,
  configuration,
  DeleteType,
  MessageType,
  QueueFor,
  Schemas,
} from '@nuvix/utils'
import type { ProvidersDoc } from '@nuvix/utils/types'
import { Queue } from 'bullmq'
import { CreateTargetDTO, UpdateTargetDTO } from './DTO/target.dto'

@Injectable()
export class TargetsService {
  private readonly db: Database
  constructor(
    private readonly coreService: CoreService,
    private readonly event: EventEmitter2,
    @InjectQueue(QueueFor.DELETES)
    private readonly deletesQueue: Queue<DeletesJobData, unknown, DeleteType>,
  ) {
    this.db = this.coreService.getDatabase()
  }

  /**
   * Create a new target
   */
  async createTarget(
    userId: string,
    { targetId, providerId, ...input }: CreateTargetDTO,
  ) {
    targetId = targetId === 'unique()' ? ID.unique() : targetId

    let provider!: ProvidersDoc
    if (providerId) {
      provider = await this.db.withSchema(Schemas.Core, () =>
        this.db.getDocument('providers', providerId),
      )
    }

    switch (input.providerType as MessageType) {
      case MessageType.EMAIL:
        if (!new EmailValidator().$valid(input.identifier)) {
          throw new Exception(Exception.GENERAL_INVALID_EMAIL)
        }
        break
      case MessageType.PUSH:
        break
      case MessageType.SMS:
        if (!new PhoneValidator().$valid(input.identifier)) {
          throw new Exception(Exception.GENERAL_INVALID_PHONE)
        }
        break
      default:
        throw new Exception(Exception.PROVIDER_INCORRECT_TYPE)
    }

    const user = await this.db.getDocument('users', userId)

    if (user.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    const existingTarget = await this.db.getDocument('targets', targetId)

    if (!existingTarget.empty()) {
      throw new Exception(Exception.USER_TARGET_ALREADY_EXISTS)
    }

    try {
      const target = await this.db.createDocument(
        'targets',
        new Doc({
          $id: targetId,
          $permissions: [
            Permission.read(Role.user(user.getId())),
            Permission.update(Role.user(user.getId())),
            Permission.delete(Role.user(user.getId())),
          ],
          providerId: provider?.getId(),
          providerInternalId: provider?.getSequence(),
          providerType: input.providerType,
          userId: userId,
          userInternalId: user.getSequence(),
          identifier: input.identifier,
          name: input.name,
        }),
      )

      await this.db.purgeCachedDocument('users', user.getId())
      this.event.emit(AppEvents.USERS_TARGETS_CREATE, {
        userId: user.getId(),
        targetId: target.getId(),
        payload: {
          data: target,
        },
      })

      return target
    } catch (error) {
      if (error instanceof DuplicateException) {
        throw new Exception(Exception.USER_TARGET_ALREADY_EXISTS)
      }
      throw error
    }
  }

  /**
   * Get all targets for a user
   */
  async getTargets(userId: string, queries: Query[] = []) {
    const user = await this.db.getDocument('users', userId)

    if (user.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }
    queries.push(Query.equal('userId', [userId]))

    return {
      data: await this.db.find('targets', queries),
      total: await this.db.count(
        'targets',
        queries,
        configuration.limits.limitCount,
      ),
    }
  }

  /**
   * Update a target
   */
  async updateTarget(userId: string, targetId: string, input: UpdateTargetDTO) {
    const user = await this.db.getDocument('users', userId)

    if (user.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    const target = await this.db.getDocument('targets', targetId)

    if (target.empty()) {
      throw new Exception(Exception.USER_TARGET_NOT_FOUND)
    }

    if (user.getId() !== target.get('userId')) {
      throw new Exception(Exception.USER_TARGET_NOT_FOUND)
    }

    if (input.identifier) {
      const providerType = target.get('providerType')

      switch (providerType as MessageType) {
        case MessageType.EMAIL:
          if (!new EmailValidator().$valid(input.identifier)) {
            throw new Exception(Exception.GENERAL_INVALID_EMAIL)
          }
          break
        case MessageType.PUSH:
          break
        case MessageType.SMS:
          if (!new PhoneValidator().$valid(input.identifier)) {
            throw new Exception(Exception.GENERAL_INVALID_PHONE)
          }
          break
        default:
          throw new Exception(Exception.PROVIDER_INCORRECT_TYPE)
      }

      target.set('identifier', input.identifier)
    }

    if (input.providerId) {
      const provider = await this.db.getDocument('providers', input.providerId)

      if (provider.empty()) {
        throw new Exception(Exception.PROVIDER_NOT_FOUND)
      }

      if (provider.get('type') !== target.get('providerType')) {
        throw new Exception(Exception.PROVIDER_INCORRECT_TYPE)
      }

      target.set('providerId', provider.getId())
      target.set('providerInternalId', provider.getSequence())
    }

    if (input.name) {
      target.set('name', input.name)
    }

    const updatedTarget = await this.db.updateDocument(
      'targets',
      target.getId(),
      target,
    )
    await this.db.purgeCachedDocument('users', user.getId())

    this.event.emit(AppEvents.USERS_TARGETS_UPDATE, {
      userId,
      targetId,
      payload: {
        data: updatedTarget,
      },
    })

    return updatedTarget
  }

  /**
   * Get A target
   */
  async getTarget(userId: string, targetId: string) {
    const user = await this.db.getDocument('users', userId)

    if (user.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    const target = await this.db.getDocument('targets', targetId)

    if (target.empty() || target.get('userId') !== userId) {
      throw new Exception(Exception.USER_TARGET_NOT_FOUND)
    }

    return target
  }

  /**
   * Delete a target
   */
  async deleteTarget(userId: string, targetId: string) {
    const user = await this.db.getDocument('users', userId)

    if (user.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    const target = await this.db.getDocument('targets', targetId)

    if (target.empty()) {
      throw new Exception(Exception.USER_TARGET_NOT_FOUND)
    }

    if (user.getId() !== target.get('userId')) {
      throw new Exception(Exception.USER_TARGET_NOT_FOUND)
    }

    await this.db.deleteDocument('targets', target.getId())
    await this.db.purgeCachedDocument('users', user.getId())

    await this.deletesQueue.add(DeleteType.TARGET, {
      document: target.clone(),
    })

    this.event.emit(AppEvents.USERS_TARGETS_DELETE, {
      userId,
      targetId,
    })
  }
}
