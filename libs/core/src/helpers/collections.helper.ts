import { Logger } from '@nestjs/common'
import { Audit } from '@nuvix/audit'
import {
  AttributeType,
  Authorization,
  Database,
  DatabaseException,
  Doc,
  Query,
} from '@nuvix/db'
import { SchemaMeta, Status } from '@nuvix/utils'
import type {
  AttributesDoc,
  CollectionsDoc,
  IndexesDoc,
} from '@nuvix/utils/types'

export class CollectionsHelper {
  private static readonly logger = new Logger(CollectionsHelper.name)

  /**
   *
   */
  static getRelatedAttrId(collectionSequence: number, key: string): string {
    return `related_${collectionSequence}_${key}`
  }

  /** @see collectionService */
  static getAttrId(collectionSequence: number, key: string): string {
    return `${collectionSequence}_${key}`
  }

  /**
   * Creates an attribute in the specified collection.
   */
  public static async createAttribute({
    db,
    collection,
    attribute,
  }: {
    db: Database
    collection: CollectionsDoc
    attribute: AttributesDoc
  }): Promise<void> {
    await Authorization.skip(async () => {
      const collectionId = collection.getId()
      const key = attribute.get('key')
      const type = attribute.get('type') as AttributeType
      const size = attribute.get('size', 0)
      const required = attribute.get('required', false)
      const defaultValue = attribute.get('default', null)
      const array = attribute.get('array', false)
      const format = attribute.get('format', '')
      const formatOptions = attribute.get('formatOptions', {})
      const filters = attribute.get('filters', [])
      const options = attribute.get('options', {})

      let relatedAttribute!: AttributesDoc
      let relatedCollection!: CollectionsDoc

      switch (type) {
        case AttributeType.Relationship:
          relatedCollection = await db.getDocument(
            SchemaMeta.collections,
            options.relatedCollection,
          )
          if (relatedCollection.empty()) {
            throw new DatabaseException(
              `Collection '${options.relatedCollection}' not found`,
            )
          }
          if (
            !(await db.createRelationship({
              collectionId: collection.getId(),
              relatedCollectionId: relatedCollection.getId(),
              type: options.relationType,
              twoWay: options.twoWay,
              id: key,
              twoWayKey: options.twoWayKey,
              onDelete: options.onDelete,
            }))
          ) {
            throw new DatabaseException('Failed to create Attribute')
          }

          if (options.twoWay) {
            relatedAttribute = await db.getDocument(
              SchemaMeta.attributes,
              CollectionsHelper.getRelatedAttrId(
                relatedCollection.getSequence(),
                options.twoWayKey,
              ),
            )
          }
          break
        default:
          if (
            !(await db.createAttribute(collection.getId(), {
              $id: key,
              key,
              type,
              size,
              required,
              default: defaultValue,
              array,
              format,
              formatOptions,
              filters,
            }))
          ) {
            throw new DatabaseException('Failed to create Attribute')
          }
      }

      await db.updateDocument(
        SchemaMeta.attributes,
        attribute.getId(),
        attribute.set('status', Status.AVAILABLE),
      )

      if (type === AttributeType.Relationship && options.twoWay) {
        await db.purgeCachedDocument(
          SchemaMeta.collections,
          relatedCollection.getId(),
        )
      }

      await db.purgeCachedDocument(SchemaMeta.collections, collectionId)
    })
  }

  /**
   * Deletes an attribute from the specified collection.
   * If the attribute is a relationship, it also deletes the related attribute.
   */
  public static async deleteAttribute({
    db,
    collection,
    attribute,
  }: {
    db: Database
    collection: CollectionsDoc
    attribute: AttributesDoc
  }): Promise<void> {
    await Authorization.skip(async () => {
      const collectionId = collection.getId()
      const key = attribute.get('key')
      const status = attribute.get('status', '')
      const type = attribute.get('type') as AttributeType
      const options = attribute.get('options', {})

      let relatedAttribute: AttributesDoc | null = null
      let relatedCollection: CollectionsDoc | null = null

      if (status !== Status.FAILED) {
        if (type === AttributeType.Relationship) {
          if (options.twoWay) {
            relatedCollection = await db.getDocument(
              SchemaMeta.collections,
              options.relatedCollection,
            )
            if (relatedCollection.empty()) {
              throw new DatabaseException('Collection not found')
            }
            relatedAttribute = await db.getDocument(
              SchemaMeta.attributes,
              CollectionsHelper.getRelatedAttrId(
                relatedCollection.getSequence(),
                options.twoWayKey,
              ),
            )
            if (relatedAttribute.empty()) {
              throw new DatabaseException('Related attribute not found')
            }
          }

          if (!(await db.deleteRelationship(collection.getId(), key))) {
            throw new DatabaseException('Failed to delete Relationship')
          }
        } else if (!(await db.deleteAttribute(collection.getId(), key))) {
          throw new DatabaseException('Failed to delete Attribute')
        }
      }

      await db.deleteDocument(SchemaMeta.attributes, attribute.getId())

      if (relatedAttribute && !relatedAttribute.empty()) {
        await db.deleteDocument(SchemaMeta.attributes, relatedAttribute.getId())
      }

      const indexes = collection.get(SchemaMeta.indexes, []) as IndexesDoc[]

      for (const index of indexes) {
        const attributes = index.get('attributes')
        const orders = index.get('orders')

        const found = attributes.indexOf(key)

        if (found !== -1) {
          attributes.splice(found, 1)
          if (orders[found]) {
            orders.splice(found, 1)
          }

          if (attributes.length === 0) {
            await db.deleteDocument(SchemaMeta.indexes, index.getId())
          } else {
            index.set('attributes', attributes)
            index.set('orders', orders)

            let exists = false
            for (const existing of indexes) {
              if (
                existing.get('key') !== index.get('key') &&
                existing.get('attributes').toString() ===
                  index.get('attributes').toString() &&
                existing.get('orders').toString() ===
                  index.get('orders').toString()
              ) {
                exists = true
                break
              }
            }

            if (exists) {
              await CollectionsHelper.deleteIndex({
                db,
                collection,
                index,
              })
            } else {
              await db.updateDocument(SchemaMeta.indexes, index.getId(), index)
            }
          }
        }
      }

      await db.purgeCachedDocument(SchemaMeta.collections, collectionId)
      await db.purgeCachedCollection(collection.getId())

      if (
        relatedCollection &&
        !relatedCollection.empty() &&
        relatedAttribute &&
        !relatedAttribute.empty()
      ) {
        await db.purgeCachedDocument(
          SchemaMeta.collections,
          relatedCollection.getId(),
        )
        await db.purgeCachedCollection(relatedCollection.getId())
      }
    })
  }

  /**
   * Creates an index in the specified collection.
   */
  public static async createIndex({
    db,
    collection,
    index,
  }: {
    db: Database
    collection: CollectionsDoc
    index: IndexesDoc
  }): Promise<void> {
    await Authorization.skip(async () => {
      const collectionId = collection.getId()
      const key = index.get('key')
      const type = index.get('type')
      const attributes = index.get('attributes', [])
      const orders = index.get('orders', [])

      if (
        !(await db.createIndex(
          collection.getId(),
          key,
          type,
          attributes,
          orders,
        ))
      ) {
        throw new DatabaseException('Failed to create Index')
      }

      await db.purgeCachedDocument(SchemaMeta.collections, collectionId)
    })
  }

  /**
   * Deletes an index from the specified collection.
   * If the index is part of a collection, it also deletes the index from the collection
   */
  public static async deleteIndex({
    db,
    collection,
    index,
  }: {
    db: Database
    collection: CollectionsDoc
    index: IndexesDoc
  }): Promise<void> {
    await Authorization.skip(async () => {
      const key = index.get('key')
      const status = index.get('status', '')

      if (
        status !== Status.FAILED &&
        !(await db.deleteIndex(collection.getId(), key))
      ) {
        throw new DatabaseException('Failed to delete index')
      }
      await db.deleteDocument(SchemaMeta.indexes, index.getId())

      await db.purgeCachedDocument(SchemaMeta.collections, collection.getId())
    })
  }

  /**
   * Deletes a collection and all its attributes and indexes.
   * It also deletes all relationships associated with the collection.
   */
  public static async deleteCollection({
    db,
    collection,
    coreDb,
  }: {
    db: Database
    collection: CollectionsDoc
    coreDb: Database
  }): Promise<void> {
    await Authorization.skip(async () => {
      const collectionId = collection.getId()
      const collectionInternalId = collection.getSequence()

      const relationships = await db.find(SchemaMeta.attributes, qb =>
        qb
          .equal('type', AttributeType.Relationship)
          .equal('collectionInternalId', collectionInternalId)
          .equal('options->>relatedCollection' as any, collection.getId()),
      )

      for (const relationship of relationships) {
        await db.deleteDocument(
          relationship.getCollection(),
          relationship.getId(),
        )
        await db.purgeCachedDocument(
          SchemaMeta.collections,
          relationship.getCollection(),
        )
      }
      await db.deleteCollection(collection.getId())
      await db.deleteDocuments(SchemaMeta.attributes, qb =>
        qb.equal('collectionInternalId', collectionInternalId),
      )
      await db.deleteDocuments(SchemaMeta.indexes, qb =>
        qb.equal('collectionInternalId', collectionInternalId),
      )

      await CollectionsHelper.deleteAuditLogsByResource(
        `/collection/${collectionId}`,
        coreDb,
      )
    })
  }

  private static async deleteAuditLogsByResource(
    resource: string,
    db: Database,
  ): Promise<void> {
    await CollectionsHelper.deleteByGroup(
      Audit.COLLECTION,
      [Query.equal('resource', [resource])],
      db,
    )
  }

  private static async deleteByGroup(
    collection: string,
    queries: Query[],
    database: Database,
    callback?: (document: Doc) => Promise<void>,
  ): Promise<void> {
    let count = 0
    let chunk = 0
    const limit = 50
    let sum = limit

    const executionStart = Date.now()

    while (sum === limit) {
      chunk++

      const results = await database.find(collection, [
        Query.limit(limit),
        ...queries,
      ])

      sum = results.length

      CollectionsHelper.logger.log(
        `Deleting chunk #${chunk}. Found ${sum} documents`,
      )

      for (const document of results) {
        if (
          await database.deleteDocument(
            document.getCollection(),
            document.getId(),
          )
        ) {
          CollectionsHelper.logger.log(
            `Deleted document "${document.getId()}" successfully`,
          )

          if (callback) {
            await callback(document)
          }
        } else {
          CollectionsHelper.logger.warn(
            `Failed to delete document: ${document.getId()}`,
          )
        }
        count++
      }
    }

    const executionEnd = Date.now()

    CollectionsHelper.logger.log(
      `Deleted ${count} documents by group in ${(executionEnd - executionStart) / 1000} seconds`,
    )
  }
}
