import type { Database as PostgresDatabase } from '@nuvix/pg'

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'is_null'

export interface QueryFilter {
  readonly column: string
  readonly operator: FilterOperator
  readonly value?: unknown
}

export interface QueryJoin {
  readonly table: string
  readonly fromColumn: string
  readonly toColumn: string
  readonly type?: 'inner' | 'left'
}

export interface QueryOrder {
  readonly column: string
  readonly direction?: 'asc' | 'desc'
}

export interface TableQueryOptions {
  readonly schema?: string
  readonly table: string
  readonly select?: readonly string[]
  readonly filters?: readonly QueryFilter[]
  readonly joins?: readonly QueryJoin[]
  readonly orderBy?: readonly QueryOrder[]
  readonly limit?: number
  readonly offset?: number
}

export interface TenantQueryService {
  queryTable<T = Record<string, unknown>>(
    database: PostgresDatabase,
    options: TableQueryOptions,
  ): Promise<readonly T[]>

  countTable(
    database: PostgresDatabase,
    options: Pick<TableQueryOptions, 'schema' | 'table' | 'filters'>,
  ): Promise<number>
}

export function createTenantQueryService(): TenantQueryService {
  return {
    async queryTable<T = Record<string, unknown>>(
      database: PostgresDatabase,
      options: TableQueryOptions,
    ): Promise<readonly T[]> {
      let qb = database.table(options.table)

      if (options.schema) {
        qb = qb.withSchema(options.schema)
      }

      if (options.select && options.select.length > 0) {
        qb = qb.select(...options.select)
      } else {
        qb = qb.select('*')
      }

      // Apply joins
      if (options.joins) {
        for (const join of options.joins) {
          if (join.type === 'left') {
            qb = qb.leftJoin(join.table, join.fromColumn, join.toColumn)
          } else {
            qb = qb.join(join.table, join.fromColumn, join.toColumn)
          }
        }
      }

      // Apply filters
      if (options.filters) {
        for (const f of options.filters) {
          switch (f.operator) {
            case 'eq':
              qb = qb.where(f.column, f.value)
              break
            case 'neq':
              qb = qb.whereNot(f.column, f.value)
              break
            case 'gt':
              qb = qb.where(f.column, '>', f.value)
              break
            case 'gte':
              qb = qb.where(f.column, '>=', f.value)
              break
            case 'lt':
              qb = qb.where(f.column, '<', f.value)
              break
            case 'lte':
              qb = qb.where(f.column, '<=', f.value)
              break
            case 'like':
              qb = qb.where(f.column, 'like', f.value)
              break
            case 'in':
              if (Array.isArray(f.value)) {
                qb = qb.whereIn(f.column, f.value)
              }
              break
            case 'is_null':
              qb = qb.whereNull(f.column)
              break
          }
        }
      }

      // Apply ordering
      if (options.orderBy) {
        for (const o of options.orderBy) {
          qb = qb.orderBy(o.column, o.direction ?? 'asc')
        }
      }

      // Apply pagination
      if (options.limit !== undefined) {
        qb = qb.limit(options.limit)
      }
      if (options.offset !== undefined) {
        qb = qb.offset(options.offset)
      }

      const rows = await qb.execute()
      return Object.freeze(rows as unknown as T[])
    },

    async countTable(
      database: PostgresDatabase,
      options: Pick<TableQueryOptions, 'schema' | 'table' | 'filters'>,
    ): Promise<number> {
      let qb = database.table(options.table)

      if (options.schema) {
        qb = qb.withSchema(options.schema)
      }

      qb = qb.count('* as count')

      if (options.filters) {
        for (const f of options.filters) {
          switch (f.operator) {
            case 'eq':
              qb = qb.where(f.column, f.value)
              break
            case 'neq':
              qb = qb.whereNot(f.column, f.value)
              break
            case 'gt':
              qb = qb.where(f.column, '>', f.value)
              break
            case 'gte':
              qb = qb.where(f.column, '>=', f.value)
              break
            case 'lt':
              qb = qb.where(f.column, '<', f.value)
              break
            case 'lte':
              qb = qb.where(f.column, '<=', f.value)
              break
            case 'like':
              qb = qb.where(f.column, 'like', f.value)
              break
            case 'in':
              if (Array.isArray(f.value)) {
                qb = qb.whereIn(f.column, f.value)
              }
              break
            case 'is_null':
              qb = qb.whereNull(f.column)
              break
          }
        }
      }

      const rows = await qb.execute()
      const first = rows[0] as { count?: unknown } | undefined
      return Number(first?.count ?? 0)
    },
  }
}
