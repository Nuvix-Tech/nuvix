import { validateWebhookUrl } from './validator'

export interface WebhookDeliveryTarget {
  id: string
  url: string
  security: boolean
  httpUser?: string
  httpPass?: string
  signatureKey: string
}

export interface WebhookDeliveryReport {
  success: boolean
  statusCode?: number
  durationMs: number
  response?: string
  error?: string
}

export async function signWebhookPayload(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return Buffer.from(sig).toString('hex')
}

export function generateNonce(): string {
  return crypto.randomUUID()
}

export interface WebhookDispatcher {
  dispatch(
    target: WebhookDeliveryTarget,
    event: string,
    payloadData: unknown,
  ): Promise<WebhookDeliveryReport>
}

export type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface WebhookDispatcherOptions {
  validator?: (url: string) => string
  fetchFn?: FetchFunction
}

export function createWebhookDispatcher(options: WebhookDispatcherOptions = {}): WebhookDispatcher {
  const validator = options.validator ?? validateWebhookUrl
  const fetchFn = options.fetchFn ?? fetch

  return {
    async dispatch(target, event, payloadData) {
      const startTime = performance.now()

      try {
        // 1. SSRF check at dispatch time
        validator(target.url)

        // 2. Prepare payload
        const timestampSeconds = Math.floor(Date.now() / 1000).toString()
        const timestampIso = new Date().toISOString()
        const nonce = generateNonce()

        const webhookPayload = {
          event,
          timestamp: timestampIso,
          data: payloadData,
        }
        const payloadString = JSON.stringify(webhookPayload)

        // 3. Cryptographic signature
        const signatureHex = await signWebhookPayload(target.signatureKey, payloadString)
        const signatureHeader = `sha256=${signatureHex}`

        // 4. Headers
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          'x-nuvix-timestamp': timestampSeconds,
          'x-nuvix-nonce': nonce,
          'x-nuvix-signature': signatureHeader,
          'X-Webhook-Signature': signatureHeader,
          'X-Webhook-Event': event,
          'X-Webhook-ID': target.id,
        }

        if (target.httpUser && target.httpPass) {
          const credentials = Buffer.from(`${target.httpUser}:${target.httpPass}`).toString(
            'base64',
          )
          headers.Authorization = `Basic ${credentials}`
        }

        // 5. HTTP Fetch
        const fetchOptions: RequestInit & { tls?: { rejectUnauthorized?: boolean } } = {
          method: 'POST',
          headers,
          body: payloadString,
          signal: AbortSignal.timeout(10000),
          tls: {
            rejectUnauthorized: target.security,
          },
        }

        const response = await fetchFn(target.url, fetchOptions)
        const durationMs = Math.round(performance.now() - startTime)
        const responseBody = await response.text().catch(() => '')

        if (!response.ok) {
          return {
            success: false,
            statusCode: response.status,
            durationMs,
            response: responseBody.slice(0, 1000),
            error: `HTTP ${response.status}: ${response.statusText}`,
          }
        }

        return {
          success: true,
          statusCode: response.status,
          durationMs,
          response: responseBody.slice(0, 1000),
        }
      } catch (err) {
        const durationMs = Math.round(performance.now() - startTime)
        const errorMessage = err instanceof Error ? err.message : String(err)
        return {
          success: false,
          durationMs,
          error: errorMessage.slice(0, 1000),
        }
      }
    },
  }
}
