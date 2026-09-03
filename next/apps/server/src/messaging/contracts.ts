import { t } from 'elysia'

export const ProviderId = t.String({
  minLength: 1,
  maxLength: 36,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$',
})

export const TopicId = t.String({
  minLength: 1,
  maxLength: 36,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$',
})

export const SubscriberId = t.String({
  minLength: 1,
  maxLength: 36,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$',
})

export const MessageId = t.String({
  minLength: 1,
  maxLength: 36,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$',
})

// ================= Provider Schemas =================
export const CreateProviderBody = t.Object(
  {
    providerId: t.Optional(t.Union([ProviderId, t.Literal('unique()')])),
    name: t.String({ minLength: 1, maxLength: 128 }),
    type: t.Union([t.Literal('email'), t.Literal('sms'), t.Literal('push')]),
    adapter: t.String({ minLength: 1, maxLength: 64 }),
    enabled: t.Optional(t.Boolean()),
    options: t.Record(t.String(), t.Unknown()),
  },
  { additionalProperties: false },
)

export const UpdateProviderBody = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
    enabled: t.Optional(t.Boolean()),
    options: t.Optional(t.Record(t.String(), t.Unknown())),
  },
  { additionalProperties: false },
)

export const ProviderResponse = t.Object({
  $id: t.String(),
  $createdAt: t.String(),
  $updatedAt: t.String(),
  name: t.String(),
  type: t.String(),
  adapter: t.String(),
  enabled: t.Boolean(),
  options: t.Record(t.String(), t.Unknown()),
})

// ================= Topic Schemas =================
export const CreateTopicBody = t.Object(
  {
    topicId: t.Optional(t.Union([TopicId, t.Literal('unique()')])),
    name: t.String({ minLength: 1, maxLength: 128 }),
    description: t.Optional(t.String({ maxLength: 512 })),
    permissions: t.Optional(t.Array(t.String({ maxLength: 256 }))),
  },
  { additionalProperties: false },
)

export const UpdateTopicBody = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
    description: t.Optional(t.String({ maxLength: 512 })),
    permissions: t.Optional(t.Array(t.String({ maxLength: 256 }))),
  },
  { additionalProperties: false },
)

export const TopicResponse = t.Object({
  $id: t.String(),
  $createdAt: t.String(),
  $updatedAt: t.String(),
  $permissions: t.Array(t.String()),
  name: t.String(),
  description: t.String(),
  total: t.Integer(),
})

// ================= Subscriber Schemas =================
export const CreateSubscriberBody = t.Object(
  {
    subscriberId: t.Optional(t.Union([SubscriberId, t.Literal('unique()')])),
    userId: t.Optional(t.String({ maxLength: 36 })),
    userName: t.Optional(t.String({ maxLength: 128 })),
    targetId: t.Optional(t.String({ maxLength: 36 })),
    target: t.String({ minLength: 1, maxLength: 256 }),
    providerType: t.Union([t.Literal('email'), t.Literal('sms'), t.Literal('push')]),
  },
  { additionalProperties: false },
)

export const SubscriberResponse = t.Object({
  $id: t.String(),
  $createdAt: t.String(),
  $updatedAt: t.String(),
  topicId: t.String(),
  userId: t.String(),
  userName: t.String(),
  targetId: t.String(),
  target: t.String(),
  providerType: t.String(),
})

// ================= Message Schemas =================
export const CreateEmailMessageBody = t.Object(
  {
    messageId: t.Optional(t.Union([MessageId, t.Literal('unique()')])),
    topics: t.Optional(t.Array(t.String({ maxLength: 36 }))),
    users: t.Optional(t.Array(t.String({ maxLength: 36 }))),
    targets: t.Optional(t.Array(t.String({ maxLength: 256 }))),
    subject: t.String({ minLength: 1, maxLength: 256 }),
    content: t.String({ minLength: 1 }),
    html: t.Optional(t.Boolean()),
    senderName: t.Optional(t.String({ maxLength: 128 })),
    senderEmail: t.Optional(t.String({ maxLength: 128 })),
    replyTo: t.Optional(t.String({ maxLength: 128 })),
    draft: t.Optional(t.Boolean()),
    data: t.Optional(t.Record(t.String(), t.Unknown())),
  },
  { additionalProperties: false },
)

export const CreateSmsMessageBody = t.Object(
  {
    messageId: t.Optional(t.Union([MessageId, t.Literal('unique()')])),
    topics: t.Optional(t.Array(t.String({ maxLength: 36 }))),
    users: t.Optional(t.Array(t.String({ maxLength: 36 }))),
    targets: t.Optional(t.Array(t.String({ maxLength: 256 }))),
    content: t.String({ minLength: 1 }),
    draft: t.Optional(t.Boolean()),
    data: t.Optional(t.Record(t.String(), t.Unknown())),
  },
  { additionalProperties: false },
)

export const CreatePushMessageBody = t.Object(
  {
    messageId: t.Optional(t.Union([MessageId, t.Literal('unique()')])),
    topics: t.Optional(t.Array(t.String({ maxLength: 36 }))),
    users: t.Optional(t.Array(t.String({ maxLength: 36 }))),
    targets: t.Optional(t.Array(t.String({ maxLength: 256 }))),
    title: t.String({ minLength: 1, maxLength: 256 }),
    body: t.String({ minLength: 1 }),
    draft: t.Optional(t.Boolean()),
    data: t.Optional(t.Record(t.String(), t.Unknown())),
  },
  { additionalProperties: false },
)

export const MessageResponse = t.Object({
  $id: t.String(),
  $createdAt: t.String(),
  $updatedAt: t.String(),
  channel: t.String(),
  topics: t.Array(t.String()),
  users: t.Array(t.String()),
  targets: t.Array(t.String()),
  status: t.String(),
  deliveredTo: t.Integer(),
  total: t.Integer(),
  data: t.Record(t.String(), t.Unknown()),
  deliveryErrors: t.Array(t.String()),
})
