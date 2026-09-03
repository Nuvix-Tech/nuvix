import { Doc, type Session } from '@nuvix/db'
import { createPublishableKey } from '../context/publishable-key'
import { ConflictError, NotFoundError } from '../shared/errors'
import type { CreateProjectInput, UpdateAuthSettingsInput, UpdateProjectInput } from './contracts'
import { PLATFORM_MODEL, type PlatformModel } from './model'

export type SqlQueryExecutor = <T = unknown>(
  query: TemplateStringsArray,
  ...args: unknown[]
) => Promise<T[]>

export interface PlatformService {
  createProject(session: Session, input: CreateProjectInput): Promise<Doc>
  listProjects(session: Session): Promise<Doc[]>
  getProject(session: Session, id: string): Promise<Doc>
  updateProject(session: Session, id: string, input: UpdateProjectInput): Promise<Doc>
  deleteProject(session: Session, id: string): Promise<void>

  getAuthSettings(
    session: Session,
    projectId: string,
  ): Promise<{
    sessionDurationSeconds: number
    maxActiveSessions: number
    passwordMinLength: number
    passwordRequireSymbols: boolean
  }>

  updateAuthSettings(
    session: Session,
    projectId: string,
    input: UpdateAuthSettingsInput,
  ): Promise<{
    sessionDurationSeconds: number
    maxActiveSessions: number
    passwordMinLength: number
    passwordRequireSymbols: boolean
  }>

  introspectSchemas(sql: SqlQueryExecutor): Promise<Array<{ schema_name: string }>>

  introspectTables(
    sql: SqlQueryExecutor,
    schema?: string,
  ): Promise<Array<{ table_schema: string; table_name: string; table_type: string }>>

  introspectColumns(
    sql: SqlQueryExecutor,
    schema: string,
    table: string,
  ): Promise<
    Array<{
      table_name: string
      column_name: string
      data_type: string
      is_nullable: string
      column_default: string | null
    }>
  >
}

export interface PlatformServiceDependencies {
  model?: PlatformModel
  now?: () => Date
  createId?: () => string
}

const DEFAULT_AUTH_SETTINGS = Object.freeze({
  sessionDurationSeconds: 86400,
  maxActiveSessions: 10,
  passwordMinLength: 8,
  passwordRequireSymbols: false,
})

export function createPlatformService({
  model = PLATFORM_MODEL,
  now = () => new Date(),
  createId = () => crypto.randomUUID(),
}: PlatformServiceDependencies = {}): PlatformService {
  const { collections, fields } = model

  return {
    async createProject(session, input) {
      const projectId =
        input.projectId && input.projectId !== 'unique()' ? input.projectId : createId()

      try {
        const existing = await session.getDocument(collections.projects, projectId)
        if (existing?.getId()) {
          throw new ConflictError(`Project with id "${projectId}" already exists`, {
            code: 'project_already_exists',
          })
        }
      } catch (err) {
        if (err instanceof ConflictError) throw err
      }

      const publicId = createPublishableKey(projectId, 'live')
      const doc = new Doc({
        $id: projectId,
        [fields.projects.publicId]: publicId,
        [fields.projects.name]: input.name,
        [fields.projects.description]: input.description ?? '',
        [fields.projects.enabled]: input.enabled ?? true,
        [fields.projects.authSettings]: JSON.stringify(DEFAULT_AUTH_SETTINGS),
        $createdAt: now().toISOString(),
        $updatedAt: now().toISOString(),
      })

      return await session.createDocument(collections.projects, doc)
    },

    async listProjects(session) {
      return await session.find(collections.projects, [])
    },

    async getProject(session, id) {
      try {
        const doc = await session.getDocument(collections.projects, id)
        if (!doc?.getId()) {
          throw new NotFoundError('Project not found', { code: 'project_not_found' })
        }
        return doc
      } catch (err) {
        if (err instanceof NotFoundError) throw err
        throw new NotFoundError('Project not found', { code: 'project_not_found' })
      }
    },

    async updateProject(session, id, input) {
      const project = await this.getProject(session, id)

      if (input.name !== undefined) {
        project.set(fields.projects.name, input.name)
      }
      if (input.description !== undefined) {
        project.set(fields.projects.description, input.description)
      }
      if (input.enabled !== undefined) {
        project.set(fields.projects.enabled, input.enabled)
      }

      project.set('$updatedAt', now().toISOString())
      return await session.updateDocument(collections.projects, id, project)
    },

    async deleteProject(session, id) {
      await this.getProject(session, id)
      await session.deleteDocument(collections.projects, id)
      try {
        await session.deleteDocument(collections.tenantTargets, id)
      } catch {
        // Target may not exist yet
      }
    },

    async getAuthSettings(session, projectId) {
      const project = await this.getProject(session, projectId)
      const raw = project.get(fields.projects.authSettings)
      if (typeof raw === 'string' && raw.length > 0) {
        try {
          return { ...DEFAULT_AUTH_SETTINGS, ...JSON.parse(raw) }
        } catch {
          return { ...DEFAULT_AUTH_SETTINGS }
        }
      }
      return { ...DEFAULT_AUTH_SETTINGS }
    },

    async updateAuthSettings(session, projectId, input) {
      const project = await this.getProject(session, projectId)
      const current = await this.getAuthSettings(session, projectId)

      const updated = {
        ...current,
        ...(input.sessionDurationSeconds !== undefined && {
          sessionDurationSeconds: input.sessionDurationSeconds,
        }),
        ...(input.maxActiveSessions !== undefined && {
          maxActiveSessions: input.maxActiveSessions,
        }),
        ...(input.passwordMinLength !== undefined && {
          passwordMinLength: input.passwordMinLength,
        }),
        ...(input.passwordRequireSymbols !== undefined && {
          passwordRequireSymbols: input.passwordRequireSymbols,
        }),
      }

      project.set(fields.projects.authSettings, JSON.stringify(updated))
      project.set('$updatedAt', now().toISOString())
      await session.updateDocument(collections.projects, projectId, project)

      return updated
    },

    async introspectSchemas(sql) {
      return await sql<{ schema_name: string }>`
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY schema_name ASC
      `
    },

    async introspectTables(sql, schema = 'public') {
      return await sql<{ table_schema: string; table_name: string; table_type: string }>`
        SELECT table_schema, table_name, table_type
        FROM information_schema.tables
        WHERE table_schema = ${schema}
        ORDER BY table_name ASC
      `
    },

    async introspectColumns(sql, schema = 'public', table: string) {
      return await sql<{
        table_name: string
        column_name: string
        data_type: string
        is_nullable: string
        column_default: string | null
      }>`
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = ${schema} AND table_name = ${table}
        ORDER BY ordinal_position ASC
      `
    },
  }
}
