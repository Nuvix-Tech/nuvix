import {
  Body,
  Controller,
  HttpStatus,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common'
import { Delete, Get, Patch, Post, Put } from '@nuvix/core'
import {
  AllowSessionType,
  AuthType,
  Ctx,
  Locale,
  Namespace,
  User,
} from '@nuvix/core/decorators'
import { Exception } from '@nuvix/core/extend/exception'
import { LocaleTranslator, Models, RequestContext } from '@nuvix/core/helpers'
import { ApiInterceptor, ResponseInterceptor } from '@nuvix/core/resolvers'
import { type IResponse, SessionType } from '@nuvix/utils'
import type { TokensDoc, UsersDoc } from '@nuvix/utils/types'
import { AccountService } from './account.service'
import {
  CreateAccountDTO,
  UpdateEmailDTO,
  UpdateNameDTO,
  UpdatePasswordDTO,
  UpdatePhoneDTO,
  UpdatePrefsDTO,
} from './DTO/account.dto'
import {
  CreateEmailVerificationDTO,
  UpdateEmailVerificationDTO,
  UpdatePhoneVerificationDTO,
} from './DTO/verification.dto'

@Controller({ version: ['1'], path: 'account' })
@Namespace('account')
@UseInterceptors(ResponseInterceptor, ApiInterceptor)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Post('', {
    summary: 'Create Account',
    scopes: 'sessions.write',
    throttle: {
      limit: 10,
      configKey: 'create_account',
    },
    model: Models.ACCOUNT,
    audit: {
      key: 'user.create',
      resource: 'user/{res.$id}',
      userId: '{res.$id}',
    },
    sdk: {
      name: 'create',
      code: HttpStatus.CREATED,
      descMd: 'docs/references/account/create.md',
    },
  })
  @AllowSessionType(SessionType.EMAIL_PASSWORD)
  async createAccount(
    @Body() { userId, email, password, name }: CreateAccountDTO,
    @User() user: UsersDoc,
    @Ctx() ctx: RequestContext,
  ): Promise<IResponse<UsersDoc>> {
    return this.accountService.createAccount(
      userId,
      email,
      password,
      name,
      user,
      ctx,
    )
  }

  @Get('', {
    summary: 'Get Account',
    scopes: 'account',
    auth: [AuthType.SESSION, AuthType.JWT],
    model: Models.ACCOUNT,
    sdk: {
      name: 'get',
      descMd: '/docs/references/account/get.md',
    },
  })
  async getAccount(@User() user: UsersDoc): Promise<IResponse<UsersDoc>> {
    if (user.empty()) {
      throw new Exception(Exception.USER_NOT_FOUND)
    }
    return user
  }

  @Delete('', {
    summary: 'Delete Account',
    scopes: 'account',
    model: Models.NONE,
    auth: AuthType.ADMIN,
    audit: {
      key: 'user.delete',
      resource: 'user/{res.$id}',
    },
    sdk: {
      name: 'delete',
      descMd: '/docs/references/account/delete.md',
    },
  })
  async deleteAccount(@User() user: UsersDoc): Promise<void> {
    return this.accountService.deleteAccount(user)
  }

  @Get('prefs', {
    summary: 'Get account preferences',
    scopes: 'account',
    model: {
      type: Models.PREFERENCES,
      excludeExtraneousValues: false,
    },
    auth: [AuthType.SESSION, AuthType.JWT],
    sdk: {
      name: 'getPrefs',
      descMd: '/docs/references/account/get-prefs.md',
    },
  })
  getPrefs(@User() user: UsersDoc): IResponse<Record<string, unknown>> {
    return user.get('prefs', {})
  }

  @Patch('prefs', {
    summary: 'Update preferences',
    scopes: 'account',
    model: {
      type: Models.PREFERENCES,
      excludeExtraneousValues: false,
    },
    auth: [AuthType.SESSION, AuthType.JWT],
    audit: {
      key: 'user.update',
      resource: 'user/{res.$id}',
    },
    sdk: {
      name: 'updatePrefs',
      descMd: '/docs/references/account/update-prefs.md',
    },
  })
  async updatePrefs(
    @User() user: UsersDoc,
    @Body() input: UpdatePrefsDTO,
  ): Promise<IResponse<Record<string, unknown>>> {
    return this.accountService.updatePrefs(user, input.prefs)
  }

  @Patch('name', {
    summary: 'Update name',
    scopes: 'account',
    model: Models.ACCOUNT,
    auth: [AuthType.SESSION, AuthType.JWT],
    audit: {
      key: 'user.update',
      resource: 'user/{res.$id}',
    },
    sdk: {
      name: 'updateName',
      descMd: '/docs/references/account/update-name.md',
    },
  })
  async updateName(
    @User() user: UsersDoc,
    @Body() { name }: UpdateNameDTO,
  ): Promise<IResponse<UsersDoc>> {
    return this.accountService.updateName(name, user)
  }

  @Patch('password', {
    summary: 'Update password',
    scopes: 'account',
    throttle: 10,
    model: Models.ACCOUNT,
    auth: [AuthType.SESSION, AuthType.JWT],
    audit: {
      key: 'user.update',
      resource: 'user/{res.$id}',
    },
    sdk: {
      name: 'updatePassword',
      descMd: '/docs/references/account/update-password.md',
    },
  })
  async updatePassword(
    @User() user: UsersDoc,
    @Body() { password, oldPassword }: UpdatePasswordDTO,
    @Ctx() ctx: RequestContext,
  ): Promise<IResponse<UsersDoc>> {
    return this.accountService.updatePassword({
      password,
      oldPassword,
      user,
      ctx,
    })
  }

  @Patch('email', {
    summary: 'Update email',
    scopes: 'account',
    model: Models.ACCOUNT,
    auth: [AuthType.SESSION, AuthType.JWT],
    audit: {
      key: 'user.update',
      resource: 'user/{res.$id}',
    },
    sdk: {
      name: 'updateEmail',
      descMd: '/docs/references/account/update-email.md',
    },
  })
  async updateEmail(
    @User() user: UsersDoc,
    @Body() updateEmailDTO: UpdateEmailDTO,
  ): Promise<IResponse<UsersDoc>> {
    return this.accountService.updateEmail(user, updateEmailDTO)
  }

  @Patch('phone', {
    summary: 'Update phone',
    scopes: 'account',
    model: Models.ACCOUNT,
    auth: [AuthType.SESSION, AuthType.JWT],
    audit: {
      key: 'user.update',
      resource: 'user/{res.$id}',
    },
    sdk: {
      name: 'updatePhone',
      descMd: '/docs/references/account/update-phone.md',
    },
  })
  async updatePhone(
    @User() user: UsersDoc,
    @Body() { password, phone }: UpdatePhoneDTO,
  ): Promise<IResponse<UsersDoc>> {
    return this.accountService.updatePhone({
      password,
      phone,
      user,
    })
  }

  @Patch('status', {
    summary: 'Update status',
    scopes: 'account',
    model: Models.ACCOUNT,
    auth: [AuthType.SESSION, AuthType.JWT],
    audit: {
      key: 'user.update',
      resource: 'user/{res.$id}',
    },
    sdk: {
      name: 'updateStatus',
      descMd: '/docs/references/account/update-status.md',
    },
  })
  async updateStatus(
    @User() user: UsersDoc,
    @Req() request: NuvixRequest,
    @Res({ passthrough: true }) response: NuvixRes,
  ): Promise<IResponse<UsersDoc>> {
    return this.accountService.updateStatus({
      user,
      request,
      response,
    })
  }

  @Post(['verification', 'verifications/email'], {
    summary: 'Create email verification',
    scopes: 'account',
    model: Models.TOKEN,
    sensitiveFields: ['secret'],
    auth: [AuthType.SESSION, AuthType.JWT],
    throttle: {
      limit: 10,
      key: 'url:{url},userId:{userId}',
    },
    audit: {
      key: 'verification.create',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    sdk: {
      name: 'createVerification',
      descMd: '/docs/references/account/create-email-verification.md',
    },
  })
  async createEmailVerification(
    @Body() { url }: CreateEmailVerificationDTO,
    @Req() request: NuvixRequest,
    @User() user: UsersDoc,
    @Locale() locale: LocaleTranslator,
  ): Promise<IResponse<TokensDoc>> {
    return this.accountService.createEmailVerification({
      url,
      request,
      user,
      locale,
    })
  }

  @Put(['verification', 'verifications/email'], {
    summary: 'Update email verification (confirmation)',
    scopes: 'public',
    model: Models.TOKEN,
    sensitiveFields: ['secret'],
    auth: [AuthType.SESSION, AuthType.JWT],
    throttle: {
      limit: 10,
      key: 'url:{url},userId:{body-userId}',
    },
    audit: {
      key: 'verification.update',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    sdk: {
      name: 'updateVerification',
      descMd: '/docs/references/account/update-email-verification.md',
    },
  })
  async updateEmailVerification(
    @Body() { userId, secret }: UpdateEmailVerificationDTO,
    @User() user: UsersDoc,
  ): Promise<IResponse<TokensDoc>> {
    return this.accountService.updateEmailVerification({
      userId,
      secret,
      user,
    })
  }

  @Post(['verification/phone', 'verifications/phone'], {
    summary: 'Create phone verification',
    scopes: 'account',
    model: Models.TOKEN,
    sensitiveFields: ['secret'],
    auth: [AuthType.SESSION, AuthType.JWT],
    throttle: {
      limit: 10,
      key: ['url:{url},userId:{userId}', 'url:{url},ip:{ip}'],
    },
    audit: {
      key: 'verification.create',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    sdk: {
      name: 'createPhoneVerification',
      descMd: '/docs/references/account/create-phone-verification.md',
    },
  })
  async createPhoneVerification(
    @Req() request: NuvixRequest,
    @User() user: UsersDoc,
    @Locale() locale: LocaleTranslator,
  ): Promise<IResponse<TokensDoc>> {
    return this.accountService.createPhoneVerification({
      request,
      user,
      locale,
    })
  }

  @Put(['verification/phone', 'verifications/phone'], {
    summary: 'Update phone verification (confirmation)',
    scopes: 'public',
    model: Models.TOKEN,
    sensitiveFields: ['secret'],
    auth: [AuthType.SESSION, AuthType.JWT],
    throttle: {
      limit: 10,
      key: 'userId:{body-userId}',
    },
    audit: {
      key: 'verification.update',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    sdk: {
      name: 'updatePhoneVerification',
      descMd: '/docs/references/account/update-phone-verification.md',
    },
  })
  async updatePhoneVerification(
    @Body() { userId, secret }: UpdatePhoneVerificationDTO,
    @User() user: UsersDoc,
  ) {
    return this.accountService.updatePhoneVerification({
      userId,
      secret,
      user,
    })
  }
}
