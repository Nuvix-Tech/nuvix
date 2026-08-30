import { Elysia } from 'elysia'
import type { ProjectAuthContext } from '../context/project'
import type { DatabaseRequestCapabilities } from '../infrastructure/database-composition'
import { ForbiddenError } from '../shared/errors'
import {
  CreateSchemaBody,
  SchemaListQuery,
  SchemaListResponse,
  SchemaParams,
  SchemaResponse,
  UpdateSchemaBody,
} from './contracts'

type SchemaScope = 'schemas.read' | 'schemas.write'

/** Allows trusted admin sessions and API keys carrying the required schema scope. */
export function authorizeSchemas(auth: ProjectAuthContext, scope: SchemaScope): void {
  const isAdminSession = auth.type === 'session' && auth.scopes.includes(scope)
  const isScopedKey = auth.type === 'apiKey' && auth.scopes.includes(scope)
  if (!isAdminSession && !isScopedKey) throw new ForbiddenError()
}

export function schemaRoutes(requests: DatabaseRequestCapabilities) {
  return new Elysia({ name: 'schema-routes' })
    .get(
      '/database/schemas',
      {
        query: SchemaListQuery,
        response: SchemaListResponse,
        detail: { tags: ['database'] },
      },
      ({ query, request }) =>
        requests.withProject(request.headers, async ({ auth, schemas }) => {
          authorizeSchemas(auth, 'schemas.read')
          const result = await schemas.list(query.type)
          return { data: [...result.data], meta: { total: result.meta.total } }
        }),
    )
    .post(
      '/database/schemas',
      {
        body: CreateSchemaBody,
        response: SchemaResponse,
        detail: { tags: ['database'] },
      },
      ({ body, request, set }) =>
        requests.withProject(request.headers, async ({ auth, schemas }) => {
          authorizeSchemas(auth, 'schemas.write')
          set.status = 201
          return await schemas.create(body)
        }),
    )
    .get(
      '/database/schemas/:name',
      {
        params: SchemaParams,
        response: SchemaResponse,
        detail: { tags: ['database'] },
      },
      ({ params, request }) =>
        requests.withProject(request.headers, async ({ auth, schemas }) => {
          authorizeSchemas(auth, 'schemas.read')
          return await schemas.get(params.name)
        }),
    )
    .patch(
      '/database/schemas/:name',
      {
        params: SchemaParams,
        body: UpdateSchemaBody,
        response: SchemaResponse,
        detail: { tags: ['database'] },
      },
      ({ body, params, request }) =>
        requests.withProject(request.headers, async ({ auth, schemas }) => {
          authorizeSchemas(auth, 'schemas.write')
          return await schemas.update(params.name, body.description)
        }),
    )
    .delete(
      '/database/schemas/:name',
      { params: SchemaParams, detail: { tags: ['database'] } },
      ({ params, request, set }) =>
        requests.withProject(request.headers, async ({ auth, schemas }) => {
          authorizeSchemas(auth, 'schemas.write')
          await schemas.remove(params.name)
          set.status = 204
        }),
    )
}
