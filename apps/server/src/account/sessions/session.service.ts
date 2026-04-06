import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { JwtService } from '@nestjs/jwt'
import { CoreService } from '@nuvix/core'
import { type OAuthProviders, type OAuthProviderType } from '@nuvix/core/config'
import { Exception } from '@nuvix/core/extend/exception'
import { Auth, EmailHelper, Models, RequestContext } from '@nuvix/core/helpers'
import { getOAuth2Class, OAuth2 } from '@nuvix/core/OAuth2'
import {
  DeletesJobData,
  MailJob,
  MailQueueOptions,
  MessagingJob,
  MessagingJobInternalData,
} from '@nuvix/core/resolvers'
import { URLValidator } from '@nuvix/core/validators'
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
  AuthFactor,
  configuration,
  DeleteType,
  type HashAlgorithm,
  MessageType,
  QueueFor,
  SessionProvider,
  TokenType,
} from '@nuvix/utils'
import { PhraseGenerator } from '@nuvix/utils/auth'
import type {
  ProjectsDoc,
  Sessions,
  SessionsDoc,
  TargetsDoc,
  Tokens,
  UsersDoc,
} from '@nuvix/utils/types'
import { Queue } from 'bullmq'
import { CountryResponse, Reader } from 'maxmind'
import {
  CreateEmailSessionDTO,
  CreateOAuth2SessionDTO,
  CreateSessionDTO,
  OAuth2CallbackDTO,
} from './DTO/session.dto'
import {
  CreateEmailTokenDTO,
  CreateMagicURLTokenDTO,
  CreateOAuth2TokenDTO,
  CreatePhoneTokenDTO,
} from './DTO/token.dto'

@Injectable()
export class SessionService {
  private readonly geodb: Reader<CountryResponse>
  private readonly db: Database
  private readonly emailHelper = new EmailHelper()

  constructor(
    private readonly coreService: CoreService,
    private eventEmitter: EventEmitter2,
    private readonly jwtService: JwtService,
    @InjectQueue(QueueFor.MAILS)
    private readonly mailsQueue: Queue<MailQueueOptions>,
    @InjectQueue(QueueFor.DELETES)
    private readonly deletesQueue: Queue<DeletesJobData, unknown, DeleteType>,
    @InjectQueue(QueueFor.MESSAGING)
    private readonly messagingQueue: Queue<
      MessagingJobInternalData,
      unknown,
      MessagingJob
    >,
  ) {
    this.geodb = this.coreService.getGeoDb()
    this.db = this.coreService.getDatabase()
  }

  private static readonly oauthDefaultSuccess = '/auth/oauth2/success'
  private static readonly oauthDefaultFailure = '/auth/oauth2/failure'
  private static readonly magicAuthDefaultPath = '/auth/magic-url'

  /**
   * Get User's Sessions
   */
  async getSessions(user: UsersDoc, ctx: RequestContext) {
    const sessions = user.get('sessions', []) as SessionsDoc[]
    const current = ctx.session

    const locale = ctx.translator()
    const updatedSessions = sessions.map(session => {
      const key = countryKey(session.get('countryCode'))
      const countryName = locale.has(key)
        ? locale.getRaw(key)
        : locale.t('locale.country.unknown')

      session.set('countryName', countryName)
      session.set('current', current && current.getId() === session.getId())
      session.set('secret', session.get('secret', ''))

      return session
    })

    return {
      data: updatedSessions,
      total: updatedSessions.length,
    }
  }

  /**
   * Delete User's Session
   */
  async deleteSessions(
    user: UsersDoc,
    request: NuvixRequest,
    response: NuvixRes,
  ) {
    const ctx = request.context
    const protocol = request.protocol
    const sessions = user.get('sessions', []) as SessionsDoc[]

    for (const session of sessions) {
      await this.db.deleteDocument('sessions', session.getId())

      if (configuration.server.fallbackCookies) {
        response.header('X-Fallback-Cookies', '{}')
      }

      const locale = ctx.translator()
      const key = countryKey(session.get('countryCode'))

      session.set('current', false)
      session.set(
        'countryName',
        locale.has(key)
          ? locale.getRaw(key)
          : locale.t('locale.country.unknown'),
      )

      if (ctx.session && ctx.session.getId() === session.getId()) {
        session.set('current', true)

        // If current session, delete the cookies too
        response.cookie(Auth.cookieName, '', {
          expires: new Date(0),
          path: '/',
          domain: ctx.cookieDomain,
          secure: protocol === 'https',
          httpOnly: true,
          sameSite: ctx.cookieSameSite,
        })
      }
    }

    await this.deletesQueue.addBulk(
      [...sessions].map(s => ({
        name: DeleteType.SESSION_TARGETS,
        data: {
          document: s,
        },
      })),
    )

    await this.db.purgeCachedDocument('users', user.getId())

    this.eventEmitter.emit(AppEvents.SESSION_DELETE, {
      userId: user.getId(),
    })

    return
  }

  /**
   * Get a Session
   */
  async getSession(user: UsersDoc, sessionId: string, ctx: RequestContext) {
    const sessions = user.get('sessions', []) as SessionsDoc[]
    if (sessionId === 'current') {
      sessionId = ctx.session ? ctx.session.getId() : ''
    }

    for (const session of sessions) {
      if (sessionId === session.getId()) {
        const locale = ctx.translator()
        const key = countryKey(session.get('countryCode'))
        const countryName = locale.has(key)
          ? locale.getRaw(key)
          : locale.t('locale.country.unknown')

        session
          .set(
            'current',
            ctx.session && ctx.session.getId() === session.getId(),
          )
          .set('countryName', countryName)
          .set('secret', session.get('secret', ''))

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
    const ctx = request.context
    const sessions = user.get('sessions', []) as SessionsDoc[]
    if (sessionId === 'current') {
      sessionId = ctx.session ? ctx.session.getId() : ''
    }

    for (const session of sessions) {
      if (sessionId !== session.getId()) {
        continue
      }

      await this.db.deleteDocument('sessions', session.getId())
      session.set('current', false)

      if (ctx.session && session.getId() === ctx.session.getId()) {
        session.set('current', true)

        response.cookie(Auth.cookieName, '', {
          expires: new Date(0),
          path: '/',
          domain: ctx.cookieDomain,
          secure: protocol === 'https',
          httpOnly: true,
          sameSite: ctx.cookieSameSite,
        })

        if (configuration.server.fallbackCookies) {
          response.header('X-Fallback-Cookies', '{}')
        }
      }

      await this.db.purgeCachedDocument('users', user.getId())

      this.eventEmitter.emit(AppEvents.SESSIONS_DELETE, {
        userId: user.getId(),
        sessionId: session.getId(),
        payload: {
          data: session,
          type: Models.SESSION,
        },
      })

      await this.deletesQueue.add(DeleteType.SESSION_TARGETS, {
        document: session,
      })

      return
    }

    throw new Exception(Exception.USER_SESSION_NOT_FOUND)
  }

  /**
   * Update a Session
   */
  async updateSession(user: UsersDoc, sessionId: string, ctx: RequestContext) {
    if (sessionId === 'current') {
      sessionId = ctx.session ? ctx.session.getId() : ''
    }

    const sessions = user.get('sessions', []) as SessionsDoc[]
    let session: SessionsDoc | undefined

    for (const value of sessions) {
      if (sessionId === value.getId()) {
        session = value
        break
      }
    }

    if (!session) {
      throw new Exception(Exception.USER_SESSION_NOT_FOUND)
    }

    const auths = ctx.project.get('auths', {})

    const authDuration = auths.duration ?? Auth.TOKEN_EXPIRATION_LOGIN_LONG
    session.set('expire', new Date(Date.now() + authDuration * 1000))

    const provider: string = session.get('provider', '')
    const refreshToken = session.get('providerRefreshToken', '')

    if (provider) {
      const providerInfo = this.getProviderConfig(ctx.project, provider)
      const appId = providerInfo.appId
      const appSecret = Auth.decryptIfDefined(providerInfo.secret)

      if (!appId || !appSecret) {
        throw new Exception(
          Exception.PROJECT_PROVIDER_DISABLED,
          `This provider is disabled. Please configure the provider app ID and app secret key from your ${configuration.app.name} console to continue.`,
        )
      }

      const OAuth2Class = await getOAuth2Class(provider)
      const oauth2: OAuth2 = new OAuth2Class(appId, appSecret, '')
      await oauth2.refreshTokens(refreshToken)
      const accessToken = await oauth2.getAccessToken('')

      session
        .set('providerAccessToken', accessToken)
        .set('providerRefreshToken', accessToken)
        .set(
          'providerAccessTokenExpiry',
          new Date(Date.now() + (await oauth2.getAccessTokenExpiry('')) * 1000),
        )
    }

    await this.db.updateDocument('sessions', sessionId, session)
    await this.db.purgeCachedDocument('users', user.getId())

    this.eventEmitter.emit(AppEvents.SESSION_UPDATE, {
      userId: user.getId(),
      sessionId: session.getId(),
      payload: {
        data: session,
        type: Models.SESSION,
      },
    })

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
    const ctx = request.context

    const profile = await this.db.findOne('users', [
      Query.equal('email', [email]),
    ])

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

    const auths = ctx.project.get('auths', {})
    const duration = auths.duration ?? Auth.TOKEN_EXPIRATION_LOGIN_LONG
    const detector = ctx.detector(request.headers['user-agent'])
    const record = this.geodb.get(request.ip)
    const secret = Auth.tokenGenerator(Auth.TOKEN_LENGTH_SESSION)

    const session = new Doc<Sessions>({
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
    })

    Authorization.setRole(Role.user(user.getId()).toString())

    if ((user.get('hash') as HashAlgorithm) !== Auth.DEFAULT_ALGO) {
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

    session.set('$permissions', [
      Permission.read(Role.user(user.getId())),
      Permission.update(Role.user(user.getId())),
      Permission.delete(Role.user(user.getId())),
    ])
    const createdSession = await this.db.createDocument('sessions', session)

    if (configuration.server.fallbackCookies) {
      response.header(
        'X-Fallback-Cookies',
        JSON.stringify({
          [Auth.cookieName]: Auth.encodeSession(user.getId(), secret),
        }),
      )
    }

    const expire = new Date(Date.now() + duration * 1000)
    response
      .cookie(Auth.cookieName, Auth.encodeSession(user.getId(), secret), {
        expires: expire,
        path: '/',
        secure: protocol === 'https',
        domain: ctx.cookieDomain,
        sameSite: ctx.cookieSameSite,
        httpOnly: true,
      })
      .status(201)

    const locale = ctx.translator()
    const key = countryKey(createdSession.get('countryCode'))
    const countryName = locale.has(key)
      ? locale.getRaw(key)
      : locale.get('locale.country.unknown')

    createdSession
      .set('current', true)
      .set('countryName', countryName)
      .set('secret', secret)

    this.eventEmitter.emit(AppEvents.SESSION_CREATE, {
      userId: user.getId(),
      sessionId: createdSession.getId(),
      payload: {
        data: createdSession,
        type: Models.SESSION,
      },
    })

    if (ctx.project.get('auths', {}).sessionAlerts ?? false) {
      const sessionCount = await this.db.count('sessions', qb =>
        qb.equal('userId', user.getId()),
      )

      if (sessionCount !== 1) {
        await this.sendSessionAlert(user, createdSession, ctx)
      }
    }

    return createdSession
  }

  async createAnonymousSession({
    request,
    response,
    user,
  }: {
    request: NuvixRequest
    response: NuvixRes
    user: UsersDoc
  }) {
    const ctx = request.context
    const protocol = request.protocol
    const limit = ctx.project.get('auths', {}).limit ?? 0
    const maxUsers = configuration.limits.users

    if (limit !== 0) {
      const total = await this.db.count('users', [], maxUsers)

      if (total >= limit) {
        throw new Exception(Exception.USER_COUNT_EXCEEDED)
      }
    }

    const userId = ID.unique()
    user.setAll({
      $id: userId,
      $permissions: [
        Permission.read(Role.any()),
        Permission.update(Role.user(userId)),
        Permission.delete(Role.user(userId)),
      ],
      emailVerification: false,
      status: true,
      hash: Auth.DEFAULT_ALGO,
      hashOptions: Auth.DEFAULT_ALGO_OPTIONS,
      registration: new Date(),
      reset: false,
      mfa: false,
      prefs: {},
      search: userId,
      accessedAt: new Date(),
    })
    user.delete('$sequence')
    await Authorization.skip(() => this.db.createDocument('users', user))

    // Create session token
    const duration =
      ctx.project.get('auths', {}).duration ?? Auth.TOKEN_EXPIRATION_LOGIN_LONG
    const detector = ctx.detector(request.headers['user-agent'])
    const record = this.geodb.get(request.ip)
    const secret = Auth.tokenGenerator(Auth.TOKEN_LENGTH_SESSION)

    const session = new Doc({
      $id: ID.unique(),
      userId: user.getId(),
      userInternalId: user.getSequence(),
      provider: SessionProvider.ANONYMOUS,
      secret: Auth.hash(secret),
      userAgent: request.headers['user-agent'] || 'UNKNOWN',
      ip: request.ip,
      factors: ['anonymous'],
      countryCode: record?.country?.iso_code.toLowerCase(),
      expire: new Date(Date.now() + duration * 1000),
      ...detector.getOS(),
      ...detector.getClient(),
      ...detector.getDevice(),
    }) as SessionsDoc

    Authorization.setRole(Role.user(user.getId()).toString())

    session.set('$permissions', [
      Permission.read(Role.user(user.getId())),
      Permission.update(Role.user(user.getId())),
      Permission.delete(Role.user(user.getId())),
    ])
    const createdSession = await this.db.createDocument('sessions', session)

    await this.db.purgeCachedDocument('users', user.getId())

    this.eventEmitter.emit(AppEvents.USER_CREATE, {
      userId: user.getId(),
      sessionId: createdSession.getId(),
    })

    if (configuration.server.fallbackCookies) {
      response.header(
        'X-Fallback-Cookies',
        JSON.stringify({
          [Auth.cookieName]: Auth.encodeSession(user.getId(), secret),
        }),
      )
    }

    const expire = new Date(Date.now() + duration * 1000)

    response
      .cookie(Auth.cookieName, Auth.encodeSession(user.getId(), secret), {
        expires: expire,
        path: '/',
        domain: ctx.cookieDomain,
        secure: protocol === 'https',
        httpOnly: true,
        sameSite: ctx.cookieSameSite,
      })
      .status(201)

    const locale = ctx.translator()
    const key = countryKey(createdSession.get('countryCode'))
    const countryName = locale.has(key)
      ? locale.getRaw(key)
      : locale.get('locale.country.unknown')

    createdSession
      .set('current', true)
      .set('countryName', countryName)
      .set('secret', secret)

    return createdSession
  }

  /**
   * Create OAuth2 Session.
   */
  async createOAuth2Session({
    input,
    request,
    provider,
  }: {
    input: CreateOAuth2SessionDTO
    request: NuvixRequest
    provider: OAuthProviders
  }) {
    const ctx = request.context
    const protocol = request.protocol

    if (input.success) ctx.validateRedirectURL(input.success)
    if (input.failure) ctx.validateRedirectURL(input.failure)

    const success = input.success || ''
    const failure = input.failure || ''
    const scopes = input.scopes || []

    const callback = `${protocol}://${request.host}/v1/account/sessions/oauth2/callback/${provider}`
    const providerInfo = this.getProviderConfig(ctx.project, provider)

    if (!providerInfo.enabled) {
      throw new Exception(Exception.PROJECT_PROVIDER_DISABLED)
    }

    const appId = providerInfo.appId
    const appSecret = Auth.decryptIfDefined(providerInfo.secret)

    if (!appId || !appSecret) {
      throw new Exception(
        Exception.PROJECT_PROVIDER_DISABLED,
        `This provider is disabled. Please configure the provider app ID and app secret key from your ${configuration.app.name} console to continue.`,
      )
    }

    const AuthClass = await getOAuth2Class(provider)
    const finalSuccess =
      success ||
      `${protocol}://${request.host}${SessionService.oauthDefaultSuccess}`
    const finalFailure =
      failure ||
      `${protocol}://${request.host}${SessionService.oauthDefaultFailure}`

    const oauth2 = new AuthClass(
      appId,
      appSecret,
      callback,
      {
        success: finalSuccess,
        failure: finalFailure,
        token: false,
      },
      scopes,
    )

    return oauth2.getLoginURL()
  }

  /**
   * Handle OAuth2 Redirect.
   */
  async oAuth2Redirect({
    user,
    input,
    provider,
    request,
    response,
  }: {
    user: UsersDoc
    input: OAuth2CallbackDTO
    provider: string
    request: NuvixRequest
    response: NuvixRes
  }) {
    const ctx = request.context
    const protocol = request.protocol
    const callback = `${protocol}://${request.host}/v1/account/sessions/oauth2/callback/${provider}`
    const defaultState = {
      success: '',
      failure: '',
    }
    const validateURL = new URLValidator()
    const providerInfo = this.getProviderConfig(ctx.project, provider)
    const providerEnabled = providerInfo.enabled
    const appId = providerInfo.appId ?? ''
    const appSecret = Auth.decryptIfDefined(providerInfo.secret) ?? ''
    const AuthClass = await getOAuth2Class(provider)
    const oauth2 = new AuthClass(appId, appSecret, callback)

    let state: {
      success: string
      failure: string
      token?: string
    } = defaultState
    if (input.state) {
      try {
        state = { ...defaultState, ...oauth2.parseState(input.state) }
      } catch (_error) {
        throw new Exception(
          Exception.GENERAL_BAD_REQUEST,
          'Failed to parse login state params as passed from OAuth2 provider',
        )
      }
    }

    if (!validateURL.$valid(state.success)) {
      throw new Exception(Exception.PROJECT_INVALID_SUCCESS_URL)
    }

    if (state.failure && !validateURL.$valid(state.failure)) {
      throw new Exception(Exception.PROJECT_INVALID_FAILURE_URL)
    }

    const failureRedirect = (type: string, message?: string, code?: number) => {
      const exception = new Exception(type, message, code)
      if (state.failure) {
        // Handle failure redirect with error params
        const failureUrl = new URL(state.failure)
        failureUrl.searchParams.set(
          'error',
          JSON.stringify({
            message: exception.message,
            type: exception.getType(),
            code: code ?? exception.getStatus(),
          }),
        )
        response.status(302).redirect(failureUrl.toString())
        return
      }
      throw exception
    }

    if (!providerEnabled) {
      return failureRedirect(
        Exception.PROJECT_PROVIDER_DISABLED,
        `This provider is disabled. Please enable the provider from your ${configuration.app.name} console to continue.`,
      )
    }

    if (input.error) {
      let message = `The ${provider} OAuth2 provider returned an error: ${input.error}`
      if (input.error_description) {
        message += `: ${input.error_description}`
      }
      return failureRedirect(Exception.USER_OAUTH2_PROVIDER_ERROR, message)
    }

    if (!input.code) {
      return failureRedirect(
        Exception.USER_OAUTH2_PROVIDER_ERROR,
        'Missing OAuth2 code. Please contact the team for additional support.',
      )
    }

    let accessToken = ''
    let refreshToken = ''
    let accessTokenExpiry = 0

    try {
      accessToken = await oauth2.getAccessToken(input.code!)
      refreshToken = await oauth2.getRefreshToken(input.code!)
      accessTokenExpiry = await oauth2.getAccessTokenExpiry(input.code!)
    } catch (error: any) {
      return failureRedirect(
        Exception.USER_OAUTH2_PROVIDER_ERROR,
        `Failed to obtain access token. The ${provider} OAuth2 provider returned an error: ${error.message}`,
        error.code,
      )
    }

    const oauth2ID = await oauth2.getUserID(accessToken)
    if (!oauth2ID) {
      return failureRedirect(Exception.USER_MISSING_ID)
    }

    let name = ''
    const nameOAuth = await oauth2.getUserName(accessToken)
    const userParam = JSON.parse(
      (request.query as { user: string }).user || '{}',
    )
    if (nameOAuth) {
      name = nameOAuth
    } else if (Array.isArray(userParam) || typeof userParam === 'object') {
      const nameParam = userParam.name
      if (
        typeof nameParam === 'object' &&
        nameParam.firstName &&
        nameParam.lastName
      ) {
        name = `${nameParam.firstName} ${nameParam.lastName}`
      }
    }

    const email = await oauth2.getUserEmail(accessToken)

    // Check if this identity is connected to a different user
    let sessionUpgrade = false
    if (!user.empty()) {
      const userId = user.getId()

      const identityWithMatchingEmail = await this.db.findOne('identities', [
        Query.equal('providerEmail', [email]),
        Query.notEqual('userInternalId', user.getSequence()),
      ])
      if (!identityWithMatchingEmail.empty()) {
        return failureRedirect(Exception.USER_ALREADY_EXISTS)
      }

      const userWithMatchingEmail = await this.db.find('users', [
        Query.equal('email', [email]),
        Query.notEqual('$id', userId),
      ])
      if (userWithMatchingEmail.length > 0) {
        return failureRedirect(Exception.USER_ALREADY_EXISTS)
      }

      sessionUpgrade = true
    }

    const current = ctx.session?.getId()
    if (current) {
      const currentDocument = await this.db.getDocument('sessions', current)
      if (!currentDocument.empty()) {
        await this.db.deleteDocument('sessions', currentDocument.getId())
        await this.db.purgeCachedDocument('users', user.getId())
      }
    }

    if (user.empty()) {
      const session = await this.db.findOne('sessions', [
        Query.equal('provider', [provider]),
        Query.equal('providerUid', [oauth2ID]),
      ])
      if (!session.empty()) {
        const foundUser = await this.db.getDocument(
          'users',
          session.get('userId'),
        )
        user.setAll(foundUser.toObject())
      }
    }

    if (user.empty()) {
      if (!email) {
        return failureRedirect(
          Exception.USER_UNAUTHORIZED,
          'OAuth provider failed to return email.',
        )
      }

      const userWithEmail = await this.db.findOne('users', [
        Query.equal('email', [email]),
      ])
      if (!userWithEmail.empty()) {
        user.setAll(userWithEmail.toObject())
      }

      if (user.empty()) {
        const identity = await this.db.findOne('identities', [
          Query.equal('provider', [provider]),
          Query.equal('providerUid', [oauth2ID]),
        ])

        if (!identity.empty()) {
          const foundUser = await this.db.getDocument(
            'users',
            identity.get('userId'),
          )
          user.setAll(foundUser.toObject())
        }
      }

      if (user.empty()) {
        const limit = ctx.project.get('auths', {}).limit ?? 0
        const maxUsers = configuration.limits.users

        if (limit !== 0) {
          const total = await this.db.count('users', [], maxUsers)
          if (total >= limit) {
            return failureRedirect(Exception.USER_COUNT_EXCEEDED)
          }
        }

        const identityWithMatchingEmail = await this.db.findOne('identities', [
          Query.equal('providerEmail', [email]),
        ])
        if (!identityWithMatchingEmail.empty()) {
          // This means an account with the same email already exists but with a different provider,
          // we don't want to link them together automatically for security reasons,
          // so we return an error instead of linking the new provider to the existing account
          return failureRedirect(Exception.GENERAL_BAD_REQUEST)
        }

        try {
          const userId = ID.unique()
          user.setAll({
            $id: userId,
            $permissions: [
              Permission.read(Role.any()),
              Permission.update(Role.user(userId)),
              Permission.delete(Role.user(userId)),
            ],
            email: email,
            emailVerification: true,
            status: true,
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

          const userDoc = await Authorization.skip(() =>
            this.db.createDocument('users', user),
          )

          await this.db.createDocument(
            'targets',
            new Doc({
              $permissions: [
                Permission.read(Role.user(user.getId())),
                Permission.update(Role.user(user.getId())),
                Permission.delete(Role.user(user.getId())),
              ],
              userId: userDoc.getId(),
              userInternalId: userDoc.getSequence(),
              providerType: MessageType.EMAIL,
              identifier: email,
            }),
          )
        } catch (error) {
          if (error instanceof DuplicateException) {
            return failureRedirect(Exception.USER_ALREADY_EXISTS)
          }
          throw error
        }
      }
    }

    Authorization.setRole(Role.user(user.getId()).toString())
    Authorization.setRole(Role.users().toString())

    if (user.get('status') === false) {
      return failureRedirect(Exception.USER_BLOCKED)
    }

    let identity = await this.db.findOne('identities', [
      Query.equal('userInternalId', [user.getSequence()]),
      Query.equal('provider', [provider]),
      Query.equal('providerUid', [oauth2ID]),
    ])

    if (identity.empty()) {
      const identitiesWithMatchingEmail = await this.db.find('identities', [
        Query.equal('providerEmail', [email]),
        Query.notEqual('userInternalId', user.getSequence()),
      ])
      if (identitiesWithMatchingEmail.length > 0) {
        // This means an identity with the same email already exists but with a different provider,
        // we don't want to link them together automatically for security reasons,
        // so we return an error instead of linking the new provider to the existing account
        return failureRedirect(Exception.GENERAL_BAD_REQUEST)
      }

      identity = await this.db.createDocument(
        'identities',
        new Doc({
          $id: ID.unique(),
          $permissions: [
            Permission.read(Role.any()),
            Permission.update(Role.user(user.getId())),
            Permission.delete(Role.user(user.getId())),
          ],
          userInternalId: user.getSequence(),
          userId: user.getId(),
          provider: provider,
          providerUid: oauth2ID,
          providerEmail: email,
          providerAccessToken: accessToken,
          providerRefreshToken: refreshToken,
          providerAccessTokenExpiry: new Date(
            Date.now() + accessTokenExpiry * 1000,
          ),
        }),
      )
    } else {
      identity
        .set('providerAccessToken', accessToken)
        .set('providerRefreshToken', refreshToken)
        .set(
          'providerAccessTokenExpiry',
          new Date(Date.now() + accessTokenExpiry * 1000),
        )
      await this.db.updateDocument('identities', identity.getId(), identity)
    }

    if (!user.get('email')) {
      user.set('email', email)
    }

    if (!user.get('name')) {
      user.set('name', name)
    }

    user.set('status', true)
    await this.db.updateDocument('users', user.getId(), user)

    const duration =
      ctx.project.get('auths', {}).duration ?? Auth.TOKEN_EXPIRATION_LOGIN_LONG
    const expire = new Date(Date.now() + duration * 1000)

    const parsedState = new URL(state.success)
    const query = new URLSearchParams(parsedState.search)

    // If token param is set, return token in query string
    if (state.token) {
      const secret = Auth.tokenGenerator(Auth.TOKEN_LENGTH_OAUTH2)
      const token = new Doc<Tokens>({
        $id: ID.unique(),
        userId: user.getId(),
        userInternalId: user.getSequence(),
        type: TokenType.OAUTH2,
        secret: Auth.hash(secret),
        expire: expire,
        userAgent: request.headers['user-agent'] || 'UNKNOWN',
        ip: request.ip,
      })

      await this.db.createDocument(
        'tokens',
        token.set('$permissions', [
          Permission.read(Role.user(user.getId())),
          Permission.update(Role.user(user.getId())),
          Permission.delete(Role.user(user.getId())),
        ]),
      )

      query.set('secret', secret)
      query.set('userId', user.getId())
    } else {
      // Create session
      const detector = ctx.detector(request.headers['user-agent'])
      const record = this.geodb.get(request.ip)
      const secret = Auth.tokenGenerator(Auth.TOKEN_LENGTH_SESSION)

      const session = new Doc<Sessions>({
        $id: ID.unique(),
        userId: user.getId(),
        userInternalId: user.getSequence(),
        provider: provider,
        providerUid: oauth2ID,
        providerAccessToken: accessToken,
        providerRefreshToken: refreshToken,
        providerAccessTokenExpiry: new Date(
          Date.now() + accessTokenExpiry * 1000,
        ),
        secret: Auth.hash(secret),
        userAgent: request.headers['user-agent'] || 'UNKNOWN',
        ip: request.ip,
        factors: ['email', 'oauth2'],
        countryCode: record?.country?.iso_code.toLowerCase(),
        expire: expire,
        ...detector.getOS(),
        ...detector.getClient(),
        ...detector.getDevice(),
      })

      const createdSession = await this.db.createDocument(
        'sessions',
        session.set('$permissions', [
          Permission.read(Role.user(user.getId())),
          Permission.update(Role.user(user.getId())),
          Permission.delete(Role.user(user.getId())),
        ]),
      )

      if (configuration.server.fallbackCookies) {
        response.header(
          'X-Fallback-Cookies',
          JSON.stringify({
            [Auth.cookieName]: Auth.encodeSession(user.getId(), secret),
          }),
        )
      }

      // todo: rethink...
      if (parsedState.pathname === SessionService.oauthDefaultSuccess) {
        query.set('domain', ctx.cookieDomain)
        query.set('key', Auth.cookieName)
        query.set('secret', Auth.encodeSession(user.getId(), secret))
      }

      response.cookie(
        Auth.cookieName,
        Auth.encodeSession(user.getId(), secret),
        {
          expires: expire,
          path: '/',
          domain: ctx.cookieDomain,
          secure: protocol === 'https',
          httpOnly: true,
          sameSite: ctx.cookieSameSite,
        },
      )

      if (sessionUpgrade) {
        const targets = user.get('targets', []) as TargetsDoc[]
        for (const target of targets) {
          if (target.get('providerType') !== 'push') {
            continue
          }
          target
            .set('sessionId', createdSession.getId())
            .set('sessionInternalId', createdSession.getSequence())
          await this.db.updateDocument('targets', target.getId(), target)
        }
      }

      this.eventEmitter.emit(AppEvents.SESSION_CREATE, {
        userId: user.getId(),
        sessionId: createdSession.getId(),
        payload: {
          data: createdSession,
          type: Models.SESSION,
        },
      })
    }

    await this.db.purgeCachedDocument('users', user.getId())

    parsedState.search = query.toString()
    const finalSuccessUrl = parsedState.toString()

    response
      .status(302)
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .header('Pragma', 'no-cache')
      .redirect(finalSuccessUrl)
  }

  /**
   * Create oAuth2 Token.
   */
  async createOAuth2Token({
    input,
    request,
    response,
    provider,
  }: {
    input: CreateOAuth2TokenDTO
    request: NuvixRequest
    response: NuvixRes
    provider: OAuthProviders
  }) {
    const ctx = request.context
    const protocol = request.protocol

    if (input.success) ctx.validateRedirectURL(input.success)
    if (input.failure) ctx.validateRedirectURL(input.failure)

    const success = input.success || ''
    const failure = input.failure || ''
    const scopes = input.scopes || []

    const callback = `${protocol}://${request.host}/v1/account/sessions/oauth2/callback/${provider}`
    const providerInfo = this.getProviderConfig(ctx.project, provider)
    const providerEnabled = providerInfo.enabled ?? false

    if (!providerEnabled) {
      throw new Exception(Exception.PROJECT_PROVIDER_DISABLED)
    }

    const appId = providerInfo.appId
    const appSecret = Auth.decryptIfDefined(providerInfo.secret)

    if (!appId || !appSecret) {
      throw new Exception(
        Exception.PROJECT_PROVIDER_DISABLED,
        `This provider is disabled. Please configure the provider app ID and app secret key from your ${configuration.app.name} console to continue.`,
      )
    }

    const AuthClass = await getOAuth2Class(provider)
    if (!AuthClass) {
      throw new Exception(Exception.PROJECT_PROVIDER_UNSUPPORTED)
    }

    const finalSuccess =
      success ||
      `${protocol}://${request.host}${SessionService.oauthDefaultSuccess}`
    const finalFailure =
      failure ||
      `${protocol}://${request.host}${SessionService.oauthDefaultFailure}`

    const oauth2 = new AuthClass(
      appId,
      appSecret,
      callback,
      {
        success: finalSuccess,
        failure: finalFailure,
        token: true,
      },
      scopes,
    )

    response
      .status(302)
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .header('Pragma', 'no-cache')
      .redirect(oauth2.getLoginURL())
  }

  /**
   * Create Magic-URL Token.
   */
  async createMagicURLToken({
    user,
    input,
    request,
  }: {
    user: UsersDoc
    input: CreateMagicURLTokenDTO
    request: NuvixRequest
  }) {
    if (!configuration.smtp.enabled()) {
      throw new Exception(Exception.GENERAL_SMTP_DISABLED)
    }

    const ctx = request.context
    const {
      userId,
      email,
      url: inputUrl = '',
      phrase: inputPhrase = false,
    } = input

    if (inputUrl) ctx.validateRedirectURL(inputUrl)

    let url = inputUrl
    let phrase: string | undefined

    if (inputPhrase === true) {
      phrase = PhraseGenerator.generate()
    }

    const result = await this.db.findOne('users', [
      Query.equal('email', [email]),
    ])
    if (!result.empty()) {
      user.setAll(result.toObject())
    } else {
      const limit = ctx.project.get('auths', {}).limit ?? 0
      const maxUsers = configuration.limits.users

      if (limit !== 0) {
        const total = await this.db.count('users', [], maxUsers)

        if (total >= limit) {
          throw new Exception(Exception.USER_COUNT_EXCEEDED)
        }
      }

      // Makes sure this email is not already used in another identity
      const identityWithMatchingEmail = await this.db.findOne('identities', [
        Query.equal('providerEmail', [email]),
      ])
      if (!identityWithMatchingEmail.empty()) {
        throw new Exception(Exception.USER_EMAIL_ALREADY_EXISTS)
      }

      const finalUserId = userId === 'unique()' ? ID.unique() : userId

      user.setAll({
        $id: finalUserId,
        $permissions: [
          Permission.read(Role.any()),
          Permission.update(Role.user(finalUserId)),
          Permission.delete(Role.user(finalUserId)),
        ],
        email: email,
        emailVerification: false,
        status: true,
        hash: Auth.DEFAULT_ALGO,
        hashOptions: Auth.DEFAULT_ALGO_OPTIONS,
        registration: new Date(),
        reset: false,
        mfa: false,
        prefs: {},
        search: [finalUserId, email].join(' '),
        accessedAt: new Date(),
      })

      user.delete('$sequence')
      await Authorization.skip(() => this.db.createDocument('users', user))
    }

    const tokenSecret = Auth.tokenGenerator(Auth.TOKEN_LENGTH_MAGIC_URL)
    const expire = new Date(Date.now() + Auth.TOKEN_EXPIRATION_CONFIRM * 1000)

    const token = new Doc<Tokens>({
      $id: ID.unique(),
      userId: user.getId(),
      userInternalId: user.getSequence(),
      type: TokenType.MAGIC_URL,
      secret: Auth.hash(tokenSecret), // One way hash encryption to protect DB leak
      expire: expire,
      userAgent: request.headers['user-agent'] || 'UNKNOWN',
      ip: request.ip,
    })

    Authorization.setRole(Role.user(user.getId()).toString())

    token.set('$permissions', [
      Permission.read(Role.user(user.getId())),
      Permission.update(Role.user(user.getId())),
      Permission.delete(Role.user(user.getId())),
    ])
    const createdToken = await this.db.createDocument('tokens', token)

    await this.db.purgeCachedDocument('users', user.getId())

    if (!url) {
      url = `${request.protocol}://${request.host}${SessionService.magicAuthDefaultPath}`
    }

    // Parse and merge URL query parameters
    const urlObj = new URL(url)
    urlObj.searchParams.set('userId', user.getId())
    urlObj.searchParams.set('secret', tokenSecret)
    urlObj.searchParams.set('expire', expire.toISOString())
    url = urlObj.toString()

    const project = ctx.project
    const locale = ctx.translator()
    const detector = ctx.detector(request.headers['user-agent'])
    const agentOs = detector.getOS()
    const agentClient = detector.getClient()
    const agentDevice = detector.getDevice()

    const projectName = project.get('name')
    const payload = await this.emailHelper
      .builder(project)
      .to(email)
      .withSubject(
        locale.t('emails.magicSession.subject', { project: projectName }),
      )
      .usingTemplate(
        'email-magic-url.tpl',
        `magicSession-${locale.fallbackLocale}`,
      )
      .withData({
        hello: locale.get('emails.magicSession.hello', {
          user: user.get('name', 'User'),
        }),
        optionButton: locale.get('emails.magicSession.optionButton', {
          project: projectName,
        }),
        buttonText: locale.get('emails.magicSession.buttonText', {
          project: projectName,
        }),
        optionUrl: locale.get('emails.magicSession.optionUrl'),
        clientInfo: locale.get('emails.magicSession.clientInfo', {
          agentClient: agentClient.clientName || 'UNKNOWN',
          agentDevice: agentDevice.deviceBrand || 'UNKNOWN',
          agentOs: agentOs.osName || 'UNKNOWN',
        }),
        thanks: locale.get('emails.magicSession.thanks'),
        signature: locale.get('emails.magicSession.signature', {
          project: projectName,
        }),
        securityPhrase: phrase
          ? locale.get('emails.magicSession.securityPhrase', { phrase })
          : '',
      })
      .withVariables({
        direction: locale.get('settings.direction'),
        user: user.get('name', 'User'),
        project: projectName,
        redirect: url,
      })
      .build()

    await this.mailsQueue.add(MailJob.SEND_EMAIL, payload)

    createdToken.set('secret', tokenSecret)

    if (phrase) {
      createdToken.set('phrase', phrase)
    }

    return createdToken
  }

  /**
   * Create Email Token.
   */
  async createEmailToken({
    user,
    input,
    request,
  }: {
    user: UsersDoc
    input: CreateEmailTokenDTO
    request: NuvixRequest
  }) {
    if (!configuration.smtp.enabled()) {
      throw new Exception(Exception.GENERAL_SMTP_DISABLED)
    }

    const ctx = request.context
    const { userId, email, phrase: inputPhrase = false } = input
    let phrase: string | undefined

    if (inputPhrase === true) {
      phrase = PhraseGenerator.generate()
    }

    const result = await this.db.findOne('users', [
      Query.equal('email', [email]),
    ])
    if (!result.empty()) {
      user.setAll(result.toObject())
    } else {
      const limit = ctx.project.get('auths', {}).limit ?? 0
      const maxUsers = configuration.limits.users

      if (limit !== 0) {
        const total = await this.db.count('users', [], maxUsers)

        if (total >= limit) {
          throw new Exception(Exception.USER_COUNT_EXCEEDED)
        }
      }

      // Makes sure this email is not already used in another identity
      const identityWithMatchingEmail = await this.db.findOne('identities', [
        Query.equal('providerEmail', [email]),
      ])
      if (!identityWithMatchingEmail.empty()) {
        throw new Exception(Exception.GENERAL_BAD_REQUEST) // Return a generic bad request to prevent exposing existing accounts
      }

      const finalUserId = userId === 'unique()' ? ID.unique() : userId

      user.setAll({
        $id: finalUserId,
        $permissions: [
          Permission.read(Role.any()),
          Permission.update(Role.user(finalUserId)),
          Permission.delete(Role.user(finalUserId)),
        ],
        email: email,
        emailVerification: false,
        status: true,
        hash: Auth.DEFAULT_ALGO,
        hashOptions: Auth.DEFAULT_ALGO_OPTIONS,
        registration: new Date(),
        reset: false,
        prefs: {},
        search: [finalUserId, email].join(' '),
        accessedAt: new Date(),
      })

      user.delete('$sequence')
      await Authorization.skip(() => this.db.createDocument('users', user))
    }

    const tokenSecret = Auth.codeGenerator(6)
    const expire = new Date(Date.now() + Auth.TOKEN_EXPIRATION_OTP * 1000)

    const token = new Doc<Tokens>({
      $id: ID.unique(),
      userId: user.getId(),
      userInternalId: user.getSequence(),
      type: TokenType.EMAIL,
      secret: Auth.hash(tokenSecret), // One way hash encryption to protect DB leak
      expire: expire,
      userAgent: request.headers['user-agent'] || 'UNKNOWN',
      ip: request.ip,
    })

    Authorization.setRole(Role.user(user.getId()).toString())

    const createdToken = await this.db.createDocument(
      'tokens',
      token.set('$permissions', [
        Permission.read(Role.user(user.getId())),
        Permission.update(Role.user(user.getId())),
        Permission.delete(Role.user(user.getId())),
      ]),
    )

    await this.db.purgeCachedDocument('users', user.getId())

    const locale = ctx.translator()
    const project = ctx.project
    const detector = ctx.detector(request.headers['user-agent'])
    const agentOs = detector.getOS()
    const agentClient = detector.getClient()
    const agentDevice = detector.getDevice()

    const projectName = project.get('name')
    const payload = await this.emailHelper
      .builder(project)
      .to(email)
      .usingTemplate('email-otp.tpl', `otpSession-${locale.fallbackLocale}`)
      .withSubject(
        locale.t('emails.otpSession.subject', { project: projectName }),
      )
      .withData({
        hello: locale.t('emails.otpSession.hello', {
          user: user.get('name', 'User'),
        }),
        description: locale.t('emails.otpSession.description', {
          project: projectName,
        }),
        clientInfo: locale.t('emails.otpSession.clientInfo', {
          agentClient: agentClient.clientName || 'UNKNOWN',
          agentDevice: agentDevice.deviceBrand || 'UNKNOWN',
          agentOs: agentOs.osName || 'UNKNOWN',
        }),
        thanks: locale.t('emails.otpSession.thanks'),
        signature: locale.t('emails.otpSession.signature', {
          project: projectName,
        }),
        securityPhrase: phrase
          ? locale.t('emails.otpSession.securityPhrase', { phrase })
          : '',
      })
      .withVariables({
        direction: locale.t('settings.direction'),
        user: user.get('name'),
        project: project.get('name'),
        otp: tokenSecret,
      })
      .build()

    await this.mailsQueue.add(MailJob.SEND_EMAIL, payload)

    createdToken.set('secret', tokenSecret)

    if (phrase) {
      createdToken.set('phrase', phrase)
    }

    return createdToken
  }

  /**
   * Create Phone Token.
   */
  async createPhoneToken({
    user,
    input,
    request,
  }: {
    user: UsersDoc
    input: CreatePhoneTokenDTO
    request: NuvixRequest
  }) {
    // Check if SMS provider is configured
    if (!configuration.sms.enabled) {
      throw new Exception(Exception.GENERAL_PHONE_DISABLED)
    }

    const ctx = request.context
    const { userId, phone } = input
    const result = await this.db.findOne('users', [
      Query.equal('phone', [phone]),
    ])

    if (!result.empty()) {
      user.setAll(result.toObject())
    } else {
      const limit = ctx.project.get('auths', {}).limit ?? 0
      const maxUsers = configuration.limits.users

      if (limit !== 0) {
        const total = await this.db.count('users', [], maxUsers)

        if (total >= limit) {
          throw new Exception(Exception.USER_COUNT_EXCEEDED)
        }
      }

      const finalUserId = userId === 'unique()' ? ID.unique() : userId
      user.setAll({
        $id: finalUserId,
        $permissions: [
          Permission.read(Role.any()),
          Permission.update(Role.user(finalUserId)),
          Permission.delete(Role.user(finalUserId)),
        ],
        phone: phone,
        emailVerification: false,
        phoneVerification: false,
        status: true,
        registration: new Date(),
        reset: false,
        prefs: {},
        search: [finalUserId, phone].join(' '),
        accessedAt: new Date(),
      })

      user.delete('$sequence')
      await Authorization.skip(() => this.db.createDocument('users', user))

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
              providerType: MessageType.SMS,
              identifier: phone,
            }),
          ),
        )
        user.set('targets', [...user.get('targets', []), target])
      } catch (error) {
        if (error instanceof DuplicateException) {
          const existingTarget = await this.db.findOne('targets', [
            Query.equal('identifier', [phone]),
          ])
          if (existingTarget && !existingTarget.empty()) {
            user.set('targets', [...user.get('targets', []), existingTarget])
          }
        }
      }
      await this.db.purgeCachedDocument('users', user.getId())
    }

    let secret: string | null = null
    let sendSMS = true
    const mockNumbers = ctx.project.get('auths', {}).mockNumbers ?? []

    for (const mockNumber of mockNumbers) {
      if (mockNumber.phone === phone) {
        secret = mockNumber.otp
        sendSMS = false
        break
      }
    }

    secret = secret ?? Auth.codeGenerator(6)
    const expire = new Date(Date.now() + Auth.TOKEN_EXPIRATION_OTP * 1000)

    const token = new Doc<Tokens>({
      $id: ID.unique(),
      userId: user.getId(),
      userInternalId: user.getSequence(),
      type: TokenType.PHONE,
      secret: Auth.hash(secret),
      expire: expire,
      userAgent: request.headers['user-agent'] || 'UNKNOWN',
      ip: request.ip,
    })

    Authorization.setRole(Role.user(user.getId()).toString())

    const createdToken = await this.db.createDocument(
      'tokens',
      token.set('$permissions', [
        Permission.read(Role.user(user.getId())),
        Permission.update(Role.user(user.getId())),
        Permission.delete(Role.user(user.getId())),
      ]),
    )
    await this.db.purgeCachedDocument('users', user.getId())

    if (sendSMS) {
      const locale = ctx.translator()
      const customTemplate =
        ctx.project.get('templates', {})[
          `sms.login-${locale.fallbackLocale}`
        ] ?? {}

      let message = locale.get('sms.verification.body', { secret })
      if (customTemplate?.message) {
        message = customTemplate.message
      }

      const messageContent = message
        .replace('{{project}}', ctx.project.get('name'))
        .replace('{{secret}}', secret)

      await this.messagingQueue.add(MessagingJob.INTERNAL, {
        message: {
          to: [phone],
          data: {
            content: messageContent,
          },
        },
      })
    }

    createdToken.set('secret', secret)

    return createdToken
  }

  /**
   * Create JWT
   */
  async createJWT(user: UsersDoc, ctx: RequestContext) {
    const current = ctx.session ?? new Doc()

    if (current.empty()) {
      throw new Exception(Exception.USER_SESSION_NOT_FOUND)
    }

    const payload = {
      userId: user.getId(),
      sessionId: current.getId(),
    }

    const jwt = this.jwtService.sign(payload, {
      expiresIn: '15m', // 900 seconds
    })

    return new Doc({ jwt })
  }

  /**
   * Send Session Alert.
   */
  async sendSessionAlert(
    user: UsersDoc,
    session: SessionsDoc,
    ctx: RequestContext,
  ) {
    const project = ctx.project
    const locale = ctx.translator()
    const projectName = project.get('name')
    const key = countryKey(session.get('countryCode'))
    const country = (
      locale.has(key) ? locale.getRaw(key) : locale.t('locale.country.unknown')
    ) as string

    const payload = await this.emailHelper
      .builder(project)
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

  /**
   * Create Session
   */
  async createSession({
    user,
    input,
    request,
    response,
  }: {
    user: UsersDoc
    input: CreateSessionDTO
    request: NuvixRequest
    response: NuvixRes
  }) {
    const userFromRequest = await Authorization.skip(() =>
      this.db.getDocument('users', input.userId),
    )

    if (userFromRequest.empty()) {
      throw new Exception(Exception.USER_INVALID_TOKEN)
    }

    const verifiedToken = Auth.tokenVerify(
      userFromRequest.get('tokens', []),
      null,
      input.secret,
    )

    if (!verifiedToken) {
      throw new Exception(Exception.USER_INVALID_TOKEN)
    }

    user.setAll(userFromRequest.toObject())

    const ctx = request.context

    const duration =
      ctx.project.get('auths', {}).duration ?? Auth.TOKEN_EXPIRATION_LOGIN_LONG
    const detector = ctx.detector(request.headers['user-agent'])
    const record = this.geodb.get(request.ip)
    const sessionSecret = Auth.tokenGenerator(Auth.TOKEN_LENGTH_SESSION)

    const tokenType = verifiedToken.get('type')
    let factor: string

    switch (tokenType) {
      case TokenType.MAGIC_URL:
      case TokenType.OAUTH2:
      case TokenType.EMAIL:
        factor = AuthFactor.EMAIL
        break
      case TokenType.PHONE:
        factor = AuthFactor.PHONE
        break
      case TokenType.GENERIC:
        factor = AuthFactor.TOKEN
        break
      default:
        throw new Exception(Exception.USER_INVALID_TOKEN)
    }

    const session = new Doc<Sessions>({
      $id: ID.unique(),
      userId: user.getId(),
      userInternalId: user.getSequence(),
      provider: Auth.getSessionProviderByTokenType(verifiedToken.get('type')),
      secret: Auth.hash(sessionSecret),
      userAgent: request.headers['user-agent'] || 'UNKNOWN',
      ip: request.ip,
      factors: [factor],
      countryCode: record?.country?.iso_code.toLowerCase(),
      expire: new Date(Date.now() + duration * 1000),
      ...detector.getOS(),
      ...detector.getClient(),
      ...detector.getDevice(),
    })

    Authorization.setRole(Role.user(user.getId()).toString())

    session.set('$permissions', [
      Permission.read(Role.user(user.getId())),
      Permission.update(Role.user(user.getId())),
      Permission.delete(Role.user(user.getId())),
    ])
    const createdSession = await this.db.createDocument('sessions', session)

    await Authorization.skip(() =>
      this.db.deleteDocument('tokens', verifiedToken.getId()),
    )
    await this.db.purgeCachedDocument('users', user.getId())

    // Magic URL + Email OTP
    if (tokenType === TokenType.MAGIC_URL || tokenType === TokenType.EMAIL) {
      user.set('emailVerification', true)
    }

    if (tokenType === TokenType.PHONE) {
      user.set('phoneVerification', true)
    }

    try {
      await this.db.updateDocument('users', user.getId(), user)
    } catch (_error) {
      throw new Exception(
        Exception.GENERAL_SERVER_ERROR,
        'Failed saving user to DB',
      )
    }

    const isAllowedTokenType =
      tokenType !== TokenType.MAGIC_URL && tokenType !== TokenType.EMAIL
    const hasUserEmail = user.get('email', false) !== false
    const isSessionAlertsEnabled =
      ctx.project.get('auths', {}).sessionAlerts ?? false

    const sessionCount = await this.db.count('sessions', [
      Query.equal('userId', [user.getId()]),
    ])
    const isNotFirstSession = sessionCount !== 1

    if (
      isAllowedTokenType &&
      hasUserEmail &&
      isSessionAlertsEnabled &&
      isNotFirstSession
    ) {
      await this.sendSessionAlert(user, createdSession, ctx)
    }

    this.eventEmitter.emit(AppEvents.SESSION_CREATE, {
      userId: user.getId(),
      sessionId: createdSession.getId(),
      payload: {
        data: createdSession,
        type: Models.SESSION,
      },
    })

    if (configuration.server.fallbackCookies) {
      response.header(
        'X-Fallback-Cookies',
        JSON.stringify({
          [Auth.cookieName]: Auth.encodeSession(user.getId(), sessionSecret),
        }),
      )
    }

    const expire = new Date(Date.now() + duration * 1000)
    const protocol = request.protocol

    response
      .cookie(
        Auth.cookieName,
        Auth.encodeSession(user.getId(), sessionSecret),
        {
          expires: expire,
          path: '/',
          domain: ctx.cookieDomain,
          secure: protocol === 'https',
          httpOnly: true,
          sameSite: ctx.cookieSameSite,
        },
      )
      .status(201)

    const locale = ctx.translator()
    const key = countryKey(createdSession.get('countryCode'))
    const countryName = locale.has(key)
      ? locale.getRaw(key)
      : locale.t('locale.country.unknown')

    createdSession
      .set('current', true)
      .set('countryName', countryName)
      .set('expire', expire.toISOString())
      .set('secret', sessionSecret)

    return createdSession
  }

  private getProviderConfig(project: ProjectsDoc, provider: string) {
    const providers = project.get('oAuthProviders', []) as OAuthProviderType[]
    const _provider = providers.find(p => p.key === provider)

    if (!_provider) {
      throw new Exception(Exception.PROJECT_PROVIDER_UNSUPPORTED) // TODO: improve & clear error
    }

    return _provider
  }
}

const countryKey = (code?: string | null) =>
  `countries.${(code || '').toLowerCase()}`
