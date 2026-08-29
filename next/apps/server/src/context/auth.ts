import { Elysia } from 'elysia'
import { HEADERS } from '../shared/constants'
import { verifyJwt } from '../utils/jwt'

/**
 * Auth context resolution — Phase 1 primitives.
 *
 * Stateless parts (JWT signature, header parsing) are resolved here.
 * Stateful verification (session lookup, API-key lookup) is pluggable:
 * DB-backed verifiers are injected once @nuvix/db is wired (Phase 3+).
 * Until then unverified credentials resolve to `guest`.
 */

export type AuthMode = 'admin' | 'console'

export type AuthContext =
  | { type: 'guest' }
  | { type: 'session'; sessionId: string; userId: string }
  | { type: 'jwt'; userId: string; sessionId?: string }
  | { type: 'apiKey'; keyId: string; mode: AuthMode }

/** Injected by later phases; null/unset means credential cannot be trusted. */
export interface AuthVerifiers {
  /** Exchanges a raw bearer token for canonical, non-secret session and user identities. */
  verifySession?: (sessionToken: string) => Promise<{ sessionId: string; userId: string } | null>
  verifyApiKey?: (key: string, mode: AuthMode) => Promise<{ keyId: string } | null>
}

function parseMode(value: string | null): AuthMode {
  return value === 'console' ? 'console' : 'admin'
}

export async function resolveAuth(
  headers: Headers,
  verifiers: AuthVerifiers = {},
  jwtSecret?: string,
): Promise<AuthContext> {
  // 1. Session token
  const sessionToken = headers.get(HEADERS.session)
  if (sessionToken) {
    if (!verifiers.verifySession) return { type: 'guest' }
    const session = await verifiers.verifySession(sessionToken)
    return session
      ? {
          type: 'session',
          sessionId: session.sessionId,
          userId: session.userId,
        }
      : { type: 'guest' }
  }

  // 2. Short-lived JWT
  const token = headers.get(HEADERS.jwt)
  if (token && jwtSecret) {
    const payload = await verifyJwt(token, jwtSecret)
    if (payload?.sub) {
      return {
        type: 'jwt',
        userId: payload.sub,
        sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
      }
    }
    return { type: 'guest' }
  }

  // 3. API key (+ optional mode)
  const apiKey = headers.get(HEADERS.apiKey)
  if (apiKey) {
    const mode = parseMode(headers.get(HEADERS.mode))
    if (!verifiers.verifyApiKey) return { type: 'guest' }
    const key = await verifiers.verifyApiKey(apiKey, mode)
    return key ? { type: 'apiKey', keyId: key.keyId, mode } : { type: 'guest' }
  }

  return { type: 'guest' }
}

export function authContext(options: { jwtSecret?: string; verifiers?: AuthVerifiers } = {}) {
  return new Elysia({ name: 'auth-context' }).derive(
    // NOTE: scope required — local-scoped derive does not cross .use() boundaries
    'plugin',
    async ({ request }) => ({
      auth: await resolveAuth(request.headers, options.verifiers, options.jwtSecret),
    }),
  )
}
