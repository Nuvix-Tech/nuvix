import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { CoreService } from '@nuvix/core/core.service'
import { Authorization } from '@nuvix/db'
import { Observable } from 'rxjs'
import { Scope } from '../../decorators'
import { Exception } from '../../extend/exception'

@Injectable()
export class ConsoleInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly coreSerice: CoreService,
  ) {
    if (!this.coreSerice.isConsole()) {
      throw new Exception(
        'ConsoleInterceptor can only be used in a console application. Please ensure it is not applied in non-console contexts.',
      )
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    Authorization.setDefaultStatus(true)
    const request = context.switchToHttp().getRequest<NuvixRequest>()
    const { scopes = [], user } = request.context

    const scope = this.reflector.getAllAndOverride(Scope, [
      context.getHandler(),
      context.getClass(),
    ])

    if (scope) {
      const requiredScopes = Array.isArray(scope) ? scope : [scope]
      const missingScopes = requiredScopes.filter(
        s => !scopes.includes(s as string),
      )

      if (missingScopes.length > 0) {
        throw new Exception(
          Exception.GENERAL_UNAUTHORIZED_SCOPE,
          `${user.get('email', 'User')} (role: ${request.context.role ?? '#'}) missing scopes (${missingScopes.join(', ')})`,
        )
      }
    }

    if (user.get('status') === false) {
      // Account is blocked
      throw new Exception(Exception.USER_BLOCKED)
    }

    if (user.get('reset')) {
      throw new Exception(Exception.USER_PASSWORD_RESET_REQUIRED)
    }

    return next.handle()
  }
}
