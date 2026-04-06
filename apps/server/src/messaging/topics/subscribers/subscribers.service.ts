import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CoreService } from '@nuvix/core/core.service'
import { Exception } from '@nuvix/core/extend/exception'
import {
  Authorization,
  Database,
  Doc,
  DuplicateException,
  ID,
  Permission,
  Query,
  Role,
} from '@nuvix/db'
import { AppEvents, MessageType } from '@nuvix/utils'
import type { Subscribers, SubscribersDoc } from '@nuvix/utils/types'
import type { CreateSubscriber, ListSubscribers } from './subscribers.types'

@Injectable()
export class SubscribersService {
  protected readonly db: Database

  constructor(
    private readonly coreService: CoreService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.db = this.coreService.getDatabase()
  }

  /**
   * Create Subscriber
   */
  async createSubscriber({ input, topicId }: CreateSubscriber) {
    const { subscriberId: inputSubscriberId, targetId } = input
    const subscriberId =
      inputSubscriberId === 'unique()' ? ID.unique() : inputSubscriberId

    const topic = await Authorization.skip(() =>
      this.db.getDocument('topics', topicId),
    )

    if (topic.empty()) {
      throw new Exception(Exception.TOPIC_NOT_FOUND)
    }

    const validator = new Authorization('subscribe' as any)
    if (!validator.$valid(topic.get('subscribe'))) {
      throw new Exception(Exception.USER_UNAUTHORIZED, validator.$description)
    }

    const target = await Authorization.skip(() =>
      this.db.getDocument('targets', targetId),
    )

    if (target.empty()) {
      throw new Exception(Exception.USER_TARGET_NOT_FOUND)
    }

    const user = await Authorization.skip(() =>
      this.db.getDocument('users', target.get('userId')),
    )

    const subscriber = new Doc<Subscribers>({
      $id: subscriberId,
      $permissions: [
        Permission.read(Role.user(user.getId())),
        Permission.delete(Role.user(user.getId())),
      ],
      topicId,
      topicInternalId: topic.getSequence(),
      targetId,
      targetInternalId: target.getSequence(),
      userId: user.getId(),
      userInternalId: user.getSequence(),
      providerType: target.get('providerType'),
      search: [
        subscriberId,
        targetId,
        user.getId(),
        target.get('providerType'),
      ].join(' '),
    })

    try {
      const createdSubscriber = await this.db.createDocument(
        'subscribers',
        subscriber,
      )

      const totalAttribute = (() => {
        switch (target.get('providerType')) {
          case MessageType.EMAIL:
            return 'emailTotal'
          case MessageType.SMS:
            return 'smsTotal'
          case MessageType.PUSH:
            return 'pushTotal'
          default:
            throw new Exception(Exception.TARGET_PROVIDER_INVALID_TYPE)
        }
      })()

      await Authorization.skip(() =>
        this.db.increaseDocumentAttribute('topics', topicId, totalAttribute),
      )

      createdSubscriber.set('target', target).set('userName', user.get('name'))

      this.eventEmitter.emit(AppEvents.SUBSCRIBERS_CREATE, {
        topicId,
        subscriberId: createdSubscriber.getId(),
        payload: {
          data: createdSubscriber,
        },
      })

      return createdSubscriber
    } catch (error) {
      if (error instanceof DuplicateException) {
        throw new Exception(Exception.SUBSCRIBER_ALREADY_EXISTS)
      }
      throw error
    }
  }

  /**
   * Lists all subscribers for a topic.
   */
  async listSubscribers({ topicId, queries = [], search }: ListSubscribers) {
    if (search) {
      queries.push(Query.search('search', search))
    }

    const topic = await Authorization.skip(() =>
      this.db.getDocument('topics', topicId),
    )

    if (topic.empty()) {
      throw new Exception(Exception.TOPIC_NOT_FOUND)
    }

    const { filters } = Query.groupByType(queries)

    queries.push(Query.equal('topicInternalId', [topic.getSequence()]))
    const subscribers = await this.db.find('subscribers', queries)
    const total = await this.db.count('subscribers', filters)

    // Batch process subscribers to add target and userName
    const enrichedSubscribers = await Promise.all(
      subscribers.map(async subscriber => {
        const target = await Authorization.skip(() =>
          this.db.getDocument('targets', subscriber.get('targetId')),
        )
        const user = await Authorization.skip(() =>
          this.db.getDocument('users', target.get('userId')),
        )

        return subscriber
          .set('target', target)
          .set('userName', user.get('name'))
      }),
    )

    return {
      data: enrichedSubscribers as SubscribersDoc[],
      total,
    }
  }

  /**
   * Get Subscriber
   */
  async getSubscriber(topicId: string, subscriberId: string) {
    const topic = await Authorization.skip(() =>
      this.db.getDocument('topics', topicId),
    )

    if (topic.empty()) {
      throw new Exception(Exception.TOPIC_NOT_FOUND)
    }

    const subscriber = await this.db.getDocument('subscribers', subscriberId)

    if (subscriber.empty() || subscriber.get('topicId') !== topicId) {
      throw new Exception(Exception.SUBSCRIBER_NOT_FOUND)
    }

    const target = await Authorization.skip(() =>
      this.db.getDocument('targets', subscriber.get('targetId')),
    )
    const user = await Authorization.skip(() =>
      this.db.getDocument('users', target.get('userId')),
    )

    subscriber.set('target', target).set('userName', user.get('name'))

    return subscriber
  }

  /**
   * Deletes a subscriber.
   */
  async deleteSubscriber(topicId: string, subscriberId: string) {
    const topic = await Authorization.skip(() =>
      this.db.getDocument('topics', topicId),
    )

    if (topic.empty()) {
      throw new Exception(Exception.TOPIC_NOT_FOUND)
    }

    const subscriber = await this.db.getDocument('subscribers', subscriberId)

    if (subscriber.empty() || subscriber.get('topicId') !== topicId) {
      throw new Exception(Exception.SUBSCRIBER_NOT_FOUND)
    }

    const target = await this.db.getDocument(
      'targets',
      subscriber.get('targetId'),
    )

    await this.db.deleteDocument('subscribers', subscriberId)

    const totalAttribute = (() => {
      switch (target.get('providerType')) {
        case MessageType.EMAIL:
          return 'emailTotal'
        case MessageType.SMS:
          return 'smsTotal'
        case MessageType.PUSH:
          return 'pushTotal'
        default:
          throw new Exception(Exception.TARGET_PROVIDER_INVALID_TYPE)
      }
    })()

    await Authorization.skip(() =>
      this.db.decreaseDocumentAttribute('topics', topicId, totalAttribute, 1),
    )

    this.eventEmitter.emit(AppEvents.SUBSCRIBERS_DELETE, {
      topicId,
      subscriberId,
    })
  }
}
