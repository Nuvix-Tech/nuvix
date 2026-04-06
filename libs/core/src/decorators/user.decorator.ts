import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { Doc } from '@nuvix/db'
import { UsersDoc } from '@nuvix/utils/types'
import { CoreService } from '../core.service'

export const User = createParamDecorator<any, UsersDoc | null>(
  (_data: unknown, ctx: ExecutionContext): UsersDoc => {
    const request: NuvixRequest = ctx.switchToHttp().getRequest()
    const { context } = request

    if (CoreService.isConsole()) {
      return context.user
    }

    if (!context.isAdminUser) {
      return context.user
    }

    return new Doc()
  },
)
