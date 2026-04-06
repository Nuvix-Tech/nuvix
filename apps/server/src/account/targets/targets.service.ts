import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { CoreService } from '@nuvix/core/core.service'
import { Exception } from '@nuvix/core/extend/exception'
import { RequestContext } from '@nuvix/core/helpers'
import type { DeletesJobData } from '@nuvix/core/resolvers'
import {
  Authorization,
  Database,
  Doc,
  DuplicateException,
  ID,
  Permission,
  Role,
} from '@nuvix/db'
import { DeleteType, MessageType, QueueFor } from '@nuvix/utils'
import type { ProvidersDoc, Targets, UsersDoc } from '@nuvix/utils/types'
import { Queue } from 'bullmq'
import { CreatePushTargetDTO, UpdatePushTargetDTO } from './DTO/target.dto'

@Injectable()
export class TargetsService {
  private readonly db: Database
  constructor(
    private readonly coreService: CoreService,
    @InjectQueue(QueueFor.DELETES)
    private readonly deletesQueue: Queue<DeletesJobData, unknown, DeleteType>,
  ) {
    this.db = this.coreService.getDatabase()
  }

  /**
   * Create Push Target
   */
  async createPushTarget({
    user,
    targetId,
    userAgent,
    providerId,
    identifier,
    ctx,
  }: WithUser<
    CreatePushTargetDTO & { userAgent: string; ctx: RequestContext }
  >) {
    const finalTargetId = targetId === 'unique()' ? ID.unique() : targetId

    let provider: ProvidersDoc | null = null
    if (providerId) {
      provider = await Authorization.skip(() =>
        this.db.getDocument('providers', providerId!),
      )
    }

    const target = await Authorization.skip(() =>
      this.db.getDocument('targets', finalTargetId),
    )

    if (!target.empty()) {
      throw new Exception(Exception.USER_TARGET_ALREADY_EXISTS)
    }

    const detector = ctx.detector(userAgent)
    const device = detector.getDevice()

    const sessionId = ctx.session!.getId()
    const session = await this.db.getDocument('sessions', sessionId.toString())

    try {
      const createdTarget = await this.db.createDocument(
        'targets',
        new Doc<Targets>({
          $id: finalTargetId,
          $permissions: [
            Permission.read(Role.user(user.getId())),
            Permission.update(Role.user(user.getId())),
            Permission.delete(Role.user(user.getId())),
          ],
          providerId: provider ? provider.getId() : null,
          providerInternalId: provider ? provider.getSequence() : null,
          providerType: MessageType.PUSH,
          userId: user.getId(),
          userInternalId: user.getSequence(),
          sessionId: session.getId(),
          sessionInternalId: session.getSequence(),
          identifier: identifier,
          name: `${device.deviceBrand} ${device.deviceModel}`,
        }),
      )

      await this.db.purgeCachedDocument('users', user.getId())

      return createdTarget
    } catch (error) {
      if (error instanceof DuplicateException) {
        throw new Exception(Exception.USER_TARGET_ALREADY_EXISTS)
      }
      throw error
    }
  }

  /**
   * Update Push Target
   */
  async updatePushTarget({
    user,
    request,
    targetId,
    identifier,
  }: WithUser<
    UpdatePushTargetDTO & { request: NuvixRequest; targetId: string }
  >) {
    const target = await Authorization.skip(
      async () => await this.db.getDocument('targets', targetId),
    )

    if (target.empty()) {
      throw new Exception(Exception.USER_TARGET_NOT_FOUND)
    }

    if (user.getId() !== target.get('userId')) {
      throw new Exception(Exception.USER_TARGET_NOT_FOUND)
    }

    if (identifier) {
      target.set('identifier', identifier).set('expired', false)
    }

    const detector = request.context.detector(request.headers['user-agent'])
    const device = detector.getDevice()

    target.set('name', `${device.deviceBrand} ${device.deviceModel}`)

    const updatedTarget = await this.db.updateDocument(
      'targets',
      target.getId(),
      target,
    )

    await this.db.purgeCachedDocument('users', user.getId())

    return updatedTarget
  }

  /**
   * Delete Push Target
   */
  async deletePushTarget({ user, targetId }: WithUser<{ targetId: string }>) {
    const target = await Authorization.skip(
      async () => await this.db.getDocument('targets', targetId),
    )

    if (target.empty()) {
      throw new Exception(Exception.USER_TARGET_NOT_FOUND)
    }

    if (user.getSequence() !== target.get('userInternalId')) {
      throw new Exception(Exception.USER_TARGET_NOT_FOUND)
    }

    await this.db.deleteDocument('targets', target.getId())

    await this.db.purgeCachedDocument('users', user.getId())

    await this.deletesQueue.add(DeleteType.TARGET, {
      document: target.clone(),
    })
  }
}

type WithUser<T = unknown> = { user: UsersDoc } & T
