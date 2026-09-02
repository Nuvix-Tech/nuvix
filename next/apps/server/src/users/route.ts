import { Elysia } from 'elysia'
import type { DatabaseRequestCapabilities } from '../infrastructure/database-composition'
import {
  CreateUserBody,
  UpdateEmailBody,
  UpdateLabelsBody,
  UpdateNameBody,
  UpdatePhoneBody,
  UpdatePrefsBody,
  UpdateStatusBody,
  UserListQuery,
  UserListResponse,
  UserMembershipListQuery,
  UserMembershipListResponse,
  UserParams,
  UserResponse,
} from './contracts'
import { userDocuments } from './documents'
import { authorizeUsers, createUserService, type UserService } from './service'

export function userRoutes(
  requests: DatabaseRequestCapabilities,
  service: UserService = createUserService(),
) {
  return new Elysia({ name: 'user-routes' })
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
}
