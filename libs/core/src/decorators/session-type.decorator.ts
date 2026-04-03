import { applyDecorators, UseGuards } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SessionType } from '@nuvix/utils'
import { SessionTypeGuard } from '../resolvers/guards'

export const AllowedSessionType = Reflector.createDecorator<SessionType>()
export function AllowSessionType(type: SessionType): any {
  return applyDecorators(UseGuards(SessionTypeGuard), AllowedSessionType(type))
}
