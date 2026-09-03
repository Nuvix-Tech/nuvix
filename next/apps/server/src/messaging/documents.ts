import { type Doc, Query, type Session } from '@nuvix/db'
import { MESSAGING_MODEL, type MessagingModel } from './model'

export type MessagingSession = Pick<
  Session,
  'find' | 'getDocument' | 'createDocument' | 'updateDocument' | 'deleteDocument' | 'count'
>

export interface MessagingDocuments {
  // Providers
  findProviders(queries?: readonly Query[]): Promise<Doc[]>
  getProvider(id: string): Promise<Doc>
  createProvider(doc: Doc): Promise<Doc>
  updateProvider(doc: Doc): Promise<Doc>
  deleteProvider(id: string): Promise<boolean>

  // Topics
  findTopics(queries?: readonly Query[]): Promise<Doc[]>
  getTopic(id: string): Promise<Doc>
  createTopic(doc: Doc): Promise<Doc>
  updateTopic(doc: Doc): Promise<Doc>
  deleteTopic(id: string): Promise<boolean>

  // Subscribers
  findSubscribers(queries?: readonly Query[]): Promise<Doc[]>
  getSubscriber(id: string): Promise<Doc>
  createSubscriber(doc: Doc): Promise<Doc>
  deleteSubscriber(id: string): Promise<boolean>
  deleteSubscribersByTopic(topicId: string): Promise<number>

  // Messages
  findMessages(queries?: readonly Query[]): Promise<Doc[]>
  getMessage(id: string): Promise<Doc>
  createMessage(doc: Doc): Promise<Doc>
  updateMessage(doc: Doc): Promise<Doc>
  deleteMessage(id: string): Promise<boolean>
}

export function messagingDocuments(
  session: MessagingSession,
  model: MessagingModel = MESSAGING_MODEL,
): MessagingDocuments {
  const collections = model.collections
  const fields = model.fields

  return Object.freeze({
    findProviders: (queries?: readonly Query[]) =>
      session.find(collections.providers, queries ? [...queries] : []),
    getProvider: (id: string) => session.getDocument(collections.providers, id),
    createProvider: (doc: Doc) => session.createDocument(collections.providers, doc),
    updateProvider: (doc: Doc) => session.updateDocument(collections.providers, doc.getId(), doc),
    deleteProvider: (id: string) => session.deleteDocument(collections.providers, id),

    findTopics: (queries?: readonly Query[]) =>
      session.find(collections.topics, queries ? [...queries] : []),
    getTopic: (id: string) => session.getDocument(collections.topics, id),
    createTopic: (doc: Doc) => session.createDocument(collections.topics, doc),
    updateTopic: (doc: Doc) => session.updateDocument(collections.topics, doc.getId(), doc),
    deleteTopic: (id: string) => session.deleteDocument(collections.topics, id),

    findSubscribers: (queries?: readonly Query[]) =>
      session.find(collections.subscribers, queries ? [...queries] : []),
    getSubscriber: (id: string) => session.getDocument(collections.subscribers, id),
    createSubscriber: (doc: Doc) => session.createDocument(collections.subscribers, doc),
    deleteSubscriber: (id: string) => session.deleteDocument(collections.subscribers, id),
    deleteSubscribersByTopic: async (topicId: string) => {
      const subs = await session.find(collections.subscribers, [
        Query.equal(fields.subscribers.topicId, [topicId]),
      ])
      let deleted = 0
      for (const sub of subs) {
        await session.deleteDocument(collections.subscribers, sub.getId())
        deleted++
      }
      return deleted
    },

    findMessages: (queries?: readonly Query[]) =>
      session.find(collections.messages, queries ? [...queries] : []),
    getMessage: (id: string) => session.getDocument(collections.messages, id),
    createMessage: (doc: Doc) => session.createDocument(collections.messages, doc),
    updateMessage: (doc: Doc) => session.updateDocument(collections.messages, doc.getId(), doc),
    deleteMessage: (id: string) => session.deleteDocument(collections.messages, id),
  })
}
