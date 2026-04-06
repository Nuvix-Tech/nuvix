import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  buildCreateCollectionDTO,
  buildUpdateCollectionDTO,
} from '../../factories/dto/collection.factory'
import { buildCreateDocumentSchemaDTO } from '../../factories/dto/schema.factory'
import { getApiKeyHeaders, getApiKeyJsonHeaders } from '../../helpers/auth'
import { getApp } from '../../setup/app'
import {
  assertDocumentShape,
  assertListResponse,
  assertStatusCode,
  parseJson,
} from '../../setup/test-utils'

describe('schemas/collections (integration)', () => {
  let app: NestFastifyApplication
  let testSchemaId: string

  beforeAll(async () => {
    app = await getApp()

    // Create a document schema to use for collection tests
    const schemaDto = buildCreateDocumentSchemaDTO()
    testSchemaId = schemaDto.name

    await app.inject({
      method: 'POST',
      url: '/v1/database/schemas',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(schemaDto),
    })
  })

  /**
   * AUTH BOUNDARY TESTS
   * Collection endpoints require ADMIN or KEY auth
   */

  it('GET /v1/schemas/:schemaId/collections returns 401 when unauthenticated', async () => {
    // PROTECTS: Collection list not exposed without authentication
    const res = await app.inject({
      method: 'GET',
      url: `/v1/schemas/${testSchemaId}/collections`,
    })

    assertStatusCode(res, 401)
  })

  it('POST /v1/schemas/:schemaId/collections returns 401 when unauthenticated', async () => {
    // PROTECTS: Collection creation requires authentication
    const dto = buildCreateCollectionDTO()

    const res = await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 401)
  })

  /**
   * COLLECTION LISTING TESTS
   */

  it('GET /v1/schemas/:schemaId/collections returns 200 and list shape with API key', async () => {
    // PROTECTS: Collection listing returns proper list format
    const res = await app.inject({
      method: 'GET',
      url: `/v1/schemas/${testSchemaId}/collections`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertListResponse(body)
  })

  it('GET /v1/schemas/:schemaId/collections returns 404 for non-existent schema', async () => {
    // PROTECTS: 404 for unknown schema
    const res = await app.inject({
      method: 'GET',
      url: '/v1/schemas/nonexistentschema/collections',
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 404)
  })

  /**
   * COLLECTION CREATION TESTS
   */

  it('POST /v1/schemas/:schemaId/collections returns 201 with complete collection shape', async () => {
    // PROTECTS: Collection creation contract
    const dto = buildCreateCollectionDTO()

    const res = await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 201)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body).toMatchObject({
      $id: dto.collectionId,
      name: dto.name,
    })
  })

  it('POST /v1/schemas/:schemaId/collections returns 400 for invalid collectionId', async () => {
    // PROTECTS: Collection ID validation is enforced
    const dto = buildCreateCollectionDTO({ collectionId: '@@invalid@@' })

    const res = await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 400)
  })

  it('POST /v1/schemas/:schemaId/collections returns 400 for missing name', async () => {
    // PROTECTS: Required field validation
    const res = await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify({
        collectionId: 'test-collection',
        // Missing name
      }),
    })

    assertStatusCode(res, 400)
  })

  it('POST /v1/schemas/:schemaId/collections returns 404 for non-existent schema', async () => {
    // PROTECTS: 404 for unknown schema
    const dto = buildCreateCollectionDTO()

    const res = await app.inject({
      method: 'POST',
      url: '/v1/schemas/nonexistentschema/collections',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 404)
  })

  it('POST /v1/schemas/:schemaId/collections returns 409 for duplicate collectionId', async () => {
    // PROTECTS: Collection ID uniqueness constraint
    const dto = buildCreateCollectionDTO()

    // Create first collection
    await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    // Try to create second collection with same ID
    const res = await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 409)
  })

  /**
   * COLLECTION RETRIEVAL TESTS
   */

  it('GET /v1/schemas/:schemaId/collections/:collectionId returns 200 for existing collection', async () => {
    // PROTECTS: Single collection retrieval works correctly
    const dto = buildCreateCollectionDTO()

    // Create collection first
    await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    // Retrieve it
    const res = await app.inject({
      method: 'GET',
      url: `/v1/schemas/${testSchemaId}/collections/${dto.collectionId}`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body.$id).toBe(dto.collectionId)
    expect(body.name).toBe(dto.name)
  })

  it('GET /v1/schemas/:schemaId/collections/:collectionId returns 404 for non-existent collection', async () => {
    // PROTECTS: 404 for unknown collection ID
    const res = await app.inject({
      method: 'GET',
      url: `/v1/schemas/${testSchemaId}/collections/nonexistentcollection`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 404)
  })

  /**
   * COLLECTION UPDATE TESTS
   */

  it('PUT /v1/schemas/:schemaId/collections/:collectionId returns 200 and updates collection', async () => {
    // PROTECTS: Collection update works correctly
    const createDto = buildCreateCollectionDTO()
    const updateDto = buildUpdateCollectionDTO({
      name: 'Updated Collection Name',
    })

    // Create collection first
    await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(createDto),
    })

    // Update it
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/schemas/${testSchemaId}/collections/${createDto.collectionId}`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(updateDto),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body.$id).toBe(createDto.collectionId)
    expect(body.name).toBe('Updated Collection Name')
  })

  it('PUT /v1/schemas/:schemaId/collections/:collectionId returns 404 for non-existent collection', async () => {
    // PROTECTS: 404 when updating non-existent collection
    const updateDto = buildUpdateCollectionDTO()

    const res = await app.inject({
      method: 'PUT',
      url: `/v1/schemas/${testSchemaId}/collections/nonexistentcollection`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(updateDto),
    })

    assertStatusCode(res, 404)
  })

  /**
   * COLLECTION DELETION TESTS
   */

  it('DELETE /v1/schemas/:schemaId/collections/:collectionId returns 204 for existing collection', async () => {
    // PROTECTS: Collection deletion works correctly
    const dto = buildCreateCollectionDTO()

    // Create collection first
    await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    // Delete it
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/schemas/${testSchemaId}/collections/${dto.collectionId}`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 204)

    // Verify it's gone
    const checkRes = await app.inject({
      method: 'GET',
      url: `/v1/schemas/${testSchemaId}/collections/${dto.collectionId}`,
      headers: getApiKeyHeaders(),
    })
    assertStatusCode(checkRes, 404)
  })

  it('DELETE /v1/schemas/:schemaId/collections/:collectionId returns 404 for non-existent collection', async () => {
    // PROTECTS: 404 when deleting non-existent collection
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/schemas/${testSchemaId}/collections/nonexistentcollection`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 404)
  })
})
