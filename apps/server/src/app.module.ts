import {
  MiddlewareConsumer,
  Module,
  NestModule,
  OnModuleInit,
} from '@nestjs/common'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { ScheduleModule } from '@nestjs/schedule'
import { CoreModule } from '@nuvix/core'
import { Key } from '@nuvix/core/helpers'
import {
  ApiHook,
  AuditHook,
  AuthHook,
  CorsHook,
  LogsHook,
  StatsHook,
} from '@nuvix/core/resolvers'
import { configuration } from '@nuvix/utils'
import { AccountModule } from './account/account.module'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { AvatarsModule } from './avatars/avatars.module'
import { DatabaseModule } from './database/database.module'
import { LocaleModule } from './locale/locale.module'
import { MessagingModule } from './messaging/messaging.module'
import { SchemasModule } from './schemas/schemas.module'
import { StorageModule } from './storage/storage.module'
import { TeamsModule } from './teams/teams.module'
import { UsersModule } from './users/users.module'
import { WebhooksModule } from './webhooks/webhooks.module'

@Module({
  imports: [
    CoreModule,
    ScheduleModule.forRoot(),
    JwtModule.register({
      secret: configuration.security.jwtSecret,
      global: true,
    }),
    UsersModule,
    TeamsModule,
    AccountModule,
    DatabaseModule,
    AvatarsModule,
    StorageModule,
    SchemasModule,
    MessagingModule,
    LocaleModule,
    WebhooksModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule, OnModuleInit {
  constructor(private readonly jwtService: JwtService) {}

  onModuleInit() {
    Key.setJwtService(this.jwtService)
  }

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorsHook)
      .forRoutes('*')
      .apply(AuthHook, ApiHook, AuditHook, StatsHook)
      .forRoutes('*')
      .apply(...(configuration.app.enableApiLogs ? [LogsHook] : []))
      .forRoutes('*')
  }
}
