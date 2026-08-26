import { describe, expect, test } from 'bun:test'
import { treaty } from '@elysia/eden'
import type { Translator } from '@nuvix/i18n'
import { Elysia } from 'elysia'
import { problemErrors } from '../src/plugins/errors'
import { ConflictError, NotFoundError } from '../src/shared/errors'

/**
 * Treaty gives us a fully typed client generated from the Elysia instance —
 * same client type works for unit tests (instance) and e2e (URL).
 *
 * NOTE: plugin factories MUST be invoked before `.use()` — passing the bare
 * function silently drops its global error handlers (elysia 2.0.0-beta.6).
 */

/** Stub translator: deterministic key→string mapping, no file IO. */
const stubTranslator = {
  locale: 'de',
  fallback: 'en',
  format: (key: string, params?: Record<string, unknown>) =>
    key === 'errors.test.taken' ? `E-Mail ${params?.email} ist vergeben` : `[de] ${key}`,
} as unknown as Translator

const problemErrorsDe = problemErrors({
  getTranslator: async () => stubTranslator,
})

/** Probe app: error plugin + routes that throw each error type. */
const probe = new Elysia({ prefix: '/v2' })
  .use(problemErrorsDe)
  .get('/conflict', () => {
    throw new ConflictError('duplicate resource')
  })
  .get('/not-found', () => {
    throw new NotFoundError('User')
  })
  .get('/localized', () => {
    throw new ConflictError('duplicate resource', {
      messageKey: 'errors.test.taken',
      params: { email: 'ada@nuvix.in' },
    })
  })

const client = treaty(probe)

describe('problem+json error mapping (via treaty)', () => {
  test('maps ConflictError to 409 problem+json', async () => {
    const { data, error } = await client.v2.conflict.get()

    expect(data).toBeNull()
    expect(error).toBeDefined()
    expect(error!.status).toBe(409)
    // problem+json body arrives as the typed/loose error value
    const body = error!.value as Record<string, unknown>
    expect(body.type).toBe('/errors/conflict')
    expect(body.detail).toBe('duplicate resource')
  })

  test('maps NotFoundError to 404 problem+json', async () => {
    const { error } = await client.v2['not-found'].get()

    expect(error).toBeDefined()
    expect(error!.status).toBe(404)
    const body = error!.value as Record<string, unknown>
    expect(body.type).toBe('/errors/not-found')
    expect(body.detail).toBe('User not found')
  })

  test('translates detail via messageKey + params (D34)', async () => {
    const { error } = await client.v2.localized.get()

    expect(error!.status).toBe(409)
    const body = error!.value as Record<string, unknown>
    expect(body.type).toBe('/errors/conflict')
    expect(body.detail).toBe('E-Mail ada@nuvix.in ist vergeben')
  })
})
