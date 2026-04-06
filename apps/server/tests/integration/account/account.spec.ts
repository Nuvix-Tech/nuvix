import { faker } from '@faker-js/faker'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildCreateAccountDTO } from '../../factories/dto/account.factory'
import { createUserAndSession } from '../../helpers/auth'
import { getApp } from '../../setup/app'
import {
  assertDocumentShape,
  assertStatusCode,
  parseJson,
} from '../../setup/test-utils'

describe('account (integration)', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    app = await getApp()
  })

  /**
   * AUTH BOUNDARY TESTS
   * These tests protect against accidentally exposing private endpoints publicly
   */

  it('GET /v1/account returns 401 when unauthenticated', async () => {
    // PROTECTS: Ensures account details are not exposed without authentication
    const res = await app.inject({
      method: 'GET',
      url: '/v1/account',
    })

    assertStatusCode(res, 401)
    const body = parseJson(res.payload)
    expect(body.message).toBeDefined()
    expect(body.code).toBeDefined()
  })

  it('GET /v1/account/prefs returns 401 when unauthenticated', async () => {
    // PROTECTS: User preferences not exposed without authentication
    const res = await app.inject({
      method: 'GET',
      url: '/v1/account/prefs',
    })

    assertStatusCode(res, 401)
  })

  /**
   * ACCOUNT CREATION TESTS
   * These tests protect the account registration flow
   */

  it('POST /v1/account returns 201 and echoes full account shape', async () => {
    // PROTECTS: Account creation contract - status code and all required fields
    const dto = buildCreateAccountDTO()

    const res = await app.inject({
      method: 'POST',
      url: '/v1/account',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 201)

    const body = parseJson(res.payload)
    assertDocumentShape(body)

    // Verify all expected fields are present
    expect(body).toMatchObject({
      $id: dto.userId,
      email: dto.email,
      name: dto.name,
      status: true,
      emailVerification: false,
      phoneVerification: false,
      mfa: false,
    })

    // Ensure password is NOT returned
    expect(body.password).toBeUndefined()
    expect(body.hash).toBeUndefined()
    expect(body.hashOptions).toBeUndefined()
    expect(body.mfaRecoveryCodes).toBeUndefined()
  })

  it('POST /v1/account returns 400 for an invalid email', async () => {
    // PROTECTS: Email validation is enforced during registration
    const dto = buildCreateAccountDTO({ email: 'not-an-email' })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/account',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 400)
    const body = parseJson(res.payload)
    expect(body.message).toBeDefined()
  })

  it('POST /v1/account returns 400 for missing required fields', async () => {
    // PROTECTS: All required fields are validated
    const res = await app.inject({
      method: 'POST',
      url: '/v1/account',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'test@example.com' }), // Missing password, userId
    })

    assertStatusCode(res, 400)
  })

  it('POST /v1/account returns 400 for weak password', async () => {
    // PROTECTS: Password strength requirements are enforced
    const dto = buildCreateAccountDTO({ password: '123' })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/account',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto),
    })

    assertStatusCode(res, 400)
  })

  it('POST /v1/account returns 409 for duplicate email', async () => {
    // PROTECTS: Email uniqueness constraint
    const dto = buildCreateAccountDTO()

    // Create first account
    await app.inject({
      method: 'POST',
      url: '/v1/account',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto),
    })

    // Try to create second account with same email
    const dto2 = buildCreateAccountDTO({ email: dto.email })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/account',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(dto2),
    })

    assertStatusCode(res, 409)
  })

  /**
   * AUTHENTICATED ACCOUNT ACCESS TESTS
   * These tests verify behavior when user is properly authenticated
   */

  it('GET /v1/account returns 200 and full user shape when authenticated', async () => {
    // PROTECTS: Authenticated account retrieval returns complete user data
    const { sessionHeader, userId, email } = await createUserAndSession(app)

    const res = await app.inject({
      method: 'GET',
      url: '/v1/account',
      headers: {
        'x-nuvix-session': sessionHeader,
      },
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertDocumentShape(body)

    expect(body).toMatchObject({
      $id: userId,
      email: email,
      status: true,
      mfa: false,
    })

    // Sensitive data should not be exposed
    expect(body.password).toBeUndefined()
    expect(body.hash).toBeUndefined()
  })

  it('GET /v1/account/prefs returns 200 and an object for authenticated user', async () => {
    // PROTECTS: Prefs endpoint returns valid object (even if empty)
    const { sessionHeader } = await createUserAndSession(app)

    const res = await app.inject({
      method: 'GET',
      url: '/v1/account/prefs',
      headers: {
        'x-nuvix-session': sessionHeader,
      },
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    expect(typeof body).toBe('object')
    expect(body).not.toBeNull()
  })

  /**
   * ACCOUNT UPDATE TESTS
   * These tests verify account modification endpoints
   */

  it('PATCH /v1/account/prefs returns 200 and echoes updated prefs', async () => {
    // PROTECTS: Prefs update works and returns the updated values
    const { sessionHeader } = await createUserAndSession(app)
    const prefs = { theme: 'dark', language: 'en' }

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/account/prefs',
      headers: {
        'content-type': 'application/json',
        'x-nuvix-session': sessionHeader,
      },
      payload: JSON.stringify({ prefs }),
    })
    console.log(res.body, '---', res.payload)
    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    expect(body).toEqual(prefs)
  })

  it('PATCH /v1/account/name returns 200 and updates name', async () => {
    // PROTECTS: Name update modifies the account correctly
    const { sessionHeader } = await createUserAndSession(app)
    const newName = 'Updated Test Name'

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/account/name',
      headers: {
        'content-type': 'application/json',
        'x-nuvix-session': sessionHeader,
      },
      payload: JSON.stringify({ name: newName }),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body.name).toBe(newName)
  })

  it('PATCH /v1/account/password returns 200 when old password is correct', async () => {
    // PROTECTS: Password change works with valid old password
    const {
      sessionHeader,
      password: oldPassword,
      userId,
    } = await createUserAndSession(app)
    const newPassword = 'NewPassword123!'

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/account/password',
      headers: {
        'content-type': 'application/json',
        'x-nuvix-session': sessionHeader,
      },
      payload: JSON.stringify({
        password: newPassword,
        oldPassword,
      }),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body.$id).toBe(userId)
    // Password should not be returned
    expect(body.password).toBeUndefined()
  })

  it('PATCH /v1/account/password returns 401 when old password is wrong', async () => {
    // PROTECTS: Password change is rejected with invalid old password
    const { sessionHeader } = await createUserAndSession(app)

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/account/password',
      headers: {
        'content-type': 'application/json',
        'x-nuvix-session': sessionHeader,
      },
      payload: JSON.stringify({
        password: 'NewPassword123!',
        oldPassword: 'WrongOldPassword123!',
      }),
    })

    assertStatusCode(res, 401)
  })

  it('PATCH /v1/account/email returns 200 and updates email when password is correct', async () => {
    // PROTECTS: Email change works with valid password
    const { sessionHeader, password: currentPassword } =
      await createUserAndSession(app)
    const newEmail = `updated-email-${Date.now()}@example.com`

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/account/email',
      headers: {
        'content-type': 'application/json',
        'x-nuvix-session': sessionHeader,
      },
      payload: JSON.stringify({
        email: newEmail,
        password: currentPassword,
      }),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body.email).toBe(newEmail)
  })

  it('PATCH /v1/account/email returns 401 when password is wrong', async () => {
    // PROTECTS: Email change is rejected with invalid password
    const { sessionHeader } = await createUserAndSession(app)

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/account/email',
      headers: {
        'content-type': 'application/json',
        'x-nuvix-session': sessionHeader,
      },
      payload: JSON.stringify({
        email: 'new@example.com',
        password: 'WrongPassword123!',
      }),
    })

    assertStatusCode(res, 401)
  })

  it('PATCH /v1/account/phone returns 200 and updates phone when password is correct', async () => {
    // PROTECTS: Phone update works with valid password
    const { sessionHeader, password: currentPassword } =
      await createUserAndSession(app)
    const newPhone = faker.phone.number({ style: 'international' })

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/account/phone',
      headers: {
        'content-type': 'application/json',
        'x-nuvix-session': sessionHeader,
      },
      payload: JSON.stringify({
        phone: newPhone,
        password: currentPassword,
      }),
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body.phone).toBe(newPhone)
  })

  it('PATCH /v1/account/status returns 200 and disables the account', async () => {
    // PROTECTS: Account deactivation works correctly
    const { sessionHeader } = await createUserAndSession(app)

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/account/status',
      headers: {
        'x-nuvix-session': sessionHeader,
      },
    })

    assertStatusCode(res, 200)

    const body = parseJson(res.payload)
    assertDocumentShape(body)
    expect(body.status).toBe(false)
  })
})
