import type { Doc } from '@nuvix/db'
import { Elysia, t } from 'elysia'
import type { ProjectAuthContext } from '../context/project'
import type { DatabaseRequestCapabilities } from '../infrastructure/database-composition'
import { ForbiddenError } from '../shared/errors'
import {
  CreateEmailMessageBody,
  CreateProviderBody,
  CreatePushMessageBody,
  CreateSmsMessageBody,
  CreateSubscriberBody,
  CreateTopicBody,
  MessageId,
  MessageResponse,
  ProviderId,
  ProviderResponse,
  SubscriberId,
  SubscriberResponse,
  TopicId,
  TopicResponse,
  UpdateProviderBody,
  UpdateTopicBody,
} from './contracts'
import { messagingDocuments } from './documents'
import type { MessagingGateway } from './gateway'
import { MESSAGING_MODEL, type MessagingModel } from './model'
import { createMessagingService, type MessagingService } from './service'

export interface MessagingRouteDependencies {
  requests: DatabaseRequestCapabilities
  gateway: MessagingGateway
  service?: MessagingService
  model?: MessagingModel
}

function assertScopes(auth: ProjectAuthContext, requiredScopes: readonly string[]): void {
  if (auth.type === 'guest') throw new ForbiddenError()
  if (auth.type === 'apiKey') {
    const hasAny = requiredScopes.some((s) => auth.scopes.includes(s))
    if (!hasAny) throw new ForbiddenError()
  }
}

function toProviderResponse(doc: Doc, model: MessagingModel = MESSAGING_MODEL) {
  const fields = model.fields.providers
  return {
    $id: doc.getId(),
    $createdAt: doc.get('$createdAt') ?? '',
    $updatedAt: doc.get('$updatedAt') ?? '',
    name: doc.get(fields.name) ?? '',
    type: doc.get(fields.type) ?? '',
    adapter: doc.get(fields.adapter) ?? '',
    enabled: doc.get(fields.enabled) ?? true,
    options: (doc.get(fields.options) as Record<string, unknown>) ?? {},
  }
}

function toTopicResponse(doc: Doc, model: MessagingModel = MESSAGING_MODEL) {
  const fields = model.fields.topics
  return {
    $id: doc.getId(),
    $createdAt: doc.get('$createdAt') ?? '',
    $updatedAt: doc.get('$updatedAt') ?? '',
    $permissions: (doc.get(fields.permissions) as string[]) ?? [],
    name: doc.get(fields.name) ?? '',
    description: doc.get(fields.description) ?? '',
    total: Number(doc.get(fields.total) || 0),
  }
}

function toSubscriberResponse(doc: Doc, model: MessagingModel = MESSAGING_MODEL) {
  const fields = model.fields.subscribers
  return {
    $id: doc.getId(),
    $createdAt: doc.get('$createdAt') ?? '',
    $updatedAt: doc.get('$updatedAt') ?? '',
    topicId: doc.get(fields.topicId) ?? '',
    userId: doc.get(fields.userId) ?? '',
    userName: doc.get(fields.userName) ?? '',
    targetId: doc.get(fields.targetId) ?? '',
    target: doc.get(fields.target) ?? '',
    providerType: doc.get(fields.providerType) ?? '',
  }
}

function toMessageResponse(doc: Doc, model: MessagingModel = MESSAGING_MODEL) {
  const fields = model.fields.messages
  return {
    $id: doc.getId(),
    $createdAt: doc.get('$createdAt') ?? '',
    $updatedAt: doc.get('$updatedAt') ?? '',
    channel: doc.get(fields.channel) ?? '',
    topics: (doc.get(fields.topics) as string[]) ?? [],
    users: (doc.get(fields.users) as string[]) ?? [],
    targets: (doc.get(fields.targets) as string[]) ?? [],
    status: doc.get(fields.status) ?? 'draft',
    deliveredTo: Number(doc.get(fields.deliveredTo) || 0),
    total: Number(doc.get(fields.total) || 0),
    data: (doc.get(fields.data) as Record<string, unknown>) ?? {},
    deliveryErrors: (doc.get(fields.deliveryErrors) as string[]) ?? [],
  }
}

export function messagingRoutes({
  requests,
  gateway,
  service = createMessagingService(),
  model = MESSAGING_MODEL,
}: MessagingRouteDependencies) {
  return (
    new Elysia({ name: 'messaging-routes', prefix: '/messaging' })
      // ================= Providers =================
      .post(
        '/providers',
        {
          body: CreateProviderBody,
          response: { 201: ProviderResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['providers.write'])
            set.status = 201
            const doc = await service.createProvider(messagingDocuments(session, model), body)
            return toProviderResponse(doc, model)
          }),
      )
      .get(
        '/providers',
        {
          response: {
            200: t.Object({
              total: t.Integer(),
              providers: t.Array(ProviderResponse),
            }),
          },
          detail: { tags: ['messaging'] },
        },
        async ({ request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['providers.read'])
            const docs = await service.listProviders(messagingDocuments(session, model))
            return {
              total: docs.length,
              providers: docs.map((d) => toProviderResponse(d, model)),
            }
          }),
      )
      .get(
        '/providers/:providerId',
        {
          params: t.Object({ providerId: ProviderId }),
          response: { 200: ProviderResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['providers.read'])
            const doc = await service.getProvider(
              messagingDocuments(session, model),
              params.providerId,
            )
            return toProviderResponse(doc, model)
          }),
      )
      .put(
        '/providers/:providerId',
        {
          params: t.Object({ providerId: ProviderId }),
          body: UpdateProviderBody,
          response: { 200: ProviderResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ body, params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['providers.write'])
            const doc = await service.updateProvider(
              messagingDocuments(session, model),
              params.providerId,
              body,
            )
            return toProviderResponse(doc, model)
          }),
      )
      .delete(
        '/providers/:providerId',
        {
          params: t.Object({ providerId: ProviderId }),
          response: { 204: t.Null() },
          detail: { tags: ['messaging'] },
        },
        async ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['providers.write'])
            await service.deleteProvider(messagingDocuments(session, model), params.providerId)
            set.status = 204
            return null
          }),
      )

      // ================= Topics =================
      .post(
        '/topics',
        {
          body: CreateTopicBody,
          response: { 201: TopicResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['topics.write'])
            set.status = 201
            const doc = await service.createTopic(messagingDocuments(session, model), body)
            return toTopicResponse(doc, model)
          }),
      )
      .get(
        '/topics',
        {
          response: {
            200: t.Object({
              total: t.Integer(),
              topics: t.Array(TopicResponse),
            }),
          },
          detail: { tags: ['messaging'] },
        },
        async ({ request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['topics.read'])
            const docs = await service.listTopics(messagingDocuments(session, model))
            return {
              total: docs.length,
              topics: docs.map((d) => toTopicResponse(d, model)),
            }
          }),
      )
      .get(
        '/topics/:topicId',
        {
          params: t.Object({ topicId: TopicId }),
          response: { 200: TopicResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['topics.read'])
            const doc = await service.getTopic(messagingDocuments(session, model), params.topicId)
            return toTopicResponse(doc, model)
          }),
      )
      .put(
        '/topics/:topicId',
        {
          params: t.Object({ topicId: TopicId }),
          body: UpdateTopicBody,
          response: { 200: TopicResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ body, params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['topics.write'])
            const doc = await service.updateTopic(
              messagingDocuments(session, model),
              params.topicId,
              body,
            )
            return toTopicResponse(doc, model)
          }),
      )
      .delete(
        '/topics/:topicId',
        {
          params: t.Object({ topicId: TopicId }),
          response: { 204: t.Null() },
          detail: { tags: ['messaging'] },
        },
        async ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['topics.write'])
            await service.deleteTopic(messagingDocuments(session, model), params.topicId)
            set.status = 204
            return null
          }),
      )

      // ================= Subscribers =================
      .post(
        '/topics/:topicId/subscribers',
        {
          params: t.Object({ topicId: TopicId }),
          body: CreateSubscriberBody,
          response: { 201: SubscriberResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ body, params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['subscribers.write'])
            set.status = 201
            const doc = await service.createSubscriber(
              messagingDocuments(session, model),
              params.topicId,
              body,
            )
            return toSubscriberResponse(doc, model)
          }),
      )
      .get(
        '/topics/:topicId/subscribers',
        {
          params: t.Object({ topicId: TopicId }),
          response: {
            200: t.Object({
              total: t.Integer(),
              subscribers: t.Array(SubscriberResponse),
            }),
          },
          detail: { tags: ['messaging'] },
        },
        async ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['subscribers.read'])
            const docs = await service.listSubscribers(
              messagingDocuments(session, model),
              params.topicId,
            )
            return {
              total: docs.length,
              subscribers: docs.map((d) => toSubscriberResponse(d, model)),
            }
          }),
      )
      .get(
        '/topics/:topicId/subscribers/:subscriberId',
        {
          params: t.Object({ topicId: TopicId, subscriberId: SubscriberId }),
          response: { 200: SubscriberResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['subscribers.read'])
            const doc = await service.getSubscriber(
              messagingDocuments(session, model),
              params.topicId,
              params.subscriberId,
            )
            return toSubscriberResponse(doc, model)
          }),
      )
      .delete(
        '/topics/:topicId/subscribers/:subscriberId',
        {
          params: t.Object({ topicId: TopicId, subscriberId: SubscriberId }),
          response: { 204: t.Null() },
          detail: { tags: ['messaging'] },
        },
        async ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['subscribers.write'])
            await service.deleteSubscriber(
              messagingDocuments(session, model),
              params.topicId,
              params.subscriberId,
            )
            set.status = 204
            return null
          }),
      )

      // ================= Messages =================
      .post(
        '/messages/email',
        {
          body: CreateEmailMessageBody,
          response: { 201: MessageResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['messages.write'])
            set.status = 201
            const doc = await service.createMessage(
              messagingDocuments(session, model),
              gateway,
              'email',
              body,
            )
            return toMessageResponse(doc, model)
          }),
      )
      .post(
        '/messages/sms',
        {
          body: CreateSmsMessageBody,
          response: { 201: MessageResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['messages.write'])
            set.status = 201
            const doc = await service.createMessage(
              messagingDocuments(session, model),
              gateway,
              'sms',
              body,
            )
            return toMessageResponse(doc, model)
          }),
      )
      .post(
        '/messages/push',
        {
          body: CreatePushMessageBody,
          response: { 201: MessageResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['messages.write'])
            set.status = 201
            const doc = await service.createMessage(
              messagingDocuments(session, model),
              gateway,
              'push',
              body,
            )
            return toMessageResponse(doc, model)
          }),
      )
      .get(
        '/messages',
        {
          response: {
            200: t.Object({
              total: t.Integer(),
              messages: t.Array(MessageResponse),
            }),
          },
          detail: { tags: ['messaging'] },
        },
        async ({ request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['messages.read'])
            const docs = await service.listMessages(messagingDocuments(session, model))
            return {
              total: docs.length,
              messages: docs.map((d) => toMessageResponse(d, model)),
            }
          }),
      )
      .get(
        '/messages/:messageId',
        {
          params: t.Object({ messageId: MessageId }),
          response: { 200: MessageResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['messages.read'])
            const doc = await service.getMessage(
              messagingDocuments(session, model),
              params.messageId,
            )
            return toMessageResponse(doc, model)
          }),
      )
      .delete(
        '/messages/:messageId',
        {
          params: t.Object({ messageId: MessageId }),
          response: { 204: t.Null() },
          detail: { tags: ['messaging'] },
        },
        async ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['messages.write'])
            await service.deleteMessage(messagingDocuments(session, model), params.messageId)
            set.status = 204
            return null
          }),
      )
      .post(
        '/messages/:messageId/send',
        {
          params: t.Object({ messageId: MessageId }),
          response: { 200: MessageResponse },
          detail: { tags: ['messaging'] },
        },
        async ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            assertScopes(auth, ['messages.write'])
            const doc = await service.sendMessage(
              messagingDocuments(session, model),
              gateway,
              params.messageId,
            )
            return toMessageResponse(doc, model)
          }),
      )
  )
}
