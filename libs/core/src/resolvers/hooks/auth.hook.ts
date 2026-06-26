import { Injectable, Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Authorization, Database, Doc } from '@nuvix/db'
import { AppMode, configuration } from '@nuvix/utils'
import { SessionsDoc, UsersDoc } from '@nuvix/utils/types'
import { CoreService } from '../../core.service.js'
import { AuthType } from '../../decorators'
import { Exception } from '../../extend/exception'
import { Auth } from '../../helpers/auth.helper'
import { Key } from '../../helpers/key.helper'
import ParamsHelper from '../../helpers/params.helper'
import { Hook } from '../../server/hooks/interface'

@Injectable()
export class AuthHook implements Hook {
  private readonly logger = new Logger(AuthHook.name)
  private readonly internalDb: Database
  private readonly db: Database

  constructor(
    readonly coreService: CoreService,
    private readonly jwtService: JwtService,
  ) {
    this.internalDb = coreService.getInternalDatabase()
    this.db = coreService.getDatabase()
  }

  async onRequest(req: NuvixRequest, reply: NuvixRes): Promise<void> {
    const params = new ParamsHelper(req)
    const mode = req.context.mode || AppMode.DEFAULT

    Authorization.setDefaultStatus(true)
    const isConsole = this.coreService.isConsole()
    const cookieName =
      isConsole || mode === AppMode.ADMIN ? 'nc_session' : Auth.cookieName

    let session: { id?: string; secret?: string } = {}
    const cookie = req.cookies[cookieName]
    if (cookie) {
      session = Auth.decodeSession(cookie)
    }

    if (!session.id && !session.secret && !isConsole) {
      const sessionHeader = params.getFromHeaders('x-nuvix-session')
      if (sessionHeader) {
        try {
          session = Auth.decodeSession(sessionHeader)
        } catch (error: any) {
          this.logger.debug(
            'Failed to decode session from header',
            error?.message,
          )
        }
      }
    }

    if (
      !session.id &&
      !session.secret &&
      configuration.server.fallbackCookies
    ) {
      reply.header('X-Debug-Fallback', 'true')
      try {
        const fallbackHeader = params.getFromHeaders('x-fallback-cookies', '')
        if (fallbackHeader) {
          const fallback = JSON.parse(fallbackHeader)
          session = Auth.decodeSession(fallback[cookieName] || '')
        }
      } catch (error: any) {
        this.logger.debug('Failed to parse fallback cookies', error?.message)
      }
    } else {
      reply.header('X-Debug-Fallback', 'false')
    }

    req.context.authMeta.id = session.id
    req.context.authMeta.secret = session.secret

    let user: UsersDoc = new Doc()
    if (req.context.authMeta.id) {
      if (mode !== AppMode.ADMIN) {
        if (isConsole) {
          user = await this.internalDb.getDocument(
            'users',
            req.context.authMeta.id,
          )
        } else {
          user = await this.db.getDocument('users', req.context.authMeta.id)
        }
      } else {
        user = await this.internalDb.getDocument(
          'users',
          req.context.authMeta.id,
        )
      }
    }

    const sessionId = Auth.sessionVerify(
      user.get('sessions', []),
      req.context.authMeta.secret,
    )

    if (user.empty() || !sessionId) {
      user = new Doc()
    } else {
      req.context.authType = AuthType.SESSION
    }

    const authJWT = params.getFromHeaders('x-nuvix-jwt')

    if (authJWT && !isConsole) {
      if (req.context.authType === AuthType.SESSION) {
        throw new Exception(Exception.USER_JWT_AND_SESSION_SET)
      }

      let payload: { userId?: string; sessionId?: string } = {}
      try {
        payload = await this.jwtService.verifyAsync(authJWT)
      } catch (e: any) {
        this.logger.debug('Failed to verify JWT', e?.message)
        throw new Exception(Exception.USER_JWT_INVALID)
      }

      const jwtUserId = payload?.userId
      if (jwtUserId) {
        user = await this.db.getDocument('users', jwtUserId)
      }

      const jwtSessionId = payload?.sessionId
      if (
        jwtSessionId &&
        !user.findWhere(
          'sessions',
          (s: SessionsDoc) => s.getId() === jwtSessionId,
        )
      ) {
        user = new Doc()
      } else {
        req.context.authType = AuthType.JWT
      }
    }

    const currentSession = sessionId
      ? (user
          .get('sessions', [] as SessionsDoc[])
          .find(s => s.getId() === sessionId) ?? (new Doc() as SessionsDoc))
      : (new Doc() as SessionsDoc)

    if (!isConsole) {
      const apiKey =
        params.getFromHeaders('x-nuvix-key') || params.getFromQuery('apikey')
      req.context.apiKey = apiKey
        ? await Key.decode(req.context.project, apiKey)
        : undefined
    }

    req.context.user = user
    req.context.session = currentSession
  }
}
