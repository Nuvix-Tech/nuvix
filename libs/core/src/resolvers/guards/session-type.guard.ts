import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { authMethods } from '@nuvix/core/config'
import { AllowedSessionType } from '@nuvix/core/decorators'
import { SessionType } from '@nuvix/utils'
import { Exception } from '../../extend/exception'

@Injectable()
export class SessionTypeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: NuvixRequest = context.switchToHttp().getRequest()
    const ctx = request.context
    const sessionType = this.reflector.getAllAndOverride<SessionType>(
      AllowedSessionType,
      [context.getHandler(), context.getClass()],
    )

    if (!sessionType) {
      return true
    }

    const project = ctx.project
    if (project.empty()) {
      return false
    }
    if (ctx.isPrivilegedUser()) {
      return true
    }

    const auths = project.get('auths', {} as Record<string, boolean>)
    switch (sessionType) {
      case SessionType.EMAIL_PASSWORD:
        if (!this.isEnabled(auths, sessionType)) {
          throw new Exception(
            Exception.USER_AUTH_METHOD_UNSUPPORTED,
            'Email/Password authentication is not enabled for this project',
          )
        }
        break
      case SessionType.MAGIC_URL:
        if (!this.isEnabled(auths, sessionType)) {
          throw new Exception(
            Exception.USER_AUTH_METHOD_UNSUPPORTED,
            'Magic URL authentication is not enabled for this project',
          )
        }
        break
      case SessionType.EMAIL_OTP:
        if (!this.isEnabled(auths, sessionType)) {
          throw new Exception(
            Exception.USER_AUTH_METHOD_UNSUPPORTED,
            'Email OTP authentication is not enabled for this project',
          )
        }
        break
      case SessionType.ANONYMOUS:
        if (!this.isEnabled(auths, sessionType)) {
          throw new Exception(
            Exception.USER_AUTH_METHOD_UNSUPPORTED,
            'Anonymous authentication is not enabled for this project',
          )
        }
        break
      case SessionType.INVITES:
        if (!this.isEnabled(auths, sessionType)) {
          throw new Exception(
            Exception.USER_AUTH_METHOD_UNSUPPORTED,
            'Invites authentication is not enabled for this project',
          )
        }
        break
      case SessionType.JWT:
        if (!this.isEnabled(auths, sessionType)) {
          throw new Exception(
            Exception.USER_AUTH_METHOD_UNSUPPORTED,
            'JWT authentication is not enabled for this project',
          )
        }
        break
      case SessionType.PHONE:
        if (!this.isEnabled(auths, sessionType)) {
          throw new Exception(
            Exception.USER_AUTH_METHOD_UNSUPPORTED,
            'Phone authentication is not enabled for this project',
          )
        }
        break
      default:
        throw new Exception(
          Exception.USER_AUTH_METHOD_UNSUPPORTED,
          'Unsupported authentication method',
        )
    }

    return true
  }

  private isEnabled(
    auths: Record<string, boolean>,
    sessionType: SessionType,
  ): boolean {
    const key = authMethods[sessionType]?.key
    if (!key) return false

    return (auths[key] ?? false) === true
  }
}
