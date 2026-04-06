import { Module } from '@nestjs/common'
import { MessagingQueue } from '@nuvix/core/resolvers'
import { MessagingController } from './messaging.controller'
import { MessagingService } from './messaging.service'
import { ProvidersController } from './providers/providers.controller'
import { ProvidersService } from './providers/providers.service'
import { SubscribersController } from './topics/subscribers/subscribers.controller'
import { SubscribersService } from './topics/subscribers/subscribers.service'
import { TopicsController } from './topics/topics.controller'
import { TopicsService } from './topics/topics.service'

@Module({
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
export class MessagingModule {}
