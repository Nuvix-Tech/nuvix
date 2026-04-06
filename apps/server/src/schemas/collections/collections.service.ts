import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { usageConfig } from '@nuvix/core/config'
import { CoreService } from '@nuvix/core/core.service'
import { Exception } from '@nuvix/core/extend/exception'
import { CollectionsHelper } from '@nuvix/core/helpers'
import { StatsQueue } from '@nuvix/core/resolvers'
import {
  Authorization,
  Database,
  Doc,
  DuplicateException,
  ID,
  LimitException,
  Permission,
  Query,
} from '@nuvix/db'
import {
  configuration,
  MetricFor,
  MetricPeriod,
  SchemaMeta,
} from '@nuvix/utils'
import type {
  CreateCollectionDTO,
  UpdateCollectionDTO,
} from './DTO/collection.dto'

@Injectable()
export class CollectionsService {
  constructor(
    private readonly event: EventEmitter2,
    private readonly coreService: CoreService,
  ) {}

  /**
   * Create a new collection.
   */
  async createCollection(db: Database, input: CreateCollectionDTO) {
    const { name, enabled, documentSecurity } = input
    let { collectionId, permissions = [] } = input

    permissions = Permission.aggregate(permissions) ?? []
    collectionId = collectionId === 'unique()' ? ID.unique() : collectionId

    try {
      await db.createDocument(
        SchemaMeta.collections,
        new Doc({
          $id: collectionId,
          $permissions: permissions ?? [],
          documentSecurity: documentSecurity,
          enabled: enabled ?? true,
          name,
          search: `${collectionId} ${name}`,
        }),
      )

      const collection = await db.getDocument(
        SchemaMeta.collections,
        collectionId,
      )

      await db.createCollection({
        id: collection.getId(),
        permissions,
        documentSecurity,
        enabled,
      })

      this.event.emit(
        `schema.${db.schema}.collection.${collectionId}.created`,
        collection,
      )
      return collection
    } catch (error) {
      if (error instanceof DuplicateException) {
        throw new Exception(Exception.COLLECTION_ALREADY_EXISTS)
      }
      if (error instanceof LimitException) {
        throw new Exception(Exception.COLLECTION_LIMIT_EXCEEDED)
      }
      throw error
    }
  }

  /**
   * Get collections for a schema.
   */
  async getCollections(db: Database, queries: Query[] = [], search?: string) {
    if (search) {
      queries.push(Query.search('search', search))
    }

    const filterQueries = Query.groupByType(queries).filters
    const collections = await db.find(SchemaMeta.collections, queries)
    const total = await db.count(
      SchemaMeta.collections,
      filterQueries,
      configuration.limits.limitCount,
    )

    return {
      data: collections,
      total,
    }
  }

  /**
   * Find one collection.
   */
  async getCollection(db: Database, collectionId: string) {
    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )

    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    return collection
  }

  /**
   * Get logs for a collection.
   */
  async getCollectionLogs(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _collectionId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _queries: Query[] = [],
  ) {
    // TODO: Implement collection logs
    return {
      total: 0, //await audit.countLogsByResource(resource),
      data: [],
    }
  }

  /**
   * Update a collection.
   */
  async updateCollection(
    db: Database,
    collectionId: string,
    input: UpdateCollectionDTO,
  ) {
    const { name, documentSecurity } = input
    let { permissions, enabled } = input

    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )
    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    if (permissions) {
      permissions = Permission.aggregate(permissions) ?? []
    }
    enabled = enabled ?? collection.get('enabled')

    const updatedCollection = await db.updateDocument(
      SchemaMeta.collections,
      collectionId,
      collection
        .set('name', name)
        .set('$permissions', permissions)
        .set('documentSecurity', documentSecurity)
        .set('enabled', enabled)
        .set('search', `${collectionId} ${name}`),
    )

    await db.updateCollection({
      id: collection.getId(),
      permissions: permissions ?? updatedCollection.get('$permissions'),
      documentSecurity:
        documentSecurity ?? updatedCollection.get('documentSecurity'),
      enabled: updatedCollection.get('enabled'),
    })

    this.event.emit(
      `schema.${db.schema}.collection.${collectionId}.updated`,
      updatedCollection,
    )
    return updatedCollection
  }

  /**
   * Remove a collection.
   */
  async removeCollection(db: Database, collectionId: string) {
    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )

    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    if (!(await db.deleteDocument(SchemaMeta.collections, collectionId))) {
      throw new Exception(
        Exception.GENERAL_SERVER_ERROR,
        'Failed to remove collection from DB',
      )
    }

    await CollectionsHelper.deleteCollection({
      db,
      collection,
      coreDb: this.coreService.getDatabase(),
    })
    await db.purgeCachedCollection(collection.getId())
  }

  /**
   * Get Usage.
   */
  async getUsage(db: Database, range = '7d') {
    const periods = usageConfig
    const stats: Record<string, any> = {}
    const usage: Record<string, any> = {}
    const days = periods[range as keyof typeof periods]
    const metrics = [MetricFor.COLLECTIONS, MetricFor.DOCUMENTS]

    await Authorization.skip(async () => {
      for (const metric of metrics) {
        const result = await db.findOne('stats', qb =>
          qb.equal('metric', metric).equal('period', MetricPeriod.INF),
        )

        stats[metric] = { total: result.get('value') }
        const limit = days.limit
        const period = days.period
        const results = await db.find('stats', qb =>
          qb
            .equal('metric', metric)
            .equal('period', period)
            .limit(limit)
            .orderDesc('time'),
        )

        stats[metric].data = {}
        for (const result of results) {
          const time = StatsQueue.formatDate(
            period,
            result.get('time') as Date,
          )!
          stats[metric].data[time] = {
            value: result.get('value'),
          }
        }
      }
    })

    for (const metric of metrics) {
      usage[metric] = { total: stats[metric].total, data: [] }
      let leap = Date.now() - days.limit * days.factor
      while (leap < Date.now()) {
        leap += days.factor
        const formatDate = StatsQueue.formatDate(days.period, new Date(leap))!
        usage[metric].data.push({
          value: stats[metric].data[formatDate]?.value ?? 0,
          date: formatDate,
        })
      }
    }

    return new Doc({
      range,
      collectionsTotal: usage[MetricFor.COLLECTIONS].total,
      documentsTotal: usage[MetricFor.DOCUMENTS].total,
      collections: usage[MetricFor.COLLECTIONS].data,
      documents: usage[MetricFor.DOCUMENTS].data,
    })
  }

  /**
   * Get collection Usage.
   */
  async getCollectionUsage(db: Database, collectionId: string, range = '7d') {
    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )

    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    const periods = usageConfig
    const stats: Record<string, any> = {}
    const usage: Record<string, any> = {}
    const days = periods[range as keyof typeof periods]
    const metrics = [
      MetricFor.SCHEMA_ID_DOCUMENTS.replace('{schemaId}', db.schema),
    ]

    await Authorization.skip(async () => {
      for (const metric of metrics) {
        const result: any = await db.findOne('stats', qb =>
          qb.equal('metric', metric).equal('period', MetricPeriod.INF),
        )

        stats[metric] = { total: result?.value ?? 0 }
        const limit = days.limit
        const period = days.period
        const results = await db.find('stats', qb =>
          qb
            .equal('metric', metric)
            .equal('period', period)
            .limit(limit)
            .orderDesc('time'),
        )

        stats[metric].data = {}
        for (const result of results) {
          const time = StatsQueue.formatDate(
            period,
            result.get('time') as Date,
          )!
          stats[metric].data[time] = {
            value: result.get('value'),
          }
        }
      }
    })

    for (const metric of metrics) {
      usage[metric] = { total: stats[metric].total, data: [] }
      let leap = Date.now() - days.limit * days.factor
      while (leap < Date.now()) {
        leap += days.factor
        const formatDate = StatsQueue.formatDate(days.period, new Date(leap))!
        usage[metric].data.push({
          value: stats[metric].data[formatDate]?.value ?? 0,
          date: formatDate,
        })
      }
    }

    return new Doc({
      range,
      documentsTotal: usage[metrics[0]!].total,
      documents: usage[metrics[0]!].data,
    })
  }
}
