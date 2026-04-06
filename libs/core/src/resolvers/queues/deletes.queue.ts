import { OnWorkerEvent, Processor } from '@nestjs/bullmq'
import { forwardRef, Inject, Logger } from '@nestjs/common'
import { Audit } from '@nuvix/audit'
import { Authorization, Database, Doc, IEntity, Query } from '@nuvix/db'
import { DeleteDocumentType, DeleteType, QueueFor } from '@nuvix/utils'
import type {
  Memberships,
  ProjectsDoc,
  Schedules,
  TeamsDoc,
  TopicsDoc,
  UsersDoc,
} from '@nuvix/utils/types'
import { Job } from 'bullmq'
import { CoreService } from '../../core.service'
import { Auth } from '../../helpers'
import {
  deleteIdentities,
  deleteSubscribers,
  deleteTargets,
} from '../../helpers/misc.helper'
import { Queue } from './queue'

@Processor(QueueFor.DELETES, { concurrency: 1000 })
export class DeletesQueue extends Queue {
  private readonly internalDb: Database
  private readonly db: Database
  private readonly logger = new Logger(DeletesQueue.name)

  constructor(
    @Inject(forwardRef(() => CoreService))
    private readonly coreService: CoreService,
  ) {
    super()
    this.internalDb = this.coreService.getInternalDatabase()
    this.db = this.coreService.getDatabase()
  }

  override async process(
    job: Job<DeletesJobData, unknown, DeleteType>,
  ): Promise<any> {
    const document = new Doc(job.data.document) as Doc<any>
    const { datetime, hourlyUsageRetentionDatetime, resource, resourceType } =
      job.data

    switch (job.name) {
      case DeleteType.DOCUMENT:
        switch (document.getCollection() as DeleteDocumentType) {
          case DeleteDocumentType.USERS:
            await this.deleteUser(document as UsersDoc)
            break
          case DeleteDocumentType.BUCKETS:
            await this.deleteBucket(document)
            break
          default:
            this.logger.error(
              'No lazy delete operation available for document of type: ' +
                document.getCollection(),
            )
            break
        }
        break
      case DeleteType.AUDIT:
        await this.deleteAuditLogs(datetime!)
        break
      case DeleteType.SESSIONS:
        await this.deleteExpiredSessions(
          new Doc(job.data.project!) as unknown as ProjectsDoc,
        )
        break
      case DeleteType.USAGE:
        await this.deleteUsageStats(hourlyUsageRetentionDatetime!)
        break
      case DeleteType.SCHEDULES:
        await this.deleteSchedules(datetime!)
        break
      case DeleteType.TOPIC:
        await this.deleteTopic(document as TopicsDoc)
        break
      case DeleteType.TARGET:
        await deleteSubscribers(this.db, document)
        break
      case DeleteType.EXPIRED_TARGETS:
        await this.deleteExpiredTargets()
        break
      case DeleteType.SESSION_TARGETS:
        await this.deleteSessionTargets(document)
        break
      default:
        throw new Error(`No delete operation for type: ${job.name}`)
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`)
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: any) {
    this.logger.error(
      `Job ${job.id} of type ${job.name} failed with error: ${err.message}`,
    )
  }

  /**
   * Delete schedules which are inactive and their resource is deleted or updated before given datetime
   */
  private async deleteSchedules(datetime: string): Promise<void> {
    await this.listByGroup<Schedules>(
      'schedules',
      [
        Query.lessThanEqual('resourceUpdatedAt', datetime),
        Query.equal('active', [false]),
      ],
      this.internalDb,
      async document => {
        await this.internalDb.deleteDocument('schedules', document.getId())
        this.logger.log(
          'Deleting schedule for ' +
            document.get('resourceType') +
            ' ' +
            document.get('resourceId'),
        )
      },
    )
  }

  /**
   * Delete topic and its subscribers
   */
  private async deleteTopic(topic: TopicsDoc): Promise<void> {
    if (topic.empty()) {
      this.logger.error('Failed to delete subscribers. Topic not found')
      return
    }

    await this.deleteByGroup(
      'subscribers',
      [Query.equal('topicInternalId', [topic.getSequence()]), Query.orderAsc()],
      this.db,
    ).catch((e: any) => {
      this.logger.error(`Failed to delete subscribers: ${e.message}`)
    })
  }

  /**
   * Delete expired targets
   */
  private async deleteExpiredTargets(): Promise<void> {
    await deleteTargets(this.db, Query.equal('expired', [true]))
  }

  /**
   * Delete session targets
   */
  private async deleteSessionTargets(session: Doc): Promise<void> {
    await deleteTargets(
      this.db,
      Query.equal('sessionInternalId', [session.getSequence()]),
    )
  }

  /**
   * Delete usage stats from project database
   */
  private async deleteUsageStats(
    hourlyUsageRetentionDatetime: string,
  ): Promise<void> {
    await this.deleteByGroup(
      'stats',
      [
        Query.equal('period', ['1h']),
        Query.lessThan('time', hourlyUsageRetentionDatetime),
        Query.orderDesc('time'),
        Query.orderDesc(),
      ],
      this.db,
    )
  }

  /**
   * Delete memberships for a team
   */
  public async deleteMemberships(team: TeamsDoc): Promise<void> {
    const teamInternalId = team.getSequence()

    return this.deleteByGroup<Memberships>(
      'memberships',
      [Query.equal('teamInternalId', [teamInternalId]), Query.orderAsc()],
      this.db,
      async membership => {
        const userId = membership.get('userId')
        await this.db.purgeCachedDocument('users', userId)
      },
    )
  }

  /**
   * Delete user and associated data
   */
  private async deleteUser(user: UsersDoc): Promise<void> {
    const userId = user.getId()
    const userInternalId = user.getSequence()

    // Delete all sessions of this user from the sessions table
    await this.deleteByGroup(
      'sessions',
      [Query.equal('userInternalId', [userInternalId]), Query.orderAsc()],
      this.db,
    )

    await this.db.purgeCachedDocument('users', userId)

    // Delete Memberships and decrement team membership counts
    await this.deleteByGroup<Memberships>(
      'memberships',
      [Query.equal('userInternalId', [userInternalId]), Query.orderAsc()],
      this.db,
      async membership => {
        if (membership.get('confirm')) {
          // Count only confirmed members
          const teamId = membership.get('teamId')
          const team = await this.db.getDocument('teams', teamId)
          if (!team.empty()) {
            await this.db.decreaseDocumentAttribute(
              'teams',
              teamId,
              'total',
              1,
              0,
            )
          }
        }
      },
    )

    // Delete tokens
    await this.deleteByGroup(
      'tokens',
      [Query.equal('userInternalId', [userInternalId]), Query.orderAsc()],
      this.db,
    )

    // Delete identities
    await deleteIdentities(
      this.db,
      Query.equal('userInternalId', [userInternalId]),
    )

    // Delete targets
    await deleteTargets(
      this.db,
      Query.equal('userInternalId', [userInternalId]),
    )
  }

  /**
   * Delete bucket and its files
   */
  private async deleteBucket(bucket: Doc): Promise<void> {
    if (bucket.empty()) {
      this.logger.error('Failed to delete bucket. Bucket not found')
      return
    }

    await Authorization.skip(() =>
      this.db.deleteCollection(`bucket_${bucket.getSequence()}`),
    )

    const device = this.coreService.getStorageDevice()
    await device.deletePath(bucket.getId())
  }

  /**
   * Delete expired sessions based on project auth duration
   */
  private async deleteExpiredSessions(project: ProjectsDoc): Promise<void> {
    const duration =
      project.get('auths')?.duration ?? Auth.TOKEN_EXPIRATION_LOGIN_LONG
    const expired = new Date(Date.now() - duration * 1000).toISOString()

    await this.deleteByGroup(
      'sessions',
      [
        Query.lessThan('$createdAt', expired),
        Query.orderDesc('$createdAt'),
        Query.orderDesc(),
      ],
      this.db,
    )
  }

  /**
   * Delete audit logs older than the retention period
   */
  private async deleteAuditLogs(auditRetention: string): Promise<void> {
    await this.deleteByGroup(
      Audit.COLLECTION,
      [
        Query.lessThan('time', auditRetention),
        Query.orderDesc('time'),
        Query.orderAsc(),
      ],
      this.db,
    ).catch((e: any) => {
      this.logger.error(`Failed to delete audit logs: ${e.message}`)
    })
  }

  protected async deleteByGroup<T extends IEntity>(
    collection: string,
    queries: Query[],
    database: Database,
    callback?: (doc: Doc<T>) => void | Promise<void>,
  ): Promise<void> {
    const start = Date.now()
    const batch_limit = 1000

    try {
      const count = await Authorization.skip(() =>
        database.deleteDocumentsBatch(
          collection,
          queries,
          batch_limit,
          callback,
        ),
      )

      const end = Date.now()
      this.logger.log(
        `Deleted ${count} documents by group in ${(end - start) / 1000} seconds`,
      )
    } catch (error: any) {
      this.logger.error(
        `Failed to delete documents for collection:${database.namespace}_${collection} :${error.message}`,
      )
    }
  }

  protected async listByGroup<T extends IEntity>(
    collection: string,
    queries: Query[],
    database: Database,
    callback?: (doc: Doc<T>) => void | Promise<void>,
  ): Promise<void> {
    let count = 0
    const limit = 1000
    let sum = limit
    let cursor: Doc<T> | null = null

    const start = Date.now()

    while (sum === limit) {
      const paginatedQueries = [...queries, Query.limit(limit)]

      if (cursor !== null) {
        paginatedQueries.push(Query.cursorAfter(cursor))
      }

      const results = await Authorization.skip(() =>
        database.find<T>(collection, paginatedQueries),
      )

      sum = results.length

      if (sum > 0) {
        cursor = results[sum - 1] as Doc<T>
      }

      for (const document of results) {
        if (callback) {
          await callback(document)
        }
        count++
      }
    }

    const end = Date.now()

    this.logger.log(
      `Listed ${count} documents by group in ${(end - start) / 1000} seconds`,
    )
  }
}

export type DeletesJobData = {
  datetime?: string
  document?: Doc<any>
  hourlyUsageRetentionDatetime?: string
  resource?: string
  resourceType?: string
  project?: ProjectsDoc
}
