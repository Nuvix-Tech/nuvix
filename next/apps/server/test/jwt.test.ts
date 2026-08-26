import { describe, expect, test } from 'bun:test'
import { signJwt, verifyJwt } from '../src/utils/jwt'

const SECRET = 'test-secret'

describe('jwt utils', () => {
  test('signs and verifies round-trip', async () => {
    const token = await signJwt({ sub: 'user-1', sid: 'sess-9' }, SECRET, 60)
    const payload = await verifyJwt(token, SECRET)

    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('user-1')
    expect(payload!.sid).toBe('sess-9')
    expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  test('rejects wrong secret', async () => {
    const token = await signJwt({ sub: 'user-1' }, SECRET, 60)
    expect(await verifyJwt(token, 'wrong-secret')).toBeNull()
  })

  test('rejects garbage', async () => {
    expect(await verifyJwt('not-a-token', SECRET)).toBeNull()
  })

  test('rejects expired token', async () => {
    const token = await signJwt({ sub: 'u' }, SECRET, -10)
    expect(await verifyJwt(token, SECRET)).toBeNull()
  })
})
