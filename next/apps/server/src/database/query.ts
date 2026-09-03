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

export interface InsertRowOptions {
  readonly schema?: string
  readonly table: string
  readonly data: Record<string, unknown> | readonly Record<string, unknown>[]
  readonly returning?: readonly string[]
}

export interface UpdateRowOptions {
  readonly schema?: string
  readonly table: string
  readonly data: Record<string, unknown>
  readonly filters?: readonly QueryFilter[]
  readonly rowId?: string
  readonly returning?: readonly string[]
}

export interface DeleteRowOptions {
  readonly schema?: string
  readonly table: string
  readonly filters?: readonly QueryFilter[]
  readonly rowId?: string
  readonly returning?: readonly string[]
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

  getRow<T = Record<string, unknown>>(
    database: PostgresDatabase,
    options: { readonly schema?: string; readonly table: string; readonly rowId: string },
  ): Promise<T | null>

  insertRows<T = Record<string, unknown>>(
    database: PostgresDatabase,
    options: InsertRowOptions,
  ): Promise<readonly T[]>

  updateRows<T = Record<string, unknown>>(
    database: PostgresDatabase,
    options: UpdateRowOptions,
  ): Promise<readonly T[]>

  deleteRows<T = Record<string, unknown>>(
    database: PostgresDatabase,
    options: DeleteRowOptions,
  ): Promise<readonly T[]>
}

export interface TableDataService {
  query(
    schema: string,
    table: string,
    options: Omit<TableQueryOptions, 'table' | 'schema'>,
  ): Promise<readonly Record<string, unknown>[]>
  count(schema: string, table: string, filters?: readonly QueryFilter[]): Promise<number>
  get(schema: string, table: string, rowId: string): Promise<Record<string, unknown> | null>
  insert(
    schema: string,
    table: string,
    data: Record<string, unknown> | readonly Record<string, unknown>[],
  ): Promise<readonly Record<string, unknown>[]>
  update(
    schema: string,
    table: string,
    data: Record<string, unknown>,
    filters?: readonly QueryFilter[],
    rowId?: string,
  ): Promise<readonly Record<string, unknown>[]>
  delete(
    schema: string,
    table: string,
    filters?: readonly QueryFilter[],
    rowId?: string,
  ): Promise<readonly Record<string, unknown>[]>
}

export function createTableDataService(
  postgres: PostgresDatabase,
  queryService: TenantQueryService = createTenantQueryService(),
): TableDataService {
  const service: TableDataService = {
    query: (schema, table, options) =>
      queryService.queryTable(postgres, { ...options, schema, table }),
    count: (schema, table, filters) =>
      queryService.countTable(postgres, { schema, table, filters }),
    get: (schema, table, rowId) => queryService.getRow(postgres, { schema, table, rowId }),
    insert: (schema, table, data) => queryService.insertRows(postgres, { schema, table, data }),
    update: (schema, table, data, filters, rowId) =>
      queryService.updateRows(postgres, { schema, table, data, filters, rowId }),
    delete: (schema, table, filters, rowId) =>
      queryService.deleteRows(postgres, { schema, table, filters, rowId }),
  }
  return Object.freeze(service)
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

    async getRow<T = Record<string, unknown>>(
      database: PostgresDatabase,
      options: { readonly schema?: string; readonly table: string; readonly rowId: string },
    ): Promise<T | null> {
      let qb = database.table(options.table)
      if (options.schema) {
        qb = qb.withSchema(options.schema)
      }
      try {
        const rows = await qb.where('_id', options.rowId).limit(1).execute()
        if (rows.length > 0) return rows[0] as T
      } catch {
        // column _id might not exist
      }
      let fallback = database.table(options.table)
      if (options.schema) fallback = fallback.withSchema(options.schema)
      const rows = await fallback.where('id', options.rowId).limit(1).execute()
      return (rows[0] as T) ?? null
    },

    async insertRows<T = Record<string, unknown>>(
      database: PostgresDatabase,
      options: InsertRowOptions,
    ): Promise<readonly T[]> {
      let qb = database.table(options.table)
      if (options.schema) {
        qb = qb.withSchema(options.schema)
      }
      const data = Array.isArray(options.data) ? options.data : [options.data]
      qb = qb.insert(data as any).returning('*')
      const rows = await qb.execute()
      return Object.freeze(rows as unknown as T[])
    },

    async updateRows<T = Record<string, unknown>>(
      database: PostgresDatabase,
      options: UpdateRowOptions,
    ): Promise<readonly T[]> {
      let qb = database.table(options.table)
      if (options.schema) {
        qb = qb.withSchema(options.schema)
      }
      if (options.rowId) {
        qb = qb.where('_id', options.rowId)
      }
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
      qb = qb.update(options.data as any).returning('*')
      const rows = await qb.execute()
      return Object.freeze(rows as unknown as T[])
    },

    async deleteRows<T = Record<string, unknown>>(
      database: PostgresDatabase,
      options: DeleteRowOptions,
    ): Promise<readonly T[]> {
      let qb = database.table(options.table)
      if (options.schema) {
        qb = qb.withSchema(options.schema)
      }
      if (options.rowId) {
        qb = qb.where('_id', options.rowId)
      }
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
      qb = qb.delete().returning('*')
      const rows = await qb.execute()
      return Object.freeze(rows as unknown as T[])
    },
  }
}

export function parseFilterString(filterStr?: string): QueryFilter[] {
  if (!filterStr || typeof filterStr !== 'string') return []
  const filters: QueryFilter[] = []
  if (filterStr.startsWith('[') && filterStr.endsWith(']')) {
    try {
      const parsed = JSON.parse(filterStr)
      if (Array.isArray(parsed)) return parsed as QueryFilter[]
    } catch {
      // ignore
    }
  }
  const parts = filterStr.split(/,(?![^(]*\))/)
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const matchFn = trimmed.match(/^([a-zA-Z0-9_]+)\.([a-z_]+)\((.*)\)$/)
    if (matchFn && matchFn[1] && matchFn[2]) {
      const col = matchFn[1]
      const op = matchFn[2] as FilterOperator
      const rawVal = matchFn[3] ?? ''
      let value: unknown = rawVal
      if (rawVal === 'null') value = null
      else if (rawVal === 'true') value = true
      else if (rawVal === 'false') value = false
      else if (!Number.isNaN(Number(rawVal)) && rawVal !== '') value = Number(rawVal)
      filters.push({ column: col, operator: op, value })
      continue
    }
    const dotParts = trimmed.split('.')
    if (dotParts.length >= 3 && dotParts[0] && dotParts[1]) {
      const col = dotParts[0]
      const op = dotParts[1] as FilterOperator
      const rawVal = dotParts.slice(2).join('.')
      let value: unknown = rawVal
      if (rawVal === 'null') value = null
      else if (rawVal === 'true') value = true
      else if (rawVal === 'false') value = false
      else if (!Number.isNaN(Number(rawVal)) && rawVal !== '') value = Number(rawVal)
      filters.push({ column: col, operator: op, value })
      continue
    }
  }
  return filters
}
