import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CoreService } from '@nuvix/core'
import { Exception } from '@nuvix/core/extend/exception'
import type { LocaleTranslator, RequestContext } from '@nuvix/core/helpers'
import { Auth, Detector, ID } from '@nuvix/core/helpers'
import { Database, Doc, Permission, Role } from '@nuvix/db'
import { AppEvents, SessionProvider } from '@nuvix/utils'
import type { Sessions, SessionsDoc } from '@nuvix/utils/types'
import { CountryResponse, Reader } from 'maxmind'

@Injectable()
export class SessionsService {
  private readonly geoDb: Reader<CountryResponse>
  private readonly db: Database

  constructor(
    private readonly coreService: CoreService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.geoDb = this.coreService.getGeoDb()
    this.db = this.coreService.getDatabase()
  }

  /**
   * Get all sessions
   */
  async getSessions(userId: string, locale: LocaleTranslator) {
    const user = await this.db.getDocument('users', userId)

    if (user.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    const sessions = user.get('sessions', []) as SessionsDoc[]

    for (const session of sessions) {
      const key = `countries.${session.get('countryCode')}`
      const countryName = locale.has(key)
        ? locale.getRaw(key)
        : locale.t('locale.country.unknown')

      session.set('countryName', countryName)
      session.set('current', false)
    }

    return {
      data: sessions,
      total: sessions.length,
    }
  }

  /**
   * Create User Session
   */
  async createSession(
    userId: string,
    userAgent: string,
    ip: string,
    ctx: RequestContext,
  ) {
    const user = await this.db.getDocument('users', userId)

    if (user.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    const secret = Auth.tokenGenerator(Auth.TOKEN_LENGTH_SESSION)
    const detector = new Detector(userAgent)
    const record = this.geoDb.get(ip)
    const project = ctx.project
    const locale = ctx.translator()

    const duration =
      project.get('auths', {}).duration ?? Auth.TOKEN_EXPIRATION_LOGIN_LONG
    const expire = new Date(Date.now() + duration * 1000)

    const session = new Doc<Sessions>({
      $id: ID.unique(),
      $permissions: [
        Permission.read(Role.user(userId)),
        Permission.update(Role.user(userId)),
        Permission.delete(Role.user(userId)),
      ],
      userId: user.getId(),
      userInternalId: user.getSequence(),
      provider: SessionProvider.SERVER,
      secret: Auth.hash(secret),
      userAgent: userAgent,
      ip: ip,
      countryCode: record?.country?.iso_code.toLowerCase(),
      expire: expire,
      ...detector.getOS(),
      ...detector.getClient(),
      ...detector.getDevice(),
    })

    const key = `countries.${session.get('countryCode')}`
    const countryName = locale.has(key)
      ? locale.getRaw(key)
      : locale.t('locale.country.unknown')

    const createdSession = await this.db.createDocument('sessions', session)

    createdSession.set('secret', secret).set('countryName', countryName)

    return createdSession
  }

  /**
   * Delete User Session
   */
  async deleteSession(userId: string, sessionId: string) {
    const user = await this.db.getDocument('users', userId)

    if (user.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    const session = await this.db.getDocument('sessions', sessionId)

    if (session.empty()) {
      throw new Exception(Exception.USER_SESSION_NOT_FOUND)
    }

    await this.db.deleteDocument('sessions', session.getId())
    await this.db.purgeCachedDocument('users', user.getId())

    this.eventEmitter.emit(AppEvents.USERS_SESSIONS_DELETE, {
      userId,
      sessionId,
    })
  }

  /**
   * Delete User Sessions
   */
  async deleteSessions(userId: string) {
    const user = await this.db.getDocument('users', userId)

    if (user.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    const sessions = user.get('sessions', []) as SessionsDoc[]

    for (const session of sessions) {
      await this.db.deleteDocument('sessions', session.getId())
    }

    await this.db.purgeCachedDocument('users', user.getId())

    this.eventEmitter.emit(AppEvents.USERS_SESSIONS_DELETE, {
      userId,
    })
  }
}
