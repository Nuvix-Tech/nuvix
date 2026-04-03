import { applyDecorators, UseGuards } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type ThrottleOptions } from '@nuvix/utils'
import { ThrottlerGuard } from '../resolvers/guards'

const _Throttle = Reflector.createDecorator<ThrottleOptions>({
  key: Throttle.name,
})

export function Throttle(limit: number): any
export function Throttle(options: ThrottleOptions): any
export function Throttle(options: ThrottleOptions | number): any {
  return applyDecorators(
    UseGuards(ThrottlerGuard),
    _Throttle(typeof options === 'number' ? { limit: options } : options),
  )
}
