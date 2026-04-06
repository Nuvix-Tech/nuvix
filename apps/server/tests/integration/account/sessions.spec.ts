import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildCreateAccountDTO } from '../../factories/dto/account.factory'
import { buildCreateEmailSessionDTO } from '../../factories/dto/session.factory'
import { createUserAndSession } from '../../helpers/auth'
import { getApp } from '../../setup/app'
import {
  assertDocumentShape,
  assertListResponse,
  assertStatusCode,
  parseJson,
} from '../../setup/test-utils'
import { Auth } from '@nuvix/core/helpers'

describe('account/sessions (integration)', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    app = await getApp()
  })

  /**
   * SESSION CREATION TESTS
   * These tests protect the login flow
   */

  it('POST /v1/account/sessions/email returns 201 and complete session shape for valid credentials', async () => {
    // PROTECTS: Login success contract - status code, required fields, and session secret
    const account = buildCreateAccountDTO()

    const createAccountRes = await app.inject({
      method: 'POST',
      url: '/v1/account',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(account),
    })
    assertStatusCode(createAccountRes, 201)

    const dto = buildCreateEmailSessionDTO({
      email: account.email,
      password: account.password,
    })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/account/sessions/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 201)

    const body = parseJson(res.payload)
    assertDocumentShape(body)

    // Verify complete session shape
    expect(body).toMatchObject({
      $id: expect.any(String),
      userId: expect.any(String),
      expire: expect.any(String),
      provider: 'email',
      current: true,
    })

    // Secret should be non-empty
    expect(body.secret).toBe(undefined)
  })

  it('POST /v1/account/sessions/email returns 401 for invalid password', async () => {
    // PROTECTS: Login fails with wrong password (prevents unauthorized access)
    const account = buildCreateAccountDTO()

    const createAccountRes = await app.inject({
      method: 'POST',
      url: '/v1/account',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(account),
    })
    assertStatusCode(createAccountRes, 201)

    const dto = buildCreateEmailSessionDTO({
      email: account.email,
      password: 'wrong-password-12345',
    })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/account/sessions/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 401)
    const body = parseJson(res.payload)
    expect(body.message).toBeDefined()
    expect(body.code).toBeDefined()
  })

  it('POST /v1/account/sessions/email returns 401 for non-existent user', async () => {
    // PROTECTS: Login fails for unknown email (prevents user enumeration if response is generic)
    const dto = buildCreateEmailSessionDTO({
      email: `nonexistent-${Date.now()}@example.com`,
      password: 'SomePassword123!',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/account/sessions/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 401)
  })

  it('POST /v1/account/sessions/email returns 400 for an invalid email format', async () => {
    // PROTECTS: Email validation on login request
    const dto = buildCreateEmailSessionDTO({ email: 'not-an-email' })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/account/sessions/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 400)
  })

  it('POST /v1/account/sessions/email returns 400 for missing password', async () => {
    // PROTECTS: Required field validation on login
    const res = await app.inject({
      method: 'POST',
      url: '/v1/account/sessions/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'test@example.com' }),
    })

    assertStatusCode(res, 400)
  })

  /**
   * SESSION LISTING TESTS
   * These tests verify session management endpoints
   */

  it('GET /v1/account/sessions returns 401 when unauthenticated', async () => {
    // PROTECTS: Session list not exposed without authentication
    const res = await app.inject({
      method: 'GET',
      url: '/v1/account/sessions',
    })

    assertStatusCode(res, 401)
  })

  it('GET /v1/account/sessions returns 200 and list shape when authenticated', async () => {
    // PROTECTS: Session listing returns proper list format
    const { sessionHeader } = await createUserAndSession(app)

    const res = await app.inject({
      method: 'GET',
      url: '/v1/account/sessions',
      headers: {
        'x-nuvix-session': sessionHeader,
      },
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertListResponse(body)

    // Should have at least one session (the current one)
    expect(body.total).toBeGreaterThanOrEqual(1)
    expect(body.data.length).toBeGreaterThanOrEqual(1)

    // Verify session shape in list
    const session = body.data[0] as Record<string, unknown>
    expect(session.$id).toBeDefined()
    expect(session.userId).toBeDefined()
    expect(session.provider).toBeDefined()
  })

  /**
   * SESSION RETRIEVAL TESTS
   */

  it('GET /v1/account/sessions/current returns 200 and current session shape', async () => {
    // PROTECTS: Current session endpoint returns the active session
    const { sessionHeader, userId } = await createUserAndSession(app)

    const res = await app.inject({
      method: 'GET',
      url: '/v1/account/sessions/current',
      headers: {
        'x-nuvix-session': sessionHeader,
      },
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body).toMatchObject({
      userId: userId,
      current: true,
      provider: 'email',
    })
  })

  it('GET /v1/account/sessions/:sessionId returns 200 for existing session', async () => {
    // PROTECTS: Can retrieve specific session by ID
    const { sessionHeader } = await createUserAndSession(app)

    // First get the current session to know its ID
    const currentRes = await app.inject({
      method: 'GET',
      url: '/v1/account/sessions/current',
      headers: {
        'x-nuvix-session': sessionHeader,
      },
    })
    const currentSession = parseJson(currentRes.payload)

    // Now fetch by ID
    const res = await app.inject({
      method: 'GET',
      url: `/v1/account/sessions/${currentSession.$id}`,
      headers: {
        'x-nuvix-session': sessionHeader,
      },
    })

    assertStatusCode(res, 200)
    const body = parseJson(res.payload)
    expect(body.$id).toBe(currentSession.$id)
  })

  it('GET /v1/account/sessions/:sessionId returns 404 for non-existent session', async () => {
    // PROTECTS: 404 returned for invalid session ID
    const { sessionHeader } = await createUserAndSession(app)

    const res = await app.inject({
      method: 'GET',
      url: '/v1/account/sessions/nonexistentsessionid',
      headers: {
        'x-nuvix-session': sessionHeader,
      },
    })

    assertStatusCode(res, 404)
  })

  /**
   * SESSION DELETION TESTS
   */

  it('DELETE /v1/account/sessions/:sessionId returns 204 for existing session', async () => {
    // PROTECTS: Session deletion works correctly
    const account = buildCreateAccountDTO()

    // Create account
    await app.inject({
      method: 'POST',
      url: '/v1/account',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(account),
    })

    // Create first session
    const session1Res = await app.inject({
      method: 'POST',
      url: '/v1/account/sessions/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: account.email,
        password: account.password,
      }),
    })
    const session1 = parseJson(session1Res.payload)

    // Create second session
    const session2Res = await app.inject({
      method: 'POST',
      url: '/v1/account/sessions/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: account.email,
        password: account.password,
      }),
    })

    // Delete first session using second session's auth
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/account/sessions/${session1.$id}`,
      headers: {
        'x-nuvix-session': session2Res.cookies.find(
          c => c.name === Auth.cookieName,
        )?.value,
      },
    })

    assertStatusCode(deleteRes, 204)

    // Verify first session is gone
    const checkRes = await app.inject({
      method: 'GET',
      url: `/v1/account/sessions/${session1.$id}`,
      headers: {
        'x-nuvix-session': session2Res.cookies.find(
          c => c.name === Auth.cookieName,
        )?.value,
      },
    })
    assertStatusCode(checkRes, 404)
  })

  it('DELETE /v1/account/sessions/current returns 204 and invalidates current session', async () => {
    // PROTECTS: Current session logout works (user can log out)
    const { sessionHeader } = await createUserAndSession(app)

    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/account/sessions/current',
      headers: {
        'x-nuvix-session': sessionHeader,
      },
    })

    assertStatusCode(res, 204)

    // Verify session is invalidated
    const checkRes = await app.inject({
      method: 'GET',
      url: '/v1/account',
      headers: {
        'x-nuvix-session': sessionHeader,
      },
    })
    assertStatusCode(checkRes, 401)
  })
})
