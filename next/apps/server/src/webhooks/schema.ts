import { AttributeType, type Database, Doc, IndexType, Permission, Role } from '@nuvix/db'
import { apiScopeLabel } from '../context/database-roles'
import { WEBHOOK_MODEL, type WebhookModel } from './model'

export type WebhookCollectionDefinition = Parameters<Database['createCollection']>[0]
export type WebhookSchemaDatabase = Pick<Database, 'createCollection' | 'exists'>

export function createWebhooksCollectionDefinition(
  model: WebhookModel = WEBHOOK_MODEL,
): WebhookCollectionDefinition {
  const fields = model.fields.webhooks
  return {
    id: model.collections.webhooks,
    attributes: [
      new Doc({
        $id: fields.name,
        key: fields.name,
        type: AttributeType.String,
        size: 128,
        required: true,
      }),
      new Doc({
        $id: fields.events,
        key: fields.events,
        type: AttributeType.String,
        size: 256,
        array: true,
        required: true,
      }),
      new Doc({
        $id: fields.url,
        key: fields.url,
        type: AttributeType.String,
        size: 2048,
        required: true,
      }),
      new Doc({
        $id: fields.security,
        key: fields.security,
        type: AttributeType.Boolean,
        required: true,
        default: true,
      }),
      new Doc({
        $id: fields.httpUser,
        key: fields.httpUser,
        type: AttributeType.String,
        size: 256,
        required: false,
        default: '',
      }),
      new Doc({
        $id: fields.httpPass,
        key: fields.httpPass,
        type: AttributeType.String,
        size: 256,
        required: false,
        default: '',
      }),
      new Doc({
        $id: fields.signatureKey,
        key: fields.signatureKey,
        type: AttributeType.String,
        size: 128,
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
        $id: fields.attempts,
        key: fields.attempts,
        type: AttributeType.Integer,
        size: 4,
        required: true,
        default: 0,
      }),
      new Doc({
        $id: fields.logs,
        key: fields.logs,
        type: AttributeType.String,
        size: 500,
        required: false,
        default: '',
      }),
    ],
    indexes: [
      new Doc({
        $id: 'idx_webhooks_enabled',
        key: 'idx_webhooks_enabled',
        type: IndexType.Key,
        attributes: [fields.enabled],
      }),
    ],
    permissions: [
      Permission.create(Role.label(apiScopeLabel('webhooks.write'))),
      Permission.read(Role.label(apiScopeLabel('webhooks.read'))),
      Permission.update(Role.label(apiScopeLabel('webhooks.write'))),
      Permission.delete(Role.label(apiScopeLabel('webhooks.write'))),
    ],
    documentSecurity: true,
  }
}

export function createWebhookLogsCollectionDefinition(
  model: WebhookModel = WEBHOOK_MODEL,
): WebhookCollectionDefinition {
  const fields = model.fields.webhookLogs
  return {
    id: model.collections.webhookLogs,
    attributes: [
      new Doc({
        $id: fields.webhookId,
        key: fields.webhookId,
        type: AttributeType.String,
        size: 64,
        required: true,
      }),
      new Doc({
        $id: fields.event,
        key: fields.event,
        type: AttributeType.String,
        size: 256,
        required: true,
      }),
      new Doc({
        $id: fields.success,
        key: fields.success,
        type: AttributeType.Boolean,
        required: true,
      }),
      new Doc({
        $id: fields.statusCode,
        key: fields.statusCode,
        type: AttributeType.Integer,
        size: 4,
        required: false,
      }),
      new Doc({
        $id: fields.response,
        key: fields.response,
        type: AttributeType.String,
        size: 1000,
        required: false,
        default: '',
      }),
      new Doc({
        $id: fields.error,
        key: fields.error,
        type: AttributeType.String,
        size: 1000,
        required: false,
        default: '',
      }),
      new Doc({
        $id: fields.durationMs,
        key: fields.durationMs,
        type: AttributeType.Integer,
        size: 4,
        required: true,
        default: 0,
      }),
      new Doc({
        $id: fields.timestamp,
        key: fields.timestamp,
        type: AttributeType.String,
        size: 64,
        required: true,
      }),
    ],
    indexes: [
      new Doc({
        $id: 'idx_webhook_logs_webhook_id',
        key: 'idx_webhook_logs_webhook_id',
        type: IndexType.Key,
        attributes: [fields.webhookId],
      }),
      new Doc({
        $id: 'idx_webhook_logs_timestamp',
        key: 'idx_webhook_logs_timestamp',
        type: IndexType.Key,
        attributes: [fields.webhookId, fields.timestamp],
      }),
    ],
    permissions: [
      Permission.read(Role.label(apiScopeLabel('webhooks.read'))),
      Permission.delete(Role.label(apiScopeLabel('webhooks.write'))),
    ],
    documentSecurity: true,
  }
}

/** Explicit provisioning operation for tenant webhook schemas. */
export async function setupWebhookSchema(
  database: WebhookSchemaDatabase,
  model: WebhookModel = WEBHOOK_MODEL,
): Promise<void> {
  if (!(await database.exists(undefined, model.collections.webhooks))) {
    await database.createCollection(createWebhooksCollectionDefinition(model))
  }
  if (!(await database.exists(undefined, model.collections.webhookLogs))) {
    await database.createCollection(createWebhookLogsCollectionDefinition(model))
  }
}
