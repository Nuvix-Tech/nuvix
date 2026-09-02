import { Elysia } from 'elysia'
import type { ProjectAuthContext } from '../context/project'
import type { DatabaseRequestCapabilities } from '../infrastructure/database-composition'
import { UnauthorizedError } from '../shared/errors'
import { Preferences } from '../teams/contracts'
import {
  CreateAccountBody,
  CreateEmailSessionBody,
  SessionListQuery,
  SessionListResponse,
  SessionParams,
  SessionResponse,
  UpdateAccountEmailBody,
  UpdateAccountNameBody,
  UpdateAccountPrefsBody,
  UpdatePasswordBody,
  UserResponse,
} from './contracts'
import { type AccountService, createAccountService } from './service'

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
  return new Elysia({ name: 'account-routes' })
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
}
