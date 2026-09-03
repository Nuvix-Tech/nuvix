import { Elysia, t } from 'elysia'
import type { ProjectAuthContext } from '../context/project'
import type { DatabaseRequestCapabilities } from '../infrastructure/database-composition'
import { UnauthorizedError } from '../shared/errors'
import { Preferences } from '../teams/contracts'
import {
  ConfirmMagicUrlSessionBody,
  ConfirmPasswordRecoveryBody,
  ConfirmPhoneSessionBody,
  ConfirmVerificationBody,
  CreateAccountBody,
  CreateEmailSessionBody,
  CreateMagicUrlTokenBody,
  CreateMfaChallengeBody,
  CreatePasswordRecoveryBody,
  CreatePhoneTokenBody,
  CreateVerificationBody,
  JwtResponse,
  MfaAuthenticatorResponse,
  MfaChallengeResponse,
  MfaFactorsResponse,
  MfaRecoveryCodesResponse,
  SessionListQuery,
  SessionListResponse,
  SessionParams,
  SessionResponse,
  TokenResponse,
  UpdateAccountEmailBody,
  UpdateAccountMfaBody,
  UpdateAccountNameBody,
  UpdateAccountPhoneBody,
  UpdateAccountPrefsBody,
  UpdateAccountStatusBody,
  UpdatePasswordBody,
  UserResponse,
  VerifyMfaAuthenticatorBody,
  VerifyMfaChallengeBody,
} from './contracts'
import { type AccountService, createAccountService, userSessionAlreadyExists } from './service'

export function authorizeAccount(auth: ProjectAuthContext): { userId: string } {
  if (auth.type !== 'session' && auth.type !== 'jwt') {
    throw new UnauthorizedError('Authentication required', {
      code: 'credential_invalid',
      messageKey: 'errors.unauthorized',
    })
  }
  return { userId: auth.userId }
}

export function accountRoutes(
  requests: DatabaseRequestCapabilities,
  service: AccountService = createAccountService(),
) {
  return (
    new Elysia({ name: 'account-routes' })
      .post(
        '/account',
        {
          body: CreateAccountBody,
          response: UserResponse,
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ account }) => {
            set.status = 201
            return await service.register(account, body)
          }),
      )
      .get(
        '/account',
        {
          response: UserResponse,
        },
        async ({ request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.get(account, user.userId)
          }),
      )
      .patch(
        '/account/name',
        {
          body: UpdateAccountNameBody,
          response: UserResponse,
        },
        async ({ body, request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.updateName(account, user.userId, body.name)
          }),
      )
      .patch(
        '/account/password',
        {
          body: UpdatePasswordBody,
          response: UserResponse,
        },
        async ({ body, request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            const currentSessionId = auth.type === 'session' ? auth.sessionId : undefined
            return await service.updatePassword(account, user.userId, body, currentSessionId)
          }),
      )
      .patch(
        '/account/email',
        {
          body: UpdateAccountEmailBody,
          response: UserResponse,
        },
        async ({ body, request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.updateEmail(account, user.userId, body)
          }),
      )
      .patch(
        '/account/phone',
        {
          body: UpdateAccountPhoneBody,
          response: UserResponse,
        },
        async ({ body, request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.updatePhone(account, user.userId, body)
          }),
      )
      .patch(
        '/account/status',
        {
          body: UpdateAccountStatusBody,
          response: UserResponse,
        },
        async ({ body, request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.updateStatus(account, user.userId, body.status)
          }),
      )
      .get(
        '/account/prefs',
        {
          response: Preferences,
        },
        async ({ request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            const profile = await service.get(account, user.userId)
            return profile.prefs
          }),
      )
      .patch(
        '/account/prefs',
        {
          body: UpdateAccountPrefsBody,
          response: UserResponse,
        },
        async ({ body, request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.updatePrefs(account, user.userId, body.prefs)
          }),
      )
      .delete('/account', {}, async ({ request, set }) =>
        requests.withProject(request.headers, async ({ auth, account }) => {
          const user = authorizeAccount(auth)
          await service.deleteAccount(account, user.userId)
          set.status = 204
          return null
        }),
      )
      .post(
        '/account/jwt',
        {
          response: JwtResponse,
        },
        async ({ request, set }) =>
          requests.withProject(request.headers, async ({ auth, account, project }) => {
            if (auth.type !== 'session') {
              throw new UnauthorizedError('Session authentication required to create a JWT', {
                code: 'credential_invalid',
                messageKey: 'errors.unauthorized',
              })
            }
            set.status = 201
            return await service.createJWT(account, project.id, auth.userId, auth.sessionId)
          }),
      )
      .post(
        '/account/sessions/email',
        {
          body: CreateEmailSessionBody,
          response: SessionResponse,
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ account }) => {
            set.status = 201
            return await service.createEmailSession(account, body)
          }),
      )
      .post(
        '/account/sessions/anonymous',
        {
          response: SessionResponse,
        },
        async ({ request, set }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            if (auth.type !== 'guest') {
              throw userSessionAlreadyExists()
            }
            set.status = 201
            return await service.createAnonymousSession(account)
          }),
      )
      .get(
        '/account/sessions',
        {
          query: SessionListQuery,
          response: SessionListResponse,
        },
        async ({ query, request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.listSessions(
              account,
              user.userId,
              query.limit ?? 25,
              query.offset ?? 0,
            )
          }),
      )
      .delete('/account/sessions/current', {}, async ({ request, set }) =>
        requests.withProject(request.headers, async ({ auth, account }) => {
          if (auth.type !== 'session') {
            throw new UnauthorizedError('Session required', {
              code: 'credential_invalid',
              messageKey: 'errors.unauthorized',
            })
          }
          await service.deleteSession(account, auth.userId, auth.sessionId)
          set.status = 204
          return null
        }),
      )
      .get(
        '/account/sessions/:sessionId',
        {
          params: SessionParams,
          response: SessionResponse,
        },
        async ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.getSession(account, user.userId, params.sessionId)
          }),
      )
      .delete(
        '/account/sessions/:sessionId',
        {
          params: SessionParams,
        },
        async ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            await service.deleteSession(account, user.userId, params.sessionId)
            set.status = 204
            return null
          }),
      )
      .delete('/account/sessions', {}, async ({ request, set }) =>
        requests.withProject(request.headers, async ({ auth, account }) => {
          const user = authorizeAccount(auth)
          await service.deleteSessions(account, user.userId)
          set.status = 204
          return null
        }),
      )

      // ================= Tokens & Verification =================
      .post(
        '/account/tokens/magic-url',
        {
          body: CreateMagicUrlTokenBody,
          response: TokenResponse,
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ account }) => {
            set.status = 201
            return await service.createMagicUrlToken(account, body.userId, body.url)
          }),
      )
      .put(
        '/account/sessions/magic-url',
        {
          body: ConfirmMagicUrlSessionBody,
          response: SessionResponse,
        },
        async ({ body, request }) =>
          requests.withProject(request.headers, async ({ account }) => {
            return await service.confirmMagicUrlSession(account, body.userId, body.secret)
          }),
      )
      .post(
        '/account/tokens/phone',
        {
          body: CreatePhoneTokenBody,
          response: TokenResponse,
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ account }) => {
            set.status = 201
            return await service.createPhoneToken(account, body.userId)
          }),
      )
      .put(
        '/account/sessions/phone',
        {
          body: ConfirmPhoneSessionBody,
          response: SessionResponse,
        },
        async ({ body, request }) =>
          requests.withProject(request.headers, async ({ account }) => {
            return await service.confirmPhoneSession(account, body.userId, body.secret)
          }),
      )
      .post(
        '/account/verification',
        {
          body: CreateVerificationBody,
          response: TokenResponse,
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            set.status = 201
            return await service.createVerification(account, user.userId, body.url)
          }),
      )
      .put(
        '/account/verification',
        {
          body: ConfirmVerificationBody,
          response: TokenResponse,
        },
        async ({ body, request }) =>
          requests.withProject(request.headers, async ({ account }) => {
            return await service.confirmVerification(account, body.userId, body.secret)
          }),
      )
      .post(
        '/account/recovery',
        {
          body: CreatePasswordRecoveryBody,
          response: TokenResponse,
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ account }) => {
            set.status = 201
            return await service.createPasswordRecovery(account, body.email, body.url)
          }),
      )
      .put(
        '/account/recovery',
        {
          body: ConfirmPasswordRecoveryBody,
          response: TokenResponse,
        },
        async ({ body, request }) =>
          requests.withProject(request.headers, async ({ account }) => {
            return await service.confirmPasswordRecovery(
              account,
              body.userId,
              body.secret,
              body.password,
            )
          }),
      )

      // ================= MFA =================
      .patch(
        '/account/mfa',
        {
          body: UpdateAccountMfaBody,
          response: UserResponse,
        },
        async ({ body, request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.updateMfa(account, user.userId, body.mfa)
          }),
      )
      .get(
        '/account/mfa/factors',
        {
          response: MfaFactorsResponse,
        },
        async ({ request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.getMfaFactors(account, user.userId)
          }),
      )
      .post(
        '/account/mfa/authenticators/:type',
        {
          params: t.Object({ type: t.String() }),
          response: MfaAuthenticatorResponse,
        },
        async ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, account, project }) => {
            const user = authorizeAccount(auth)
            set.status = 201
            return await service.createMfaAuthenticator(
              account,
              user.userId,
              params.type,
              project.id,
            )
          }),
      )
      .put(
        '/account/mfa/authenticators/:type',
        {
          params: t.Object({ type: t.String() }),
          body: VerifyMfaAuthenticatorBody,
          response: UserResponse,
        },
        async ({ params, body, request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.verifyMfaAuthenticator(account, user.userId, params.type, body.otp)
          }),
      )
      .delete(
        '/account/mfa/authenticators/:type',
        {
          params: t.Object({ type: t.String() }),
        },
        async ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            await service.deleteMfaAuthenticator(account, user.userId, params.type)
            set.status = 204
            return null
          }),
      )
      .post(
        '/account/mfa/recovery-codes',
        {
          response: MfaRecoveryCodesResponse,
        },
        async ({ request, set }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            set.status = 201
            return await service.createMfaRecoveryCodes(account, user.userId)
          }),
      )
      .patch(
        '/account/mfa/recovery-codes',
        {
          response: MfaRecoveryCodesResponse,
        },
        async ({ request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.updateMfaRecoveryCodes(account, user.userId)
          }),
      )
      .get(
        '/account/mfa/recovery-codes',
        {
          response: MfaRecoveryCodesResponse,
        },
        async ({ request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            return await service.getMfaRecoveryCodes(account, user.userId)
          }),
      )
      .post(
        '/account/mfa/challenge',
        {
          body: CreateMfaChallengeBody,
          response: MfaChallengeResponse,
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            set.status = 201
            return await service.createMfaChallenge(account, user.userId, body.factor)
          }),
      )
      .put(
        '/account/mfa/challenge',
        {
          body: VerifyMfaChallengeBody,
          response: t.Object({ success: t.Boolean() }),
        },
        async ({ body, request }) =>
          requests.withProject(request.headers, async ({ auth, account }) => {
            const user = authorizeAccount(auth)
            const success = await service.verifyMfaChallenge(
              account,
              user.userId,
              body.otp,
              body.challengeId,
            )
            return { success }
          }),
      )
  )
}
