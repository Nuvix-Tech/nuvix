import { describe, expect, test } from 'bun:test'
import { createDatabase, type SqlClient, type SqlQuery } from '@nuvix/pg'
import { createSchemaCatalog, type SchemaRecord } from '../src/database/catalog'

interface SqlCall {
  readonly text: string
  readonly values: readonly unknown[]
}

function harness(...results: readonly unknown[]) {
  const calls: SqlCall[] = []
  let resultIndex = 0
  const sql: SqlClient = {
    unsafe<Result>(text: string, values: unknown[] = []): SqlQuery<Result> {
      calls.push({ text, values: [...values] })
      const result = results[resultIndex] ?? []
      resultIndex += 1
      return Promise.resolve(result) as unknown as SqlQuery<Result>
    },
  }
  const catalog = createSchemaCatalog(createDatabase(sql))

  return { calls, catalog }
}

const MANAGED_SCHEMA: SchemaRecord = {
  name: 'appdata',
  description: 'Application data',
  type: 'managed',
}

describe('PostgreSQL schema catalog', () => {
  test('lists normalized rows while excluding contract-reserved schemas', async () => {
    const state = harness([
      { ...MANAGED_SCHEMA, private_value: 'not exposed' },
      { name: 'documents', description: null, type: 'document' },
    ])

    const result = await state.catalog.list()

    expect(result).toEqual([
      MANAGED_SCHEMA,
      { name: 'documents', description: null, type: 'document' },
    ])
    expect(Object.keys(result[0]!)).toEqual(['name', 'description', 'type'])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result[0])).toBe(true)
    expect(state.calls).toEqual([
      {
        text: 'select "name", "description", "type" from "system"."schemas" where "name" not in ($1, $2, $3)',
        values: ['core', 'system', 'internal'],
      },
    ])
  })

  test.each(['document', 'managed', 'unmanaged'] as const)(
    'binds the optional %s list filter on the immutable query branch',
    async (type) => {
      const state = harness([])

      await state.catalog.list(type)

      expect(state.calls).toEqual([
        {
          text: 'select "name", "description", "type" from "system"."schemas" where "name" not in ($1, $2, $3) and "type" = $4',
          values: ['core', 'system', 'internal', type],
        },
      ])
    },
  )

  test('gets one normalized row with a bound name', async () => {
    const state = harness([{ ...MANAGED_SCHEMA, ignored: true }])

    const result = await state.catalog.get('appdata')

    expect(result).toEqual(MANAGED_SCHEMA)
    expect(state.calls).toEqual([
      {
        text: 'select "name", "description", "type" from "system"."schemas" where "name" = $1 limit $2',
        values: ['appdata', 1],
      },
    ])
  })

  test('returns undefined when get has no matching row', async () => {
    const state = harness([])

    expect(await state.catalog.get('missing')).toBeUndefined()
  })

  test('invokes create_schema with bound values and no duplicate inference', async () => {
    const state = harness([{ create_schema: null }])

    expect(
      await state.catalog.create({
        name: 'appdata',
        type: 'managed',
        description: null,
      }),
    ).toBeUndefined()
    expect(state.calls).toEqual([
      {
        text: 'select system.create_schema($1, $2, $3)',
        values: ['appdata', 'managed', null],
      },
    ])
  })

  test('updates a description and consumes the row through returning', async () => {
    const state = harness([{ ...MANAGED_SCHEMA, description: null, ignored: true }])

    const result = await state.catalog.update('appdata', null)

    expect(result).toEqual({ ...MANAGED_SCHEMA, description: null })
    expect(state.calls).toEqual([
      {
        text: 'update "system"."schemas" set "description" = $1 where "name" = $2 returning "name", "description", "type"',
        values: [null, 'appdata'],
      },
    ])
  })

  test('returns undefined when update has no matching row', async () => {
    const state = harness([])

    expect(await state.catalog.update('missing', 'Still missing')).toBeUndefined()
  })

  test('drops only the safely bound schema identifier', async () => {
    const state = harness([])

    await state.catalog.remove('tenant"archive')

    expect(state.calls).toEqual([
      {
        text: 'drop schema if exists "tenant""archive" cascade',
        values: [],
      },
    ])
  })

  test('exposes only the narrow frozen catalog capability', () => {
    const state = harness()

    expect(Object.keys(state.catalog)).toEqual(['list', 'get', 'create', 'update', 'remove'])
    expect(Object.isFrozen(state.catalog)).toBe(true)
    expect('table' in state.catalog).toBe(false)
    expect('raw' in state.catalog).toBe(false)
    expect('client' in state.catalog).toBe(false)
    expect('close' in state.catalog).toBe(false)
  })

  test('rejects malformed persisted rows instead of widening the public type', async () => {
    const state = harness([{ name: 'appdata', description: null, type: 'unknown' }])

    await expect(state.catalog.get('appdata')).rejects.toThrow(
      'Schema catalog returned an invalid row',
    )
  })
})
