import { Doc, ID, Query } from '@nuvix/db'
import { BadRequestError, ConflictError, NotFoundError } from '../shared/errors'
import type { MessagingDocuments } from './documents'
import type { MessagingGateway, ProviderConfig } from './gateway'
import { MESSAGING_MODEL, type MessagingModel } from './model'

export interface CreateProviderInput {
  providerId?: string
  name: string
  type: 'email' | 'sms' | 'push'
  adapter: string
  enabled?: boolean
  options: Record<string, unknown>
}

export interface UpdateProviderInput {
  name?: string
  enabled?: boolean
  options?: Record<string, unknown>
}

export interface CreateTopicInput {
  topicId?: string
  name: string
  description?: string
  permissions?: string[]
}

export interface UpdateTopicInput {
  name?: string
  description?: string
  permissions?: string[]
}

export interface CreateSubscriberInput {
  subscriberId?: string
  userId?: string
  userName?: string
  targetId?: string
  target: string
  providerType: 'email' | 'sms' | 'push'
}

export interface CreateMessageInput {
  messageId?: string
  topics?: string[]
  users?: string[]
  targets?: string[]
  subject?: string
  content?: string
  html?: boolean
  senderName?: string
  senderEmail?: string
  replyTo?: string
  title?: string
  body?: string
  draft?: boolean
  data?: Record<string, unknown>
}

export interface MessagingService {
  // Providers
  createProvider(documents: MessagingDocuments, input: CreateProviderInput): Promise<Doc>
  listProviders(documents: MessagingDocuments): Promise<Doc[]>
  getProvider(documents: MessagingDocuments, id: string): Promise<Doc>
  updateProvider(
    documents: MessagingDocuments,
    id: string,
    input: UpdateProviderInput,
  ): Promise<Doc>
  deleteProvider(documents: MessagingDocuments, id: string): Promise<boolean>

  // Topics
  createTopic(documents: MessagingDocuments, input: CreateTopicInput): Promise<Doc>
  listTopics(documents: MessagingDocuments): Promise<Doc[]>
  getTopic(documents: MessagingDocuments, id: string): Promise<Doc>
  updateTopic(documents: MessagingDocuments, id: string, input: UpdateTopicInput): Promise<Doc>
  deleteTopic(documents: MessagingDocuments, id: string): Promise<boolean>

  // Subscribers
  createSubscriber(
    documents: MessagingDocuments,
    topicId: string,
    input: CreateSubscriberInput,
  ): Promise<Doc>
  listSubscribers(documents: MessagingDocuments, topicId: string): Promise<Doc[]>
  getSubscriber(documents: MessagingDocuments, topicId: string, subscriberId: string): Promise<Doc>
  deleteSubscriber(
    documents: MessagingDocuments,
    topicId: string,
    subscriberId: string,
  ): Promise<boolean>

  // Messages
  createMessage(
    documents: MessagingDocuments,
    gateway: MessagingGateway,
    channel: 'email' | 'sms' | 'push',
    input: CreateMessageInput,
  ): Promise<Doc>
  listMessages(documents: MessagingDocuments): Promise<Doc[]>
  getMessage(documents: MessagingDocuments, id: string): Promise<Doc>
  deleteMessage(documents: MessagingDocuments, id: string): Promise<boolean>
  sendMessage(documents: MessagingDocuments, gateway: MessagingGateway, id: string): Promise<Doc>
}

export function createMessagingService(
  model: MessagingModel = MESSAGING_MODEL,
  options: { createId?: () => string; now?: () => Date } = {},
): MessagingService {
  const fields = model.fields
  const createId = options.createId ?? (() => ID.unique())
  const now = options.now ?? (() => new Date())

  async function resolveRecipients(
    documents: MessagingDocuments,
    channel: 'email' | 'sms' | 'push',
    topics: readonly string[],
    explicitTargets: readonly string[],
  ): Promise<string[]> {
    const recipients = new Set<string>(explicitTargets)

    for (const topicId of topics) {
      const subs = await documents.findSubscribers([
        Query.equal(fields.subscribers.topicId, [topicId]),
        Query.equal(fields.subscribers.providerType, [channel]),
      ])
      for (const sub of subs) {
        const target = sub.get(fields.subscribers.target)
        if (target) recipients.add(target)
      }
    }

    return [...recipients]
  }

  async function getActiveProvider(
    documents: MessagingDocuments,
    channel: 'email' | 'sms' | 'push',
  ): Promise<ProviderConfig | undefined> {
    const providers = await documents.findProviders([
      Query.equal(fields.providers.type, [channel]),
      Query.equal(fields.providers.enabled, [true]),
    ])
    if (providers.length === 0) return undefined
    const doc = providers[0]
    if (!doc) return undefined
    return {
      type: doc.get(fields.providers.type),
      adapter: doc.get(fields.providers.adapter),
      enabled: doc.get(fields.providers.enabled),
      options: doc.get(fields.providers.options) ?? {},
    }
  }

  return {
    // ================= Providers =================
    async createProvider(documents, input) {
      const providerId =
        input.providerId && input.providerId !== 'unique()' ? input.providerId : createId()

      try {
        const existing = await documents.getProvider(providerId)
        if (existing?.getId()) {
          throw new ConflictError('Provider already exists', { code: 'provider_already_exists' })
        }
      } catch (err) {
        if (err instanceof ConflictError) throw err
      }

      const doc = new Doc({
        $id: providerId,
        [fields.providers.name]: input.name,
        [fields.providers.type]: input.type,
        [fields.providers.adapter]: input.adapter,
        [fields.providers.enabled]: input.enabled ?? true,
        [fields.providers.options]: input.options,
        $createdAt: now().toISOString(),
        $updatedAt: now().toISOString(),
      })

      return await documents.createProvider(doc)
    },

    async listProviders(documents) {
      return await documents.findProviders()
    },

    async getProvider(documents, id) {
      try {
        const doc = await documents.getProvider(id)
        if (!doc?.getId()) {
          throw new NotFoundError('Provider not found', { code: 'provider_not_found' })
        }
        return doc
      } catch (err) {
        if (err instanceof NotFoundError) throw err
        throw new NotFoundError('Provider not found', { code: 'provider_not_found' })
      }
    },

    async updateProvider(documents, id, input) {
      const doc = await this.getProvider(documents, id)

      if (input.name !== undefined) doc.set(fields.providers.name, input.name)
      if (input.enabled !== undefined) doc.set(fields.providers.enabled, input.enabled)
      if (input.options !== undefined) doc.set(fields.providers.options, input.options)
      doc.set('$updatedAt', now().toISOString())

      return await documents.updateProvider(doc)
    },

    async deleteProvider(documents, id) {
      await this.getProvider(documents, id)
      return await documents.deleteProvider(id)
    },

    // ================= Topics =================
    async createTopic(documents, input) {
      const topicId = input.topicId && input.topicId !== 'unique()' ? input.topicId : createId()

      try {
        const existing = await documents.getTopic(topicId)
        if (existing?.getId()) {
          throw new ConflictError('Topic already exists', { code: 'topic_already_exists' })
        }
      } catch (err) {
        if (err instanceof ConflictError) throw err
      }

      const doc = new Doc({
        $id: topicId,
        [fields.topics.name]: input.name,
        [fields.topics.description]: input.description ?? '',
        [fields.topics.total]: 0,
        [fields.topics.permissions]: input.permissions ?? ['read("any")'],
        $permissions: input.permissions ?? ['read("any")'],
        $createdAt: now().toISOString(),
        $updatedAt: now().toISOString(),
      })

      return await documents.createTopic(doc)
    },

    async listTopics(documents) {
      return await documents.findTopics()
    },

    async getTopic(documents, id) {
      try {
        const doc = await documents.getTopic(id)
        if (!doc?.getId()) {
          throw new NotFoundError('Topic not found', { code: 'topic_not_found' })
        }
        return doc
      } catch (err) {
        if (err instanceof NotFoundError) throw err
        throw new NotFoundError('Topic not found', { code: 'topic_not_found' })
      }
    },

    async updateTopic(documents, id, input) {
      const doc = await this.getTopic(documents, id)

      if (input.name !== undefined) doc.set(fields.topics.name, input.name)
      if (input.description !== undefined) doc.set(fields.topics.description, input.description)
      if (input.permissions !== undefined) {
        doc.set(fields.topics.permissions, input.permissions)
        doc.set('$permissions', input.permissions)
      }
      doc.set('$updatedAt', now().toISOString())

      return await documents.updateTopic(doc)
    },

    async deleteTopic(documents, id) {
      await this.getTopic(documents, id)
      await documents.deleteSubscribersByTopic(id)
      return await documents.deleteTopic(id)
    },

    // ================= Subscribers =================
    async createSubscriber(documents, topicId, input) {
      const topic = await this.getTopic(documents, topicId)

      const subscriberId =
        input.subscriberId && input.subscriberId !== 'unique()' ? input.subscriberId : createId()

      const doc = new Doc({
        $id: subscriberId,
        [fields.subscribers.topicId]: topicId,
        [fields.subscribers.userId]: input.userId ?? '',
        [fields.subscribers.userName]: input.userName ?? '',
        [fields.subscribers.targetId]: input.targetId ?? '',
        [fields.subscribers.target]: input.target,
        [fields.subscribers.providerType]: input.providerType,
        $createdAt: now().toISOString(),
        $updatedAt: now().toISOString(),
      })

      const created = await documents.createSubscriber(doc)

      // Increment topic total
      const currentTotal = Number(topic.get(fields.topics.total) || 0)
      topic.set(fields.topics.total, currentTotal + 1)
      topic.set('$updatedAt', now().toISOString())
      await documents.updateTopic(topic)

      return created
    },

    async listSubscribers(documents, topicId) {
      await this.getTopic(documents, topicId)
      return await documents.findSubscribers([Query.equal(fields.subscribers.topicId, [topicId])])
    },

    async getSubscriber(documents, topicId, subscriberId) {
      await this.getTopic(documents, topicId)
      try {
        const doc = await documents.getSubscriber(subscriberId)
        if (!doc?.getId() || doc.get(fields.subscribers.topicId) !== topicId) {
          throw new NotFoundError('Subscriber not found', { code: 'subscriber_not_found' })
        }
        return doc
      } catch (err) {
        if (err instanceof NotFoundError) throw err
        throw new NotFoundError('Subscriber not found', { code: 'subscriber_not_found' })
      }
    },

    async deleteSubscriber(documents, topicId, subscriberId) {
      const subscriber = await this.getSubscriber(documents, topicId, subscriberId)
      await documents.deleteSubscriber(subscriber.getId())

      // Decrement topic total
      const topic = await this.getTopic(documents, topicId)
      const currentTotal = Number(topic.get(fields.topics.total) || 0)
      topic.set(fields.topics.total, Math.max(0, currentTotal - 1))
      topic.set('$updatedAt', now().toISOString())
      await documents.updateTopic(topic)

      return true
    },

    // ================= Messages =================
    async createMessage(documents, gateway, channel, input) {
      const messageId =
        input.messageId && input.messageId !== 'unique()' ? input.messageId : createId()

      const topics = input.topics ?? []
      const users = input.users ?? []
      const explicitTargets = input.targets ?? []

      const messageData: Record<string, unknown> = {
        subject: input.subject,
        content: input.content,
        html: input.html,
        senderName: input.senderName,
        senderEmail: input.senderEmail,
        replyTo: input.replyTo,
        title: input.title,
        body: input.body,
        custom: input.data ?? {},
      }

      let status = input.draft ? 'draft' : 'completed'
      let deliveredTo = 0
      let total = 0
      const deliveryErrors: string[] = []

      if (!input.draft) {
        const recipients = await resolveRecipients(documents, channel, topics, explicitTargets)

        total = recipients.length
        if (total === 0) {
          throw new BadRequestError('No recipients found for message', {
            code: 'no_recipients',
          })
        }

        const provider = await getActiveProvider(documents, channel)
        if (!provider) {
          throw new BadRequestError(`No active provider configured for channel: ${channel}`, {
            code: 'no_active_provider',
          })
        }

        try {
          const report = await gateway.send(
            {
              channel,
              recipients,
              payload: {
                subject: input.subject,
                content: input.content,
                html: input.html,
                fromName: input.senderName,
                fromEmail: input.senderEmail,
                replyToEmail: input.replyTo,
                title: input.title,
                body: input.body,
                data: input.data,
              },
            },
            provider,
          )

          deliveredTo = report.deliveredTo
          for (const res of report.results) {
            if (res.status === 'failure' && res.error) {
              deliveryErrors.push(`${res.recipient}: ${res.error}`)
            }
          }

          if (deliveredTo === 0 && total > 0) {
            status = 'failed'
          }
        } catch (err: unknown) {
          status = 'failed'
          deliveryErrors.push(err instanceof Error ? err.message : String(err))
        }
      }

      const doc = new Doc({
        $id: messageId,
        [fields.messages.topics]: topics,
        [fields.messages.users]: users,
        [fields.messages.targets]: explicitTargets,
        [fields.messages.channel]: channel,
        [fields.messages.status]: status,
        [fields.messages.deliveredTo]: deliveredTo,
        [fields.messages.total]: total,
        [fields.messages.data]: messageData,
        [fields.messages.deliveryErrors]: deliveryErrors,
        $createdAt: now().toISOString(),
        $updatedAt: now().toISOString(),
      })

      return await documents.createMessage(doc)
    },

    async listMessages(documents) {
      return await documents.findMessages()
    },

    async getMessage(documents, id) {
      try {
        const doc = await documents.getMessage(id)
        if (!doc?.getId()) {
          throw new NotFoundError('Message not found', { code: 'message_not_found' })
        }
        return doc
      } catch (err) {
        if (err instanceof NotFoundError) throw err
        throw new NotFoundError('Message not found', { code: 'message_not_found' })
      }
    },

    async deleteMessage(documents, id) {
      await this.getMessage(documents, id)
      return await documents.deleteMessage(id)
    },

    async sendMessage(documents, gateway, id) {
      const doc = await this.getMessage(documents, id)
      const channel = doc.get(fields.messages.channel) as 'email' | 'sms' | 'push'
      const topics = (doc.get(fields.messages.topics) || []) as string[]
      const targets = (doc.get(fields.messages.targets) || []) as string[]
      const data = (doc.get(fields.messages.data) || {}) as Record<string, unknown>

      const recipients = await resolveRecipients(documents, channel, topics, targets)
      const total = recipients.length
      if (total === 0) {
        throw new BadRequestError('No recipients found for message', {
          code: 'no_recipients',
        })
      }

      const provider = await getActiveProvider(documents, channel)
      if (!provider) {
        throw new BadRequestError(`No active provider configured for channel: ${channel}`, {
          code: 'no_active_provider',
        })
      }

      const deliveryErrors: string[] = []
      let deliveredTo = 0
      let status = 'completed'

      try {
        const report = await gateway.send(
          {
            channel,
            recipients,
            payload: {
              subject: data.subject as string | undefined,
              content: data.content as string | undefined,
              html: data.html as boolean | undefined,
              fromName: data.senderName as string | undefined,
              fromEmail: data.senderEmail as string | undefined,
              replyToEmail: data.replyTo as string | undefined,
              title: data.title as string | undefined,
              body: data.body as string | undefined,
              data: data.custom as Record<string, unknown> | undefined,
            },
          },
          provider,
        )

        deliveredTo = report.deliveredTo
        for (const res of report.results) {
          if (res.status === 'failure' && res.error) {
            deliveryErrors.push(`${res.recipient}: ${res.error}`)
          }
        }

        if (deliveredTo === 0 && total > 0) {
          status = 'failed'
        }
      } catch (err: unknown) {
        status = 'failed'
        deliveryErrors.push(err instanceof Error ? err.message : String(err))
      }

      doc.set(fields.messages.status, status)
      doc.set(fields.messages.deliveredTo, deliveredTo)
      doc.set(fields.messages.total, total)
      doc.set(fields.messages.deliveryErrors, deliveryErrors)
      doc.set('$updatedAt', now().toISOString())

      return await documents.updateMessage(doc)
    },
  }
}
