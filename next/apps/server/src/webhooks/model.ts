export interface WebhookModel {
  readonly collections: {
    readonly webhooks: string
    readonly webhookLogs: string
  }
  readonly fields: {
    readonly webhooks: {
      readonly name: string
      readonly events: string
      readonly url: string
      readonly security: string
      readonly httpUser: string
      readonly httpPass: string
      readonly signatureKey: string
      readonly enabled: string
      readonly attempts: string
      readonly logs: string
    }
    readonly webhookLogs: {
      readonly webhookId: string
      readonly event: string
      readonly success: string
      readonly statusCode: string
      readonly response: string
      readonly error: string
      readonly durationMs: string
      readonly timestamp: string
    }
  }
}

export const WEBHOOK_MODEL: WebhookModel = Object.freeze({
  collections: {
    webhooks: '_webhooks',
    webhookLogs: '_webhook_logs',
  },
  fields: {
    webhooks: {
      name: 'name',
      events: 'events',
      url: 'url',
      security: 'security',
      httpUser: 'httpUser',
      httpPass: 'httpPass',
      signatureKey: 'signatureKey',
      enabled: 'enabled',
      attempts: 'attempts',
      logs: 'logs',
    },
    webhookLogs: {
      webhookId: 'webhookId',
      event: 'event',
      success: 'success',
      statusCode: 'statusCode',
      response: 'response',
      error: 'error',
      durationMs: 'durationMs',
      timestamp: 'timestamp',
    },
  },
})
