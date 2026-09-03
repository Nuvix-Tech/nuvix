import { t } from 'elysia'

export const BucketId = t.String({
  minLength: 1,
  maxLength: 36,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$',
})

export const ObjectKey = t.String({
  minLength: 1,
  maxLength: 1024,
})

export const CreateBucketBody = t.Object(
  {
    bucketId: t.Optional(t.Union([BucketId, t.Literal('unique()')])),
    name: t.String({ minLength: 1, maxLength: 128 }),
    permissions: t.Optional(t.Array(t.String({ maxLength: 256 }))),
    fileSecurity: t.Optional(t.Boolean()),
    enabled: t.Optional(t.Boolean()),
    maximumFileSize: t.Optional(t.Integer({ minimum: 1 })),
    allowedFileExtensions: t.Optional(t.Array(t.String({ maxLength: 32 }))),
    compression: t.Optional(t.String({ maxLength: 16 })),
    encryption: t.Optional(t.Boolean()),
    antivirus: t.Optional(t.Boolean()),
  },
  { additionalProperties: false },
)

export const UpdateBucketBody = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
    permissions: t.Optional(t.Array(t.String({ maxLength: 256 }))),
    fileSecurity: t.Optional(t.Boolean()),
    enabled: t.Optional(t.Boolean()),
    maximumFileSize: t.Optional(t.Integer({ minimum: 1 })),
    allowedFileExtensions: t.Optional(t.Array(t.String({ maxLength: 32 }))),
    compression: t.Optional(t.String({ maxLength: 16 })),
    encryption: t.Optional(t.Boolean()),
    antivirus: t.Optional(t.Boolean()),
  },
  { additionalProperties: false },
)

export const BucketPolicyStatementSchema = t.Object({
  sid: t.Optional(t.String({ maxLength: 64 })),
  effect: t.Union([t.Literal('allow'), t.Literal('deny')]),
  principal: t.Union([t.String(), t.Array(t.String())]),
  actions: t.Array(t.String()),
  resources: t.Array(t.String()),
})

export const BucketPolicySchema = t.Object({
  version: t.Optional(t.String()),
  statements: t.Array(BucketPolicyStatementSchema),
})

export const BucketResponse = t.Object({
  $id: t.String(),
  $createdAt: t.String(),
  $updatedAt: t.String(),
  $permissions: t.Array(t.String()),
  name: t.String(),
  enabled: t.Boolean(),
  maximumFileSize: t.Integer(),
  allowedFileExtensions: t.Array(t.String()),
  compression: t.String(),
  encryption: t.Boolean(),
  antivirus: t.Boolean(),
  fileSecurity: t.Boolean(),
})

export const ObjectResponse = t.Object({
  $id: t.String(),
  $createdAt: t.String(),
  $updatedAt: t.String(),
  $permissions: t.Array(t.String()),
  bucketId: t.String(),
  key: t.String(),
  size: t.Integer(),
  mimeType: t.String(),
  etag: t.String(),
  metadata: t.Record(t.String(), t.Unknown()),
})

export const PresignBody = t.Object(
  {
    key: ObjectKey,
    action: t.Union([t.Literal('getObject'), t.Literal('putObject')]),
    expiresIn: t.Optional(t.Integer({ minimum: 1, maximum: 604800 })), // Up to 7 days
  },
  { additionalProperties: false },
)

export const PresignResponse = t.Object({
  url: t.String(),
  expiresAt: t.String(),
})

export const InitiateMultipartBody = t.Object(
  {
    key: ObjectKey,
    mimeType: t.Optional(t.String({ maxLength: 128 })),
    metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  },
  { additionalProperties: false },
)

export const MultipartPartSchema = t.Object({
  partNumber: t.Integer({ minimum: 1, maximum: 10000 }),
  etag: t.String(),
})

export const CompleteMultipartBody = t.Object(
  {
    parts: t.Array(MultipartPartSchema),
  },
  { additionalProperties: false },
)

export const UpdateObjectPermissionsBody = t.Object(
  {
    permissions: t.Array(t.String({ maxLength: 256 })),
  },
  { additionalProperties: false },
)
