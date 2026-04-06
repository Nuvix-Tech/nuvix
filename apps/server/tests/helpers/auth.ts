import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { ApiKey, configuration } from '@nuvix/utils'
import { buildCreateAccountDTO } from '../factories/dto/account.factory'
import { buildCreateEmailSessionDTO } from '../factories/dto/session.factory'
import { Auth } from '@nuvix/core/helpers'

/**
 * Creates a new user account and establishes a session.
 * Returns the session secret for use in x-nuvix-session header.
 */
export async function createUserAndSession(
  app: NestFastifyApplication,
): Promise<{
  userId: string
  email: string
  password: string
  sessionHeader: string
}> {
  const account = buildCreateAccountDTO()
  const createAccountRes = await app.inject({
    method: 'POST',
    url: '/v1/account',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(account),
  })

  // Keep helper strict: if this breaks, tests should fail loudly.
  if (createAccountRes.statusCode !== 201) {
    throw new Error(
      `Expected account creation 201, got ${createAccountRes.statusCode}: ${createAccountRes.payload}`,
    )
  }

  const sessionDto = buildCreateEmailSessionDTO({
    email: account.email,
    password: account.password,
  })
  const createSessionRes = await app.inject({
    method: 'POST',
    url: '/v1/account/sessions/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(sessionDto),
  })

  if (createSessionRes.statusCode !== 201) {
    throw new Error(
      `Expected session creation 201, got ${createSessionRes.statusCode}: ${createSessionRes.payload}`,
    )
  }

  const sessionHeader = createSessionRes.cookies.find(
    f => f.name === Auth.cookieName,
  )
  if (!sessionHeader || sessionHeader.value.length === 0) {
    throw new Error('Expected session cookie')
  }

  return {
    userId: account.userId,
    email: account.email,
    password: account.password,
    sessionHeader: sessionHeader.value,
  }
}

/**
 * Returns headers object with x-nuvix-key for API key authentication.
 * Reads the API key from NUVIX_TEST_API_KEY environment variable.
 * @throws Error if NUVIX_TEST_API_KEY is not set
 */
export function getApiKeyHeaders(): Record<string, string> {
  const apiKey = configuration.app.testApiKey
  if (!apiKey) {
    throw new Error(
      'NUVIX_TEST_API_KEY environment variable is required for KEY auth tests',
    )
  }
  return {
    'x-nuvix-key': `${ApiKey.STANDARD}_${apiKey}`,
  }
}

/**
 * Creates headers object with x-nuvix-key and content-type for JSON requests.
 */
export function getApiKeyJsonHeaders(): Record<string, string> {
  return {
    ...getApiKeyHeaders(),
    'content-type': 'application/json',
  }
}

/**
 * Placeholder for creating admin session headers.
 * For routes that ONLY accept ADMIN auth, not KEY auth.
 * Currently throws - implement when needed.
 */
export async function createAdminSession(
  _app: NestFastifyApplication,
): Promise<Record<string, string>> {
  // TODO: Implement admin session creation
  // This could use the existing admin user from db.ts setup
  // For now, most ADMIN routes also accept KEY auth, so use getApiKeyHeaders instead
  throw new Error(
    'createAdminSession not yet implemented - use getApiKeyHeaders() for routes that accept both ADMIN and KEY auth',
  )
}
