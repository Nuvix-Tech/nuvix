import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, UseInterceptors } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CoreService } from '@nuvix/core'
import { Exception } from '@nuvix/core/extend/exception'
import { Hooks } from '@nuvix/core/extend/hooks'
import {
  Auth,
  Detector,
  emailHelper,
  RequestContext,
} from '@nuvix/core/helpers'
import type { DeletesJobData } from '@nuvix/core/resolvers'
import {
  MailJob,
  MailQueueOptions,
  ResponseInterceptor,
} from '@nuvix/core/resolvers'
import { PersonalDataValidator } from '@nuvix/core/validators'
import {
  Authorization,
  Database,
  Doc,
  DuplicateException,
  ID,
  Permission,
  Query,
  Role,
} from '@nuvix/db'
import {
  AppEvents,
  configuration,
  DeleteType,
  type HashAlgorithm,
  QueueFor,
  SessionProvider,
} from '@nuvix/utils'
import type {
  MembershipsDoc,
  SessionsDoc,
  TargetsDoc,
  UsersDoc,
} from '@nuvix/utils/types'
import { Queue } from 'bullmq'
import { CountryResponse, Reader } from 'maxmind'
import { platform } from '../platform'
import { UpdateEmailDTO, UpdatePasswordDTO } from './DTO/account.dto'
import { CreateEmailSessionDTO } from './DTO/session.dto'

@Injectable()
@UseInterceptors(ResponseInterceptor)
export class AccountService {
  private readonly geodb: Reader<CountryResponse>
  private readonly db: Database

  constructor(
    private readonly coreService: CoreService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue(QueueFor.MAILS)
    private readonly mailsQueue: Queue<MailQueueOptions, MailJob>,
    @InjectQueue(QueueFor.DELETES)
    private readonly deletesQueue: Queue<DeletesJobData, unknown, DeleteType>,
  ) {
    this.db = this.coreService.getInternalDatabase()
    this.geodb = coreService.getGeoDb()
  }

  /**
   * Create a new account
   */
  async createAccount(
    userId: string,
    email: string,
    password: string,
    name: string | undefined,
    user: UsersDoc,
    ip: string,
  ): Promise<UsersDoc> {
    email = email.toLowerCase()

    const whitelistEmails = platform.get('authWhitelistEmails')
    const whitelistIPs = platform.get('authWhitelistIPs', false)

    if (
      whitelistEmails &&
      !whitelistEmails.includes(email) &&
      !whitelistEmails.includes(email.toUpperCase())
    ) {
      throw new Exception(Exception.USER_EMAIL_NOT_WHITELISTED)
    }

    if (whitelistIPs && !whitelistIPs.includes(ip)) {
      throw new Exception(Exception.USER_IP_NOT_WHITELISTED)
    }

    const limit = platform.get('auths').limit ?? 0
    if (limit !== 0) {
      const total = await this.db.count('users', [])

      if (total >= limit) {
        throw new Exception(Exception.USER_CONSOLE_COUNT_EXCEEDED)
      }
    }

    const identityWithMatchingEmail = await this.db.findOne('identities', [
      Query.equal('providerEmail', [email]),
    ])

    if (identityWithMatchingEmail && !identityWithMatchingEmail.empty()) {
      throw new Exception(Exception.GENERAL_BAD_REQUEST)
    }

    if (platform.get('auths').personalDataCheck ?? false) {
      const personalDataValidator = new PersonalDataValidator(
        userId,
        email,
        name,
        null,
      )
      if (!personalDataValidator.$valid(password)) {
        throw new Exception(Exception.USER_PASSWORD_PERSONAL_DATA)
      }
    }

    await Hooks.trigger('passwordValidator', [
      this.db,
      new Doc(),
      password,
      user,
      true,
    ])

    const hashedPassword =
      (await Auth.passwordHash(
        password,
        Auth.DEFAULT_ALGO,
        Auth.DEFAULT_ALGO_OPTIONS,
      )) ?? undefined

    try {
      userId = userId === 'unique()' ? ID.unique() : userId
      user.setAll({
        $id: userId,
        $permissions: [
          Permission.read(Role.any()),
          Permission.update(Role.user(userId)),
          Permission.delete(Role.user(userId)),
        ],
        email: email,
        emailVerification: true, // we don't need to verify email on account creation by admin
        status: true,
        password: hashedPassword,
        passwordHistory: [],
        passwordUpdate: new Date(),
        hash: Auth.DEFAULT_ALGO,
        hashOptions: Auth.DEFAULT_ALGO_OPTIONS,
        registration: new Date(),
        reset: false,
        name: name,
        mfa: false,
        prefs: {},
        search: `${userId} ${email} ${name}`,
        accessedAt: new Date(),
      })
      user.delete('$sequence')
      user = await Authorization.skip(() =>
        this.db.createDocument('users', user),
      )

      try {
        const target = await Authorization.skip(() =>
          this.db.createDocument(
            'targets',
            new Doc({
              $permissions: [
                Permission.read(Role.user(user.getId())),
                Permission.update(Role.user(user.getId())),
                Permission.delete(Role.user(user.getId())),
              ],
              userId: user.getId(),
              userInternalId: user.getSequence(),
              providerType: 'email',
              identifier: email,
            }) as TargetsDoc,
          ),
        )
        user.set('targets', [...user.get('targets', []), target])
      } catch (error) {
        if (error instanceof DuplicateException) {
          const existingTarget = await this.db.findOne('targets', [
            Query.equal('identifier', [email]),
          ])
          if (existingTarget) {
            user.append('targets', existingTarget)
          }
        } else {
          throw error
        }
      }

      await this.db.purgeCachedDocument('users', user.getId())
    } catch (error) {
      if (error instanceof DuplicateException) {
        throw new Exception(Exception.USER_ALREADY_EXISTS)
      }
      throw new Exception(
        Exception.GENERAL_SERVER_ERROR,
        'Failed saving user to DB',
      )
    }

    Authorization.unsetRole(Role.guests().toString())
    Authorization.setRole(Role.user(user.getId()).toString())
    Authorization.setRole(Role.users().toString())

    return user
  }

  /**
   * Update user's prefs
   */
  async updatePrefs(user: UsersDoc, prefs: Record<string, any>) {
    user.set('prefs', prefs)
    user = await this.db.updateDocument('users', user.getId(), user)

    return user.get('prefs', {})
  }

  /**
   * Delete User Account.
   */
  async deleteAccount(user: UsersDoc) {
    if (user.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    // Get all memberships and check if user can be deleted
    const memberships = user.get('memberships', []) as MembershipsDoc[]
    for (const membership of memberships) {
      if (membership.get('confirm', false)) {
        throw new Exception(Exception.USER_DELETION_PROHIBITED)
      }
    }

    await Authorization.skip(() =>
      this.db.deleteDocument('users', user.getId()),
    )
    await this.db.purgeCachedDocument('users', user.getId())

    await this.deletesQueue.add(DeleteType.DOCUMENT, {
      document: user.clone(),
      project: new Doc({ $id: 'console' }),
    })

    return user
  }

  /**
   * Update User's Email
   */
  async updateEmail(user: UsersDoc, input: UpdateEmailDTO) {
    const passwordUpdate = user.get('passwordUpdate')

    if (
      passwordUpdate &&
      !(await Auth.passwordVerify(
        input.password,
        user.get('password'),
        user.get('hash') as HashAlgorithm,
        user.get('hashOptions'),
      ))
    ) {
      throw new Exception(Exception.USER_INVALID_CREDENTIALS)
    }

    const oldEmail = user.get('email')
    const email = input.email.toLowerCase()

    const identityWithMatchingEmail = await this.db.findOne('identities', qb =>
      qb
        .equal('providerEmail', email)
        .equal('userInternalId', user.getSequence()),
    )

    if (identityWithMatchingEmail && !identityWithMatchingEmail.empty()) {
      throw new Exception(Exception.GENERAL_BAD_REQUEST)
    }

    user.set('email', email).set('emailVerification', false)

    if (!passwordUpdate) {
      const hashedPassword = await Auth.passwordHash(
        input.password,
        Auth.DEFAULT_ALGO,
        Auth.DEFAULT_ALGO_OPTIONS,
      )
      user
        .set('password', hashedPassword)
        .set('hash', Auth.DEFAULT_ALGO)
        .set('hashOptions', Auth.DEFAULT_ALGO_OPTIONS)
        .set('passwordUpdate', new Date())
    }

    const target = await Authorization.skip(() =>
      this.db.findOne('targets', [Query.equal('identifier', [email])]),
    )

    if (target && !target.empty()) {
      throw new Exception(Exception.USER_TARGET_ALREADY_EXISTS)
    }

    try {
      user = await this.db.updateDocument('users', user.getId(), user)
      const oldTarget = user.findWhere(
        'targets',
        (target: TargetsDoc) => target.get('identifier') === oldEmail,
      )

      if (oldTarget && !oldTarget.empty()) {
        await Authorization.skip(() =>
          this.db.updateDocument(
            'targets',
            oldTarget.getId(),
            oldTarget.set('identifier', email),
          ),
        )
      }
      await this.db.purgeCachedDocument('users', user.getId())
    } catch (error) {
      if (error instanceof DuplicateException) {
        throw new Exception(Exception.GENERAL_BAD_REQUEST)
      }
      throw error
    }
  }

  /**
   * Update User's Name
   */
  async updateName(user: UsersDoc, name: string) {
    user.set('name', name)
    user = await this.db.updateDocument('users', user.getId(), user)

    return user
  }

  /**
   * Update User's Password
   */
  async updatePassword(
    user: UsersDoc,
    { oldPassword, password: newPassword }: UpdatePasswordDTO,
  ) {
    // Check old password only if it's an existing user.
    if (
      user.get('passwordUpdate') &&
      !(await Auth.passwordVerify(
        oldPassword,
        user.get('password'),
        user.get('hash') as HashAlgorithm,
        user.get('hashOptions'),
      ))
    ) {
      throw new Exception(Exception.USER_INVALID_CREDENTIALS)
    }

    const hashedNewPassword = await Auth.passwordHash(
      newPassword,
      Auth.DEFAULT_ALGO,
      Auth.DEFAULT_ALGO_OPTIONS,
    )

    if (platform.get('auths').personalDataCheck ?? false) {
      const personalDataValidator = new PersonalDataValidator(
        user.getId(),
        user.get('email'),
        user.get('name'),
        user.get('phone'),
      )
      if (!personalDataValidator.$valid(newPassword)) {
        throw new Exception(Exception.USER_PASSWORD_PERSONAL_DATA)
      }
    }

    user
      .set('password', hashedNewPassword)
      .set('passwordHistory', [])
      .set('passwordUpdate', new Date())
      .set('hash', Auth.DEFAULT_ALGO)
      .set('hashOptions', Auth.DEFAULT_ALGO_OPTIONS)

    user = await this.db.updateDocument('users', user.getId(), user)

    return user
  }

  /**
   * Get User's Sessions
   */
  async getSessions(user: UsersDoc, ctx: RequestContext) {
    const sessions = user.get('sessions', [])
    const locale = ctx.translator()

    const updatedSessions = sessions.map((session: SessionsDoc) => {
      const key = `countries.${session.get('countryCode')}`
      const countryName = locale.has(key)
        ? locale.getRaw(key)
        : locale.t('locale.country.unknown')

      session.set('countryName', countryName)
      session.set('current', ctx.getSession().getId() === session.getId())
      session.delete('secret')

      return session
    })

    return {
      data: updatedSessions,
      total: updatedSessions.length,
    }
  }

  /**
   * Delete user's session
   */
  async deleteSessions(
    user: UsersDoc,
    request: NuvixRequest,
    response: NuvixRes,
  ) {
    const protocol = request.protocol
    const sessions = user.get('sessions', []) as SessionsDoc[]

    const ctx = request.context
    for (const session of sessions) {
      await this.db.deleteDocument('sessions', session.getId())
      session.set('current', false)
      const locale = ctx.translator()
      const key = `countries.${session.get('countryCode')}`
      session.set(
        'countryName',
        locale.has(key)
          ? locale.getRaw(key)
          : locale.t('locale.country.unknown'),
      )

      if (session.getId() === ctx.getSession().getId()) {
        session.set('current', true)

        // If current session, delete the cookies too
        response.cookie('nc_session', '', {
          expires: new Date(0),
          path: '/',
          domain: ctx.cookieDomain,
          secure: protocol === 'https',
          httpOnly: true,
          sameSite: ctx.cookieSameSite,
        })

        if (configuration.server.fallbackCookies) {
          response.header('X-Fallback-Cookies', JSON.stringify({}))
        }
      }
    }

    await this.db.purgeCachedDocument('users', user.getId())
    this.eventEmitter.emit(AppEvents.SESSION_DELETE, {
      userId: user.getId(),
    })
  }

  /**
   * Get a Session
   */
  async getSession(user: UsersDoc, id: string, ctx: RequestContext) {
    const sessions = user.get('sessions', []) as SessionsDoc[]
    const current = ctx.getSession()
    const sessionId = id === 'current' ? current.getId() : id

    for (const session of sessions) {
      if (sessionId === session.getId()) {
        const locale = ctx.translator()
        const key = `countries.${session.get('countryCode')}`
        const countryName = locale.has(key)
          ? locale.getRaw(key)
          : locale.t('locale.country.unknown')

        session
          .set('current', session.getId() === current.getId())
          .set('countryName', countryName)
          .delete('secret')

        return session
      }
    }

    throw new Exception(Exception.USER_SESSION_NOT_FOUND)
  }

  /**
   * Delete a Session
   */
  async deleteSession(
    user: UsersDoc,
    sessionId: string,
    request: NuvixRequest,
    response: NuvixRes,
  ) {
    const protocol = request.protocol
    const sessions = user.get('sessions', []) as SessionsDoc[]

    for (const session of sessions) {
      if (sessionId !== session.getId()) {
        continue
      }

      await this.db.deleteDocument('sessions', session.getId())

      session.set('current', false)
      if (session.getId() === request.context.getSession().getId()) {
        session.set('current', true)

        response.cookie('nc_session', '', {
          expires: new Date(0),
          path: '/',
          domain: request.context.cookieDomain,
          secure: protocol === 'https',
          httpOnly: true,
          sameSite: request.context.cookieSameSite,
        })
      }

      await this.db.purgeCachedDocument('users', user.getId())
      return
    }

    throw new Exception(Exception.USER_SESSION_NOT_FOUND)
  }

  /**
   * Update a Session
   */
  async updateSession(user: UsersDoc, sessionId: string) {
    const sessions = user.get('sessions', []) as SessionsDoc[]
    let session: SessionsDoc | null = null

    for (const value of sessions) {
      if (sessionId === value.getId()) {
        session = value
        break
      }
    }

    if (session === null) {
      throw new Exception(Exception.USER_SESSION_NOT_FOUND)
    }

    const auths = platform.get('auths')
    const authDuration = auths.duration ?? Auth.TOKEN_EXPIRATION_LOGIN_LONG
    session.set('expire', new Date(Date.now() + authDuration * 1000))

    await this.db.updateDocument('sessions', sessionId, session)
    await this.db.purgeCachedDocument('users', user.getId())

    return session
  }

  /**
   * Create a new session for the user using Email & Password
   */
  async createEmailSession(
    user: UsersDoc,
    input: CreateEmailSessionDTO,
    request: NuvixRequest,
    response: NuvixRes,
  ) {
    const email = input.email.toLowerCase()
    const protocol = request.protocol

    const profile = await this.db.findOne('users', qb =>
      qb.equal('email', email),
    )

    if (
      profile.empty() ||
      !profile.get('passwordUpdate') ||
      !(await Auth.passwordVerify(
        input.password,
        profile.get('password'),
        profile.get('hash') as HashAlgorithm,
        profile.get('hashOptions'),
      ))
    ) {
      throw new Exception(Exception.USER_INVALID_CREDENTIALS)
    }

    if (profile.get('status') === false) {
      throw new Exception(Exception.USER_BLOCKED)
    }

    user.setAll(profile.toObject())

    const duration =
      platform.get('auths').duration ?? Auth.TOKEN_EXPIRATION_LOGIN_LONG
    const detector = new Detector(request.headers['user-agent'] || 'UNKNOWN')
    const record = this.geodb.get(request.ip)
    const secret = Auth.tokenGenerator(Auth.TOKEN_LENGTH_SESSION)

    const session = new Doc({
      $id: ID.unique(),
      userId: user.getId(),
      userInternalId: user.getSequence(),
      provider: SessionProvider.EMAIL,
      providerUid: email,
      secret: Auth.hash(secret),
      userAgent: request.headers['user-agent'] || 'UNKNOWN',
      ip: request.ip,
      factors: ['password'],
      countryCode: record?.country?.iso_code.toLowerCase(),
      expire: new Date(Date.now() + duration * 1000),
      ...detector.getOS(),
      ...detector.getClient(),
      ...detector.getDevice(),
    }) as SessionsDoc

    Authorization.setRole(Role.user(user.getId()).toString())

    if (user.get('hash') !== Auth.DEFAULT_ALGO) {
      user
        .set(
          'password',
          await Auth.passwordHash(
            input.password,
            Auth.DEFAULT_ALGO,
            Auth.DEFAULT_ALGO_OPTIONS,
          ),
        )
        .set('hash', Auth.DEFAULT_ALGO)
        .set('hashOptions', Auth.DEFAULT_ALGO_OPTIONS)
      await this.db.updateDocument('users', user.getId(), user)
    }

    await this.db.purgeCachedDocument('users', user.getId())

    const createdSession = await this.db.createDocument(
      'sessions',
      session.set('$permissions', [
        Permission.read(Role.user(user.getId())),
        Permission.update(Role.user(user.getId())),
        Permission.delete(Role.user(user.getId())),
      ]),
    )

    const expire = new Date(Date.now() + duration * 1000)
    const ctx = request.context
    const locale = ctx.translator()

    response
      .cookie('nc_session', Auth.encodeSession(user.getId(), secret), {
        expires: expire,
        path: '/',
        secure: protocol === 'https',
        domain: ctx.cookieDomain,
        sameSite: ctx.cookieSameSite,
        httpOnly: true,
      })
      .status(201)

    if (configuration.server.fallbackCookies) {
      response.header(
        'X-Fallback-Cookies',
        JSON.stringify({
          nc_session: Auth.encodeSession(user.getId(), secret),
        }),
      )
    }

    const key = `countries.${session.get('countryCode')}`
    const countryName = locale.has(key)
      ? locale.getRaw(key)
      : locale.t('locale.country.unknown')

    createdSession
      .set('current', true)
      .set('countryName', countryName)
      .delete('secret')

    if (platform.get('auths').sessionAlerts ?? false) {
      const sessionCount = await this.db.count('sessions', qb =>
        qb.equal('userId', user.getId()),
      )

      if (sessionCount !== 1) {
        await this.sendSessionAlert(user, createdSession, ctx)
      }
    }

    return createdSession
  }

  /**
   * Send Session Alert.
   */
  async sendSessionAlert(
    user: UsersDoc,
    session: SessionsDoc,
    ctx: RequestContext,
  ) {
    const project = new Doc({ $id: 'console', name: 'Console' })
    const locale = ctx.translator()
    const projectName = project.get('name')
    const key = `countries.${session.get('countryCode')}`
    const country = (
      locale.has(key) ? locale.getRaw(key) : locale.t('locale.country.unknown')
    ) as string

    const payload = await emailHelper
      .builder(project as any)
      .to(user.get('email'))
      .usingTemplate(
        'email-session-alert.tpl',
        `sessionAlert-${locale.fallbackLocale}`,
      )
      .withSubject(
        locale.t('emails.sessionAlert.subject', { project: projectName }),
      )
      .withData({
        hello: locale.t('emails.sessionAlert.hello', {
          user: user.get('name', 'User'),
        }),
        body: locale.t('emails.sessionAlert.body', {
          project: projectName,
          date: new Date().toLocaleDateString(locale.fallbackLocale, {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }),
          time: new Date().toLocaleTimeString(locale.fallbackLocale),
          year: new Date().getFullYear().toString(),
        }),
        listDevice: locale.t('emails.sessionAlert.listDevice', {
          device: session.get('clientName'),
        }),
        listIpAddress: locale.t('emails.sessionAlert.listIpAddress', {
          ipAddress: session.get('ip'),
        }),
        listCountry: locale.t('emails.sessionAlert.listCountry', {
          country,
        }),
        footer: locale.t('emails.sessionAlert.footer'),
        thanks: locale.t('emails.sessionAlert.thanks'),
        signature: locale.t('emails.sessionAlert.signature', {
          project: projectName,
        }),
      })
      .withVariables({
        direction: locale.t('settings.direction'),
        user: user.get('name', 'User'),
        project: projectName,
      })
      .build()

    await this.mailsQueue.add(MailJob.SEND_EMAIL, payload)
  }
}
