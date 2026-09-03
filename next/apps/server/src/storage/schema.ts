import { AttributeType, type Database, Doc, IndexType, Permission, Role } from '@nuvix/db'
import { apiScopeLabel } from '../context/database-roles'
import { STORAGE_MODEL, type StorageModel } from './model'

export type StorageCollectionDefinition = Parameters<Database['createCollection']>[0]
export type StorageSchemaDatabase = Pick<Database, 'createCollection' | 'exists'>

export function createBucketsCollectionDefinition(
  model: StorageModel = STORAGE_MODEL,
): StorageCollectionDefinition {
  const fields = model.fields.buckets
  return {
    id: model.collections.buckets,
    attributes: [
      new Doc({
        $id: fields.name,
        key: fields.name,
        type: AttributeType.String,
        size: 128,
        required: true,
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
      new Doc({
        $id: fields.fileSecurity,
        key: fields.fileSecurity,
        type: AttributeType.Boolean,
        required: true,
        default: true,
      }),
      new Doc({
        $id: fields.enabled,
        key: fields.enabled,
        type: AttributeType.Boolean,
        required: true,
        default: true,
      }),
      new Doc({
        $id: fields.maximumFileSize,
        key: fields.maximumFileSize,
        type: AttributeType.Integer,
        size: 8,
        required: true,
        default: 26214400, // 25 MB default limit
      }),
      new Doc({
        $id: fields.allowedFileExtensions,
        key: fields.allowedFileExtensions,
        type: AttributeType.String,
        size: 32,
        array: true,
        required: false,
        default: [],
      }),
      new Doc({
        $id: fields.compression,
        key: fields.compression,
        type: AttributeType.String,
        size: 16,
        required: true,
        default: 'none',
      }),
      new Doc({
        $id: fields.encryption,
        key: fields.encryption,
        type: AttributeType.Boolean,
        required: true,
        default: true,
      }),
      new Doc({
        $id: fields.antivirus,
        key: fields.antivirus,
        type: AttributeType.Boolean,
        required: true,
        default: false,
      }),
      new Doc({
        $id: fields.policy,
        key: fields.policy,
        type: AttributeType.Json,
        required: false,
        default: {},
      }),
      new Doc({
        $id: fields.cors,
        key: fields.cors,
        type: AttributeType.Json,
        required: false,
        default: [],
      }),
    ],
    indexes: [],
    permissions: [
      Permission.create(Role.label(apiScopeLabel('buckets.write'))),
      Permission.read(Role.label(apiScopeLabel('buckets.read'))),
      Permission.update(Role.label(apiScopeLabel('buckets.write'))),
      Permission.delete(Role.label(apiScopeLabel('buckets.write'))),
    ],
    documentSecurity: true,
  }
}

export function createObjectsCollectionDefinition(
  model: StorageModel = STORAGE_MODEL,
): StorageCollectionDefinition {
  const fields = model.fields.objects
  return {
    id: model.collections.objects,
    attributes: [
      new Doc({
        $id: fields.bucketId,
        key: fields.bucketId,
        type: AttributeType.String,
        size: 36,
        required: true,
      }),
      new Doc({
        $id: fields.key,
        key: fields.key,
        type: AttributeType.String,
        size: 1024,
        required: true,
      }),
      new Doc({
        $id: fields.size,
        key: fields.size,
        type: AttributeType.Integer,
        size: 8,
        required: true,
      }),
      new Doc({
        $id: fields.mimeType,
        key: fields.mimeType,
        type: AttributeType.String,
        size: 128,
        required: true,
      }),
      new Doc({
        $id: fields.etag,
        key: fields.etag,
        type: AttributeType.String,
        size: 64,
        required: true,
      }),
      new Doc({
        $id: fields.metadata,
        key: fields.metadata,
        type: AttributeType.Json,
        required: false,
        default: {},
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
    indexes: [
      new Doc({
        $id: 'idx_objects_bucket_key',
        key: 'idx_objects_bucket_key',
        type: IndexType.Unique,
        attributes: [fields.bucketId, fields.key],
      }),
      new Doc({
        $id: 'idx_objects_bucket',
        key: 'idx_objects_bucket',
        type: IndexType.Key,
        attributes: [fields.bucketId],
      }),
    ],
    permissions: [
      Permission.create(Role.users()),
      Permission.create(Role.label(apiScopeLabel('files.write'))),
      Permission.read(Role.label(apiScopeLabel('files.read'))),
      Permission.update(Role.label(apiScopeLabel('files.write'))),
      Permission.delete(Role.label(apiScopeLabel('files.write'))),
    ],
    documentSecurity: true,
  }
}

export function createMultipartUploadsCollectionDefinition(
  model: StorageModel = STORAGE_MODEL,
): StorageCollectionDefinition {
  const fields = model.fields.multipartUploads
  return {
    id: model.collections.multipartUploads,
    attributes: [
      new Doc({
        $id: fields.bucketId,
        key: fields.bucketId,
        type: AttributeType.String,
        size: 36,
        required: true,
      }),
      new Doc({
        $id: fields.key,
        key: fields.key,
        type: AttributeType.String,
        size: 1024,
        required: true,
      }),
      new Doc({
        $id: fields.parts,
        key: fields.parts,
        type: AttributeType.Json,
        required: true,
        default: [],
      }),
      new Doc({
        $id: fields.expiresAt,
        key: fields.expiresAt,
        type: AttributeType.Timestamptz,
        required: true,
      }),
    ],
    indexes: [
      new Doc({
        $id: 'idx_multipart_bucket_key',
        key: 'idx_multipart_bucket_key',
        type: IndexType.Key,
        attributes: [fields.bucketId, fields.key],
      }),
      new Doc({
        $id: 'idx_multipart_expires',
        key: 'idx_multipart_expires',
        type: IndexType.Key,
        attributes: [fields.expiresAt],
      }),
    ],
    permissions: [
      Permission.create(Role.users()),
      Permission.create(Role.label(apiScopeLabel('files.write'))),
      Permission.read(Role.label(apiScopeLabel('files.read'))),
      Permission.update(Role.label(apiScopeLabel('files.write'))),
      Permission.delete(Role.label(apiScopeLabel('files.write'))),
    ],
    documentSecurity: true,
  }
}

/** Explicit provisioning operation for tenant storage schemas. */
export async function setupStorageSchema(
  database: StorageSchemaDatabase,
  model: StorageModel = STORAGE_MODEL,
): Promise<void> {
  if (!(await database.exists(undefined, model.collections.buckets))) {
    await database.createCollection(createBucketsCollectionDefinition(model))
  }
  if (!(await database.exists(undefined, model.collections.objects))) {
    await database.createCollection(createObjectsCollectionDefinition(model))
  }
  if (!(await database.exists(undefined, model.collections.multipartUploads))) {
    await database.createCollection(createMultipartUploadsCollectionDefinition(model))
  }
}
