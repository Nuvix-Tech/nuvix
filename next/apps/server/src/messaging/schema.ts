import { AttributeType, type Database, Doc, IndexType, Permission, Role } from '@nuvix/db'
import { apiScopeLabel } from '../context/database-roles'
import { MESSAGING_MODEL, type MessagingModel } from './model'

export type MessagingCollectionDefinition = Parameters<Database['createCollection']>[0]
export type MessagingSchemaDatabase = Pick<Database, 'createCollection' | 'exists'>

export function createProvidersCollectionDefinition(
  model: MessagingModel = MESSAGING_MODEL,
): MessagingCollectionDefinition {
  const fields = model.fields.providers
  return {
    id: model.collections.providers,
    attributes: [
      new Doc({
        $id: fields.name,
        key: fields.name,
        type: AttributeType.String,
        size: 128,
        required: true,
      }),
      new Doc({
        $id: fields.type,
        key: fields.type,
        type: AttributeType.String,
        size: 32,
        required: true,
      }),
      new Doc({
        $id: fields.adapter,
        key: fields.adapter,
        type: AttributeType.String,
        size: 64,
        required: true,
      }),
      new Doc({
        $id: fields.enabled,
        key: fields.enabled,
        type: AttributeType.Boolean,
        required: true,
        default: true,
      }),
      new Doc({
        $id: fields.options,
        key: fields.options,
        type: AttributeType.Json,
        required: true,
        default: {},
      }),
    ],
    indexes: [
      new Doc({
        $id: 'idx_providers_type',
        key: 'idx_providers_type',
        type: IndexType.Key,
        attributes: [fields.type],
      }),
    ],
    permissions: [
      Permission.create(Role.label(apiScopeLabel('providers.write'))),
      Permission.read(Role.label(apiScopeLabel('providers.read'))),
      Permission.update(Role.label(apiScopeLabel('providers.write'))),
      Permission.delete(Role.label(apiScopeLabel('providers.write'))),
    ],
    documentSecurity: true,
  }
}

export function createTopicsCollectionDefinition(
  model: MessagingModel = MESSAGING_MODEL,
): MessagingCollectionDefinition {
  const fields = model.fields.topics
  return {
    id: model.collections.topics,
    attributes: [
      new Doc({
        $id: fields.name,
        key: fields.name,
        type: AttributeType.String,
        size: 128,
        required: true,
      }),
      new Doc({
        $id: fields.description,
        key: fields.description,
        type: AttributeType.String,
        size: 512,
        required: false,
        default: '',
      }),
      new Doc({
        $id: fields.total,
        key: fields.total,
        type: AttributeType.Integer,
        size: 4,
        required: true,
        default: 0,
      }),
      new Doc({
        $id: fields.permissions,
        key: fields.permissions,
        type: AttributeType.String,
        size: 256,
        array: true,
        required: false,
        default: [],
      }),
    ],
    indexes: [],
    permissions: [
      Permission.create(Role.label(apiScopeLabel('topics.write'))),
      Permission.read(Role.label(apiScopeLabel('topics.read'))),
      Permission.update(Role.label(apiScopeLabel('topics.write'))),
      Permission.delete(Role.label(apiScopeLabel('topics.write'))),
    ],
    documentSecurity: true,
  }
}

export function createSubscribersCollectionDefinition(
  model: MessagingModel = MESSAGING_MODEL,
): MessagingCollectionDefinition {
  const fields = model.fields.subscribers
  return {
    id: model.collections.subscribers,
    attributes: [
      new Doc({
        $id: fields.topicId,
        key: fields.topicId,
        type: AttributeType.String,
        size: 36,
        required: true,
      }),
      new Doc({
        $id: fields.userId,
        key: fields.userId,
        type: AttributeType.String,
        size: 36,
        required: false,
      }),
      new Doc({
        $id: fields.userName,
        key: fields.userName,
        type: AttributeType.String,
        size: 128,
        required: false,
      }),
      new Doc({
        $id: fields.targetId,
        key: fields.targetId,
        type: AttributeType.String,
        size: 36,
        required: false,
      }),
      new Doc({
        $id: fields.target,
        key: fields.target,
        type: AttributeType.String,
        size: 256,
        required: true,
      }),
      new Doc({
        $id: fields.providerType,
        key: fields.providerType,
        type: AttributeType.String,
        size: 32,
        required: true,
      }),
    ],
    indexes: [
      new Doc({
        $id: 'idx_subscribers_topic',
        key: 'idx_subscribers_topic',
        type: IndexType.Key,
        attributes: [fields.topicId],
      }),
      new Doc({
        $id: 'idx_subscribers_user',
        key: 'idx_subscribers_user',
        type: IndexType.Key,
        attributes: [fields.userId],
      }),
    ],
    permissions: [
      Permission.create(Role.users()),
      Permission.create(Role.label(apiScopeLabel('subscribers.write'))),
      Permission.read(Role.label(apiScopeLabel('subscribers.read'))),
      Permission.update(Role.label(apiScopeLabel('subscribers.write'))),
      Permission.delete(Role.label(apiScopeLabel('subscribers.write'))),
    ],
    documentSecurity: true,
  }
}

export function createMessagesCollectionDefinition(
  model: MessagingModel = MESSAGING_MODEL,
): MessagingCollectionDefinition {
  const fields = model.fields.messages
  return {
    id: model.collections.messages,
    attributes: [
      new Doc({
        $id: fields.topics,
        key: fields.topics,
        type: AttributeType.String,
        size: 36,
        array: true,
        required: false,
        default: [],
      }),
      new Doc({
        $id: fields.users,
        key: fields.users,
        type: AttributeType.String,
        size: 36,
        array: true,
        required: false,
        default: [],
      }),
      new Doc({
        $id: fields.targets,
        key: fields.targets,
        type: AttributeType.String,
        size: 256,
        array: true,
        required: false,
        default: [],
      }),
      new Doc({
        $id: fields.channel,
        key: fields.channel,
        type: AttributeType.String,
        size: 32,
        required: true,
      }),
      new Doc({
        $id: fields.status,
        key: fields.status,
        type: AttributeType.String,
        size: 32,
        required: true,
        default: 'draft',
      }),
      new Doc({
        $id: fields.deliveredTo,
        key: fields.deliveredTo,
        type: AttributeType.Integer,
        size: 4,
        required: true,
        default: 0,
      }),
      new Doc({
        $id: fields.total,
        key: fields.total,
        type: AttributeType.Integer,
        size: 4,
        required: true,
        default: 0,
      }),
      new Doc({
        $id: fields.data,
        key: fields.data,
        type: AttributeType.Json,
        required: true,
        default: {},
      }),
      new Doc({
        $id: fields.deliveryErrors,
        key: fields.deliveryErrors,
        type: AttributeType.String,
        size: 512,
        array: true,
        required: false,
        default: [],
      }),
    ],
    indexes: [
      new Doc({
        $id: 'idx_messages_status',
        key: 'idx_messages_status',
        type: IndexType.Key,
        attributes: [fields.status],
      }),
      new Doc({
        $id: 'idx_messages_channel',
        key: 'idx_messages_channel',
        type: IndexType.Key,
        attributes: [fields.channel],
      }),
    ],
    permissions: [
      Permission.create(Role.label(apiScopeLabel('messages.write'))),
      Permission.read(Role.label(apiScopeLabel('messages.read'))),
      Permission.update(Role.label(apiScopeLabel('messages.write'))),
      Permission.delete(Role.label(apiScopeLabel('messages.write'))),
    ],
    documentSecurity: true,
  }
}

/** Explicit provisioning operation for tenant messaging schemas. */
export async function setupMessagingSchema(
  database: MessagingSchemaDatabase,
  model: MessagingModel = MESSAGING_MODEL,
): Promise<void> {
  if (!(await database.exists(undefined, model.collections.providers))) {
    await database.createCollection(createProvidersCollectionDefinition(model))
  }
  if (!(await database.exists(undefined, model.collections.topics))) {
    await database.createCollection(createTopicsCollectionDefinition(model))
  }
  if (!(await database.exists(undefined, model.collections.subscribers))) {
    await database.createCollection(createSubscribersCollectionDefinition(model))
  }
  if (!(await database.exists(undefined, model.collections.messages))) {
    await database.createCollection(createMessagesCollectionDefinition(model))
  }
}
