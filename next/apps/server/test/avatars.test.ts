import { describe, expect, test } from 'bun:test'
import { treaty } from '@elysia/eden'
import { Elysia } from 'elysia'
import { avatarRoutes } from '../src/avatars/route'
import { createAvatarService } from '../src/avatars/service'

/**
 * Avatars module tests — service-level (pure) + route-level (treaty).
 * Contract: docs/api/avatars.md
 */

const service = createAvatarService()

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const
const isPng = (bytes: Uint8Array) => PNG_MAGIC.every((b, i) => bytes[i] === b)

describe('avatar service', () => {
  test('resize: real flag asset → PNG with immutable cache', async () => {
    const result = await service.resize('flags', 'de', 64, 64)
    expect(isPng(result.body)).toBe(true)
    expect(result.contentType).toBe('image/png')
    expect(result.headers['Cache-Control']).toBe('public, max-age=86400, immutable')
  })

  test('resize: case-insensitive codes', async () => {
    const result = await service.resize('flags', 'DE', 32, 32)
    expect(isPng(result.body)).toBe(true)
  })

  test('unknown code → NotFoundError with messageKey', async () => {
    let caught: unknown
    try {
      await service.resize('flags', 'atlantis', 32, 32)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    const fields = (caught as { fields?: Record<string, unknown> }).fields
    expect(fields?.messageKey).toBe('errors.avatars.unknownCode')
  })

  test('path traversal attempts rejected as unknown code', async () => {
    await expect(service.resize('flags', '../secrets', 32, 32)).rejects.toThrow()
  })

  test('initials: renders PNG for a name', async () => {
    const result = await service.initials({
      name: 'Ada Lovelace',
      width: 200,
      height: 200,
    })
    expect(isPng(result.body)).toBe(true)
    expect(result.headers['Cache-Control']).toContain('immutable')
  })

  test('initials: missing name falls back to NA (v1 parity)', async () => {
    const result = await service.initials({})
    expect(isPng(result.body)).toBe(true)
  })

  test('qr: inline by default, attachment on download', async () => {
    const inline = await service.qr('https://nuvix.in', 400, 1, false)
    expect(isPng(inline.body)).toBe(true)
    expect(inline.headers['Content-Disposition']).toContain('inline')

    const attached = await service.qr('https://nuvix.in', 400, 1, true)
    expect(attached.headers['Content-Disposition']).toContain('attachment')
  })
})

describe('avatar routes', () => {
  const probe = new Elysia({ prefix: '/v2' }).use(avatarRoutes(service))
  const client = treaty(probe)

  test('GET /avatars/flags/:code → image/png', async () => {
    const response =
      await // biome-ignore lint/suspicious/noExplicitAny: treaty types do not model value-as-property dynamic segments
      (client.v2.avatars.flags as any).us.get()
    expect(response.status).toBe(200)
    const headers = response.headers as Headers
    expect(headers.get('content-type')).toBe('image/png')
    expect(headers.get('cache-control')).toContain('immutable')
  })

  test('GET /avatars/credit-cards/:code → image/png', async () => {
    const response =
      await // biome-ignore lint/suspicious/noExplicitAny: treaty types do not model value-as-property dynamic segments
      (client.v2.avatars['credit-cards'] as any).visa.get()
    expect(response.status).toBe(200)
  })

  test('GET /avatars/browsers/:code → image/png', async () => {
    const response =
      await // biome-ignore lint/suspicious/noExplicitAny: treaty types do not model value-as-property dynamic segments
      (client.v2.avatars.browsers as any).chrome.get()
    expect(response.status).toBe(200)
  })

  test('GET /avatars/initials → image/png', async () => {
    const response = await client.v2.avatars.initials.get({
      query: { name: 'Grace Hopper' },
    })
    expect(response.status).toBe(200)
    expect((response.headers as Headers).get('content-type')).toBe('image/png')
  })

  test('GET /avatars/qr requires text', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentionally invalid query to assert 422
    const response = await client.v2.avatars.qr.get({ query: {} as any })
    // Elysia validation: missing required query param → 422
    expect(response.status).toBe(422)
  })

  test('GET /avatars/favicon rejects private hosts without fetching', async () => {
    const response = await client.v2.avatars.favicon.get({
      query: { url: 'http://127.0.0.1/x.png' },
    })
    expect(response.status).toBe(404)
    const body = (await response.data) as unknown
    expect(body).toBeDefined()
  })
})
