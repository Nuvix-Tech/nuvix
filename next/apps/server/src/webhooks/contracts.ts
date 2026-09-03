import { t } from 'elysia'

export const WebhookId = t.String({ minLength: 1, maxLength: 64 })

export const CreateWebhookBody = t.Object({
  webhookId: t.Optional(WebhookId),
  name: t.String({ minLength: 1, maxLength: 128 }),
  events: t.Array(t.String({ minLength: 1, maxLength: 256 }), { minItems: 1 }),
  url: t.String({ minLength: 1, maxLength: 2048 }),
  security: t.Optional(t.Boolean({ default: true })),
  httpUser: t.Optional(t.String({ maxLength: 256 })),
  httpPass: t.Optional(t.String({ maxLength: 256 })),
  enabled: t.Optional(t.Boolean({ default: true })),
})

export const UpdateWebhookBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  events: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 256 }))),
  url: t.Optional(t.String({ minLength: 1, maxLength: 2048 })),
  security: t.Optional(t.Boolean()),
  httpUser: t.Optional(t.String({ maxLength: 256 })),
  httpPass: t.Optional(t.String({ maxLength: 256 })),
  enabled: t.Optional(t.Boolean()),
})

export const TestWebhookBody = t.Object({
  event: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
  data: t.Optional(t.Record(t.String(), t.Unknown())),
})

export const WebhookResponse = t.Object({
  $id: t.String(),
  $createdAt: t.String(),
  $updatedAt: t.String(),
  name: t.String(),
  events: t.Array(t.String()),
  url: t.String(),
  security: t.Boolean(),
  httpUser: t.String(),
  signatureKey: t.String(),
  enabled: t.Boolean(),
  attempts: t.Integer(),
  logs: t.String(),
})

export const WebhookLogResponse = t.Object({
  $id: t.String(),
  webhookId: t.String(),
  event: t.String(),
  success: t.Boolean(),
  statusCode: t.Union([t.Integer(), t.Null()]),
  response: t.String(),
  error: t.Union([t.String(), t.Null()]),
  durationMs: t.Integer(),
  timestamp: t.String(),
})

export const WebhookDeliveryReportResponse = t.Object({
  success: t.Boolean(),
  statusCode: t.Optional(t.Integer()),
  durationMs: t.Integer(),
  response: t.Optional(t.String()),
  error: t.Optional(t.String()),
})

export interface CreateWebhookInput {
  webhookId?: string
  name: string
  events: string[]
  url: string
  security?: boolean
  httpUser?: string
  httpPass?: string
  enabled?: boolean
}

export interface UpdateWebhookInput {
  name?: string
  events?: string[]
  url?: string
  security?: boolean
  httpUser?: string
  httpPass?: string
  enabled?: boolean
}

export interface TestWebhookInput {
  event?: string
  data?: Record<string, unknown>
}
