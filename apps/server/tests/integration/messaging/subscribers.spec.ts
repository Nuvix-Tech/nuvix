import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { ID } from '@nuvix/db'
import { CreateUserDTO } from '@/server/users/DTO/user.dto'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildCreateSmtpProviderDTO } from '../../factories/dto/provider.factory'
import { buildCreateSubscriberDTO } from '../../factories/dto/subscriber.factory'
import { buildCreateTopicDTO } from '../../factories/dto/topic.factory'
import { buildCreateUserDTO } from '../../factories/dto/user.factory'
import { buildCreateUserTargetDTO } from '../../factories/dto/userTarget.factory'
import { getApiKeyHeaders, getApiKeyJsonHeaders } from '../../helpers/auth'
import { getApp } from '../../setup/app'
import {
  assertDocumentShape,
  assertListResponse,
  assertStatusCode,
  parseJson,
} from '../../setup/test-utils'

describe('messaging/topics/subscribers (integration)', () => {
  let app: NestFastifyApplication
  let testTopicId: string
  let testTargetId: string
  let userDto: CreateUserDTO

  beforeAll(async () => {
    app = await getApp()

    // Create a topic to use for subscriber tests
    const topicDto = buildCreateTopicDTO()
    testTopicId = topicDto.topicId

    await app.inject({
      method: 'POST',
      url: '/v1/messaging/topics',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(topicDto),
    })

    // Create a user, provider and target for subscriber tests
    userDto = buildCreateUserDTO()
    await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(userDto),
    })

    const providerDto = buildCreateSmtpProviderDTO()
    await app.inject({
      method: 'POST',
      url: '/v1/messaging/providers/smtp',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(providerDto),
    })

    const targetDto = buildCreateUserTargetDTO({
      providerId: providerDto.providerId,
    })
    testTargetId = targetDto.targetId
    await app.inject({
      method: 'POST',
      url: `/v1/users/${userDto.userId}/targets`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(targetDto),
    })
  })

  const createTarget = async () => {
    const providerDto = buildCreateSmtpProviderDTO()
    await app.inject({
      method: 'POST',
      url: '/v1/messaging/providers/smtp',
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(providerDto),
    })

    const targetDto = buildCreateUserTargetDTO({
      providerId: providerDto.providerId,
    })

    await app.inject({
      method: 'POST',
      url: `/v1/users/${userDto.userId}/targets`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(targetDto),
    })
    return targetDto.targetId
  }

  /**
   * AUTH BOUNDARY TESTS
   * Subscriber endpoints require ADMIN or KEY auth
   */

  it('GET /v1/messaging/topics/:topicId/subscribers returns 401 when unauthenticated', async () => {
    // PROTECTS: Subscriber list not exposed without authentication
    const res = await app.inject({
      method: 'GET',
      url: `/v1/messaging/topics/${testTopicId}/subscribers`,
    })

    assertStatusCode(res, 401)
  })

  it('POST /v1/messaging/topics/:topicId/subscribers returns 401 when unauthenticated', async () => {
    // PROTECTS: Subscriber creation requires authentication
    const dto = buildCreateSubscriberDTO({ targetId: testTargetId })

    const res = await app.inject({
      method: 'POST',
      url: `/v1/messaging/topics/${testTopicId}/subscribers`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 401)
  })

  /**
   * SUBSCRIBER LISTING TESTS
   */

  it('GET /v1/messaging/topics/:topicId/subscribers returns 200 and list shape with API key', async () => {
    // PROTECTS: Subscriber listing returns proper list format
    const res = await app.inject({
      method: 'GET',
      url: `/v1/messaging/topics/${testTopicId}/subscribers`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertListResponse(body)
  })

  it('GET /v1/messaging/topics/:topicId/subscribers returns 404 for non-existent topic', async () => {
    // PROTECTS: 404 for unknown topic
    const res = await app.inject({
      method: 'GET',
      url: '/v1/messaging/topics/nonexistenttopic/subscribers',
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 404)
  })

  /**
   * SUBSCRIBER CREATION TESTS
   */

  it('POST /v1/messaging/topics/:topicId/subscribers returns 201 with complete subscriber shape', async () => {
    // PROTECTS: Subscriber creation contract
    const dto = buildCreateSubscriberDTO({ targetId: testTargetId })

    const res = await app.inject({
      method: 'POST',
      url: `/v1/messaging/topics/${testTopicId}/subscribers`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 201)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body).toMatchObject({
      $id: dto.subscriberId,
      topicId: testTopicId,
    })
  })

  it('POST /v1/messaging/topics/:topicId/subscribers returns 400 for missing targetId', async () => {
    // PROTECTS: Required field validation
    const res = await app.inject({
      method: 'POST',
      url: `/v1/messaging/topics/${testTopicId}/subscribers`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify({
        subscriberId: 'unique()',
        // Missing targetId
      }),
    })

    assertStatusCode(res, 400)
  })

  it('POST /v1/messaging/topics/:topicId/subscribers returns 404 for non-existent topic', async () => {
    // PROTECTS: 404 for unknown topic when creating subscriber
    const uniqueTargetId = await createTarget()
    const dto = buildCreateSubscriberDTO({ targetId: uniqueTargetId })

    const res = await app.inject({
      method: 'POST',
      url: `/v1/messaging/topics/nonexistenttopic${ID.unique()}/subscribers`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 404)
  })

  it('POST /v1/messaging/topics/:topicId/subscribers returns 409 for duplicate subscriberId', async () => {
    // PROTECTS: Subscriber ID uniqueness constraint within topic
    const uniqueTargetId = await createTarget()
    const dto = buildCreateSubscriberDTO({ targetId: uniqueTargetId })

    // Create first subscriber
    const res1 = await app.inject({
      method: 'POST',
      url: `/v1/messaging/topics/${testTopicId}/subscribers`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })
    assertStatusCode(res1, 201)

    // Try to create second subscriber with same ID (and same target/topic combo effectively if ID matches)
    const res = await app.inject({
      method: 'POST',
      url: `/v1/messaging/topics/${testTopicId}/subscribers`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 409)
  })

  /**
   * SUBSCRIBER RETRIEVAL TESTS
   */

  it('GET /v1/messaging/topics/:topicId/subscribers/:subscriberId returns 200 for existing subscriber', async () => {
    // PROTECTS: Single subscriber retrieval works correctly
    const uniqueTargetId = await createTarget()
    const dto = buildCreateSubscriberDTO({ targetId: uniqueTargetId })

    // Create subscriber first
    const createRes = await app.inject({
      method: 'POST',
      url: `/v1/messaging/topics/${testTopicId}/subscribers`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(createRes, 201)

    // Retrieve it
    const res = await app.inject({
      method: 'GET',
      url: `/v1/messaging/topics/${testTopicId}/subscribers/${dto.subscriberId}`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body.$id).toBe(dto.subscriberId)
  })

  it('GET /v1/messaging/topics/:topicId/subscribers/:subscriberId returns 404 for non-existent subscriber', async () => {
    // PROTECTS: 404 for unknown subscriber ID
    const res = await app.inject({
      method: 'GET',
      url: `/v1/messaging/topics/${testTopicId}/subscribers/${ID.unique()}`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 404)
  })

  /**
   * SUBSCRIBER DELETION TESTS
   */

  it('DELETE /v1/messaging/topics/:topicId/subscribers/:subscriberId returns 204 for existing subscriber', async () => {
    // PROTECTS: Subscriber deletion works correctly
    const uniqueTargetId = await createTarget()
    const dto = buildCreateSubscriberDTO({ targetId: uniqueTargetId })

    // Create subscriber first
    const createRes = await app.inject({
      method: 'POST',
      url: `/v1/messaging/topics/${testTopicId}/subscribers`,
      headers: getApiKeyJsonHeaders(),
      payload: JSON.stringify(dto),
    })

    assertStatusCode(createRes, 201)

    // Delete it
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/messaging/topics/${testTopicId}/subscribers/${dto.subscriberId}`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 204)

    // Verify it's gone
    const checkRes = await app.inject({
      method: 'GET',
      url: `/v1/messaging/topics/${testTopicId}/subscribers/${dto.subscriberId}`,
      headers: getApiKeyHeaders(),
    })
    assertStatusCode(checkRes, 404)
  })

  it('DELETE /v1/messaging/topics/:topicId/subscribers/:subscriberId returns 404 for non-existent subscriber', async () => {
    // PROTECTS: 404 when deleting non-existent subscriber
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/messaging/topics/${testTopicId}/subscribers/nonexistentsubscriber`,
      headers: getApiKeyHeaders(),
    })

    assertStatusCode(res, 404)
  })
})
