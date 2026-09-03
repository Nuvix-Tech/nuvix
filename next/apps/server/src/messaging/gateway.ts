import {
  type Adapter,
  APNS,
  Email,
  FCM,
  Mailgun,
  type Message,
  Msg91,
  Push,
  Sendgrid,
  type SendResult,
  SMS,
  SMTP,
  Telesign,
  TextMagic,
  Twilio,
  Vonage,
} from '@nuvix/messaging'
import { BadRequestError } from '../shared/errors'
import { renderTemplate } from './template'

export type DeliveryResult = SendResult['results'][number]

export interface MessageRequest {
  channel: 'email' | 'sms' | 'push'
  recipients: readonly string[]
  payload: {
    subject?: string
    content?: string
    html?: boolean | string
    fromName?: string
    fromEmail?: string
    replyToName?: string
    replyToEmail?: string
    title?: string
    body?: string
    data?: Record<string, unknown>
    from?: string // SMS sender ID
  }
  templateData?: Record<string, unknown>
}

export interface DeliveryReport {
  deliveredTo: number
  results: readonly DeliveryResult[]
}

export interface ProviderConfig {
  readonly type: 'email' | 'sms' | 'push'
  readonly adapter: string
  readonly enabled?: boolean
  readonly options: Record<string, unknown>
}

export interface MessagingGateway {
  send(message: MessageRequest, provider?: ProviderConfig): Promise<DeliveryReport>
}

export function createMessagingAdapter(provider: ProviderConfig): Adapter {
  const opts = provider.options
  const adapterName = provider.adapter.toLowerCase()

  switch (adapterName) {
    case 'mailgun':
      return new Mailgun(String(opts.apiKey || ''), String(opts.domain || ''), Boolean(opts.isEu))
    case 'sendgrid':
      return new Sendgrid(String(opts.apiKey || ''))
    case 'smtp':
      return new SMTP(
        String(opts.host || ''),
        Number(opts.port || 587),
        String(opts.username || ''),
        String(opts.password || ''),
        Boolean(opts.secure ?? opts.port === 465),
      )
    case 'twilio':
      return new Twilio(String(opts.accountSid || ''), String(opts.authToken || ''))
    case 'vonage':
      return new Vonage(String(opts.apiKey || ''), String(opts.apiSecret || ''))
    case 'msg91':
      return new Msg91(
        String(opts.senderId || ''),
        String(opts.authKey || ''),
        String(opts.templateId || ''),
      )
    case 'telesign':
      return new Telesign(String(opts.customerId || ''), String(opts.apiKey || ''))
    case 'textmagic':
      return new TextMagic(String(opts.username || ''), String(opts.apiKey || ''))
    case 'fcm':
      return new FCM(
        typeof opts.serviceAccount === 'string'
          ? opts.serviceAccount
          : JSON.stringify(opts.serviceAccount ?? {}),
      )
    case 'apns':
      return new APNS(
        String(opts.authKey || ''),
        String(opts.keyId || ''),
        String(opts.teamId || ''),
        String(opts.bundleId || ''),
        Boolean(opts.sandbox),
      )
    default:
      throw new BadRequestError(`Unsupported messaging adapter: ${provider.adapter}`, {
        code: 'unsupported_adapter',
      })
  }
}

export function createMessagingGateway(): MessagingGateway {
  return {
    async send(request: MessageRequest, provider?: ProviderConfig): Promise<DeliveryReport> {
      if (!provider) {
        throw new BadRequestError(`No active provider configured for channel: ${request.channel}`, {
          code: 'no_active_provider',
        })
      }

      const adapter = createMessagingAdapter(provider)
      const data = request.templateData ?? {}

      let msg: Message

      if (request.channel === 'email') {
        const subject = renderTemplate(request.payload.subject || '', data)
        const content = renderTemplate(request.payload.content || '', data)
        const isHtml = Boolean(request.payload.html)

        msg = new Email({
          to: [...request.recipients],
          subject,
          content,
          fromName: request.payload.fromName || 'Nuvix',
          fromEmail: request.payload.fromEmail || 'no-reply@nuvix.io',
          replyToName: request.payload.replyToName,
          replyToEmail: request.payload.replyToEmail,
          html: isHtml,
        })
      } else if (request.channel === 'sms') {
        const content = renderTemplate(request.payload.content || '', data)
        msg = new SMS({
          to: [...request.recipients],
          content,
          from: request.payload.from,
        })
      } else if (request.channel === 'push') {
        const title = renderTemplate(request.payload.title || '', data)
        const body = renderTemplate(request.payload.body || '', data)

        msg = new Push({
          to: [...request.recipients],
          title,
          body,
          data: request.payload.data,
        })
      } else {
        throw new BadRequestError(`Invalid messaging channel: ${request.channel}`, {
          code: 'invalid_channel',
        })
      }

      const rawResult = await adapter.send(msg)

      // Normalize adapter result map or single report
      let results: DeliveryResult[] = []
      let deliveredTo = 0

      if ('results' in rawResult && Array.isArray((rawResult as SendResult).results)) {
        const sendRes = rawResult as SendResult
        results = sendRes.results
        deliveredTo = sendRes.deliveredTo
      } else {
        // Record<string, SendResult>
        for (const batch of Object.values(rawResult as Record<string, SendResult>)) {
          if (batch?.results) {
            results.push(...batch.results)
            deliveredTo += batch.deliveredTo || 0
          }
        }
      }

      return {
        deliveredTo,
        results,
      }
    },
  }
}
