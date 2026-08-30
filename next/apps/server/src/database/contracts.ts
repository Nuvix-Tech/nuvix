import { t } from 'elysia'

export const SchemaName = t.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[a-z][a-z0-9_]{0,254}$',
})

export const SchemaType = t.UnionEnum(['document', 'managed', 'unmanaged'])
export const SchemaDescription = t.Nullable(t.String({ maxLength: 255 }))

export const SchemaResponse = t.Object(
  {
    name: SchemaName,
    description: SchemaDescription,
    type: SchemaType,
  },
  { additionalProperties: false },
)

export const SchemaListResponse = t.Object(
  {
    data: t.Array(SchemaResponse),
    meta: t.Object(
      {
        total: t.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export const SchemaParams = t.Object({ name: SchemaName }, { additionalProperties: false })
export const SchemaListQuery = t.Object(
  { type: t.Optional(SchemaType) },
  { additionalProperties: false },
)

export const CreateSchemaBody = t.Object(
  {
    name: SchemaName,
    description: t.Optional(SchemaDescription),
    type: SchemaType,
  },
  { additionalProperties: false },
)

export const UpdateSchemaBody = t.Object(
  { description: t.Optional(SchemaDescription) },
  { additionalProperties: false },
)
