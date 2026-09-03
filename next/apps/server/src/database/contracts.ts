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

// --- Tables & Rows Contracts ---
export const TableName = t.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[a-zA-Z0-9_]+$',
})

export const TableParams = t.Object(
  { name: SchemaName, table: TableName },
  { additionalProperties: false },
)

export const TableRowParams = t.Object(
  { name: SchemaName, table: TableName, rowId: t.String() },
  { additionalProperties: false },
)

export const TableQuery = t.Object(
  {
    select: t.Optional(t.String()),
    filter: t.Optional(t.String()),
    order: t.Optional(t.String()),
    limit: t.Optional(t.Integer({ minimum: 1, maximum: 1000, default: 25 })),
    offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
  },
  { additionalProperties: false },
)

export const TableCountQuery = t.Object(
  { filter: t.Optional(t.String()) },
  { additionalProperties: false },
)

export const InsertRowBody = t.Union([
  t.Record(t.String(), t.Any()),
  t.Array(t.Record(t.String(), t.Any())),
])

export const UpdateRowBody = t.Record(t.String(), t.Any())

export const TableDataResponse = t.Object(
  {
    data: t.Array(t.Record(t.String(), t.Any())),
    meta: t.Object({ total: t.Integer() }, { additionalProperties: false }),
  },
  { additionalProperties: false },
)

export const RowCountResponse = t.Object({ count: t.Integer() }, { additionalProperties: false })

export const RowResponse = t.Record(t.String(), t.Any())

// --- Collections Contracts ---
export const CollectionId = t.String({
  minLength: 1,
  maxLength: 36,
  pattern: '^[a-zA-Z0-9_.-]+$',
})

export const CollectionParams = t.Object(
  { name: SchemaName, collectionId: CollectionId },
  { additionalProperties: false },
)

export const CollectionListQuery = t.Object(
  {
    limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 25 })),
    offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
  },
  { additionalProperties: false },
)

export const CreateCollectionBody = t.Object(
  {
    collectionId: t.Optional(CollectionId),
    name: t.String({ minLength: 1, maxLength: 128 }),
    permissions: t.Optional(t.Array(t.String())),
    documentSecurity: t.Optional(t.Boolean()),
    enabled: t.Optional(t.Boolean()),
  },
  { additionalProperties: false },
)

export const UpdateCollectionBody = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
    permissions: t.Optional(t.Array(t.String())),
    documentSecurity: t.Optional(t.Boolean()),
    enabled: t.Optional(t.Boolean()),
  },
  { additionalProperties: false },
)

export const CollectionResponse = t.Object(
  {
    $id: t.String(),
    name: t.String(),
    enabled: t.Boolean(),
    documentSecurity: t.Boolean(),
    $permissions: t.Array(t.String()),
    $createdAt: t.Optional(t.String()),
    $updatedAt: t.Optional(t.String()),
    attributes: t.Optional(t.Array(t.Any())),
    indexes: t.Optional(t.Array(t.Any())),
  },
  { additionalProperties: true },
)

export const CollectionListResponse = t.Object(
  {
    data: t.Array(CollectionResponse),
    meta: t.Object({ total: t.Integer() }, { additionalProperties: false }),
  },
  { additionalProperties: false },
)

// --- Attributes Contracts ---
export const AttributeId = t.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-zA-Z0-9_]+$',
})

export const AttributeParams = t.Object(
  { name: SchemaName, collectionId: CollectionId, attributeId: AttributeId },
  { additionalProperties: false },
)

export const CreateAttributeBody = t.Object(
  {
    key: AttributeId,
    type: t.UnionEnum([
      'string',
      'integer',
      'float',
      'boolean',
      'datetime',
      'email',
      'url',
      'ip',
      'enum',
      'relationship',
    ]),
    size: t.Optional(t.Integer()),
    required: t.Optional(t.Boolean()),
    default: t.Optional(t.Any()),
    array: t.Optional(t.Boolean()),
    elements: t.Optional(t.Array(t.String())),
    relatedCollection: t.Optional(t.String()),
    relationType: t.Optional(t.UnionEnum(['oneToOne', 'oneToMany', 'manyToOne', 'manyToMany'])),
    twoWay: t.Optional(t.Boolean()),
    twoWayKey: t.Optional(t.String()),
    onDelete: t.Optional(t.UnionEnum(['cascade', 'restrict', 'setNull'])),
  },
  { additionalProperties: false },
)

export const AttributeResponse = t.Object(
  {
    key: t.String(),
    type: t.String(),
    status: t.String(),
    error: t.Optional(t.String()),
    required: t.Boolean(),
    array: t.Optional(t.Boolean()),
    size: t.Optional(t.Integer()),
    default: t.Optional(t.Any()),
  },
  { additionalProperties: true },
)

export const AttributeListResponse = t.Object(
  {
    data: t.Array(AttributeResponse),
    meta: t.Object({ total: t.Integer() }, { additionalProperties: false }),
  },
  { additionalProperties: false },
)

// --- Indexes Contracts ---
export const IndexId = t.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-zA-Z0-9_]+$',
})

export const IndexParams = t.Object(
  { name: SchemaName, collectionId: CollectionId, indexId: IndexId },
  { additionalProperties: false },
)

export const CreateIndexBody = t.Object(
  {
    key: IndexId,
    type: t.UnionEnum(['key', 'unique', 'fulltext']),
    attributes: t.Array(t.String()),
    orders: t.Optional(t.Array(t.UnionEnum(['ASC', 'DESC']))),
  },
  { additionalProperties: false },
)

export const IndexResponse = t.Object(
  {
    key: t.String(),
    type: t.String(),
    status: t.String(),
    attributes: t.Array(t.String()),
    orders: t.Optional(t.Array(t.String())),
  },
  { additionalProperties: true },
)

export const IndexListResponse = t.Object(
  {
    data: t.Array(IndexResponse),
    meta: t.Object({ total: t.Integer() }, { additionalProperties: false }),
  },
  { additionalProperties: false },
)

// --- Documents Contracts ---
export const DocumentId = t.String({
  minLength: 1,
  maxLength: 36,
  pattern: '^[a-zA-Z0-9_.-]+$',
})

export const DocumentParams = t.Object(
  { name: SchemaName, collectionId: CollectionId, documentId: DocumentId },
  { additionalProperties: false },
)

export const CreateDocumentBody = t.Object(
  {
    documentId: t.Optional(DocumentId),
    data: t.Record(t.String(), t.Any()),
    permissions: t.Optional(t.Array(t.String())),
  },
  { additionalProperties: false },
)

export const UpdateDocumentBody = t.Object(
  {
    data: t.Record(t.String(), t.Any()),
    permissions: t.Optional(t.Array(t.String())),
  },
  { additionalProperties: false },
)

export const DocumentListQuery = t.Object(
  {
    queries: t.Optional(t.Array(t.String())),
    limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 25 })),
    offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
  },
  { additionalProperties: false },
)

export const DocumentResponse = t.Record(t.String(), t.Any())

export const DocumentListResponse = t.Object(
  {
    data: t.Array(DocumentResponse),
    meta: t.Object({ total: t.Integer() }, { additionalProperties: false }),
  },
  { additionalProperties: false },
)
