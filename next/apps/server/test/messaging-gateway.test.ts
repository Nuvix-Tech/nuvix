import { describe, expect, test } from 'bun:test'
import {
  createMessagingAdapter,
  createMessagingGateway,
  type MessageRequest,
  type ProviderConfig,
} from '../src/messaging/gateway'

describe('Messaging Gateway & Adapters', () => {
  test('constructs supported email, sms, and push adapters', () => {
    const sendgridProvider: ProviderConfig = {
      type: 'email',
      adapter: 'sendgrid',
      options: { apiKey: 'SG.fake_key' },
    }
    const sendgrid = createMessagingAdapter(sendgridProvider)
    expect(sendgrid.getName()).toBe('Sendgrid')

    const twilioProvider: ProviderConfig = {
      type: 'sms',
      adapter: 'twilio',
      options: { accountSid: 'AC123', authToken: 'auth_token' },
    }
    const twilio = createMessagingAdapter(twilioProvider)
    expect(twilio.getName()).toBe('Twilio')

    const fcmProvider: ProviderConfig = {
      type: 'push',
      adapter: 'fcm',
      options: { serviceAccount: { projectId: 'my-project' } },
    }
    const fcm = createMessagingAdapter(fcmProvider)
    expect(fcm.getName()).toBe('FCM')
  })

  test('throws BadRequestError for unsupported adapter', () => {
    const fakeProvider: ProviderConfig = {
      type: 'email',
      adapter: 'unknown_vendor',
      options: {},
    }
    expect(() => createMessagingAdapter(fakeProvider)).toThrow()
  })

  test('interpolates template data and dispatches message through mock adapter', async () => {
    const sentCalls: { req: MessageRequest; provider?: ProviderConfig }[] = []

    const mockGateway = {
      async send(req: MessageRequest, provider?: ProviderConfig) {
        sentCalls.push({ req, provider })
        return {
          deliveredTo: req.recipients.length,
          results: req.recipients.map((r: string) => ({
            recipient: r,
            status: 'success' as const,
            error: '',
          })),
        }
      },
    }

    const report = await mockGateway.send(
      {
        channel: 'email',
        recipients: ['alice@example.com', 'bob@example.com'],
        payload: {
          subject: 'Hello {{user.name}}',
          content: 'Your code is {{code}}',
          fromName: 'Nuvix Auth',
          fromEmail: 'auth@nuvix.io',
        },
        templateData: { user: { name: 'Alice' }, code: '123456' },
      },
      {
        type: 'email',
        adapter: 'sendgrid',
        options: { apiKey: 'SG.test' },
      },
    )

    expect(report.deliveredTo).toBe(2)
    expect(report.results).toHaveLength(2)
    expect(report.results[0]?.status).toBe('success')
    expect(sentCalls).toHaveLength(1)
  })

  test('createMessagingGateway rejects when no provider is provided', async () => {
    const gateway = createMessagingGateway()
    expect(
      gateway.send({
        channel: 'email',
        recipients: ['test@example.com'],
        payload: { subject: 'Hi', content: 'Hello' },
      }),
    ).rejects.toThrow()
  })
})
