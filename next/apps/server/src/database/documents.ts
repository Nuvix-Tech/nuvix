import { Doc, ID, Permission, Query, Role, type Session } from '@nuvix/db'
import { translatePackageError } from '../infrastructure/package-errors'
import { AppError, ConflictError, NotFoundError } from '../shared/errors'

const METADATA_COLLECTION = '_metadata'

export interface CollectionData {
  $id: string
  name: string
  enabled: boolean
  documentSecurity: boolean
  $permissions: string[]
  $createdAt: string
  $updatedAt: string
  attributes?: unknown[]
  indexes?: unknown[]
}

export interface AttributeData {
  key: string
  type: string
  status: string
  error?: string
  required: boolean
  array?: boolean
  size?: number
  default?: unknown
}

export interface IndexData {
  key: string
  type: string
  status: string
  attributes: string[]
  orders?: string[]
}

export interface CreateCollectionOptions {
  collectionId?: string
  name: string
  permissions?: string[]
  documentSecurity?: boolean
  enabled?: boolean
}

export interface UpdateCollectionOptions {
  name?: string
  permissions?: string[]
  documentSecurity?: boolean
  enabled?: boolean
}

export interface CreateAttributeOptions {
  key: string
  type: string
  size?: number
  required?: boolean
  default?: unknown
  array?: boolean
  elements?: string[]
}

export interface CreateIndexOptions {
  key: string
  type: string
  attributes: string[]
  orders?: string[]
}

export interface CreateDocumentOptions {
  documentId?: string
  data: Record<string, unknown>
  permissions?: string[]
}

export interface UpdateDocumentOptions {
  data: Record<string, unknown>
  permissions?: string[]
}

export function toCollectionResponse(doc: Doc): CollectionData {
  const id = doc.getId()
  const name = (doc.get('name') as string) ?? id
  const enabled = (doc.get('enabled') as boolean) ?? true
  const documentSecurity = (doc.get('documentSecurity') as boolean) ?? false
  const permissions = doc.getPermissions() ?? (doc.get('$permissions') as string[]) ?? []
  const createdAt =
    doc.createdAt()?.toISOString() ?? (doc.get('$createdAt') as string) ?? new Date().toISOString()
  const updatedAt =
    doc.updatedAt()?.toISOString() ?? (doc.get('$updatedAt') as string) ?? new Date().toISOString()
  const rawAttributes = (doc.get('attributes') as unknown[]) ?? []
  const rawIndexes = (doc.get('indexes') as unknown[]) ?? []

  return {
    $id: id,
    name,
    enabled,
    documentSecurity,
    $permissions: permissions,
    $createdAt: createdAt,
    $updatedAt: updatedAt,
    attributes: rawAttributes.map((a) =>
      a instanceof Doc ? toAttributeResponse(a) : (a as Record<string, unknown>),
    ),
    indexes: rawIndexes.map((i) =>
      i instanceof Doc ? toIndexResponse(i) : (i as Record<string, unknown>),
    ),
  }
}

export function toAttributeResponse(doc: Doc): AttributeData {
  return {
    key: doc.getId() || (doc.get('key') as string),
    type: doc.get('type') as string,
    status: (doc.get('status') as string) ?? 'available',
    error: (doc.get('error') as string) ?? undefined,
    required: (doc.get('required') as boolean) ?? false,
    array: (doc.get('array') as boolean) ?? false,
    size: (doc.get('size') as number) ?? undefined,
    default: doc.get('default') ?? undefined,
  }
}

export function toIndexResponse(doc: Doc): IndexData {
  return {
    key: doc.getId() || (doc.get('key') as string),
    type: doc.get('type') as string,
    status: (doc.get('status') as string) ?? 'available',
    attributes: (doc.get('attributes') as string[]) ?? [],
    orders: (doc.get('orders') as string[]) ?? [],
  }
}

export function toDocumentResponse(doc: Doc): Record<string, unknown> {
  const obj = doc.toObject()
  return {
    ...obj,
    $id: doc.getId(),
    $createdAt:
      doc.createdAt()?.toISOString() ??
      (doc.get('$createdAt') as string) ??
      new Date().toISOString(),
    $updatedAt:
      doc.updatedAt()?.toISOString() ??
      (doc.get('$updatedAt') as string) ??
      new Date().toISOString(),
    $permissions: doc.getPermissions() ?? (doc.get('$permissions') as string[]) ?? [],
  }
}

function failure(error: unknown, name: string): AppError {
  if (error instanceof AppError) return error
  const translated = translatePackageError(error, { operation: name })
  if (translated.status === 500) return translated

  return new AppError(500, {
    type: '/errors/internal',
    detail: `Unable to ${name}`,
  })
}

async function operation<Result>(name: string, run: () => Promise<Result>): Promise<Result> {
  try {
    return await run()
  } catch (error) {
    throw failure(error, name)
  }
}

export interface DocumentDataService {
  listCollections(limit?: number, offset?: number): Promise<{ data: Doc[]; total: number }>
  getCollection(id: string): Promise<Doc>
  createCollection(input: CreateCollectionOptions): Promise<Doc>
  updateCollection(id: string, input: UpdateCollectionOptions): Promise<Doc>
  deleteCollection(id: string): Promise<boolean>

  listAttributes(collectionId: string): Promise<Doc[]>
  createAttribute(collectionId: string, input: CreateAttributeOptions): Promise<Doc>
  deleteAttribute(collectionId: string, attributeId: string): Promise<boolean>

  listIndexes(collectionId: string): Promise<Doc[]>
  createIndex(collectionId: string, input: CreateIndexOptions): Promise<Doc>
  deleteIndex(collectionId: string, indexId: string): Promise<boolean>

  listDocuments(collectionId: string, queries?: Query[]): Promise<{ data: Doc[]; total: number }>
  getDocument(collectionId: string, documentId: string): Promise<Doc>
  createDocument(collectionId: string, input: CreateDocumentOptions): Promise<Doc>
  updateDocument(
    collectionId: string,
    documentId: string,
    input: UpdateDocumentOptions,
  ): Promise<Doc>
  deleteDocument(collectionId: string, documentId: string): Promise<boolean>
}

export function createDocumentDataService(session: Session): DocumentDataService {
  const service: DocumentDataService = {
    async listCollections(limit = 25, offset = 0) {
      const queries = [Query.limit(limit), Query.offset(offset)]
      const docs = await operation('list collections', () =>
        session.find(METADATA_COLLECTION, queries),
      )
      const count = await operation('count collections', () =>
        session.count(METADATA_COLLECTION, []),
      )
      return { data: docs, total: count }
    },

    async getCollection(id: string) {
      try {
        const doc = await session.getDocument(METADATA_COLLECTION, id)
        if (!doc || doc.empty()) {
          throw new NotFoundError(`Collection '${id}' not found`, {
            code: 'collection_not_found',
          })
        }
        return doc
      } catch (error) {
        if (error instanceof AppError) throw error
        throw new NotFoundError(`Collection '${id}' not found`, {
          code: 'collection_not_found',
        })
      }
    },

    async createCollection(input: CreateCollectionOptions) {
      const id =
        input.collectionId && input.collectionId !== 'unique()' ? input.collectionId : ID.unique()

      try {
        const existing = await session.getDocument(METADATA_COLLECTION, id)
        if (existing && !existing.empty()) {
          throw new ConflictError(`Collection '${id}' already exists`, {
            code: 'collection_already_exists',
          })
        }
      } catch (e) {
        if (e instanceof ConflictError) throw e
        // not found is expected
      }

      const permissions = input.permissions ?? [
        Permission.read(Role.any()),
        Permission.create(Role.any()),
        Permission.update(Role.any()),
        Permission.delete(Role.any()),
      ]

      const doc = new Doc({
        $id: id,
        name: input.name,
        enabled: input.enabled ?? true,
        documentSecurity: input.documentSecurity ?? false,
        $permissions: permissions,
        attributes: [],
        indexes: [],
      })

      return await operation('create collection', () =>
        session.createDocument(METADATA_COLLECTION, doc),
      )
    },

    async updateCollection(id: string, input: UpdateCollectionOptions) {
      const existing = await this.getCollection(id)
      if (input.name !== undefined) existing.set('name', input.name)
      if (input.enabled !== undefined) existing.set('enabled', input.enabled)
      if (input.documentSecurity !== undefined)
        existing.set('documentSecurity', input.documentSecurity)
      if (input.permissions !== undefined) existing.set('$permissions', input.permissions)

      return await operation('update collection', () =>
        session.updateDocument(METADATA_COLLECTION, id, existing),
      )
    },

    async deleteCollection(id: string) {
      await this.getCollection(id)
      return await operation('delete collection', () =>
        session.deleteDocument(METADATA_COLLECTION, id),
      )
    },

    async listAttributes(collectionId: string) {
      const collection = await this.getCollection(collectionId)
      const attributes = (collection.get('attributes') as unknown[]) ?? []
      return attributes.map((a) => (a instanceof Doc ? a : new Doc(a as Record<string, unknown>)))
    },

    async createAttribute(collectionId: string, input: CreateAttributeOptions) {
      const collection = await this.getCollection(collectionId)
      const attributes = (collection.get('attributes') as unknown[]) ?? []

      const existing = attributes.find((a) => {
        const key = a instanceof Doc ? a.getId() : (a as Record<string, unknown>).key
        return key === input.key
      })
      if (existing) {
        throw new ConflictError(`Attribute '${input.key}' already exists`, {
          code: 'attribute_already_exists',
        })
      }

      const attrDoc = new Doc({
        $id: input.key,
        key: input.key,
        type: input.type,
        status: 'available',
        required: input.required ?? false,
        array: input.array ?? false,
        size: input.size,
        default: input.default ?? null,
      })

      attributes.push(attrDoc)
      collection.set('attributes', attributes)
      await operation('save attribute to collection', () =>
        session.updateDocument(METADATA_COLLECTION, collectionId, collection),
      )
      return attrDoc
    },

    async deleteAttribute(collectionId: string, attributeId: string) {
      const collection = await this.getCollection(collectionId)
      const attributes = (collection.get('attributes') as unknown[]) ?? []

      const index = attributes.findIndex((a) => {
        const key = a instanceof Doc ? a.getId() : (a as Record<string, unknown>).key
        return key === attributeId
      })
      if (index === -1) {
        throw new NotFoundError(`Attribute '${attributeId}' not found`, {
          code: 'attribute_not_found',
        })
      }

      attributes.splice(index, 1)
      collection.set('attributes', attributes)
      await operation('delete attribute from collection', () =>
        session.updateDocument(METADATA_COLLECTION, collectionId, collection),
      )
      return true
    },

    async listIndexes(collectionId: string) {
      const collection = await this.getCollection(collectionId)
      const indexes = (collection.get('indexes') as unknown[]) ?? []
      return indexes.map((i) => (i instanceof Doc ? i : new Doc(i as Record<string, unknown>)))
    },

    async createIndex(collectionId: string, input: CreateIndexOptions) {
      const collection = await this.getCollection(collectionId)
      const indexes = (collection.get('indexes') as unknown[]) ?? []

      const existing = indexes.find((i) => {
        const key = i instanceof Doc ? i.getId() : (i as Record<string, unknown>).key
        return key === input.key
      })
      if (existing) {
        throw new ConflictError(`Index '${input.key}' already exists`, {
          code: 'index_already_exists',
        })
      }

      const indexDoc = new Doc({
        $id: input.key,
        key: input.key,
        type: input.type,
        status: 'available',
        attributes: input.attributes,
        orders: input.orders ?? [],
      })

      indexes.push(indexDoc)
      collection.set('indexes', indexes)
      await operation('save index to collection', () =>
        session.updateDocument(METADATA_COLLECTION, collectionId, collection),
      )
      return indexDoc
    },

    async deleteIndex(collectionId: string, indexId: string) {
      const collection = await this.getCollection(collectionId)
      const indexes = (collection.get('indexes') as unknown[]) ?? []

      const index = indexes.findIndex((i) => {
        const key = i instanceof Doc ? i.getId() : (i as Record<string, unknown>).key
        return key === indexId
      })
      if (index === -1) {
        throw new NotFoundError(`Index '${indexId}' not found`, {
          code: 'index_not_found',
        })
      }

      indexes.splice(index, 1)
      collection.set('indexes', indexes)
      await operation('delete index from collection', () =>
        session.updateDocument(METADATA_COLLECTION, collectionId, collection),
      )
      return true
    },

    async listDocuments(collectionId: string, queries = []) {
      const docs = await operation('find documents', () => session.find(collectionId, queries))
      const count = await operation('count documents', () => session.count(collectionId, queries))
      return { data: docs, total: count }
    },

    async getDocument(collectionId: string, documentId: string) {
      try {
        const doc = await session.getDocument(collectionId, documentId)
        if (!doc || doc.empty()) {
          throw new NotFoundError(`Document '${documentId}' not found`, {
            code: 'document_not_found',
          })
        }
        return doc
      } catch (error) {
        if (error instanceof AppError) throw error
        throw new NotFoundError(`Document '${documentId}' not found`, {
          code: 'document_not_found',
        })
      }
    },

    async createDocument(collectionId: string, input: CreateDocumentOptions) {
      const docId =
        input.documentId && input.documentId !== 'unique()' ? input.documentId : ID.unique()

      const permissions = input.permissions ?? [
        Permission.read(Role.any()),
        Permission.update(Role.any()),
        Permission.delete(Role.any()),
      ]

      const doc = new Doc({
        ...input.data,
        $id: docId,
        $permissions: permissions,
      })

      return await operation('create document', () => session.createDocument(collectionId, doc))
    },

    async updateDocument(collectionId: string, documentId: string, input: UpdateDocumentOptions) {
      await this.getDocument(collectionId, documentId)

      const doc = new Doc({
        ...input.data,
        $id: documentId,
        ...(input.permissions ? { $permissions: input.permissions } : {}),
      })

      return await operation('update document', () =>
        session.updateDocument(collectionId, documentId, doc),
      )
    },

    async deleteDocument(collectionId: string, documentId: string) {
      await this.getDocument(collectionId, documentId)
      return await operation('delete document', () =>
        session.deleteDocument(collectionId, documentId),
      )
    },
  }

  return Object.freeze(service)
}
