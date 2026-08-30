import { describe, expect, test } from 'bun:test'
import { type AnySchema, TypeBoxValidator, ValidationError } from 'elysia'
import {
  CreateSchemaBody,
  SchemaListQuery,
  SchemaListResponse,
  SchemaParams,
  SchemaResponse,
  UpdateSchemaBody,
} from '../src/database/contracts'

function validate(schema: AnySchema, value: unknown) {
  const validator: {
    Check(value: unknown): boolean
    Errors(value: unknown): unknown[]
  } = new TypeBoxValidator(schema)

  if (validator.Check(value)) return { valid: true, status: 200 } as const

  const error = new ValidationError('body', value, () => validator.Errors(value), schema)
  return { valid: false, status: error.status } as const
}

function expectValid(schema: AnySchema, value: unknown) {
  expect(validate(schema, value)).toEqual({ valid: true, status: 200 })
}

function expectUnprocessable(schema: AnySchema, value: unknown) {
  expect(validate(schema, value)).toEqual({ valid: false, status: 422 })
}

describe('database schema request contracts', () => {
  test.each(['a', 'appdata', `a${'0'.repeat(254)}`])('accepts schema name %s', (name) => {
    expectValid(SchemaParams, { name })
  })

  test.each(['', 'Appdata', '1appdata', '_appdata', 'app-data', `a${'0'.repeat(255)}`])(
    'rejects invalid schema name %s with 422-compatible validation',
    (name) => {
      expectUnprocessable(SchemaParams, { name })
      expectUnprocessable(CreateSchemaBody, { name, type: 'managed' })
    },
  )

  test.each(['document', 'managed', 'unmanaged'])('accepts schema type %s', (type) => {
    expectValid(SchemaListQuery, { type })
    expectValid(CreateSchemaBody, { name: 'appdata', type })
  })

  test.each(['system', 'DOCUMENT', '', null, 1])(
    'rejects invalid schema type %p with 422-compatible validation',
    (type) => {
      expectUnprocessable(SchemaListQuery, { type })
      expectUnprocessable(CreateSchemaBody, { name: 'appdata', type })
    },
  )

  test('accepts omitted filters and omitted, null, or 255-character descriptions', () => {
    const description = 'd'.repeat(255)

    expectValid(SchemaListQuery, {})
    expectValid(CreateSchemaBody, { name: 'appdata', type: 'managed' })
    expectValid(CreateSchemaBody, {
      name: 'appdata',
      description: null,
      type: 'managed',
    })
    expectValid(CreateSchemaBody, {
      name: 'appdata',
      description,
      type: 'managed',
    })
    expectValid(UpdateSchemaBody, {})
    expectValid(UpdateSchemaBody, { description: null })
    expectValid(UpdateSchemaBody, { description })
  })

  test.each([
    { name: 'appdata', description: 'd'.repeat(256), type: 'managed' },
    { name: 'appdata', description: 1, type: 'managed' },
    { description: 'd'.repeat(256) },
    { description: false },
  ])('rejects invalid description payload %p with 422-compatible validation', (body) => {
    const schema = 'name' in body ? CreateSchemaBody : UpdateSchemaBody
    expectUnprocessable(schema, body)
  })

  test.each([
    [CreateSchemaBody, { name: 'appdata', type: 'managed', collection: 'posts' }],
    [CreateSchemaBody, { name: 'appdata', type: 'managed', attributes: [] }],
    [UpdateSchemaBody, { name: 'renamed' }],
    [UpdateSchemaBody, { type: 'unmanaged' }],
  ] as const)(
    'rejects unsupported payload shape %# with 422-compatible validation',
    (schema, body) => {
      expectUnprocessable(schema, body)
    },
  )
})

describe('database schema response contracts', () => {
  const schema = {
    name: 'appdata',
    description: null,
    type: 'managed',
  }

  test('accepts exactly name, description, and type', () => {
    expectValid(SchemaResponse, schema)
  })

  test.each([
    { name: 'appdata', type: 'managed' },
    { ...schema, $id: 'schema_a' },
    { ...schema, collections: [] },
  ])('rejects incomplete or expanded schema response %p', (response) => {
    expectUnprocessable(SchemaResponse, response)
  })

  test('accepts list responses with data and meta.total only', () => {
    expectValid(SchemaListResponse, { data: [schema], meta: { total: 1 } })
  })

  test.each([
    { data: [schema], total: 1 },
    { data: [schema], meta: { total: 1, limit: 25 } },
    { data: [schema], meta: { total: -1 } },
    { data: [{ ...schema, indexes: [] }], meta: { total: 1 } },
  ])('rejects invalid list response %p', (response) => {
    expectUnprocessable(SchemaListResponse, response)
  })
})
