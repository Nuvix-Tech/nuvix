import { Module } from '@nestjs/common'
import { AvatarsController } from './avatars.controller'
import { AvatarsService } from './avatars.service'

@Module({
  controllers: [AvatarsController],
  providers: [AvatarsService],
})
export class AvatarsModule {}
