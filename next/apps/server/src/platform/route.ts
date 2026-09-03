import type { Session } from '@nuvix/db'
import { Elysia, t } from 'elysia'
import {
  AuthSettingsBody,
  AuthSettingsResponse,
  ColumnMetadataResponse,
  CreateProjectBody,
  ProjectId,
  ProjectResponse,
  SchemaMetadataResponse,
  TableMetadataResponse,
  UpdateProjectBody,
} from './contracts'
import type { PlatformService, SqlQueryExecutor } from './service'

function isoDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'string') {
    return value
  }
  return new Date().toISOString()
}

export interface PlatformRouteDependencies {
  readonly service: PlatformService
  readonly getPlatformSession: () => Promise<Session>
  readonly getTenantSql?: (projectId: string) => Promise<SqlQueryExecutor>
}

export function platformRoute({
  service,
  getPlatformSession,
  getTenantSql,
}: PlatformRouteDependencies) {
  return new Elysia({ name: 'platform-routes', prefix: '/platform' })
    .post(
      '/projects',
      {
        body: CreateProjectBody,
        response: { 201: ProjectResponse },
      },
      async ({ body, set }) => {
        const session = await getPlatformSession()
        const doc = await service.createProject(session, body)
        set.status = 201
        return {
          $id: doc.getId(),
          name: doc.get('name', ''),
          description: doc.get('description', ''),
          publicId: doc.get('publicId', ''),
          enabled: doc.get('enabled', true),
          $createdAt: isoDate(doc.get('$createdAt')),
          $updatedAt: isoDate(doc.get('$updatedAt')),
        }
      },
    )
    .get(
      '/projects',
      {
        response: {
          200: t.Object({
            total: t.Integer(),
            projects: t.Array(ProjectResponse),
          }),
        },
      },
      async () => {
        const session = await getPlatformSession()
        const docs = await service.listProjects(session)
        return {
          total: docs.length,
          projects: docs.map((doc) => ({
            $id: doc.getId(),
            name: doc.get('name', ''),
            description: doc.get('description', ''),
            publicId: doc.get('publicId', ''),
            enabled: doc.get('enabled', true),
            $createdAt: isoDate(doc.get('$createdAt')),
            $updatedAt: isoDate(doc.get('$updatedAt')),
          })),
        }
      },
    )
    .get(
      '/projects/:projectId',
      {
        params: t.Object({ projectId: ProjectId }),
        response: { 200: ProjectResponse },
      },
      async ({ params }) => {
        const session = await getPlatformSession()
        const doc = await service.getProject(session, params.projectId)
        return {
          $id: doc.getId(),
          name: doc.get('name', ''),
          description: doc.get('description', ''),
          publicId: doc.get('publicId', ''),
          enabled: doc.get('enabled', true),
          $createdAt: isoDate(doc.get('$createdAt')),
          $updatedAt: isoDate(doc.get('$updatedAt')),
        }
      },
    )
    .put(
      '/projects/:projectId',
      {
        params: t.Object({ projectId: ProjectId }),
        body: UpdateProjectBody,
        response: { 200: ProjectResponse },
      },
      async ({ params, body }) => {
        const session = await getPlatformSession()
        const doc = await service.updateProject(session, params.projectId, body)
        return {
          $id: doc.getId(),
          name: doc.get('name', ''),
          description: doc.get('description', ''),
          publicId: doc.get('publicId', ''),
          enabled: doc.get('enabled', true),
          $createdAt: isoDate(doc.get('$createdAt')),
          $updatedAt: isoDate(doc.get('$updatedAt')),
        }
      },
    )
    .delete(
      '/projects/:projectId',
      {
        params: t.Object({ projectId: ProjectId }),
      },
      async ({ params, set }) => {
        const session = await getPlatformSession()
        await service.deleteProject(session, params.projectId)
        set.status = 204
        return null
      },
    )
    .get(
      '/projects/:projectId/auth',
      {
        params: t.Object({ projectId: ProjectId }),
        response: { 200: AuthSettingsResponse },
      },
      async ({ params }) => {
        const session = await getPlatformSession()
        return await service.getAuthSettings(session, params.projectId)
      },
    )
    .put(
      '/projects/:projectId/auth',
      {
        params: t.Object({ projectId: ProjectId }),
        body: AuthSettingsBody,
        response: { 200: AuthSettingsResponse },
      },
      async ({ params, body }) => {
        const session = await getPlatformSession()
        return await service.updateAuthSettings(session, params.projectId, body)
      },
    )
    .get(
      '/projects/:projectId/metadata/schemas',
      {
        params: t.Object({ projectId: ProjectId }),
        response: {
          200: t.Object({
            schemas: t.Array(SchemaMetadataResponse),
          }),
        },
      },
      async ({ params }) => {
        if (!getTenantSql) {
          throw new Error('Tenant SQL executor not configured')
        }
        const sql = await getTenantSql(params.projectId)
        const schemas = await service.introspectSchemas(sql)
        return { schemas }
      },
    )
    .get(
      '/projects/:projectId/metadata/tables',
      {
        params: t.Object({ projectId: ProjectId }),
        query: t.Object({
          schema: t.Optional(t.String()),
        }),
        response: {
          200: t.Object({
            tables: t.Array(TableMetadataResponse),
          }),
        },
      },
      async ({ params, query }) => {
        if (!getTenantSql) {
          throw new Error('Tenant SQL executor not configured')
        }
        const sql = await getTenantSql(params.projectId)
        const tables = await service.introspectTables(sql, query.schema)
        return { tables }
      },
    )
    .get(
      '/projects/:projectId/metadata/columns',
      {
        params: t.Object({ projectId: ProjectId }),
        query: t.Object({
          schema: t.Optional(t.String()),
          table: t.String({ minLength: 1 }),
        }),
        response: {
          200: t.Object({
            columns: t.Array(ColumnMetadataResponse),
          }),
        },
      },
      async ({ params, query }) => {
        if (!getTenantSql) {
          throw new Error('Tenant SQL executor not configured')
        }
        const sql = await getTenantSql(params.projectId)
        const columns = await service.introspectColumns(sql, query.schema ?? 'public', query.table)
        return { columns }
      },
    )
}
