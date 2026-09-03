import { describe, expect, test } from 'bun:test'
import {
  createWebhookDispatcher,
  type FetchFunction,
  generateNonce,
  signWebhookPayload,
} from '../src/webhooks/dispatcher'

describe('Webhook Dispatcher', () => {
  test('signWebhookPayload generates RFC-standard HMAC-SHA256 hex string', async () => {
    const secret = 'secret_key_123'
    const payload = JSON.stringify({ hello: 'world' })

    const signature = await signWebhookPayload(secret, payload)
    expect(signature).toBeString()
    expect(signature).toHaveLength(64) // 256 bits = 32 bytes = 64 hex chars

    // Re-verifying produces identical signature
    const signature2 = await signWebhookPayload(secret, payload)
    expect(signature2).toBe(signature)

    // Altering secret changes signature
    const signatureDiff = await signWebhookPayload('other_secret', payload)
    expect(signatureDiff).not.toBe(signature)
  })

  test('generateNonce generates unique strings', () => {
    const n1 = generateNonce()
    const n2 = generateNonce()
    expect(n1).not.toBe(n2)
    expect(n1).toBeString()
  })

  test('dispatches webhook with headers and basic auth to fetchFn', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}
    let capturedBody = ''

    const mockFetch: FetchFunction = async (input, init) => {
      capturedUrl = String(input)
      capturedHeaders = (init?.headers as Record<string, string>) || {}
      capturedBody = String(init?.body || '')

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const dispatcher = createWebhookDispatcher({
      validator: (url) => url,
      fetchFn: mockFetch,
    })

    const report = await dispatcher.dispatch(
      {
        id: 'wh_test_1',
        url: 'https://api.external.com/webhook',
        security: true,
        httpUser: 'client_user',
        httpPass: 'client_pass',
        signatureKey: 'test_secret_key',
      },
      'users.create',
      { userId: 'u_123', email: 'test@example.com' },
    )

    expect(report.success).toBe(true)
    expect(report.statusCode).toBe(200)
    expect(report.response).toContain('received')
    expect(report.durationMs).toBeGreaterThanOrEqual(0)

    expect(capturedUrl).toBe('https://api.external.com/webhook')
    expect(capturedHeaders['x-nuvix-timestamp']).toBeDefined()
    expect(capturedHeaders['x-nuvix-nonce']).toBeDefined()
    expect(capturedHeaders['x-nuvix-signature']).toStartWith('sha256=')
    expect(capturedHeaders['X-Webhook-Signature']).toStartWith('sha256=')
    expect(capturedHeaders['X-Webhook-Event']).toBe('users.create')
    expect(capturedHeaders['X-Webhook-ID']).toBe('wh_test_1')
    expect(capturedHeaders.Authorization).toBe(
      `Basic ${Buffer.from('client_user:client_pass').toString('base64')}`,
    )

    const parsedBody = JSON.parse(capturedBody)
    expect(parsedBody.event).toBe('users.create')
    expect(parsedBody.data.userId).toBe('u_123')
  })

  test('handles HTTP 500 error from receiver gracefully', async () => {
    const mockFetch: FetchFunction = async () => {
      return new Response('Internal Server Error', { status: 500, statusText: 'Internal Error' })
    }

    const dispatcher = createWebhookDispatcher({
      validator: (url) => url,
      fetchFn: mockFetch,
    })

    const report = await dispatcher.dispatch(
      {
        id: 'wh_fail',
        url: 'https://api.external.com/fail',
        security: true,
        signatureKey: 'test_secret',
      },
      'users.delete',
      { userId: 'u_1' },
    )

    expect(report.success).toBe(false)
    expect(report.statusCode).toBe(500)
    expect(report.error).toContain('HTTP 500')
    expect(report.response).toBe('Internal Server Error')
  })

  test('handles network failure gracefully', async () => {
    const mockFetch: FetchFunction = async () => {
      throw new Error('Connection refused')
    }

    const dispatcher = createWebhookDispatcher({
      validator: (url) => url,
      fetchFn: mockFetch,
    })

    const report = await dispatcher.dispatch(
      {
        id: 'wh_net_err',
        url: 'https://api.external.com/net',
        security: true,
        signatureKey: 'test_secret',
      },
      'users.delete',
      { userId: 'u_1' },
    )

    expect(report.success).toBe(false)
    expect(report.error).toContain('Connection refused')
  })
})
