import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  buildCreateDocumentSchemaDTO,
  buildCreateSchemaDTO,
} from '../../factories/dto/schema.factory'
import { getApiKeyHeaders, getApiKeyJsonHeaders } from '../../helpers/auth'
import { getApp } from '../../setup/app'
import {
  assertListResponse,
  assertStatusCode,
  parseJson,
} from '../../setup/test-utils'

describe('database/schemas (integration)', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    app = await getApp()
  })

  /**
   * AUTH BOUNDARY TESTS
   * Database endpoints require ADMIN or KEY auth
   */

  it('GET /v1/database/schemas returns 401 when unauthenticated', async () => {
    // PROTECTS: Schema list not exposed without authentication
    const res = await app.inject({
      method: 'GET',
      url: '/v1/database/schemas',
    })

    assertStatusCode(res, 401)
  })

  it('POST /v1/database/schemas returns 401 when unauthenticated', async () => {
    // PROTECTS: Schema creation requires authentication
    const dto = buildCreateSchemaDTO()

    const res = await app.inject({
      method: 'POST',
      url: '/v1/database/schemas',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 401)
  })

  /**
   * SCHEMA LISTING TESTS
   */

  it('GET /v1/database/schemas returns 200 and list shape with API key', async () => {
    // PROTECTS: Schema listing returns proper list format
    const res = await app.inject({
      method: 'GET',
      url: '/v1/database/schemas',
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertListResponse(body)
  })

  it('GET /v1/database/schemas with type filter returns filtered results', async () => {
    // PROTECTS: Schema type filtering works correctly
    const res = await app.inject({
      method: 'GET',
      url: '/v1/database/schemas?type=managed',
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertListResponse(body)

    // All returned schemas should be of the filtered type
    for (const schema of body.data as Array<{ type: string }>) {
      expect(schema.type).toBe('managed')
    }
  })

  /**
   * SCHEMA CREATION TESTS
   */

  it('POST /v1/database/schemas returns 201 for managed schema', async () => {
    // PROTECTS: Managed schema creation works correctly
    const dto = buildCreateSchemaDTO()

    const res = await app.inject({
      method: 'POST',
      url: '/v1/database/schemas',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 201)

    const body = parseJson(res.payload)
    expect(body.name).toBe(dto.name)
    expect(body.type).toBe('managed')
  })

  it('POST /v1/database/schemas returns 201 for document schema', async () => {
    // PROTECTS: Document schema creation works correctly
    const dto = buildCreateDocumentSchemaDTO()

    const res = await app.inject({
      method: 'POST',
      url: '/v1/database/schemas',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 201)

    const body = parseJson(res.payload)
    expect(body.name).toBe(dto.name)
    expect(body.type).toBe('document')
  })

  it('POST /v1/database/schemas returns 400 for invalid schema name', async () => {
    // PROTECTS: Schema name validation is enforced
    const dto = buildCreateSchemaDTO({ name: '123-Invalid-Name!' })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/database/schemas',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 400)
  })

  it('POST /v1/database/schemas returns 400 for missing required fields', async () => {
    // PROTECTS: Required field validation
    const res = await app.inject({
      method: 'POST',
      url: '/v1/database/schemas',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify({ description: 'missing name and type' }),
    })

    assertStatusCode(res, 400)
  })

  it('POST /v1/database/schemas returns 409 for duplicate schema name', async () => {
    // PROTECTS: Schema name uniqueness constraint
    const dto = buildCreateSchemaDTO()

    // Create first schema
    await app.inject({
      method: 'POST',
      url: '/v1/database/schemas',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    // Try to create second schema with same name
    const res = await app.inject({
      method: 'POST',
      url: '/v1/database/schemas',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 409)
  })

  /**
   * SCHEMA RETRIEVAL TESTS
   */

  it('GET /v1/database/schemas/:schemaId returns 200 for existing schema', async () => {
    // PROTECTS: Single schema retrieval works correctly
    const dto = buildCreateSchemaDTO()

    // Create schema first
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/database/schemas',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })
    assertStatusCode(createRes, 201)

    // Retrieve it
    const res = await app.inject({
      method: 'GET',
      url: `/v1/database/schemas/${dto.name}`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    expect(body.name).toBe(dto.name)
  })

  it('GET /v1/database/schemas/:schemaId returns 404 for non-existent schema', async () => {
    // PROTECTS: 404 for unknown schema ID
    const res = await app.inject({
      method: 'GET',
      url: '/v1/database/schemas/nonexistentschema',
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 404)
  })
})
