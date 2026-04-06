import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { QueueFor } from '@nuvix/utils'
import { CoreService } from './core.service'
import {
  ApiLogsQueue,
  AuditsQueue,
  DeletesQueue,
  MailsQueue,
  MessagingQueue,
  StatsQueue,
} from './resolvers/queues'

@Module({
  imports: [
    BullModule.registerQueueAsync(
      { name: QueueFor.AUDITS },
      { name: QueueFor.MAILS },
      ...(!CoreService.isConsole()
        ? [
            { name: QueueFor.STATS },
            { name: QueueFor.LOGS },
            { name: QueueFor.DELETES },
            { name: QueueFor.MESSAGING },
          ]
        : []),
    ),
  ],
  providers: [
    AuditsQueue,
    MailsQueue,
    ...(!CoreService.isConsole()
      ? [StatsQueue, ApiLogsQueue, DeletesQueue, MessagingQueue]
      : []),
  ],
  exports: [BullModule],
})
export class QueueModule {}
