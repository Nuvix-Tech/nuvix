import { t } from 'elysia'

export const ProjectId = t.String({ minLength: 1, maxLength: 64 })

export const CreateProjectBody = t.Object({
  projectId: t.Optional(ProjectId),
  name: t.String({ minLength: 1, maxLength: 128 }),
  description: t.Optional(t.String({ maxLength: 512 })),
  enabled: t.Optional(t.Boolean({ default: true })),
})

export const UpdateProjectBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  description: t.Optional(t.String({ maxLength: 512 })),
  enabled: t.Optional(t.Boolean()),
})

export const ProjectResponse = t.Object({
  $id: t.String(),
  name: t.String(),
  description: t.String(),
  publicId: t.String(),
  enabled: t.Boolean(),
  $createdAt: t.String(),
  $updatedAt: t.String(),
})

export const AuthSettingsBody = t.Object({
  sessionDurationSeconds: t.Optional(t.Integer({ minimum: 60, maximum: 31536000 })),
  maxActiveSessions: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
  passwordMinLength: t.Optional(t.Integer({ minimum: 6, maximum: 128 })),
  passwordRequireSymbols: t.Optional(t.Boolean()),
})

export const AuthSettingsResponse = t.Object({
  sessionDurationSeconds: t.Integer(),
  maxActiveSessions: t.Integer(),
  passwordMinLength: t.Integer(),
  passwordRequireSymbols: t.Boolean(),
})

export const SchemaMetadataResponse = t.Object({
  schema_name: t.String(),
})

export const TableMetadataResponse = t.Object({
  table_schema: t.String(),
  table_name: t.String(),
  table_type: t.String(),
})

export const ColumnMetadataResponse = t.Object({
  table_name: t.String(),
  column_name: t.String(),
  data_type: t.String(),
  is_nullable: t.String(),
  column_default: t.Union([t.String(), t.Null()]),
})

export interface CreateProjectInput {
  projectId?: string
  name: string
  description?: string
  enabled?: boolean
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  enabled?: boolean
}

export interface UpdateAuthSettingsInput {
  sessionDurationSeconds?: number
  maxActiveSessions?: number
  passwordMinLength?: number
  passwordRequireSymbols?: boolean
}
