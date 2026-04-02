import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'

import { Exception } from '@nuvix/core/extend/exception'
import { Hooks } from '@nuvix/core/extend/hooks'
import {
  Auth,
  EmailHelper,
  LocaleTranslator,
  RequestContext,
} from '@nuvix/core/helpers'
import {
  DeletesJobData,
  MessagingJob,
  MessagingJobInternalData,
} from '@nuvix/core/resolvers'
import { MailJob, MailQueueOptions } from '@nuvix/core/resolvers'
import {
  PasswordHistoryValidator,
  PersonalDataValidator,
} from '@nuvix/core/validators'
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
  TokenType,
} from '@nuvix/utils'
import type {
  TargetsDoc,
  Tokens,
  TokensDoc,
  UsersDoc,
} from '@nuvix/utils/types'
import { Queue } from 'bullmq'
import { UpdateEmailDTO } from './DTO/account.dto'
import { CoreService } from '@nuvix/core/core.service'

@Injectable()
export class AccountService {
  private readonly db: Database
  private readonly emailHelper = new EmailHelper()
  constructor(
    private readonly eventEmitter: EventEmitter2,
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
    private readonly coreService: CoreService,
  ) {
    this.db = this.coreService.getDatabase()
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
    ctx: RequestContext,
  ): Promise<UsersDoc> {
    email = email.toLowerCase()

    const auths = ctx.project.get('auths', {})
    const limit = auths.limit ?? 0
    const maxUser = configuration.limits.users

    if (limit !== 0) {
      const total = await this.db.count('users', [], maxUser)
      if (total >= limit) {
        throw new Exception(Exception.USER_COUNT_EXCEEDED)
      }
    }

    // Makes sure this email is not already used in another identity
    const identityWithMatchingEmail = await this.db.findOne('identities', qb =>
      qb.equal('providerEmail', email),
    )

    if (identityWithMatchingEmail && !identityWithMatchingEmail.empty()) {
      throw new Exception(Exception.GENERAL_BAD_REQUEST) // Return a generic bad request to prevent exposing existing accounts
    }

    if (auths.personalDataCheck ?? false) {
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

    await Hooks.trigger('passwordValidator', [password, user, true])

    const passwordHistory = auths.passwordHistory ?? 0
    const hashedPassword = await Auth.passwordHash(
      password,
      Auth.DEFAULT_ALGO,
      Auth.DEFAULT_ALGO_OPTIONS,
    )

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
        emailVerification: false,
        phoneVerification: false,
        status: true,
        password: hashedPassword ?? undefined,
        passwordHistory:
          passwordHistory > 0 ? ([hashedPassword] as string[]) : [],
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
            }),
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
      throw error
    }

    Authorization.unsetRole(Role.guests().toString())
    Authorization.setRole(Role.user(user.getId()).toString())
    Authorization.setRole(Role.users().toString())

    const createdUser = await this.db.getDocument('users', user.getId())

    this.eventEmitter.emit(AppEvents.ACCOUNT_CREATE, {
      userId: createdUser.getId(),
      payload: {
        data: createdUser,
      },
    })

    return createdUser
  }

  async updatePrefs(
    user: UsersDoc,
    prefs: Record<string, string | number | boolean>,
  ) {
    user.set('prefs', prefs)

    user = await this.db.updateDocument('users', user.getId(), user)

    this.eventEmitter.emit(AppEvents.ACCOUNT_UPDATE_PREFS, {
      userId: user.getId(),
      payload: {
        data: user,
      },
    })

    return user.get('prefs', {})
  }

  async deleteAccount(user: UsersDoc) {
    if (user.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    if (user.get('status') === false) {
      throw new Exception(Exception.USER_BLOCKED)
    }

    const userId = user.getId()

    await this.db.deleteDocument('users', userId)

    await this.deletesQueue.add(DeleteType.DOCUMENT, {
      document: user.clone(),
    })

    this.eventEmitter.emit(AppEvents.ACCOUNT_DELETE, {
      userId,
    })
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

    const identityWithMatchingEmail = await this.db.findOne('identities', [
      Query.equal('providerEmail', [email]),
      Query.notEqual('userInternalId', user.getSequence()),
    ])

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
        (t: TargetsDoc) => t.get('identifier') === oldEmail,
      )

      if (oldTarget && !oldTarget.empty()) {
        await Authorization.skip(
          async () =>
            await this.db.updateDocument(
              'targets',
              oldTarget.getId(),
              oldTarget.set('identifier', email),
            ),
        )
      }
      await this.db.purgeCachedDocument('users', user.getId())

      this.eventEmitter.emit(AppEvents.ACCOUNT_UPDATE_EMAIL, {
        userId: user.getId(),
        payload: {
          data: user,
        },
      })

      return user
    } catch (error) {
      if (error instanceof DuplicateException) {
        throw new Exception(Exception.GENERAL_BAD_REQUEST)
      }
      throw error
    }
  }

  /**
   * Update User Name.
   */
  async updateName(name: string, user: UsersDoc) {
    user.set('name', name)

    user = await this.db.updateDocument('users', user.getId(), user)

    this.eventEmitter.emit(AppEvents.ACCOUNT_UPDATE_NAME, {
      userId: user.getId(),
      payload: {
        data: user,
      },
    })

    return user
  }

  /**
   * Update user password.
   */
  async updatePassword({
    password,
    oldPassword,
    user,
    ctx,
  }: {
    password: string
    oldPassword: string
    user: UsersDoc
    ctx: RequestContext
  }) {
    // passwordUpdate will be empty if the user has never set a password
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

    const newPassword = await Auth.passwordHash(
      password,
      Auth.DEFAULT_ALGO,
      Auth.DEFAULT_ALGO_OPTIONS,
    )
    const historyLimit = ctx.project.get('auths', {}).passwordHistory ?? 0
    const history = user.get('passwordHistory', [])

    if (newPassword && historyLimit > 0) {
      const validator = new PasswordHistoryValidator(
        history,
        user.get('hash') as HashAlgorithm,
        user.get('hashOptions'),
      )
      if (!(await validator.$valid(password))) {
        throw new Exception(Exception.USER_PASSWORD_RECENTLY_USED)
      }

      history.push(newPassword)
      history.splice(0, Math.max(0, history.length - historyLimit))
    }

    if (ctx.project.get('auths', {}).personalDataCheck ?? false) {
      const personalDataValidator = new PersonalDataValidator(
        user.getId(),
        user.get('email'),
        user.get('name'),
        user.get('phone'),
      )
      if (!personalDataValidator.$valid(password)) {
        throw new Exception(Exception.USER_PASSWORD_PERSONAL_DATA)
      }
    }

    await Hooks.trigger('passwordValidator', [password, user, true])

    user
      .set('password', newPassword)
      .set('passwordHistory', history)
      .set('passwordUpdate', new Date())
      .set('hash', Auth.DEFAULT_ALGO)
      .set('hashOptions', Auth.DEFAULT_ALGO_OPTIONS)

    user = await this.db.updateDocument('users', user.getId(), user)

    this.eventEmitter.emit(AppEvents.ACCOUNT_UPDATE_PASSWORD, {
      userId: user.getId(),
      payload: {
        data: user,
      },
    })

    return user
  }

  /**
   * Update User's Phone.
   */
  async updatePhone({
    password,
    phone,
    user,
  }: {
    password: string
    phone: string
    user: UsersDoc
  }) {
    // passwordUpdate will be empty if the user has never set a password
    const passwordUpdate = user.get('passwordUpdate')

    if (
      passwordUpdate &&
      !(await Auth.passwordVerify(
        password,
        user.get('password'),
        user.get('hash') as HashAlgorithm,
        user.get('hashOptions'),
      ))
    ) {
      // Double check user password
      throw new Exception(Exception.USER_INVALID_CREDENTIALS)
    }

    await Hooks.trigger('passwordValidator', [password, user, false])

    const target = await Authorization.skip(
      async () =>
        await this.db.findOne('targets', [Query.equal('identifier', [phone])]),
    )

    if (!target.empty()) {
      throw new Exception(Exception.USER_TARGET_ALREADY_EXISTS)
    }

    const oldPhone = user.get('phone')

    user.set('phone', phone).set('phoneVerification', false) // After this user needs to confirm phone number again

    if (!passwordUpdate) {
      const hashedPassword = await Auth.passwordHash(
        password,
        Auth.DEFAULT_ALGO,
        Auth.DEFAULT_ALGO_OPTIONS,
      )
      user
        .set('password', hashedPassword)
        .set('hash', Auth.DEFAULT_ALGO)
        .set('hashOptions', Auth.DEFAULT_ALGO_OPTIONS)
        .set('passwordUpdate', new Date())
    }

    try {
      user = await this.db.updateDocument('users', user.getId(), user)
      const oldTarget = user.findWhere(
        'targets',
        (t: TargetsDoc) => t.get('identifier') === oldPhone,
      )

      if (oldTarget && !oldTarget.empty()) {
        await Authorization.skip(() =>
          this.db.updateDocument(
            'targets',
            oldTarget.getId(),
            oldTarget.set('identifier', phone),
          ),
        )
      }
      await this.db.purgeCachedDocument('users', user.getId())
    } catch (error) {
      if (error instanceof DuplicateException) {
        throw new Exception(Exception.USER_PHONE_ALREADY_EXISTS)
      }
      throw error
    }

    this.eventEmitter.emit(AppEvents.ACCOUNT_UPDATE_PHONE, {
      userId: user.getId(),
      payload: {
        data: user,
      },
    })

    return user
  }

  /**
   * Update Status
   */
  async updateStatus({
    user,
    request,
    response,
  }: {
    user: UsersDoc
    request: NuvixRequest
    response: NuvixRes
  }) {
    user.set('status', false)

    user = await this.db.updateDocument('users', user.getId(), user)

    if (configuration.server.fallbackCookies) {
      response.header('X-Fallback-Cookies', JSON.stringify({}))
    }

    const protocol = request.protocol
    response.cookie(Auth.cookieName, '', {
      expires: new Date(Date.now() - 3600000),
      path: '/',
      domain: request.context.cookieDomain,
      secure: protocol === 'https',
      httpOnly: true,
      sameSite: request.context.cookieSameSite,
    })

    this.eventEmitter.emit(AppEvents.ACCOUNT_UPDATE_STATUS, {
      userId: user.getId(),
      payload: {
        data: user,
      },
    })

    return user
  }

  /**
   * Create email verification token
   */
  async createEmailVerification({
    user,
    request,
    locale,
    url,
  }: WithUser<WithLocale<{ url?: string; request: NuvixRequest }>>) {
    if (url) request.context.validateRedirectURL(url)

    if (!configuration.smtp.enabled()) {
      throw new Exception(Exception.GENERAL_SMTP_DISABLED)
    }

    if (user.get('emailVerification')) {
      throw new Exception(Exception.USER_EMAIL_ALREADY_VERIFIED)
    }

    const verificationSecret = Auth.tokenGenerator(
      Auth.TOKEN_LENGTH_VERIFICATION,
    )
    const expire = new Date(Date.now() + Auth.TOKEN_EXPIRATION_CONFIRM * 1000)

    const verification = new Doc<Tokens>({
      $id: ID.unique(),
      userId: user.getId(),
      userInternalId: user.getSequence(),
      type: TokenType.VERIFICATION,
      secret: Auth.hash(verificationSecret), // One way hash encryption to protect DB leak
      expire: expire,
      userAgent: request.headers['user-agent'] || 'UNKNOWN',
      ip: request.ip,
    })

    Authorization.setRole(Role.user(user.getId()).toString())

    verification.set('$permissions', [
      Permission.read(Role.user(user.getId())),
      Permission.update(Role.user(user.getId())),
      Permission.delete(Role.user(user.getId())),
    ])
    const createdVerification = await this.db.createDocument(
      'tokens',
      verification,
    )

    await this.db.purgeCachedDocument('users', user.getId())
    url ??= `${request.protocol}://${request.host}`

    const urlObj = new URL(url)
    urlObj.searchParams.set('userId', user.getId())
    urlObj.searchParams.set('secret', verificationSecret)
    urlObj.searchParams.set('expire', expire.toISOString())
    const finalUrl = urlObj.toString()

    const { project } = request.context
    const payload = await this.emailHelper
      .builder(project)
      .to(user.get('email'))
      .usingTemplate(
        'email-verification.tpl',
        `verification-${locale.fallbackLocale}`,
      )
      .withSubject(locale.get('emails.verification.subject'))
      .withData({
        body: locale.get('emails.verification.body', {
          project: project.get('name'),
        }),
        hello: locale.get('emails.verification.hello', {
          user: user.get('name', 'User'),
        }),
        footer: locale.get('emails.verification.footer'),
        thanks: locale.get('emails.verification.thanks'),
        signature: locale.get('emails.verification.signature', {
          project: project.get('name'),
        }),
      })
      .withVariables({
        direction: locale.get('settings.direction'),
        redirect: finalUrl,
        project: project.get('name'),
        team: '',
      })
      .build()

    await this.mailsQueue.add(MailJob.SEND_EMAIL, payload)

    createdVerification.set('secret', verificationSecret)

    this.eventEmitter.emit(AppEvents.ACCOUNT_VERIFICATION_CREATE, {
      userId: user.getId(),
      payload: {
        data: createdVerification,
      },
    })

    return createdVerification
  }

  /**
   * Verify email
   */
  async updateEmailVerification({
    user,
    userId,
    secret,
  }: WithUser<{ userId: string; secret: string }>) {
    const profile = await Authorization.skip(() =>
      this.db.getDocument('users', userId),
    )

    if (profile.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    const tokens = profile.get('tokens', []) as TokensDoc[]
    const verifiedToken = Auth.tokenVerify(
      tokens,
      TokenType.VERIFICATION,
      secret,
    )

    if (!verifiedToken) {
      throw new Exception(Exception.USER_INVALID_TOKEN)
    }

    Authorization.setRole(Role.user(profile.getId()).toString())

    const updatedProfile = await this.db.updateDocument(
      'users',
      profile.getId(),
      profile.set('emailVerification', true),
    )

    user.setAll(updatedProfile.toObject())

    const verification = await this.db.getDocument(
      'tokens',
      verifiedToken.getId(),
    )

    /**
     * We act like we're updating and validating
     * the verification token but actually we don't need it anymore.
     */
    await this.db.deleteDocument('tokens', verifiedToken.getId())
    await this.db.purgeCachedDocument('users', profile.getId())

    this.eventEmitter.emit(AppEvents.ACCOUNT_VERIFICATION_UPDATE, {
      userId: profile.getId(),
      payload: {
        data: verification,
      },
    })

    return verification
  }

  /**
   * Create phone verification token
   */
  async createPhoneVerification({
    user,
    request,
    locale,
  }: WithUser<WithLocale<{ request: NuvixRequest }>>) {
    // Check if SMS provider is configured
    if (!configuration.sms.enabled) {
      throw new Exception(Exception.GENERAL_PHONE_DISABLED)
    }

    const phone = user.get('phone')
    if (!phone) {
      throw new Exception(Exception.USER_PHONE_NOT_FOUND)
    }

    if (user.get('phoneVerification')) {
      throw new Exception(Exception.USER_PHONE_ALREADY_VERIFIED)
    }

    let secret: string | null = null
    let sendSMS = true
    const mockNumbers =
      request.context.project.get('auths', {}).mockNumbers ?? []

    for (const mockNumber of mockNumbers) {
      if (mockNumber.phone === phone) {
        secret = mockNumber.otp
        sendSMS = false
        break
      }
    }

    secret = secret ?? Auth.codeGenerator(6)
    const expire = new Date(Date.now() + Auth.TOKEN_EXPIRATION_OTP * 1000)

    const verification = new Doc<Tokens>({
      $id: ID.unique(),
      userId: user.getId(),
      userInternalId: user.getSequence(),
      type: TokenType.PHONE,
      secret: Auth.hash(secret), // One way hash encryption to protect DB leak
      expire: expire,
      userAgent: request.headers['user-agent'] || 'UNKNOWN',
      ip: request.ip,
    })

    Authorization.setRole(Role.user(user.getId()).toString())

    verification.set('$permissions', [
      Permission.read(Role.user(user.getId())),
      Permission.update(Role.user(user.getId())),
      Permission.delete(Role.user(user.getId())),
    ])
    const createdVerification = await this.db.createDocument(
      'tokens',
      verification,
    )

    await this.db.purgeCachedDocument('users', user.getId())

    if (sendSMS) {
      let message = locale.get('sms.verification.body', {
        secret: secret,
      })

      await this.messagingQueue.add(MessagingJob.INTERNAL, {
        message: {
          to: [phone],
          data: {
            content: message,
          },
        },
      })
    }

    createdVerification.set('secret', secret)

    this.eventEmitter.emit(AppEvents.ACCOUNT_VERIFICATION_CREATE, {
      userId: user.getId(),
      payload: {
        data: createdVerification,
      },
    })

    return createdVerification
  }

  /**
   * Verify phone number
   */
  async updatePhoneVerification({
    user,
    userId,
    secret,
  }: WithUser<{ userId: string; secret: string }>) {
    const profile = await Authorization.skip(() =>
      this.db.getDocument('users', userId),
    )

    if (profile.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    const tokens = profile.get('tokens', []) as TokensDoc[]
    const verifiedToken = Auth.tokenVerify(tokens, TokenType.PHONE, secret)

    if (!verifiedToken) {
      throw new Exception(Exception.USER_INVALID_TOKEN)
    }

    Authorization.setRole(Role.user(profile.getId()).toString())

    const updatedProfile = await this.db.updateDocument(
      'users',
      profile.getId(),
      profile.set('phoneVerification', true),
    )

    user.setAll(updatedProfile.toObject())

    const verificationDocument = await this.db.getDocument(
      'tokens',
      verifiedToken.getId(),
    )

    /**
     * We act like we're updating and validating the verification token but actually we don't need it anymore.
     */
    await this.db.deleteDocument('tokens', verifiedToken.getId())
    await this.db.purgeCachedDocument('users', profile.getId())

    this.eventEmitter.emit(AppEvents.ACCOUNT_VERIFICATION_UPDATE, {
      userId: profile.getId(),
      payload: {
        data: verificationDocument,
      },
    })

    return verificationDocument
  }
}

type WithUser<T = unknown> = { user: UsersDoc } & T
type WithLocale<T = unknown> = { locale: LocaleTranslator } & T
