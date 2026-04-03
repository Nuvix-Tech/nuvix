import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CoreService } from '@nuvix/core/core.service'
import { Exception } from '@nuvix/core/extend/exception'
import { Hooks } from '@nuvix/core/extend/hooks'
import { Auth, EmailHelper, RequestContext } from '@nuvix/core/helpers'
import { MailJob, MailQueueOptions } from '@nuvix/core/resolvers'
import { PasswordHistoryValidator } from '@nuvix/core/validators'
import {
  Authorization,
  Database,
  Doc,
  ID,
  Permission,
  Query,
  Role,
} from '@nuvix/db'
import {
  AppEvents,
  configuration,
  type HashAlgorithm,
  QueueFor,
  TokenType,
} from '@nuvix/utils'
import type { Tokens, TokensDoc, UsersDoc } from '@nuvix/utils/types'
import { Queue } from 'bullmq'
import { CreateRecoveryDTO, UpdateRecoveryDTO } from './DTO/recovery.dto'

@Injectable()
export class RecoveryService {
  private readonly db: Database
  private readonly emailHelper = new EmailHelper()

  constructor(
    private readonly coreService: CoreService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue(QueueFor.MAILS)
    private readonly mailsQueue: Queue<MailQueueOptions>,
  ) {
    this.db = this.coreService.getDatabase()
  }

  /**
   * Create Recovery
   */
  async createRecovery({
    user,
    request,
    input,
  }: WithUser<{
    input: CreateRecoveryDTO
    request: NuvixRequest
  }>): Promise<TokensDoc> {
    if (!configuration.smtp.enabled()) {
      throw new Exception(Exception.GENERAL_SMTP_DISABLED)
    }

    const ctx = request.context
    const email = input.email.toLowerCase()
    let url = input.url
    ctx.validateRedirectURL(url)

    const profile = await this.db.findOne('users', [
      Query.equal('email', [email]),
    ])

    if (profile.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    user.setAll(profile.toObject())

    if (profile.get('status') === false) {
      throw new Exception(Exception.USER_BLOCKED)
    }

    const expire = new Date(Date.now() + Auth.TOKEN_EXPIRATION_RECOVERY * 1000)
    const secret = Auth.tokenGenerator(Auth.TOKEN_LENGTH_RECOVERY)

    const recovery = new Doc<Tokens>({
      $id: ID.unique(),
      userId: profile.getId(),
      userInternalId: profile.getSequence(),
      type: TokenType.RECOVERY,
      secret: Auth.hash(secret), // One way hash encryption to protect DB leak
      expire: expire,
      userAgent: request.headers['user-agent'] || 'UNKNOWN',
      ip: request.ip,
    })

    Authorization.setRole(Role.user(profile.getId()).toString())

    recovery.set('$permissions', [
      Permission.read(Role.user(profile.getId())),
      Permission.update(Role.user(profile.getId())),
      Permission.delete(Role.user(profile.getId())),
    ])
    const createdRecovery = await this.db.createDocument('tokens', recovery)

    await this.db.purgeCachedDocument('users', profile.getId())

    // Parse and merge URL query parameters
    const urlObj = new URL(url)
    urlObj.searchParams.set('userId', profile.getId())
    urlObj.searchParams.set('secret', secret)
    urlObj.searchParams.set('expire', expire.toISOString())
    url = urlObj.toString()

    const project = ctx.project
    const projectName = project.get('name')
    const locale = ctx.translator()

    const payload = await this.emailHelper
      .builder(project)
      .to(profile.get('email'))
      .usingTemplate(
        'email-inner-base.tpl',
        `recovery-${locale.fallbackLocale}`,
      )
      .withSubject(locale.t('emails.recovery.subject'))
      .withData({
        body: locale.t('emails.recovery.body', { project: projectName }),
        hello: locale.t('emails.recovery.hello', {
          user: profile.get('name', 'User'),
        }),
        footer: locale.t('emails.recovery.footer'),
        thanks: locale.t('emails.recovery.thanks'),
        signature: locale.t('emails.recovery.signature', {
          project: projectName,
        }),
      })
      .withVariables({
        direction: locale.t('settings.direction'),
        user: profile.get('name', 'User'),
        redirect: url,
        project: projectName,
      })
      .build()

    await this.mailsQueue.add(MailJob.SEND_EMAIL, payload)

    createdRecovery.set('secret', secret)

    this.eventEmitter.emit(AppEvents.ACCOUNT_RECOVERY_CREATE, {
      userId: profile.getId(),
      payload: {
        data: createdRecovery,
      },
    })

    return createdRecovery
  }

  /**
   * Update password recovery (confirmation)
   */
  async updateRecovery({
    user,
    input,
    ctx,
  }: WithUser<{
    input: UpdateRecoveryDTO
    ctx: RequestContext
  }>): Promise<TokensDoc> {
    const profile = await this.db.getDocument('users', input.userId)

    if (profile.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }

    const tokens = profile.get('tokens', []) as TokensDoc[]
    const verifiedToken = Auth.tokenVerify(
      tokens,
      TokenType.RECOVERY,
      input.secret,
    )

    if (!verifiedToken) {
      throw new Exception(Exception.USER_INVALID_TOKEN)
    }

    Authorization.setRole(Role.user(profile.getId()).toString())

    const newPassword = await Auth.passwordHash(
      input.password,
      Auth.DEFAULT_ALGO,
      Auth.DEFAULT_ALGO_OPTIONS,
    )

    const historyLimit = ctx.project.get('auths', {}).passwordHistory ?? 0
    let history = profile.get('passwordHistory', [])

    if (newPassword && historyLimit > 0) {
      const validator = new PasswordHistoryValidator(
        history,
        profile.get('hash') as HashAlgorithm,
        profile.get('hashOptions'),
      )
      if (!(await validator.$valid(input.password))) {
        throw new Exception(Exception.USER_PASSWORD_RECENTLY_USED)
      }

      history.push(newPassword)
      history = history.slice(Math.max(0, history.length - historyLimit))
    }

    await Hooks.trigger('passwordValidator', [input.password, user, true])

    const updatedProfile = await this.db.updateDocument(
      'users',
      profile.getId(),
      profile
        .set('password', newPassword)
        .set('passwordHistory', history)
        .set('passwordUpdate', new Date())
        .set('hash', Auth.DEFAULT_ALGO)
        .set('hashOptions', Auth.DEFAULT_ALGO_OPTIONS)
        .set('emailVerification', true),
    )

    user.setAll(updatedProfile.toObject())
    const recoveryDocument = await this.db.getDocument(
      'tokens',
      verifiedToken.getId(),
    )

    /**
     * We act like we're updating and validating
     * the recovery token but actually we don't need it anymore.
     */
    await this.db.deleteDocument('tokens', verifiedToken.getId())
    await this.db.purgeCachedDocument('users', profile.getId())

    this.eventEmitter.emit(AppEvents.ACCOUNT_RECOVERY_UPDATE, {
      userId: profile.getId(),
      payload: {
        data: recoveryDocument,
      },
    })

    return recoveryDocument
  }
}

type WithUser<T = unknown> = { user: UsersDoc } & T
