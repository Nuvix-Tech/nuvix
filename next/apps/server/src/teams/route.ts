import { Elysia } from 'elysia'
import type { DatabaseRequestCapabilities } from '../infrastructure/database-composition'
import {
  CreateTeamBody,
  TeamListQuery,
  TeamListResponse,
  TeamParams,
  TeamResponse,
  UpdateTeamBody,
  UpdateTeamPrefsBody,
} from './contracts'
import { teamDocuments } from './documents'
import { authorizeTeams, createTeamService, type TeamService } from './service'

export function teamRoutes(
  requests: DatabaseRequestCapabilities,
  service: TeamService = createTeamService(),
) {
  return new Elysia({ name: 'team-routes' })
    .post(
      '/teams',
      {
        body: CreateTeamBody,
        response: TeamResponse,
        detail: { tags: ['teams'] },
      },
      ({ body, request, set }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeTeams(auth, 'teams.write')
          set.status = 201
          return await service.create(teamDocuments(session), auth, body)
        }),
    )
    .get(
      '/teams',
      {
        query: TeamListQuery,
        response: TeamListResponse,
        detail: { tags: ['teams'] },
      },
      ({ query, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeTeams(auth, 'teams.read')
          return await service.list(teamDocuments(session), query.limit ?? 25, query.offset ?? 0)
        }),
    )
    .get(
      '/teams/:teamId',
      {
        params: TeamParams,
        response: TeamResponse,
        detail: { tags: ['teams'] },
      },
      ({ params, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeTeams(auth, 'teams.read')
          return await service.get(teamDocuments(session), params.teamId)
        }),
    )
    .put(
      '/teams/:teamId',
      {
        params: TeamParams,
        body: UpdateTeamBody,
        response: TeamResponse,
        detail: { tags: ['teams'] },
      },
      ({ params, body, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeTeams(auth, 'teams.write')
          return await service.update(teamDocuments(session), params.teamId, body.name)
        }),
    )
    .delete(
      '/teams/:teamId',
      { params: TeamParams, detail: { tags: ['teams'] } },
      ({ params, request, set }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeTeams(auth, 'teams.write')
          await service.remove(teamDocuments(session), params.teamId)
          set.status = 204
        }),
    )
    .get(
      '/teams/:teamId/prefs',
      { params: TeamParams, detail: { tags: ['teams'] } },
      ({ params, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeTeams(auth, 'teams.read')
          return await service.getPrefs(teamDocuments(session), params.teamId)
        }),
    )
    .put(
      '/teams/:teamId/prefs',
      {
        params: TeamParams,
        body: UpdateTeamPrefsBody,
        detail: { tags: ['teams'] },
      },
      ({ params, body, request }) =>
        requests.withProject(request.headers, async ({ auth, session }) => {
          authorizeTeams(auth, 'teams.write')
          return await service.updatePrefs(teamDocuments(session), params.teamId, body.prefs)
        }),
    )
}
