import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildCreateCollectionDTO } from '../../factories/dto/collection.factory'
import {
  buildCreateDocumentDTO,
  buildUpdateDocumentDTO,
} from '../../factories/dto/document.factory'
import { buildCreateDocumentSchemaDTO } from '../../factories/dto/schema.factory'
import { getApiKeyHeaders, getApiKeyJsonHeaders } from '../../helpers/auth'
import { getApp } from '../../setup/app'
import {
  assertDocumentShape,
  assertListResponse,
  assertStatusCode,
  parseJson,
} from '../../setup/test-utils'

describe('schemas/collections/documents (integration)', () => {
  let app: NestFastifyApplication
  let testSchemaId: string
  let testCollectionId: string

  beforeAll(async () => {
    app = await getApp()

    // Create a document schema
    const schemaDto = buildCreateDocumentSchemaDTO()
    testSchemaId = schemaDto.name

    await app.inject({
      method: 'POST',
      url: '/v1/database/schemas',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(schemaDto),
    })

    // Create a collection within the schema
    const collectionDto = buildCreateCollectionDTO()
    testCollectionId = collectionDto.collectionId

    await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(collectionDto),
    })

    // Create 'title' attribute
    await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/attributes/string`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify({ key: 'title', size: 255, required: false }),
    })

    // Create 'content' attribute
    await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/attributes/string`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify({ key: 'content', size: 10000, required: false }),
    })
  })

  /**
   * AUTH BOUNDARY TESTS
   * Document endpoints require authentication (may allow JWT auth depending on permissions)
   */

  it('GET /v1/schemas/:schemaId/collections/:collectionId/documents returns 401 when unauthenticated', async () => {
    // PROTECTS: Document list not exposed without authentication
    const res = await app.inject({
      method: 'GET',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents`,
    })

    // Can be 401 (Unauthenticated) or 403 (Forbidden for Guest) depending on guard order
    expect([401, 403]).toContain(res.statusCode)
  })

  it('POST /v1/schemas/:schemaId/collections/:collectionId/documents returns 401 when unauthenticated', async () => {
    // PROTECTS: Document creation requires authentication
    const dto = buildCreateDocumentDTO()

    const res = await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 401)
  })

  /**
   * DOCUMENT LISTING TESTS
   */

  it('GET /v1/schemas/:schemaId/collections/:collectionId/documents returns 200 and list shape with API key', async () => {
    // PROTECTS: Document listing returns proper list format
    const res = await app.inject({
      method: 'GET',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertListResponse(body)
  })

  it('GET /v1/schemas/:schemaId/collections/:collectionId/documents returns 404 for non-existent collection', async () => {
    // PROTECTS: 404 for unknown collection
    const res = await app.inject({
      method: 'GET',
      url: `/v1/schemas/${testSchemaId}/collections/nonexistentcollection/documents`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 404)
  })

  /**
   * DOCUMENT CREATION TESTS
   */

  it('POST /v1/schemas/:schemaId/collections/:collectionId/documents returns 201 with complete document shape', async () => {
    // PROTECTS: Document creation contract
    // Use hardcoded data to ensure it matches attribute constraints (title: 255)
    const dto = buildCreateDocumentDTO({
      data: {
        title: 'Test Document Title',
        content: 'Test Document Content',
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 201)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body.$id).toBe(dto.documentId)
  })

  it('POST /v1/schemas/:schemaId/collections/:collectionId/documents returns 400 for invalid documentId', async () => {
    // PROTECTS: Document ID validation is enforced
    const dto = buildCreateDocumentDTO({ documentId: '@@invalid@@' })

    const res = await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 400)
  })

  it('POST /v1/schemas/:schemaId/collections/:collectionId/documents returns 404 for non-existent collection', async () => {
    // PROTECTS: 404 for unknown collection
    const dto = buildCreateDocumentDTO()

    const res = await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections/nonexistentcollection/documents`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 404)
  })

  it('POST /v1/schemas/:schemaId/collections/:collectionId/documents returns 409 for duplicate documentId', async () => {
    // PROTECTS: Document ID uniqueness constraint
    const dto = buildCreateDocumentDTO()

    // Create first document
    await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    // Try to create second document with same ID
    const res = await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 409)
  })

  /**
   * DOCUMENT RETRIEVAL TESTS
   */

  it('GET /v1/schemas/:schemaId/collections/:collectionId/documents/:documentId returns 200 for existing document', async () => {
    // PROTECTS: Single document retrieval works correctly
    const dto = buildCreateDocumentDTO()

    // Create document first
    await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    // Retrieve it
    const res = await app.inject({
      method: 'GET',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents/${dto.documentId}`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body.$id).toBe(dto.documentId)
  })

  it('GET /v1/schemas/:schemaId/collections/:collectionId/documents/:documentId returns 404 for non-existent document', async () => {
    // PROTECTS: 404 for unknown document ID
    const res = await app.inject({
      method: 'GET',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents/nonexistentdocument`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 404)
  })

  /**
   * DOCUMENT UPDATE TESTS
   */

  it('PATCH /v1/schemas/:schemaId/collections/:collectionId/documents/:documentId returns 200 and updates document', async () => {
    // PROTECTS: Document update works correctly
    const createDto = buildCreateDocumentDTO()
    const updateDto = buildUpdateDocumentDTO({
      data: { title: 'Updated Title', content: 'Updated content' },
    })

    // Create document first
    await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(createDto),
    })

    // Update it
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents/${createDto.documentId}`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(updateDto),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body.$id).toBe(createDto.documentId)
  })

  it('PATCH /v1/schemas/:schemaId/collections/:collectionId/documents/:documentId returns 404 for non-existent document', async () => {
    // PROTECTS: 404 when updating non-existent document
    const updateDto = buildUpdateDocumentDTO()

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents/nonexistentdocument`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(updateDto),
    })

    assertStatusCode(res, 404)
  })

  /**
   * DOCUMENT DELETION TESTS
   */

  it('DELETE /v1/schemas/:schemaId/collections/:collectionId/documents/:documentId returns 204 for existing document', async () => {
    // PROTECTS: Document deletion works correctly
    const dto = buildCreateDocumentDTO()

    // Create document first
    const createRes = await app.inject({
      method: 'POST',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })
    assertStatusCode(createRes, 201)

    // Delete it
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents/${dto.documentId}`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 204)

    // Verify it's gone
    const checkRes = await app.inject({
      method: 'GET',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents/${dto.documentId}`,
      headers: getApiKeyHeaders(),
    })
    assertStatusCode(checkRes, 404)
  })

  it('DELETE /v1/schemas/:schemaId/collections/:collectionId/documents/:documentId returns 404 for non-existent document', async () => {
    // PROTECTS: 404 when deleting non-existent document
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/schemas/${testSchemaId}/collections/${testCollectionId}/documents/nonexistentdocument`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 404)
  })
})
