import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { Exception } from '@nuvix/core/extend/exception'
import { Auth, EmailHelper, RequestContext } from '@nuvix/core/helpers'
import {
  MailJob,
  MailQueueOptions,
  MessagingJob,
  MessagingJobInternalData,
} from '@nuvix/core/resolvers'
import { MfaType, TOTP } from '@nuvix/core/validators'
import { Database, Doc, ID, Permission, Role } from '@nuvix/db'
import { configuration, QueueFor } from '@nuvix/utils'
import {
  EmailChallenge,
  PhoneChallenge,
  TOTPChallenge,
} from '@nuvix/utils/auth'
import type {
  Authenticators,
  AuthenticatorsDoc,
  ChallengesDoc,
  SessionsDoc,
  UsersDoc,
} from '@nuvix/utils/types'
import { Queue } from 'bullmq'
import { CreateMfaChallengeDTO, VerifyMfaChallengeDTO } from './DTO/mfa.dto'
import { CoreService } from '@nuvix/core/core.service'

@Injectable()
export class MfaService {
  private readonly db: Database
  private readonly emailHelper = new EmailHelper()

  constructor(
    private readonly coreService: CoreService,
    @InjectQueue(QueueFor.MAILS)
    private readonly mailsQueue: Queue<MailQueueOptions>,
    @InjectQueue(QueueFor.MESSAGING)
    private readonly messagingQueue: Queue<
      MessagingJobInternalData,
      unknown,
      MessagingJob
    >,
  ) {
    this.db = this.coreService.getDatabase()
  }

  /**
   * Update MFA
   */
  async updateMfa({
    user,
    mfa,
    session,
  }: WithUser<{ mfa: boolean; session?: SessionsDoc }>): Promise<UsersDoc> {
    user.set('mfa', mfa)

    user = await this.db.updateDocument('users', user.getId(), user)

    if (mfa && session) {
      let factors = session.get('factors', [])

      const totp = TOTP.getAuthenticatorFromUser(user)
      if (totp?.get('verified', false)) {
        factors.push('totp')
      }

      if (user.get('email', false) && user.get('emailVerification', false)) {
        factors.push('email')
      }

      if (user.get('phone', false) && user.get('phoneVerification', false)) {
        factors.push('phone')
      }

      factors = [...new Set(factors)] // Ensure unique factors

      session.set('factors', factors)
      await this.db.updateDocument('sessions', session.getId(), session)
    }

    return user
  }

  /**
   * Get Mfa factors
   */
  async getMfaFactors(user: UsersDoc): Promise<
    Doc<{
      totp: boolean
      email: boolean
      phone: boolean
      recoveryCode: boolean
    }>
  > {
    const mfaRecoveryCodes = user.get('mfaRecoveryCodes', [])
    const recoveryCodeEnabled =
      Array.isArray(mfaRecoveryCodes) && mfaRecoveryCodes.length > 0

    const totp = TOTP.getAuthenticatorFromUser(user)

    const factors = new Doc({
      totp: totp?.get('verified', false) ?? false,
      email: user.get('email', false)
        ? user.get('emailVerification', false)
        : false,
      phone: user.get('phone', false)
        ? user.get('phoneVerification', false)
        : false,
      recoveryCode: recoveryCodeEnabled,
    })

    return factors
  }

  /**
   * Create authenticator
   */
  async createMfaAuthenticator({
    user,
    type,
    ctx,
  }: WithUser<{ type: string; ctx: RequestContext }>): Promise<
    Doc<{ secret: string; uri: string }>
  > {
    let otp: TOTP

    switch (type) {
      case MfaType.TOTP:
        otp = new TOTP()
        break
      default:
        throw new Exception(Exception.GENERAL_ARGUMENT_INVALID, 'Unknown type.')
    }

    otp.setLabel(user.get('email'))
    otp.setIssuer(ctx.project.get('name'))

    const authenticator = TOTP.getAuthenticatorFromUser(user)

    if (authenticator) {
      if (authenticator.get('verified')) {
        throw new Exception(Exception.USER_AUTHENTICATOR_ALREADY_VERIFIED)
      }
      await this.db.deleteDocument('authenticators', authenticator.getId())
    }

    const newAuthenticator = Doc.from<Authenticators>({
      $id: ID.unique(),
      userId: user.getId(),
      userInternalId: user.getSequence(),
      type: MfaType.TOTP,
      verified: false,
      data: JSON.stringify({
        secret: otp.getSecret(),
      }),
      $permissions: [
        Permission.read(Role.user(user.getId())),
        Permission.update(Role.user(user.getId())),
        Permission.delete(Role.user(user.getId())),
      ],
    })

    const model = new Doc({
      secret: otp.getSecret(),
      uri: otp.getProvisioningUri(),
    })

    await this.db.createDocument('authenticators', newAuthenticator)
    await this.db.purgeCachedDocument('users', user.getId())

    return model
  }

  /**
   * Update authenticator (confirmation)
   */
  async verifyMfaAuthenticator({
    type,
    otp,
    user,
    session,
  }: WithUser<{
    session: SessionsDoc
    otp: string
    type: string
  }>): Promise<UsersDoc> {
    let authenticator: AuthenticatorsDoc | null = null

    switch (type) {
      case MfaType.TOTP:
        authenticator = TOTP.getAuthenticatorFromUser(user)
        break
      default:
        authenticator = null
    }

    if (!authenticator) {
      throw new Exception(Exception.USER_AUTHENTICATOR_NOT_FOUND)
    }

    if (authenticator.get('verified')) {
      throw new Exception(Exception.USER_AUTHENTICATOR_ALREADY_VERIFIED)
    }

    let success = false
    switch (type) {
      case MfaType.TOTP:
        success = await TOTPChallenge.verify(user, otp)
        break
      default:
        success = false
    }

    if (!success) {
      throw new Exception(Exception.USER_INVALID_TOKEN)
    }

    authenticator.set('verified', true)

    await this.db.updateDocument(
      'authenticators',
      authenticator.getId(),
      authenticator,
    )
    await this.db.purgeCachedDocument('users', user.getId())

    const factors = session.get('factors', [])
    factors.push(type)
    const uniqueFactors = [...new Set(factors)]

    session.set('factors', uniqueFactors)
    await this.db.updateDocument('sessions', session.getId(), session)

    return user
  }

  /**
   * Delete Authenticator
   */
  async deleteMfaAuthenticator({
    user,
    type,
  }: WithUser<{ type: string }>): Promise<void> {
    const authenticator = (() => {
      switch (type) {
        case MfaType.TOTP:
          return TOTP.getAuthenticatorFromUser(user)
        default:
          return null
      }
    })()

    if (!authenticator) {
      throw new Exception(Exception.USER_AUTHENTICATOR_NOT_FOUND)
    }

    await this.db.deleteDocument('authenticators', authenticator.getId())
    await this.db.purgeCachedDocument('users', user.getId())
  }

  /**
   * Create MFA recovery codes
   */
  async createMfaRecoveryCodes({
    user,
  }: WithUser): Promise<Doc<{ recoveryCodes: string[] }>> {
    const mfaRecoveryCodes = user.get('mfaRecoveryCodes', [])

    if (mfaRecoveryCodes.length > 0) {
      throw new Exception(Exception.USER_RECOVERY_CODES_ALREADY_EXISTS)
    }

    const newRecoveryCodes = TOTP.generateBackupCodes()
    user.set('mfaRecoveryCodes', newRecoveryCodes)
    await this.db.updateDocument('users', user.getId(), user)

    const document = new Doc({
      recoveryCodes: newRecoveryCodes,
    })

    return document
  }

  /**
   * Update MFA recovery codes (regenerate)
   */
  async updateMfaRecoveryCodes({
    user,
  }: WithUser): Promise<Doc<{ recoveryCodes: string[] }>> {
    const mfaRecoveryCodes = user.get('mfaRecoveryCodes', [])

    if (mfaRecoveryCodes.length === 0) {
      throw new Exception(Exception.USER_RECOVERY_CODES_NOT_FOUND)
    }

    const newMfaRecoveryCodes = TOTP.generateBackupCodes()
    user.set('mfaRecoveryCodes', newMfaRecoveryCodes)
    await this.db.updateDocument('users', user.getId(), user)

    const document = new Doc({
      recoveryCodes: newMfaRecoveryCodes,
    })

    return document
  }

  /**
   * Create MFA Challenge
   */
  async createMfaChallenge({
    user,
    userAgent,
    factor,
    ctx,
  }: WithUser<
    CreateMfaChallengeDTO & { userAgent: string; ctx: RequestContext }
  >): Promise<ChallengesDoc> {
    const expire = new Date(Date.now() + Auth.TOKEN_EXPIRATION_OTP * 1000)
    const code = Auth.codeGenerator(6)

    const challenge: ChallengesDoc = new Doc({
      $id: ID.unique(),
      userId: user.getId(),
      userInternalId: user.getSequence(),
      type: factor,
      token: Auth.tokenGenerator(Auth.TOKEN_LENGTH_SESSION),
      code: code,
      expire: expire,
      $permissions: [
        Permission.read(Role.user(user.getId())),
        Permission.update(Role.user(user.getId())),
        Permission.delete(Role.user(user.getId())),
      ],
    })

    const createdChallenge = await this.db.createDocument(
      'challenges',
      challenge,
    )

    const locale = ctx.translator()
    const project = ctx.project
    switch (factor) {
      case TOTP.PHONE: {
        if (!configuration.sms.enabled) {
          throw new Exception(Exception.GENERAL_PHONE_DISABLED)
        }
        if (!user.get('phone')) {
          throw new Exception(Exception.USER_PHONE_NOT_FOUND)
        }
        if (!user.get('phoneVerification')) {
          throw new Exception(Exception.USER_PHONE_NOT_VERIFIED)
        }

        const customSmsTemplate =
          project.get('templates', {})[
            `sms.mfaChallenge-${locale.fallbackLocale}`
          ] ?? {}

        let smsMessage = locale.t('sms.verification.body', {
          secret: code,
        })
        if (customSmsTemplate?.message) {
          smsMessage = customSmsTemplate.message
        }

        const smsContent = smsMessage
          .replace('{{project}}', project.get('name'))
          .replace('{{secret}}', code)

        const phone = user.get('phone')

        await this.messagingQueue.add(MessagingJob.INTERNAL, {
          message: {
            to: [phone],
            data: {
              content: smsContent,
            },
          },
        })
        // TODO: Implement usage metrics and abuse tracking
        break
      }

      case TOTP.EMAIL: {
        if (!configuration.smtp.enabled()) {
          throw new Exception(Exception.GENERAL_SMTP_DISABLED)
        }
        if (!user.get('email')) {
          throw new Exception(Exception.USER_EMAIL_NOT_FOUND)
        }
        if (!user.get('emailVerification')) {
          throw new Exception(Exception.USER_EMAIL_NOT_VERIFIED)
        }

        const detector = ctx.detector(userAgent)
        const agentOs = detector.getOS()
        const agentClient = detector.getClient()
        const agentDevice = detector.getDevice()

        const payload = await this.emailHelper
          .builder(project)
          .to(user.get('email'))
          .usingTemplate(
            'email-mfa-challenge.tpl',
            `mfaChallenge-${locale.fallbackLocale}`,
          )
          .withSubject(
            locale.t('emails.mfaChallenge.subject', {
              project: project.get('name'),
            }),
          )
          .withData({
            hello: locale.t('emails.mfaChallenge.hello', {
              user: user.get('name') || user.get('email'),
            }),
            description: locale.t('emails.mfaChallenge.description', {
              project: project.get('name'),
            }),
            clientInfo: locale.t('emails.mfaChallenge.clientInfo', {
              agentDevice: agentDevice.deviceBrand || 'UNKNOWN',
              agentClient: agentClient.clientName || 'UNKNOWN',
              agentOs: agentOs.osName || 'UNKNOWN',
            }),
            thanks: locale.t('emails.mfaChallenge.thanks'),
            signature: locale.t('emails.mfaChallenge.signature', {
              project: project.get('name'),
            }),
          })
          .withVariables({
            direction: locale.t('settings.direction'),
            user: user.get('name'),
            project: project.get('name'),
            otp: code,
          })
          .build()

        await this.mailsQueue.add(MailJob.SEND_EMAIL, payload)
        break
      }
    }

    return createdChallenge
  }

  /**
   * Update MFA Challenge
   */
  async updateMfaChallenge({
    user,
    session,
    otp,
    challengeId,
  }: WithUser<
    VerifyMfaChallengeDTO & { session: SessionsDoc }
  >): Promise<SessionsDoc> {
    const challenge = await this.db.getDocument('challenges', challengeId)

    if (challenge.empty()) {
      throw new Exception(Exception.USER_INVALID_TOKEN)
    }

    const type = challenge.get('type')

    const recoveryCodeChallenge = async (
      challenge: ChallengesDoc,
      user: UsersDoc,
      otp: string,
    ): Promise<boolean> => {
      if (
        challenge.has('type') &&
        challenge.get('type') === MfaType.RECOVERY_CODE.toLowerCase()
      ) {
        let mfaRecoveryCodes = user.get('mfaRecoveryCodes', [])
        if (mfaRecoveryCodes.includes(otp)) {
          mfaRecoveryCodes = mfaRecoveryCodes.filter(code => code !== otp)
          user.set('mfaRecoveryCodes', mfaRecoveryCodes)
          await this.db.updateDocument('users', user.getId(), user)
          return true
        }
        return false
      }
      return false
    }

    let success = false
    switch (type) {
      case MfaType.TOTP:
        success = await TOTPChallenge.challenge(challenge, user, otp)
        break
      case MfaType.PHONE:
        success =
          (await PhoneChallenge.challenge(challenge, user, otp)) &&
          challenge.get('code') === otp &&
          new Date() < new Date(challenge.get('expire') as string)
        break
      case MfaType.EMAIL:
        success =
          (await EmailChallenge.challenge(challenge, user, otp)) &&
          challenge.get('code') === otp &&
          new Date() < new Date(challenge.get('expire') as string)
        break
      case MfaType.RECOVERY_CODE.toLowerCase():
        success = await recoveryCodeChallenge(challenge, user, otp)
        break
      default:
        success = false
    }

    if (!success) {
      throw new Exception(Exception.USER_INVALID_TOKEN)
    }

    await this.db.deleteDocument('challenges', challengeId)
    await this.db.purgeCachedDocument('users', user.getId())

    let factors = session.get('factors', [])
    factors.push(type)
    factors = [...new Set(factors)] // Remove duplicates

    session.set('factors', factors).set('mfaUpdatedAt', new Date())

    await this.db.updateDocument('sessions', session.getId(), session)

    return session
  }
}

type WithUser<T = unknown> = { user: UsersDoc } & T
