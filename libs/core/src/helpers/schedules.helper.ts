import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import { Database, Events } from '@nuvix/db'
import { QueueFor, ScheduleResourceType } from '@nuvix/utils'
import type { Queue } from 'bullmq'
import type { SchedulesDoc } from '@nuvix/utils/types'
import {
  type MessagingJobData,
  MessagingJob,
} from '../resolvers/queues/messaging.queue'

@Injectable()
export class SchedulesHelper {
  private readonly logger = new Logger(SchedulesHelper.name)

  constructor(
    @InjectQueue(QueueFor.MESSAGING)
    private readonly queue: Queue<MessagingJobData, any, MessagingJob>,
  ) {}

  connect(db: Database) {
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
        // const projectId = schedule.get('projectId')
        const scheduledAtRaw = schedule.get('schedule')

        // const project = await db.getDocument('projects', projectId)

        if (!messageId || !scheduledAtRaw) {
          // !projectId || project.empty()
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

        const jobId = `[schedule]${scheduleId}`

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
