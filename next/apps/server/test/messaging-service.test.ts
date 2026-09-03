import { describe, expect, test } from 'bun:test'
import type { Doc } from '@nuvix/db'
import type { MessagingDocuments } from '../src/messaging/documents'
import type { MessageRequest, MessagingGateway, ProviderConfig } from '../src/messaging/gateway'
import { createMessagingService } from '../src/messaging/service'

function createMemoryMessagingDocuments(): {
  documents: MessagingDocuments
  providers: Map<string, Doc>
  topics: Map<string, Doc>
  subscribers: Map<string, Doc>
  messages: Map<string, Doc>
} {
  const providers = new Map<string, Doc>()
  const topics = new Map<string, Doc>()
  const subscribers = new Map<string, Doc>()
  const messages = new Map<string, Doc>()

  const documents: MessagingDocuments = {
    async findProviders(queries = []) {
      const all = [...providers.values()]
      if (queries.length === 0) return all
      return all.filter((doc) => {
        for (const q of queries) {
          const attr = q.getAttribute()
          const vals = q.getValues()
          if (attr && vals?.length && !vals.includes(doc.get(attr))) {
            return false
          }
        }
        return true
      })
    },
    async getProvider(id) {
      const doc = providers.get(id)
      if (!doc) throw new Error('Provider not found')
      return doc
    },
    async createProvider(doc) {
      providers.set(doc.getId(), doc)
      return doc
    },
    async updateProvider(doc) {
      providers.set(doc.getId(), doc)
      return doc
    },
    async deleteProvider(id) {
      return providers.delete(id)
    },

    async findTopics() {
      return [...topics.values()]
    },
    async getTopic(id) {
      const doc = topics.get(id)
      if (!doc) throw new Error('Topic not found')
      return doc
    },
    async createTopic(doc) {
      topics.set(doc.getId(), doc)
      return doc
    },
    async updateTopic(doc) {
      topics.set(doc.getId(), doc)
      return doc
    },
    async deleteTopic(id) {
      return topics.delete(id)
    },

    async findSubscribers(queries = []) {
      const all = [...subscribers.values()]
      if (queries.length === 0) return all
      return all.filter((doc) => {
        for (const q of queries) {
          const attr = q.getAttribute()
          const vals = q.getValues()
          if (attr && vals?.length && !vals.includes(doc.get(attr))) {
            return false
          }
        }
        return true
      })
    },
    async getSubscriber(id) {
      const doc = subscribers.get(id)
      if (!doc) throw new Error('Subscriber not found')
      return doc
    },
    async createSubscriber(doc) {
      subscribers.set(doc.getId(), doc)
      return doc
    },
    async deleteSubscriber(id) {
      return subscribers.delete(id)
    },
    async deleteSubscribersByTopic(topicId) {
      let count = 0
      for (const [id, doc] of subscribers.entries()) {
        if (doc.get('topicId') === topicId) {
          subscribers.delete(id)
          count++
        }
      }
      return count
    },

    async findMessages() {
      return [...messages.values()]
    },
    async getMessage(id) {
      const doc = messages.get(id)
      if (!doc) throw new Error('Message not found')
      return doc
    },
    async createMessage(doc) {
      messages.set(doc.getId(), doc)
      return doc
    },
    async updateMessage(doc) {
      messages.set(doc.getId(), doc)
      return doc
    },
    async deleteMessage(id) {
      return messages.delete(id)
    },
  }

  return { documents, providers, topics, subscribers, messages }
}

describe('MessagingService', () => {
  const service = createMessagingService()

  test('providers lifecycle: create, list, get, update, delete', async () => {
    const { documents } = createMemoryMessagingDocuments()

    // 1. Create provider
    const provider = await service.createProvider(documents, {
      providerId: 'sendgrid_prod',
      name: 'SendGrid Production',
      type: 'email',
      adapter: 'sendgrid',
      enabled: true,
      options: { apiKey: 'SG.123' },
    })
    expect(provider.getId()).toBe('sendgrid_prod')
    expect(provider.get('name')).toBe('SendGrid Production')

    // 2. Reject duplicate
    expect(
      service.createProvider(documents, {
        providerId: 'sendgrid_prod',
        name: 'Duplicate',
        type: 'email',
        adapter: 'sendgrid',
        options: {},
      }),
    ).rejects.toThrow()

    // 3. List
    const list = await service.listProviders(documents)
    expect(list).toHaveLength(1)

    // 4. Update
    const updated = await service.updateProvider(documents, 'sendgrid_prod', {
      name: 'SendGrid Updated',
      enabled: false,
    })
    expect(updated.get('name')).toBe('SendGrid Updated')
    expect(updated.get('enabled')).toBe(false)

    // 5. Delete
    await service.deleteProvider(documents, 'sendgrid_prod')
    expect(service.getProvider(documents, 'sendgrid_prod')).rejects.toThrow()
  })

  test('topics & subscribers lifecycle with total subscriber count sync', async () => {
    const { documents } = createMemoryMessagingDocuments()

    // 1. Create Topic
    const topic = await service.createTopic(documents, {
      topicId: 'news',
      name: 'Newsletter',
      description: 'Weekly tech news',
    })
    expect(topic.getId()).toBe('news')
    expect(topic.get('total')).toBe(0)

    // 2. Add Subscribers
    const sub1 = await service.createSubscriber(documents, 'news', {
      subscriberId: 'sub1',
      target: 'alice@example.com',
      providerType: 'email',
      userName: 'Alice',
    })
    expect(sub1.get('target')).toBe('alice@example.com')

    const updatedTopic1 = await service.getTopic(documents, 'news')
    expect(updatedTopic1.get('total')).toBe(1)

    const sub2 = await service.createSubscriber(documents, 'news', {
      subscriberId: 'sub2',
      target: 'bob@example.com',
      providerType: 'email',
      userName: 'Bob',
    })
    expect(sub2.getId()).toBe('sub2')

    const updatedTopic2 = await service.getTopic(documents, 'news')
    expect(updatedTopic2.get('total')).toBe(2)

    // 3. List subscribers
    const subs = await service.listSubscribers(documents, 'news')
    expect(subs).toHaveLength(2)

    // 4. Delete subscriber -> decrements total
    await service.deleteSubscriber(documents, 'news', 'sub1')
    const updatedTopic3 = await service.getTopic(documents, 'news')
    expect(updatedTopic3.get('total')).toBe(1)

    // 5. Delete topic -> cascades subscribers
    await service.deleteTopic(documents, 'news')
    expect(service.getTopic(documents, 'news')).rejects.toThrow()
    const remainingSubs = await documents.findSubscribers()
    expect(remainingSubs).toHaveLength(0)
  })

  test('message dispatch with topic recipient expansion and template rendering', async () => {
    const { documents } = createMemoryMessagingDocuments()

    // Setup active email provider
    await service.createProvider(documents, {
      providerId: 'prov_email',
      name: 'SendGrid',
      type: 'email',
      adapter: 'sendgrid',
      enabled: true,
      options: { apiKey: 'SG.fake' },
    })

    // Setup topic and subscribers
    await service.createTopic(documents, { topicId: 'alerts', name: 'Alerts' })
    await service.createSubscriber(documents, 'alerts', {
      target: 'ops1@example.com',
      providerType: 'email',
    })
    await service.createSubscriber(documents, 'alerts', {
      target: 'ops2@example.com',
      providerType: 'email',
    })

    const sentMessages: { req: MessageRequest; provider?: ProviderConfig }[] = []
    const mockGateway: MessagingGateway = {
      async send(req, provider) {
        sentMessages.push({ req, provider })
        return {
          deliveredTo: req.recipients.length,
          results: req.recipients.map((r) => ({
            recipient: r,
            status: 'success',
            error: '',
          })),
        }
      },
    }

    // 1. Create and send message to topic + explicit target
    const messageDoc = await service.createMessage(documents, mockGateway, 'email', {
      topics: ['alerts'],
      targets: ['direct@example.com'],
      subject: 'Critical Alert: Server Down',
      content: 'Server 10.0.0.1 is unresponsive',
      senderName: 'Monitoring Bot',
      senderEmail: 'bot@nuvix.io',
    })

    expect(messageDoc.get('status')).toBe('completed')
    expect(messageDoc.get('deliveredTo')).toBe(3) // ops1, ops2, direct
    expect(messageDoc.get('total')).toBe(3)
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]?.req.recipients).toEqual(
      expect.arrayContaining(['ops1@example.com', 'ops2@example.com', 'direct@example.com']),
    )

    // 2. Create draft message and trigger send later
    const draftDoc = await service.createMessage(documents, mockGateway, 'email', {
      messageId: 'draft_1',
      targets: ['client@example.com'],
      subject: 'Scheduled Announcement',
      content: 'Good day!',
      draft: true,
    })
    expect(draftDoc.get('status')).toBe('draft')
    expect(draftDoc.get('deliveredTo')).toBe(0)

    // Trigger send
    const sentDraft = await service.sendMessage(documents, mockGateway, 'draft_1')
    expect(sentDraft.get('status')).toBe('completed')
    expect(sentDraft.get('deliveredTo')).toBe(1)
  })
})
