import { describe, expect, test } from 'bun:test'
import { treaty } from '@elysia/eden'
import { Elysia } from 'elysia'
import { type AuthContext, authContext } from '../src/context/auth'
import { signJwt } from '../src/utils/jwt'

const SECRET = 'test-secret'

/** Probe route exposing the resolved auth context. */
const app = new Elysia({ prefix: '/v2' })
  .use(
    authContext({
      jwtSecret: SECRET,
      verifiers: {
        verifySession: async (id) => (id === 'valid-session' ? { userId: 'user-1' } : null),
        verifyApiKey: async (key) => (key === 'valid-key' ? { keyId: 'key-1' } : null),
      },
    }),
  )
  .get('/whoami', ({ auth }) => ({ auth }))

const client = treaty(app)

function h(headers: Record<string, string>) {
  return { headers }
}

describe('auth context resolution', () => {
  test('no credentials → guest', async () => {
    const { data } = await client.v2.whoami.get()
    expect((data!.auth as AuthContext).type).toBe('guest')
  })

  test('valid session header → session context', async () => {
    const res = await app.handle(
      new Request('http://x/v2/whoami', h({ 'x-nuvix-session': 'valid-session' })),
    )
    const body = (await res.json()) as { auth: AuthContext }
    expect(body.auth).toEqual({
      type: 'session',
      sessionId: 'valid-session',
      userId: 'user-1',
    })
  })

  test('invalid session → guest', async () => {
    const res = await app.handle(
      new Request('http://x/v2/whoami', h({ 'x-nuvix-session': 'bogus' })),
    )
    const body = (await res.json()) as { auth: AuthContext }
    expect(body.auth.type).toBe('guest')
  })

  test('valid JWT → jwt context with sub + sid', async () => {
    const token = await signJwt({ sub: 'user-7', sid: 'sess-2' }, SECRET, 60)
    const res = await app.handle(new Request('http://x/v2/whoami', h({ 'x-nuvix-jwt': token })))
    const body = (await res.json()) as { auth: AuthContext }
    expect(body.auth).toEqual({
      type: 'jwt',
      userId: 'user-7',
      sessionId: 'sess-2',
    })
  })

  test('tampered JWT → guest', async () => {
    const token = await signJwt({ sub: 'user-7' }, SECRET, 60)
    const res = await app.handle(
      new Request('http://x/v2/whoami', h({ 'x-nuvix-jwt': `${token}x` })),
    )
    const body = (await res.json()) as { auth: AuthContext }
    expect(body.auth.type).toBe('guest')
  })

  test('valid API key + mode → apiKey context', async () => {
    const res = await app.handle(
      new Request(
        'http://x/v2/whoami',
        h({ 'x-nuvix-key': 'valid-key', 'x-nuvix-mode': 'console' }),
      ),
    )
    const body = (await res.json()) as { auth: AuthContext }
    expect(body.auth).toEqual({
      type: 'apiKey',
      keyId: 'key-1',
      mode: 'console',
    })
  })

  test('API key defaults to admin mode', async () => {
    const res = await app.handle(
      new Request('http://x/v2/whoami', h({ 'x-nuvix-key': 'valid-key' })),
    )
    const body = (await res.json()) as { auth: AuthContext }
    expect(body.auth).toEqual({
      type: 'apiKey',
      keyId: 'key-1',
      mode: 'admin',
    })
  })

  test('session takes precedence over other headers', async () => {
    const token = await signJwt({ sub: 'user-7' }, SECRET, 60)
    const res = await app.handle(
      new Request(
        'http://x/v2/whoami',
        h({ 'x-nuvix-session': 'valid-session', 'x-nuvix-jwt': token }),
      ),
    )
    const body = (await res.json()) as { auth: AuthContext }
    expect(body.auth.type).toBe('session')
  })

  test('unverifiable API key without verifier → guest', async () => {
    const bare = new Elysia({ prefix: '/v2' })
      .use(authContext())
      .get('/whoami', ({ auth }) => ({ auth }))
    const res = await bare.handle(
      new Request('http://x/v2/whoami', h({ 'x-nuvix-key': 'anything' })),
    )
    const body = (await res.json()) as { auth: AuthContext }
    expect(body.auth.type).toBe('guest')
  })
})
