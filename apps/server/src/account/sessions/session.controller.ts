import {
  Body,
  Controller,
  HttpStatus,
  Param,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common'
import { Delete, Get, Patch, Post, Put } from '@nuvix/core'
import {
  AllowSessionType,
  Auth,
  AuthType,
  Ctx,
  Namespace,
  User,
} from '@nuvix/core/decorators'
import { Models, RequestContext } from '@nuvix/core/helpers'
import { ApiInterceptor, ResponseInterceptor } from '@nuvix/core/resolvers'
import { type Doc } from '@nuvix/db'
import { type IListResponse, type IResponse, SessionType } from '@nuvix/utils'
import type { SessionsDoc, TokensDoc, UsersDoc } from '@nuvix/utils/types'
import {
  CreateEmailSessionDTO,
  CreateOAuth2SessionDTO,
  CreateSessionDTO,
  OAuth2CallbackDTO,
  type OAuth2CallbackParamDTO,
  type ProviderParamDTO,
  type SessionsParamDTO,
} from './DTO/session.dto'
import {
  CreateEmailTokenDTO,
  CreateMagicURLTokenDTO,
  CreateOAuth2TokenDTO,
  CreatePhoneTokenDTO,
} from './DTO/token.dto'
import { SessionService } from './session.service'

@Namespace('account')
@Controller({ version: ['1'], path: 'account' })
@UseInterceptors(ResponseInterceptor, ApiInterceptor)
@Auth([AuthType.SESSION, AuthType.JWT])
export class SessionsController {
  constructor(private readonly sessionService: SessionService) {}

  @Get('sessions', {
    summary: 'List Sessions',
    scopes: 'account',
    model: { type: Models.SESSION, list: true },
    sensitiveFields: ['secret'],
    sdk: {
      name: 'listSessions',
      descMd: '/docs/references/account/list-sessions.md',
    },
  })
  async getSessions(
    @User() user: UsersDoc,
    @Ctx() ctx: RequestContext,
  ): Promise<IListResponse<SessionsDoc>> {
    return this.sessionService.getSessions(user, ctx)
  }

  @Delete('sessions', {
    summary: 'Delete sessions',
    scopes: 'account',
    model: Models.NONE,
    throttle: 100,
    audit: {
      key: 'sessions.delete',
      resource: 'user/{user.$id}',
    },
    sdk: {
      name: 'deleteSessions',
      descMd: '/docs/references/account/delete-sessions.md',
    },
  })
  async deleteSessions(
    @User() user: UsersDoc,
    @Req() request: NuvixRequest,
    @Res({ passthrough: true }) response: NuvixRes,
  ): Promise<void> {
    return this.sessionService.deleteSessions(user, request, response)
  }

  @Get('sessions/:sessionId', {
    summary: 'Get session',
    scopes: 'account',
    model: Models.SESSION,
    sensitiveFields: ['secret'],
    sdk: {
      name: 'getSession',
      descMd: '/docs/references/account/get-session.md',
    },
  })
  async getSession(
    @User() user: UsersDoc,
    @Param() { sessionId }: SessionsParamDTO,
    @Ctx() ctx: RequestContext,
  ): Promise<IResponse<SessionsDoc>> {
    return this.sessionService.getSession(user, sessionId, ctx)
  }

  @Delete('sessions/:sessionId', {
    summary: 'Delete session',
    scopes: 'account',
    model: Models.NONE,
    throttle: 100,
    audit: {
      key: 'session.delete',
      resource: 'user/{user.$id}',
    },
    sdk: {
      name: 'deleteSession',
      descMd: '/docs/references/account/delete-session.md',
    },
  })
  async deleteSession(
    @User() user: UsersDoc,
    @Param() { sessionId }: SessionsParamDTO,
    @Req() request: NuvixRequest,
    @Res({ passthrough: true }) response: NuvixRes,
  ): Promise<void> {
    return this.sessionService.deleteSession(user, sessionId, request, response)
  }

  @Patch('sessions/:sessionId', {
    summary: 'Update session',
    scopes: 'account',
    model: Models.SESSION,
    sensitiveFields: ['secret'],
    throttle: 10,
    audit: {
      key: 'session.update',
      resource: 'user/{res.userId}',
    },
    sdk: {
      name: 'updateSession',
      descMd: '/docs/references/account/update-session.md',
    },
  })
  async updateSession(
    @User() user: UsersDoc,
    @Param() { sessionId }: SessionsParamDTO,
    @Ctx() ctx: RequestContext,
  ): Promise<IResponse<SessionsDoc>> {
    return this.sessionService.updateSession(user, sessionId, ctx)
  }

  @Post(['sessions/email', 'sessions'], {
    summary: 'Create email password session',
    scopes: 'sessions.write',
    model: Models.SESSION,
    sensitiveFields: ['secret'],
    auth: [],
    throttle: {
      limit: 10,
      key: 'url:{url},email:{body-email}',
      configKey: 'create_email_session',
    },
    audit: {
      key: 'session.create',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    sdk: {
      name: 'createEmailPasswordSession',
      descMd: '/docs/references/account/create-session-email-password.md',
    },
  })
  @AllowSessionType(SessionType.EMAIL_PASSWORD)
  async createEmailSession(
    @User() user: UsersDoc,
    @Body() input: CreateEmailSessionDTO,
    @Req() request: NuvixRequest,
    @Res({ passthrough: true }) response: NuvixRes,
  ): Promise<IResponse<SessionsDoc>> {
    return this.sessionService.createEmailSession(
      user,
      input,
      request,
      response,
    )
  }

  @Post('sessions/anonymous', {
    summary: 'Create anonymous session',
    scopes: 'sessions.write',
    model: Models.SESSION,
    sensitiveFields: ['secret'],
    auth: [],
    throttle: {
      limit: 50,
      key: 'ip:{ip}',
      configKey: 'create_anonymous_session',
    },
    audit: {
      key: 'session.create',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    sdk: {
      name: 'createAnonymousSession',
      descMd: '/docs/references/account/create-session-anonymous.md',
    },
  })
  @AllowSessionType(SessionType.ANONYMOUS)
  async createAnonymousSession(
    @User() user: UsersDoc,
    @Req() request: NuvixRequest,
    @Res({ passthrough: true }) response: NuvixRes,
  ): Promise<IResponse<SessionsDoc>> {
    return this.sessionService.createAnonymousSession({
      user,
      request,
      response,
    })
  }

  @Post('sessions/token', {
    summary: 'Create session',
    scopes: 'sessions.write',
    model: Models.SESSION,
    sensitiveFields: ['secret'],
    auth: [],
    throttle: {
      limit: 10,
      key: 'ip:{ip},userId:{body-userId}',
      configKey: 'create_token_session',
    },
    audit: {
      key: 'session.create',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    sdk: {
      name: 'createSession',
      descMd: '/docs/references/account/create-session.md',
    },
  })
  async createSession(
    @User() user: UsersDoc,
    @Body() input: CreateSessionDTO,
    @Req() request: NuvixRequest,
    @Res({ passthrough: true }) response: NuvixRes,
  ): Promise<IResponse<SessionsDoc>> {
    return this.sessionService.createSession({
      user,
      input,
      request,
      response,
    })
  }

  @Get('sessions/oauth2/:provider', {
    summary: 'Create OAuth2 session',
    scopes: 'sessions.write',
    auth: [],
    throttle: {
      limit: 50,
      key: 'ip:{ip}',
      configKey: 'create_oauth2_session',
    },
    sdk: {
      name: 'createOAuth2Session',
      code: HttpStatus.FOUND,
      descMd: '/docs/references/account/create-session-oauth2.md',
    },
  })
  async createOAuth2Session(
    @Query() input: CreateOAuth2SessionDTO,
    @Req() request: NuvixRequest,
    @Res() response: NuvixRes,
    @Param() { provider }: ProviderParamDTO,
  ): Promise<void> {
    const url = await this.sessionService.createOAuth2Session({
      input,
      request,
      provider,
    })

    response
      .status(302)
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .header('Pragma', 'no-cache')
      .redirect(url)
  }

  @Get('sessions/oauth2/callback/:provider', {
    summary: 'Get OAuth2 callback',
    scopes: 'public',
    auth: [],
    docs: false,
  })
  async OAuth2Callback(
    @Query() input: OAuth2CallbackDTO,
    @Req() request: NuvixRequest,
    @Res() response: NuvixRes,
    @Param() { provider }: OAuth2CallbackParamDTO,
  ): Promise<void> {
    const domain = request.host
    const protocol = request.protocol

    const params: Record<string, any> = {}
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined && value !== null) {
        params[key] = value
      }
    }
    params.provider = provider

    response
      .status(302)
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .header('Pragma', 'no-cache')
      .redirect(
        `${protocol}://${domain}/v1/account/sessions/oauth2/${provider}/redirect?${new URLSearchParams(params).toString()}`,
      )
  }

  @Post('sessions/oauth2/callback/:provider', {
    summary: 'Get OAuth2 callback',
    scopes: 'public',
    auth: [],
    docs: false,
  })
  async OAuth2CallbackWithProject(
    @Body() input: OAuth2CallbackDTO,
    @Req() request: NuvixRequest,
    @Res() response: NuvixRes,
    @Param() { provider }: OAuth2CallbackParamDTO,
  ): Promise<void> {
    const domain = request.host
    const protocol = request.protocol

    const params: Record<string, any> = {}
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined && value !== null) {
        params[key] = value
      }
    }
    params.provider = provider

    response
      .status(302)
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .header('Pragma', 'no-cache')
      .redirect(
        `${protocol}://${domain}/v1/account/sessions/oauth2/${provider}/redirect?${new URLSearchParams(params).toString()}`,
      )
  }

  @Get('sessions/oauth2/:provider/redirect', {
    summary: 'Get OAuth2 callback',
    scopes: 'public',
    auth: [],
    throttle: {
      limit: 50,
      key: 'ip:{ip}',
    },
    audit: {
      key: 'session.create',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    docs: false,
  })
  async OAuth2Redirect(
    @User() user: UsersDoc,
    @Query() input: OAuth2CallbackDTO,
    @Req() request: NuvixRequest,
    @Res() response: NuvixRes,
    @Param() { provider }: ProviderParamDTO,
  ): Promise<void> {
    return this.sessionService.oAuth2Redirect({
      user,
      input,
      provider,
      request,
      response,
    })
  }

  @Get('tokens/oauth2/:provider', {
    summary: 'Create OAuth2 token',
    scopes: 'sessions.write',
    auth: [],
    throttle: {
      limit: 50,
      key: 'ip:{ip}',
    },
    sdk: {
      name: 'createOAuth2Token',
      descMd: '/docs/references/account/create-token-oauth2.md',
      code: HttpStatus.FOUND,
    },
  })
  async createOAuth2Token(
    @Query() input: CreateOAuth2TokenDTO,
    @Req() request: NuvixRequest,
    @Res() response: NuvixRes,
    @Param() { provider }: ProviderParamDTO,
  ): Promise<void> {
    return this.sessionService.createOAuth2Token({
      input,
      request,
      response,
      provider,
    })
  }

  @Post('tokens/magic-url', {
    summary: 'Create magic URL token',
    scopes: 'sessions.write',
    model: Models.TOKEN,
    auth: [],
    sensitiveFields: ['secret'],
    throttle: {
      limit: 60,
      key: ['url:{url},email:{body-email}', 'url:{url},ip:{ip}'],
    },
    audit: {
      key: 'session.create',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    sdk: {
      name: 'createMagicURLToken',
      descMd: '/docs/references/account/create-token-magic-url.md',
    },
  })
  @AllowSessionType(SessionType.MAGIC_URL)
  async createMagicURLToken(
    @User() user: UsersDoc,
    @Body() input: CreateMagicURLTokenDTO,
    @Req() request: NuvixRequest,
  ): Promise<IResponse<TokensDoc>> {
    return this.sessionService.createMagicURLToken({
      user,
      input,
      request,
    })
  }

  @Post('tokens/email', {
    summary: 'Create email token(OTP)',
    scopes: 'sessions.write',
    model: Models.TOKEN,
    sensitiveFields: ['secret'],
    auth: [],
    throttle: {
      limit: 10,
      key: ['url:{url},email:{body-email}', 'url:{url},ip:{ip}'],
    },
    audit: {
      key: 'session.create',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    sdk: {
      name: 'createEmailToken',
      descMd: '/docs/references/account/create-token-email.md',
    },
  })
  @AllowSessionType(SessionType.EMAIL_OTP)
  async createEmailToken(
    @Body() input: CreateEmailTokenDTO,
    @Req() request: NuvixRequest,
    @User() user: UsersDoc,
  ): Promise<IResponse<TokensDoc>> {
    return this.sessionService.createEmailToken({
      input,
      request,
      user,
    })
  }

  @Put('sessions/magic-url', {
    summary: 'Update magic URL session',
    scopes: 'sessions.write',
    auth: [],
    model: Models.SESSION,
    sensitiveFields: ['secret'],
    throttle: {
      limit: 10,
      key: 'ip:{ip},userId:{body-userId}',
    },
    audit: {
      key: 'session.create',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    sdk: {
      name: 'updateMagicURLSession',
      descMd: '/docs/references/account/create-session.md',
    },
  })
  async updateMagicURLSession(
    @User() user: UsersDoc,
    @Body() input: CreateSessionDTO,
    @Req() request: NuvixRequest,
    @Res({ passthrough: true }) response: NuvixRes,
  ): Promise<IResponse<SessionsDoc>> {
    return this.sessionService.createSession({
      user,
      input,
      request,
      response,
    })
  }

  @Put('sessions/phone', {
    summary: 'Update phone session',
    scopes: 'sessions.write',
    model: Models.SESSION,
    auth: [],
    sensitiveFields: ['secret'],
    throttle: {
      limit: 10,
      key: 'ip:{ip},userId:{body-userId}',
    },
    audit: {
      key: 'session.create',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    sdk: {
      name: 'updatePhoneSession',
      descMd: '/docs/references/account/create-session.md',
    },
  })
  async updatePhoneSession(
    @User() user: UsersDoc,
    @Body() input: CreateSessionDTO,
    @Req() request: NuvixRequest,
    @Res({ passthrough: true }) response: NuvixRes,
  ): Promise<IResponse<SessionsDoc>> {
    return this.sessionService.createSession({
      user,
      input,
      request,
      response,
    })
  }

  @Post(['tokens/phone', 'sessions/phone'], {
    summary: 'Create phone token',
    scopes: 'sessions.write',
    model: Models.TOKEN,
    sensitiveFields: ['secret'],
    auth: [],
    throttle: {
      limit: 10,
      key: ['url:{url},phone:{body-phone}', 'url:{url},ip:{ip}'],
    },
    audit: {
      key: 'session.create',
      resource: 'user/{res.userId}',
      userId: '{res.userId}',
    },
    sdk: {
      name: 'createPhoneToken',
      descMd: '/docs/references/account/create-token-phone.md',
    },
  })
  @AllowSessionType(SessionType.PHONE)
  async createPhoneToken(
    @User() user: UsersDoc,
    @Body() input: CreatePhoneTokenDTO,
    @Req() request: NuvixRequest,
  ): Promise<IResponse<TokensDoc>> {
    return this.sessionService.createPhoneToken({
      user,
      input,
      request,
    })
  }

  @Post(['jwts', 'jwt'], {
    summary: 'Create JWT',
    scopes: 'account',
    model: Models.JWT,
    auth: [AuthType.SESSION, AuthType.JWT], // Only allow users with valid session or JWT to create a new JWT
    throttle: {
      limit: 100,
      key: 'url:{url},userId:{userId}',
    },
    sdk: {
      name: 'createJWT',
      descMd: '/docs/references/account/create-jwt.md',
    },
  })
  @AllowSessionType(SessionType.JWT)
  async createJWT(
    @User() user: UsersDoc,
    @Ctx() ctx: RequestContext,
  ): Promise<Doc<{ jwt: string }>> {
    return this.sessionService.createJWT(user, ctx)
  }
}
