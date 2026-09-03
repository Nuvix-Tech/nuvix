import { Elysia } from 'elysia'
import type { ProjectAuthContext } from '../context/project'
import type { DatabaseRequestCapabilities } from '../infrastructure/database-composition'
import { ForbiddenError, NotFoundError, ServiceUnavailableError } from '../shared/errors'
import {
  AttributeListResponse,
  AttributeParams,
  AttributeResponse,
  CollectionListQuery,
  CollectionListResponse,
  CollectionParams,
  CollectionResponse,
  CreateAttributeBody,
  CreateCollectionBody,
  CreateDocumentBody,
  CreateIndexBody,
  CreateSchemaBody,
  DocumentListQuery,
  DocumentListResponse,
  DocumentParams,
  DocumentResponse,
  IndexListResponse,
  IndexParams,
  IndexResponse,
  InsertRowBody,
  RowCountResponse,
  RowResponse,
  SchemaListQuery,
  SchemaListResponse,
  SchemaParams,
  SchemaResponse,
  TableCountQuery,
  TableDataResponse,
  TableParams,
  TableQuery,
  TableRowParams,
  UpdateCollectionBody,
  UpdateDocumentBody,
  UpdateRowBody,
  UpdateSchemaBody,
} from './contracts'
import {
  createDocumentDataService,
  toAttributeResponse,
  toCollectionResponse,
  toDocumentResponse,
  toIndexResponse,
} from './documents'
import { parseFilterString } from './query'

type SchemaScope = 'schemas.read' | 'schemas.write'

/** Allows trusted admin sessions and API keys carrying the required schema scope. */
export function authorizeSchemas(auth: ProjectAuthContext, scope: SchemaScope): void {
  const scopes = 'scopes' in auth ? auth.scopes : []
  const isAdminSession = auth.type === 'session' && scopes.includes(scope)
  const isScopedKey = auth.type === 'apiKey' && scopes.includes(scope)
  if (!isAdminSession && !isScopedKey) throw new ForbiddenError()
}

export function authorizeTableAccess(auth: ProjectAuthContext, mode: 'read' | 'write'): void {
  const scopes = 'scopes' in auth ? auth.scopes : []
  const scope = mode === 'read' ? 'schemas.tables.read' : 'schemas.tables.write'
  const fallback = mode === 'read' ? 'tables.read' : 'tables.write'
  const allowed =
    scopes.includes(scope) || scopes.includes(fallback) || scopes.includes(`schemas.${mode}`)
  if (!allowed && auth.type !== 'session') throw new ForbiddenError()
}

export function authorizeCollectionAccess(auth: ProjectAuthContext, mode: 'read' | 'write'): void {
  const scopes = 'scopes' in auth ? auth.scopes : []
  const scope = mode === 'read' ? 'collections.read' : 'collections.write'
  const allowed = scopes.includes(scope) || scopes.includes(`schemas.${mode}`)
  if (!allowed && auth.type !== 'session') throw new ForbiddenError()
}

export function authorizeDocumentAccess(auth: ProjectAuthContext, _mode: 'read' | 'write'): void {
  if (auth.type === 'guest') throw new ForbiddenError()
}

export function schemaRoutes(requests: DatabaseRequestCapabilities) {
  return (
    new Elysia({ name: 'database-routes' })
      // --- Schemas Routes ---
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

      // --- Tables & Rows Routes (SQL) ---
      .get(
        '/database/schemas/:name/tables/:table',
        {
          params: TableParams,
          query: TableQuery,
          response: TableDataResponse,
          detail: { tags: ['database-tables'] },
        },
        ({ params, query, request }) =>
          requests.withProject(request.headers, async ({ auth, tables }) => {
            authorizeTableAccess(auth, 'read')
            if (!tables) throw new ServiceUnavailableError('Table query service unavailable')
            const filters = parseFilterString(query.filter)
            const select = query.select ? query.select.split(',').map((s) => s.trim()) : undefined
            const orderBy = query.order
              ? query.order.split(',').map((o) => {
                  const [column, direction] = o.trim().split('.')
                  return {
                    column: column ?? '',
                    direction: direction === 'desc' ? ('desc' as const) : ('asc' as const),
                  }
                })
              : undefined
            const data = await tables.query(params.name, params.table, {
              select,
              filters,
              orderBy,
              limit: query.limit,
              offset: query.offset,
            })
            return { data: [...data], meta: { total: data.length } }
          }),
      )
      .get(
        '/database/schemas/:name/tables/:table/count',
        {
          params: TableParams,
          query: TableCountQuery,
          response: RowCountResponse,
          detail: { tags: ['database-tables'] },
        },
        ({ params, query, request }) =>
          requests.withProject(request.headers, async ({ auth, tables }) => {
            authorizeTableAccess(auth, 'read')
            if (!tables) throw new ServiceUnavailableError('Table query service unavailable')
            const filters = parseFilterString(query.filter)
            const count = await tables.count(params.name, params.table, filters)
            return { count }
          }),
      )
      .get(
        '/database/schemas/:name/tables/:table/:rowId',
        {
          params: TableRowParams,
          response: RowResponse,
          detail: { tags: ['database-tables'] },
        },
        ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, tables }) => {
            authorizeTableAccess(auth, 'read')
            if (!tables) throw new ServiceUnavailableError('Table query service unavailable')
            const row = await tables.get(params.name, params.table, params.rowId)
            if (!row) throw new NotFoundError('Row not found', { code: 'row_not_found' })
            return row
          }),
      )
      .post(
        '/database/schemas/:name/tables/:table',
        {
          params: TableParams,
          body: InsertRowBody,
          detail: { tags: ['database-tables'] },
        },
        ({ body, params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, tables }) => {
            authorizeTableAccess(auth, 'write')
            if (!tables) throw new ServiceUnavailableError('Table query service unavailable')
            const inserted = await tables.insert(
              params.name,
              params.table,
              body as Record<string, unknown>,
            )
            set.status = 201
            return Array.isArray(body) ? inserted : (inserted[0] ?? {})
          }),
      )
      .patch(
        '/database/schemas/:name/tables/:table/:rowId',
        {
          params: TableRowParams,
          body: UpdateRowBody,
          detail: { tags: ['database-tables'] },
        },
        ({ body, params, request }) =>
          requests.withProject(request.headers, async ({ auth, tables }) => {
            authorizeTableAccess(auth, 'write')
            if (!tables) throw new ServiceUnavailableError('Table query service unavailable')
            const updated = await tables.update(
              params.name,
              params.table,
              body,
              undefined,
              params.rowId,
            )
            if (updated.length === 0)
              throw new NotFoundError('Row not found', { code: 'row_not_found' })
            return updated[0] ?? {}
          }),
      )
      .patch(
        '/database/schemas/:name/tables/:table',
        {
          params: TableParams,
          query: TableCountQuery,
          body: UpdateRowBody,
          detail: { tags: ['database-tables'] },
        },
        ({ body, params, query, request }) =>
          requests.withProject(request.headers, async ({ auth, tables }) => {
            authorizeTableAccess(auth, 'write')
            if (!tables) throw new ServiceUnavailableError('Table query service unavailable')
            const filters = parseFilterString(query.filter)
            const updated = await tables.update(params.name, params.table, body, filters)
            return { data: [...updated], meta: { total: updated.length } }
          }),
      )
      .delete(
        '/database/schemas/:name/tables/:table/:rowId',
        {
          params: TableRowParams,
          detail: { tags: ['database-tables'] },
        },
        ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, tables }) => {
            authorizeTableAccess(auth, 'write')
            if (!tables) throw new ServiceUnavailableError('Table query service unavailable')
            const deleted = await tables.delete(params.name, params.table, undefined, params.rowId)
            if (deleted.length === 0)
              throw new NotFoundError('Row not found', { code: 'row_not_found' })
            set.status = 204
          }),
      )
      .delete(
        '/database/schemas/:name/tables/:table',
        {
          params: TableParams,
          query: TableCountQuery,
          detail: { tags: ['database-tables'] },
        },
        ({ params, query, request, set }) =>
          requests.withProject(request.headers, async ({ auth, tables }) => {
            authorizeTableAccess(auth, 'write')
            if (!tables) throw new ServiceUnavailableError('Table query service unavailable')
            const filters = parseFilterString(query.filter)
            await tables.delete(params.name, params.table, filters)
            set.status = 204
          }),
      )

      // --- Collections Routes (Document plane) ---
      .get(
        '/database/schemas/:name/collections',
        {
          params: SchemaParams,
          query: CollectionListQuery,
          response: CollectionListResponse,
          detail: { tags: ['database-collections'] },
        },
        ({ query, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeCollectionAccess(auth, 'read')
            const service = createDocumentDataService(session)
            const result = await service.listCollections(query.limit, query.offset)
            return {
              data: result.data.map(toCollectionResponse),
              meta: { total: result.total },
            }
          }),
      )
      .post(
        '/database/schemas/:name/collections',
        {
          params: SchemaParams,
          body: CreateCollectionBody,
          response: CollectionResponse,
          detail: { tags: ['database-collections'] },
        },
        ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeCollectionAccess(auth, 'write')
            const service = createDocumentDataService(session)
            const doc = await service.createCollection(body)
            set.status = 201
            return toCollectionResponse(doc)
          }),
      )
      .get(
        '/database/schemas/:name/collections/:collectionId',
        {
          params: CollectionParams,
          response: CollectionResponse,
          detail: { tags: ['database-collections'] },
        },
        ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeCollectionAccess(auth, 'read')
            const service = createDocumentDataService(session)
            const doc = await service.getCollection(params.collectionId)
            return toCollectionResponse(doc)
          }),
      )
      .put(
        '/database/schemas/:name/collections/:collectionId',
        {
          params: CollectionParams,
          body: UpdateCollectionBody,
          response: CollectionResponse,
          detail: { tags: ['database-collections'] },
        },
        ({ body, params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeCollectionAccess(auth, 'write')
            const service = createDocumentDataService(session)
            const doc = await service.updateCollection(params.collectionId, body)
            return toCollectionResponse(doc)
          }),
      )
      .delete(
        '/database/schemas/:name/collections/:collectionId',
        {
          params: CollectionParams,
          detail: { tags: ['database-collections'] },
        },
        ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeCollectionAccess(auth, 'write')
            const service = createDocumentDataService(session)
            await service.deleteCollection(params.collectionId)
            set.status = 204
          }),
      )

      // --- Attributes Routes ---
      .get(
        '/database/schemas/:name/collections/:collectionId/attributes',
        {
          params: CollectionParams,
          response: AttributeListResponse,
          detail: { tags: ['database-attributes'] },
        },
        ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeCollectionAccess(auth, 'read')
            const service = createDocumentDataService(session)
            const docs = await service.listAttributes(params.collectionId)
            return {
              data: docs.map(toAttributeResponse),
              meta: { total: docs.length },
            }
          }),
      )
      .post(
        '/database/schemas/:name/collections/:collectionId/attributes',
        {
          params: CollectionParams,
          body: CreateAttributeBody,
          response: AttributeResponse,
          detail: { tags: ['database-attributes'] },
        },
        ({ body, params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeCollectionAccess(auth, 'write')
            const service = createDocumentDataService(session)
            const doc = await service.createAttribute(params.collectionId, body)
            set.status = 201
            return toAttributeResponse(doc)
          }),
      )
      .delete(
        '/database/schemas/:name/collections/:collectionId/attributes/:attributeId',
        {
          params: AttributeParams,
          detail: { tags: ['database-attributes'] },
        },
        ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeCollectionAccess(auth, 'write')
            const service = createDocumentDataService(session)
            await service.deleteAttribute(params.collectionId, params.attributeId)
            set.status = 204
          }),
      )

      // --- Indexes Routes ---
      .get(
        '/database/schemas/:name/collections/:collectionId/indexes',
        {
          params: CollectionParams,
          response: IndexListResponse,
          detail: { tags: ['database-indexes'] },
        },
        ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeCollectionAccess(auth, 'read')
            const service = createDocumentDataService(session)
            const docs = await service.listIndexes(params.collectionId)
            return {
              data: docs.map(toIndexResponse),
              meta: { total: docs.length },
            }
          }),
      )
      .post(
        '/database/schemas/:name/collections/:collectionId/indexes',
        {
          params: CollectionParams,
          body: CreateIndexBody,
          response: IndexResponse,
          detail: { tags: ['database-indexes'] },
        },
        ({ body, params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeCollectionAccess(auth, 'write')
            const service = createDocumentDataService(session)
            const doc = await service.createIndex(params.collectionId, body)
            set.status = 201
            return toIndexResponse(doc)
          }),
      )
      .delete(
        '/database/schemas/:name/collections/:collectionId/indexes/:indexId',
        {
          params: IndexParams,
          detail: { tags: ['database-indexes'] },
        },
        ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeCollectionAccess(auth, 'write')
            const service = createDocumentDataService(session)
            await service.deleteIndex(params.collectionId, params.indexId)
            set.status = 204
          }),
      )

      // --- Documents Routes ---
      .get(
        '/database/schemas/:name/collections/:collectionId/documents',
        {
          params: CollectionParams,
          query: DocumentListQuery,
          response: DocumentListResponse,
          detail: { tags: ['database-documents'] },
        },
        ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeDocumentAccess(auth, 'read')
            const service = createDocumentDataService(session)
            const result = await service.listDocuments(params.collectionId)
            return {
              data: result.data.map(toDocumentResponse),
              meta: { total: result.total },
            }
          }),
      )
      .post(
        '/database/schemas/:name/collections/:collectionId/documents',
        {
          params: CollectionParams,
          body: CreateDocumentBody,
          response: DocumentResponse,
          detail: { tags: ['database-documents'] },
        },
        ({ body, params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeDocumentAccess(auth, 'write')
            const service = createDocumentDataService(session)
            const doc = await service.createDocument(params.collectionId, body)
            set.status = 201
            return toDocumentResponse(doc)
          }),
      )
      .get(
        '/database/schemas/:name/collections/:collectionId/documents/:documentId',
        {
          params: DocumentParams,
          response: DocumentResponse,
          detail: { tags: ['database-documents'] },
        },
        ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeDocumentAccess(auth, 'read')
            const service = createDocumentDataService(session)
            const doc = await service.getDocument(params.collectionId, params.documentId)
            return toDocumentResponse(doc)
          }),
      )
      .patch(
        '/database/schemas/:name/collections/:collectionId/documents/:documentId',
        {
          params: DocumentParams,
          body: UpdateDocumentBody,
          response: DocumentResponse,
          detail: { tags: ['database-documents'] },
        },
        ({ body, params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeDocumentAccess(auth, 'write')
            const service = createDocumentDataService(session)
            const doc = await service.updateDocument(params.collectionId, params.documentId, body)
            return toDocumentResponse(doc)
          }),
      )
      .delete(
        '/database/schemas/:name/collections/:collectionId/documents/:documentId',
        {
          params: DocumentParams,
          detail: { tags: ['database-documents'] },
        },
        ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeDocumentAccess(auth, 'write')
            const service = createDocumentDataService(session)
            await service.deleteDocument(params.collectionId, params.documentId)
            set.status = 204
          }),
      )
  )
}
