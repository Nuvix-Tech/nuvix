import { Exception } from '@nuvix/core/extend/exception'
import { CollectionsHelper } from '@nuvix/core/helpers'
import {
  AttributeType,
  Database,
  Doc,
  DuplicateException,
  ID,
  IndexValidator,
  Query,
} from '@nuvix/db'
import { configuration, SchemaMeta, Status } from '@nuvix/utils'
import type {
  Attributes,
  AttributesDoc,
  Indexes,
  IndexesDoc,
} from '@nuvix/utils/types'
import type { CreateIndexDTO } from './DTO/indexes.dto'

export class IndexesService {
  /**
   * Create a Index.
   */
  async createIndex(db: Database, collectionId: string, input: CreateIndexDTO) {
    const { key, type, attributes, orders } = input

    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )

    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    const count = await db.count(
      SchemaMeta.indexes,
      [Query.equal('collectionInternalId', [collection.getSequence()])],
      61,
    )

    const limit = db.getAdapter().$limitForIndexes
    if (count >= limit) {
      throw new Exception(
        Exception.INDEX_LIMIT_EXCEEDED,
        'Index limit exceeded',
      )
    }

    const oldAttributes = (collection.get('attributes') as AttributesDoc[]).map(
      a => a.toObject(),
    )

    oldAttributes.push(
      {
        key: '$id',
        type: AttributeType.String,
        status: Status.AVAILABLE,
        required: true,
        size: 36,
      } as Attributes,
      {
        key: '$createdAt',
        type: AttributeType.Timestamptz,
        status: Status.AVAILABLE,
      } as Attributes,
      {
        key: '$updatedAt',
        type: AttributeType.Timestamptz,
        status: Status.AVAILABLE,
      } as Attributes,
    )

    for (const [i, attribute] of attributes.entries()) {
      const attributeIndex = oldAttributes.findIndex(a => a.key === attribute)

      if (attributeIndex === -1) {
        throw new Exception(
          Exception.ATTRIBUTE_UNKNOWN,
          `Unknown attribute: ${attribute}. Verify the attribute name or create the attribute.`,
        )
      }

      const {
        status: attributeStatus,
        type: attributeType,
        array: attributeArray = false,
      } = oldAttributes[attributeIndex]!
      if (attributeType === AttributeType.Relationship) {
        throw new Exception(
          Exception.ATTRIBUTE_TYPE_INVALID,
          `Cannot create an index for a relationship attribute: ${oldAttributes[attributeIndex]?.key}`,
        )
      }

      if (attributeStatus !== Status.AVAILABLE) {
        throw new Exception(
          Exception.ATTRIBUTE_NOT_AVAILABLE,
          `Attribute not available: ${oldAttributes[attributeIndex]?.key}`,
        )
      }

      if (attributeArray) {
        orders[i] = null
      }
    }

    let index = new Doc<Indexes>({
      $id: ID.custom(
        CollectionsHelper.getAttrId(collection.getSequence(), key),
      ),
      key,
      status: Status.AVAILABLE,
      collectionInternalId: collection.getSequence(),
      collectionId,
      type,
      attributes,
      orders,
    })

    const validator = new IndexValidator(
      collection.get('attributes'),
      db.getAdapter().$maxIndexLength,
    )

    if (!validator.$valid(index as any)) {
      throw new Exception(Exception.INDEX_INVALID, validator.$description)
    }

    try {
      index = await db.createDocument(SchemaMeta.indexes, index)
      await CollectionsHelper.createIndex({ db, collection, index }).catch(
        async error => {
          await db.deleteDocument(SchemaMeta.indexes, index.getId())
          throw error
        },
      )
    } catch (error) {
      if (error instanceof DuplicateException) {
        throw new Exception(Exception.INDEX_ALREADY_EXISTS)
      }
      throw error
    }

    await db.purgeCachedDocument(SchemaMeta.collections, collectionId)
    return index
  }

  /**
   * Get all indexes.
   */
  async getIndexes(db: Database, collectionId: string, queries: Query[] = []) {
    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )

    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }
    queries.push(
      Query.equal('collectionInternalId', [collection.getSequence()]),
    )

    const filterQueries = Query.groupByType(queries).filters
    const indexes = await db.find(SchemaMeta.indexes, queries)
    const total = await db.count(
      SchemaMeta.indexes,
      filterQueries,
      configuration.limits.limitCount,
    )

    return {
      data: indexes,
      total,
    }
  }

  /**
   * Get an index.
   */
  async getIndex(db: Database, collectionId: string, key: string) {
    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )

    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }
    const index = collection.findWhere(
      'indexes',
      (i: IndexesDoc) => i.get('key') === key,
    )

    if (!index) {
      throw new Exception(Exception.INDEX_NOT_FOUND)
    }

    return index
  }

  /**
   * Delete an index.
   */
  async deleteIndex(db: Database, collectionId: string, key: string) {
    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )

    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    const index = await db.getDocument(
      SchemaMeta.indexes,
      CollectionsHelper.getAttrId(collection.getSequence(), key),
    )

    if (index.empty()) {
      throw new Exception(Exception.INDEX_NOT_FOUND)
    }

    // Only update status if removing available index
    if (index.get('status') === Status.AVAILABLE) {
      await CollectionsHelper.deleteIndex({ db, collection, index })
    }

    await db.purgeCachedDocument(SchemaMeta.collections, collectionId)
    return index
  }
}
