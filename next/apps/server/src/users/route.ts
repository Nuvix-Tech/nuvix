import { Elysia } from 'elysia'
import { SessionListQuery, SessionListResponse, SessionResponse } from '../account/contracts'
import type { DatabaseRequestCapabilities } from '../infrastructure/database-composition'
import {
  CreateArgon2UserBody,
  CreateBcryptUserBody,
  CreateUserBody,
  CreateUserJwtBody,
  JwtResponse,
  MfaAuthenticatorParams,
  MfaFactorsResponse,
  MfaRecoveryCodesResponse,
  UpdateEmailBody,
  UpdateLabelsBody,
  UpdateMfaBody,
  UpdateNameBody,
  UpdatePhoneBody,
  UpdatePrefsBody,
  UpdateStatusBody,
  UpdateUserPasswordBody,
  UserListQuery,
  UserListResponse,
  UserMembershipListQuery,
  UserMembershipListResponse,
  UserParams,
  UserResponse,
  UserSessionParams,
} from './contracts'
import { userDocuments } from './documents'
import { authorizeUsers, createUserService, type UserService } from './service'

export function userRoutes(
  requests: DatabaseRequestCapabilities,
  service: UserService = createUserService(),
) {
  return new Elysia({ name: 'user-routes' })
    .patch(
      '/users/:userId/mfa',
      {
        params: UserParams,
        body: UpdateMfaBody,
        response: UserResponse,
        detail: { tags: ['users'] },
      },
      ({ params, body, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.write')
          return await service.updateMfa(userDocuments(session), params.userId, body.mfa)
        }),
    )
    .get(
      '/users/:userId/mfa/factors',
      {
        params: UserParams,
        response: MfaFactorsResponse,
        detail: { tags: ['users'] },
      },
      ({ params, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.read')
          return await service.getMfaFactors(userDocuments(session), params.userId)
        }),
    )
    .get(
      '/users/:userId/mfa/recovery-codes',
      {
        params: UserParams,
        response: MfaRecoveryCodesResponse,
        detail: { tags: ['users'] },
      },
      ({ params, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.read')
          return await service.getMfaRecoveryCodes(userDocuments(session), params.userId)
        }),
    )
    .patch(
      '/users/:userId/mfa/recovery-codes',
      {
        params: UserParams,
        response: MfaRecoveryCodesResponse,
        detail: { tags: ['users'] },
      },
      ({ params, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.write')
          return await service.regenerateMfaRecoveryCodes(userDocuments(session), params.userId)
        }),
    )
    .put(
      '/users/:userId/mfa/recovery-codes',
      {
        params: UserParams,
        response: MfaRecoveryCodesResponse,
        detail: { tags: ['users'] },
      },
      ({ params, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.write')
          return await service.regenerateMfaRecoveryCodes(userDocuments(session), params.userId)
        }),
    )
    .delete(
      '/users/:userId/mfa/authenticators/:type',
      {
        params: MfaAuthenticatorParams,
        detail: { tags: ['users'] },
      },
      ({ params, request, set }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.write')
          await service.deleteMfaAuthenticator(userDocuments(session), params.userId, params.type)
          set.status = 204
        }),
    )

    .post(
      '/users',
      {
        body: CreateUserBody,
        response: UserResponse,
        detail: { tags: ['users'] },
      },
      ({ body, request, set }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.write')
          set.status = 201
          return await service.create(userDocuments(session), body)
        }),
    )
    .post(
      '/users/argon2',
      {
        body: CreateArgon2UserBody,
        response: UserResponse,
        detail: { tags: ['users'] },
      },
      ({ body, request, set }) =>
        requests.withProject(request.headers, async ({ auth, account }) => {
          authorizeUsers(auth, 'users.write')
          set.status = 201
          return await service.createWithPassword(account, body, 'argon2id')
        }),
    )
    .post(
      '/users/bcrypt',
      {
        body: CreateBcryptUserBody,
        response: UserResponse,
        detail: { tags: ['users'] },
      },
      ({ body, request, set }) =>
        requests.withProject(request.headers, async ({ auth, account }) => {
          authorizeUsers(auth, 'users.write')
          set.status = 201
          return await service.createWithPassword(account, body, 'bcrypt')
        }),
    )
    .get(
      '/users',
      {
        query: UserListQuery,
        response: UserListResponse,
        detail: { tags: ['users'] },
      },
      ({ query, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.read')
          const { limit, offset, ...filters } = query
          return await service.list(userDocuments(session), filters, limit ?? 25, offset ?? 0)
        }),
    )
    .get(
      '/users/:userId',
      {
        params: UserParams,
        response: UserResponse,
        detail: { tags: ['users'] },
      },
      ({ params, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.read')
          return await service.get(userDocuments(session), params.userId)
        }),
    )
    .delete(
      '/users/:userId',
      {
        params: UserParams,
        detail: { tags: ['users'] },
      },
      async ({ params, request, set }) =>
        requests.withProject(request.headers, async ({ auth, account }) => {
          authorizeUsers(auth, 'users.write')
          await service.remove(account, params.userId)
          set.status = 204
          return null
        }),
    )
    .patch(
      '/users/:userId/name',
      {
        params: UserParams,
        body: UpdateNameBody,
        response: UserResponse,
        detail: { tags: ['users'] },
      },
      ({ params, body, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.write')
          return await service.updateName(userDocuments(session), params.userId, body.name)
        }),
    )
    .patch(
      '/users/:userId/password',
      {
        params: UserParams,
        body: UpdateUserPasswordBody,
        response: UserResponse,
        detail: { tags: ['users'] },
      },
      ({ params, body, request }) =>
        requests.withProject(request.headers, async ({ auth, account }) => {
          authorizeUsers(auth, 'users.write')
          return await service.updatePassword(account, params.userId, body.password)
        }),
    )
    .patch(
      '/users/:userId/email',
      {
        params: UserParams,
        body: UpdateEmailBody,
        response: UserResponse,
        detail: { tags: ['users'] },
      },
      ({ params, body, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.write')
          return await service.updateEmail(userDocuments(session), params.userId, body.email)
        }),
    )
    .patch(
      '/users/:userId/phone',
      {
        params: UserParams,
        body: UpdatePhoneBody,
        response: UserResponse,
        detail: { tags: ['users'] },
      },
      ({ params, body, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.write')
          return await service.updatePhone(userDocuments(session), params.userId, body.phone)
        }),
    )
    .get(
      '/users/:userId/prefs',
      { params: UserParams, detail: { tags: ['users'] } },
      ({ params, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.read')
          return await service.getPrefs(userDocuments(session), params.userId)
        }),
    )
    .patch(
      '/users/:userId/prefs',
      {
        params: UserParams,
        body: UpdatePrefsBody,
        detail: { tags: ['users'] },
      },
      ({ params, body, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.write')
          return await service.updatePrefs(userDocuments(session), params.userId, body.prefs)
        }),
    )
    .put(
      '/users/:userId/labels',
      {
        params: UserParams,
        body: UpdateLabelsBody,
        response: UserResponse,
        detail: { tags: ['users'] },
      },
      ({ params, body, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.write')
          return await service.updateLabels(userDocuments(session), params.userId, body.labels)
        }),
    )
    .patch(
      '/users/:userId/status',
      {
        params: UserParams,
        body: UpdateStatusBody,
        response: UserResponse,
        detail: { tags: ['users'] },
      },
      ({ params, body, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.write')
          return await service.updateStatus(userDocuments(session), params.userId, body.status)
        }),
    )
    .get(
      '/users/:userId/memberships',
      {
        params: UserParams,
        query: UserMembershipListQuery,
        response: UserMembershipListResponse,
        detail: { tags: ['users'] },
      },
      ({ params, query, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeUsers(auth, 'users.read')
          return await service.listMemberships(
            userDocuments(session),
            params.userId,
            query.limit ?? 25,
            query.offset ?? 0,
          )
        }),
    )
    .get(
      '/users/:userId/sessions',
      {
        params: UserParams,
        query: SessionListQuery,
        response: SessionListResponse,
        detail: { tags: ['users'] },
      },
      ({ params, query, request }) =>
        requests.withProject(request.headers, async ({ auth, account }) => {
          authorizeUsers(auth, 'users.read')
          return await service.listSessions(
            account,
            params.userId,
            query.limit ?? 25,
            query.offset ?? 0,
          )
        }),
    )
    .post(
      '/users/:userId/sessions',
      {
        params: UserParams,
        response: SessionResponse,
        detail: { tags: ['users'] },
      },
      ({ params, request, set }) =>
        requests.withProject(request.headers, async ({ auth, account }) => {
          authorizeUsers(auth, 'users.write')
          set.status = 201
          return await service.createSession(account, params.userId)
        }),
    )
    .delete(
      '/users/:userId/sessions',
      {
        params: UserParams,
        detail: { tags: ['users'] },
      },
      async ({ params, request, set }) =>
        requests.withProject(request.headers, async ({ auth, account }) => {
          authorizeUsers(auth, 'users.write')
          await service.deleteSessions(account, params.userId)
          set.status = 204
          return null
        }),
    )
    .delete(
      '/users/:userId/sessions/:sessionId',
      {
        params: UserSessionParams,
        detail: { tags: ['users'] },
      },
      async ({ params, request, set }) =>
        requests.withProject(request.headers, async ({ auth, account }) => {
          authorizeUsers(auth, 'users.write')
          await service.deleteSession(account, params.userId, params.sessionId)
          set.status = 204
          return null
        }),
    )
    .post(
      '/users/:userId/jwts',
      {
        params: UserParams,
        body: CreateUserJwtBody,
        response: JwtResponse,
        detail: { tags: ['users'] },
      },
      async ({ params, body, request, set }) =>
        requests.withProject(request.headers, async ({ auth, account, project }) => {
          authorizeUsers(auth, 'users.write')
          set.status = 201
          return await service.createJwt(
            account,
            project.id,
            params.userId,
            body.duration ?? 900,
            body.sessionId,
          )
        }),
    )
}
