import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Logger, Module } from '@nestjs/common'
import { CoreService } from '@nuvix/core'
import {
  MessagingJob,
  MessagingJobData,
  MessagingQueue,
} from '@nuvix/core/resolvers'
import { Events } from '@nuvix/db'
import { QueueFor, ScheduleResourceType } from '@nuvix/utils'
import { SchedulesDoc } from '@nuvix/utils/types'
import type { Queue } from 'bullmq'
import { MessagingController } from './messaging.controller'
import { MessagingService } from './messaging.service'
import { ProvidersController } from './providers/providers.controller'
import { ProvidersService } from './providers/providers.service'
import { SubscribersController } from './topics/subscribers/subscribers.controller'
import { SubscribersService } from './topics/subscribers/subscribers.service'
import { TopicsController } from './topics/topics.controller'
import { TopicsService } from './topics/topics.service'

@Module({
  imports: [
    BullModule.registerQueue({
      name: QueueFor.MESSAGING,
    }),
  ],
  controllers: [
    MessagingController,
    ProvidersController,
    TopicsController,
    SubscribersController,
  ],
  providers: [
    MessagingService,
    ProvidersService,
    TopicsService,
    SubscribersService,
    MessagingQueue,
  ],
})
export class MessagingModule {
  private readonly logger = new Logger(MessagingModule.name)

  constructor(
    coreService: CoreService,
    @InjectQueue(QueueFor.MESSAGING)
    private readonly queue: Queue<MessagingJobData, any, MessagingJob>,
  ) {
    const db = coreService.getInternalDatabase()

    db.on(Events.DocumentCreate, 'messaging_schedule', async doc => {
      try {
        if (doc.getCollection() !== 'schedules') return

        const schedule = doc as SchedulesDoc

        // Only process message schedules
        if (schedule.get('resourceType') !== ScheduleResourceType.MESSAGE) {
          return
        }

        // Ignore inactive schedules
        if (!schedule.get('active')) {
          return
        }

        const scheduleId = schedule.getId()
        const messageId = schedule.get('resourceId')
        const projectId = schedule.get('projectId')
        const scheduledAtRaw = schedule.get('schedule')

        const project = await db.getDocument('projects', projectId)

        if (!messageId || !projectId || !scheduledAtRaw || project.empty()) {
          this.logger.warn(`Invalid schedule document ${scheduleId}`)
          return
        }

        const scheduledAt = new Date(scheduledAtRaw)
        if (isNaN(scheduledAt.getTime())) {
          this.logger.warn(`Invalid schedule date for ${scheduleId}`)
          return
        }

        // Calculate delay
        const delay = Math.max(scheduledAt.getTime() - Date.now(), 0)

        const jobId = `schedule:${scheduleId}`

        // Prevent duplicate jobs
        const existing = await this.queue.getJob(jobId)
        if (existing) {
          this.logger.debug(`Schedule ${scheduleId} already queued`)
          return
        }

        // Enqueue delayed job
        await this.queue.add(
          MessagingJob.EXTERNAL,
          {
            scheduleId,
            message: messageId,
          },
          {
            delay,
            jobId,
            removeOnComplete: true,
            removeOnFail: false,
          },
        )

        this.logger.log(
          `Scheduled message ${messageId} (schedule ${scheduleId}) in ${delay}ms`,
        )
      } catch (err) {
        this.logger.error(
          'Failed to enqueue scheduled message',
          err instanceof Error ? err.stack : undefined,
        )
      }
    })
  }
}
