import { describe, expect, test } from 'bun:test'
import type { Database as PostgresDatabase } from '@nuvix/pg'
import { createTenantQueryService } from '../src/database/query'

interface MockQueryBuilder {
  withSchema(schema: string): MockQueryBuilder
  select(...cols: string[]): MockQueryBuilder
  join(table: string, from: string, to: string): MockQueryBuilder
  leftJoin(table: string, from: string, to: string): MockQueryBuilder
  where(col: string, opOrVal: unknown, val?: unknown): MockQueryBuilder
  whereNot(col: string, val: unknown): MockQueryBuilder
  whereIn(col: string, vals: readonly unknown[]): MockQueryBuilder
  whereNull(col: string): MockQueryBuilder
  orderBy(col: string, dir: string): MockQueryBuilder
  limit(n: number): MockQueryBuilder
  offset(n: number): MockQueryBuilder
  count(expr: string): MockQueryBuilder
  execute(): Promise<readonly unknown[]>
}

describe('TenantQueryService (@nuvix/pg immutable builders)', () => {
  test('constructs and executes query with filters, joins, and pagination', async () => {
    const service = createTenantQueryService()

    const executedCalls: string[] = []

    const mockBuilder: MockQueryBuilder = {
      withSchema(schema: string) {
        executedCalls.push(`withSchema(${schema})`)
        return mockBuilder
      },
      select(...cols: string[]) {
        executedCalls.push(`select(${cols.join(',')})`)
        return mockBuilder
      },
      join(table: string, from: string, to: string) {
        executedCalls.push(`join(${table},${from},${to})`)
        return mockBuilder
      },
      leftJoin(table: string, from: string, to: string) {
        executedCalls.push(`leftJoin(${table},${from},${to})`)
        return mockBuilder
      },
      where(col: string, opOrVal: unknown, val?: unknown) {
        executedCalls.push(
          `where(${col},${String(opOrVal)}${val !== undefined ? `,${String(val)}` : ''})`,
        )
        return mockBuilder
      },
      whereNot(col: string, val: unknown) {
        executedCalls.push(`whereNot(${col},${String(val)})`)
        return mockBuilder
      },
      whereIn(col: string, vals: readonly unknown[]) {
        executedCalls.push(`whereIn(${col},${vals.join(',')})`)
        return mockBuilder
      },
      whereNull(col: string) {
        executedCalls.push(`whereNull(${col})`)
        return mockBuilder
      },
      orderBy(col: string, dir: string) {
        executedCalls.push(`orderBy(${col},${dir})`)
        return mockBuilder
      },
      limit(n: number) {
        executedCalls.push(`limit(${n})`)
        return mockBuilder
      },
      offset(n: number) {
        executedCalls.push(`offset(${n})`)
        return mockBuilder
      },
      count(expr: string) {
        executedCalls.push(`count(${expr})`)
        return mockBuilder
      },
      async execute() {
        executedCalls.push('execute()')
        return [{ id: 'row_1', name: 'Alice' }]
      },
    }

    const mockDb = {
      table(name: string) {
        executedCalls.push(`table(${name})`)
        return mockBuilder
      },
    } as unknown as PostgresDatabase

    const rows = await service.queryTable(mockDb, {
      schema: 'analytics',
      table: 'events',
      select: ['id', 'name', 'timestamp'],
      joins: [
        { table: 'users', fromColumn: 'events.user_id', toColumn: 'users.id', type: 'inner' },
      ],
      filters: [
        { column: 'status', operator: 'eq', value: 'active' },
        { column: 'age', operator: 'gte', value: 18 },
        { column: 'deleted_at', operator: 'is_null' },
        { column: 'role', operator: 'in', value: ['admin', 'member'] },
      ],
      orderBy: [{ column: 'timestamp', direction: 'desc' }],
      limit: 20,
      offset: 40,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ id: 'row_1', name: 'Alice' })
    expect(executedCalls).toContain('table(events)')
    expect(executedCalls).toContain('withSchema(analytics)')
    expect(executedCalls).toContain('select(id,name,timestamp)')
    expect(executedCalls).toContain('join(users,events.user_id,users.id)')
    expect(executedCalls).toContain('where(status,active)')
    expect(executedCalls).toContain('where(age,>=,18)')
    expect(executedCalls).toContain('whereNull(deleted_at)')
    expect(executedCalls).toContain('whereIn(role,admin,member)')
    expect(executedCalls).toContain('orderBy(timestamp,desc)')
    expect(executedCalls).toContain('limit(20)')
    expect(executedCalls).toContain('offset(40)')
    expect(executedCalls).toContain('execute()')
  })

  test('countTable calculates aggregated count', async () => {
    const service = createTenantQueryService()

    const mockBuilder: Partial<MockQueryBuilder> = {
      withSchema() {
        return mockBuilder as MockQueryBuilder
      },
      count() {
        return mockBuilder as MockQueryBuilder
      },
      where() {
        return mockBuilder as MockQueryBuilder
      },
      async execute() {
        return [{ count: '42' }]
      },
    }

    const mockDb = {
      table() {
        return mockBuilder
      },
    } as unknown as PostgresDatabase

    const count = await service.countTable(mockDb, {
      table: 'users',
      filters: [{ column: 'status', operator: 'eq', value: 'active' }],
    })

    expect(count).toBe(42)
  })

  test('getRow fetches single row by _id or fallback to id', async () => {
    const service = createTenantQueryService()
    const mockBuilder: any = {
      withSchema() {
        return mockBuilder
      },
      where(_col: string, val: unknown) {
        return {
          limit() {
            return {
              async execute() {
                return [{ _id: val, name: 'Alice' }]
              },
            }
          },
        }
      },
    }
    const mockDb = {
      table() {
        return mockBuilder
      },
    } as unknown as PostgresDatabase

    const row = await service.getRow(mockDb, {
      schema: 'core',
      table: 'users',
      rowId: '123',
    })
    expect(row).toEqual({ _id: '123', name: 'Alice' })
  })

  test('insertRows inserts rows and returns them', async () => {
    const service = createTenantQueryService()
    const mockBuilder: any = {
      withSchema() {
        return mockBuilder
      },
      insert(data: any) {
        return {
          returning() {
            return {
              async execute() {
                return Array.isArray(data) ? data : [data]
              },
            }
          },
        }
      },
    }
    const mockDb = {
      table() {
        return mockBuilder
      },
    } as unknown as PostgresDatabase

    const rows = await service.insertRows(mockDb, {
      schema: 'core',
      table: 'users',
      data: [{ name: 'Bob' }, { name: 'Charlie' }],
    })
    expect(rows).toEqual([{ name: 'Bob' }, { name: 'Charlie' }])
  })

  test('updateRows and deleteRows work with filters', async () => {
    const service = createTenantQueryService()
    const mockBuilder: any = {
      withSchema() {
        return mockBuilder
      },
      where() {
        return mockBuilder
      },
      update(data: any) {
        return {
          returning() {
            return {
              async execute() {
                return [data]
              },
            }
          },
        }
      },
      delete() {
        return {
          returning() {
            return {
              async execute() {
                return [{ _id: '1', deleted: true }]
              },
            }
          },
        }
      },
    }
    const mockDb = {
      table() {
        return mockBuilder
      },
    } as unknown as PostgresDatabase

    const updated = await service.updateRows(mockDb, {
      table: 'users',
      data: { name: 'Bob Updated' },
      rowId: '1',
    })
    expect(updated).toEqual([{ name: 'Bob Updated' }])

    const deleted = await service.deleteRows(mockDb, {
      table: 'users',
      rowId: '1',
    })
    expect(deleted).toEqual([{ _id: '1', deleted: true }])
  })
})
