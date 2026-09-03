import type { Doc } from '@nuvix/db'
import { Elysia, t } from 'elysia'
import type { ProjectAuthContext } from '../context/project'
import type { DatabaseRequestCapabilities } from '../infrastructure/database-composition'
import { ForbiddenError } from '../shared/errors'
import {
  BucketId,
  BucketPolicySchema,
  BucketResponse,
  CompleteMultipartBody,
  CreateBucketBody,
  InitiateMultipartBody,
  ObjectKey,
  ObjectResponse,
  PresignBody,
  PresignResponse,
  UpdateBucketBody,
} from './contracts'
import { createStorageDevices, type StorageDevices } from './devices'
import { storageDocuments } from './documents'
import { STORAGE_MODEL } from './model'
import type { BucketPolicy } from './policy'
import { createStorageService, type StorageService } from './service'

export function authorizeBuckets(
  auth: ProjectAuthContext,
  scope: 'buckets.read' | 'buckets.write',
): void {
  if (auth.type === 'guest') throw new ForbiddenError()
  if (
    auth.type === 'apiKey' &&
    !auth.scopes.includes(scope) &&
    !auth.scopes.includes('buckets.*')
  ) {
    throw new ForbiddenError()
  }
}

function mapBucket(doc: Doc) {
  const fields = STORAGE_MODEL.fields.buckets
  return {
    $id: doc.getId(),
    $createdAt: (doc.get('$createdAt') || new Date().toISOString()) as string,
    $updatedAt: (doc.get('$updatedAt') || new Date().toISOString()) as string,
    $permissions: (doc.get('$permissions') || []) as string[],
    name: (doc.get(fields.name) || '') as string,
    enabled: doc.get(fields.enabled, true) as boolean,
    maximumFileSize: Number(doc.get(fields.maximumFileSize, 26214400)),
    allowedFileExtensions: (doc.get(fields.allowedFileExtensions) || []) as string[],
    compression: (doc.get(fields.compression) || 'none') as string,
    encryption: doc.get(fields.encryption, true) as boolean,
    antivirus: doc.get(fields.antivirus, false) as boolean,
    fileSecurity: doc.get(fields.fileSecurity, true) as boolean,
  }
}

function mapObject(doc: Doc) {
  const fields = STORAGE_MODEL.fields.objects
  return {
    $id: doc.getId(),
    $createdAt: (doc.get('$createdAt') || new Date().toISOString()) as string,
    $updatedAt: (doc.get('$updatedAt') || new Date().toISOString()) as string,
    $permissions: (doc.get('$permissions') || []) as string[],
    bucketId: (doc.get(fields.bucketId) || '') as string,
    key: (doc.get(fields.key) || '') as string,
    size: Number(doc.get(fields.size, 0)),
    mimeType: (doc.get(fields.mimeType) || 'application/octet-stream') as string,
    etag: (doc.get(fields.etag) || '') as string,
    metadata: (doc.get(fields.metadata) || {}) as Record<string, unknown>,
  }
}

function parseRangeHeader(
  rangeHeader: string | null,
): { start?: number; end?: number } | undefined {
  if (!rangeHeader?.startsWith('bytes=')) return undefined
  const parts = rangeHeader.slice(6).split('-')
  const start = parts[0] ? Number.parseInt(parts[0], 10) : undefined
  const end = parts[1] ? Number.parseInt(parts[1], 10) : undefined
  return { start, end }
}

export function storageRoutes(
  requests: DatabaseRequestCapabilities,
  service: StorageService = createStorageService(),
  devices: StorageDevices = createStorageDevices(),
) {
  return (
    new Elysia({ name: 'storage-routes' })
      // ================= Buckets =================
      .post(
        '/storage/buckets',
        {
          body: CreateBucketBody,
          response: BucketResponse,
          detail: { tags: ['storage'] },
        },
        ({ body, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeBuckets(auth, 'buckets.write')
            set.status = 201
            const bucket = await service.createBucket(storageDocuments(session), body)
            return mapBucket(bucket)
          }),
      )
      .get(
        '/storage/buckets',
        {
          query: t.Object({
            limit: t.Optional(t.Numeric()),
            offset: t.Optional(t.Numeric()),
          }),
          response: t.Object({
            data: t.Array(BucketResponse),
            meta: t.Object({ total: t.Integer(), limit: t.Integer(), offset: t.Integer() }),
          }),
          detail: { tags: ['storage'] },
        },
        ({ query, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeBuckets(auth, 'buckets.read')
            const limit = Number(query.limit) || 25
            const offset = Number(query.offset) || 0
            const res = await service.listBuckets(storageDocuments(session), { limit, offset })
            return {
              data: res.data.map(mapBucket),
              meta: { total: res.total, limit, offset },
            }
          }),
      )
      .get(
        '/storage/buckets/:bucketId',
        {
          params: t.Object({ bucketId: BucketId }),
          response: BucketResponse,
          detail: { tags: ['storage'] },
        },
        ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeBuckets(auth, 'buckets.read')
            const bucket = await service.getBucket(storageDocuments(session), params.bucketId)
            return mapBucket(bucket)
          }),
      )
      .put(
        '/storage/buckets/:bucketId',
        {
          params: t.Object({ bucketId: BucketId }),
          body: UpdateBucketBody,
          response: BucketResponse,
          detail: { tags: ['storage'] },
        },
        ({ params, body, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeBuckets(auth, 'buckets.write')
            const bucket = await service.updateBucket(
              storageDocuments(session),
              params.bucketId,
              body,
            )
            return mapBucket(bucket)
          }),
      )
      .delete(
        '/storage/buckets/:bucketId',
        {
          params: t.Object({ bucketId: BucketId }),
          detail: { tags: ['storage'] },
        },
        ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeBuckets(auth, 'buckets.write')
            await service.deleteBucket(storageDocuments(session), devices, params.bucketId)
            set.status = 204
            return ''
          }),
      )

      // ================= Bucket Policies =================
      .get(
        '/storage/buckets/:bucketId/policy',
        {
          params: t.Object({ bucketId: BucketId }),
          detail: { tags: ['storage'] },
        },
        ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeBuckets(auth, 'buckets.read')
            const policy = await service.getBucketPolicy(storageDocuments(session), params.bucketId)
            return policy ?? {}
          }),
      )
      .put(
        '/storage/buckets/:bucketId/policy',
        {
          params: t.Object({ bucketId: BucketId }),
          body: BucketPolicySchema,
          detail: { tags: ['storage'] },
        },
        ({ params, body, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeBuckets(auth, 'buckets.write')
            await service.putBucketPolicy(
              storageDocuments(session),
              params.bucketId,
              body as unknown as BucketPolicy,
            )
            return { ok: true }
          }),
      )
      .delete(
        '/storage/buckets/:bucketId/policy',
        {
          params: t.Object({ bucketId: BucketId }),
          detail: { tags: ['storage'] },
        },
        ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            authorizeBuckets(auth, 'buckets.write')
            await service.deleteBucketPolicy(storageDocuments(session), params.bucketId)
            set.status = 204
            return ''
          }),
      )

      // ================= Objects =================
      .get(
        '/storage/buckets/:bucketId/objects',
        {
          params: t.Object({ bucketId: BucketId }),
          query: t.Object({
            prefix: t.Optional(t.String()),
            delimiter: t.Optional(t.String()),
            limit: t.Optional(t.Numeric()),
            offset: t.Optional(t.Numeric()),
          }),
          response: t.Object({
            data: t.Array(ObjectResponse),
            commonPrefixes: t.Array(t.String()),
            meta: t.Object({ total: t.Integer(), limit: t.Integer(), offset: t.Integer() }),
          }),
          detail: { tags: ['storage'] },
        },
        ({ params, query, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            const limit = Number(query.limit) || 25
            const offset = Number(query.offset) || 0
            const res = await service.listObjects(
              storageDocuments(session),
              auth,
              params.bucketId,
              {
                prefix: query.prefix,
                delimiter: query.delimiter,
                limit,
                offset,
              },
            )
            return {
              data: res.data.map(mapObject),
              commonPrefixes: res.commonPrefixes,
              meta: { total: res.total, limit, offset },
            }
          }),
      )
      .post(
        '/storage/buckets/:bucketId/objects',
        {
          params: t.Object({ bucketId: BucketId }),
          body: t.Object({
            file: t.File(),
            key: t.Optional(ObjectKey),
            permissions: t.Optional(t.Array(t.String())),
          }),
          response: ObjectResponse,
          detail: { tags: ['storage'] },
        },
        async ({ params, body, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            const file = body.file
            const key = body.key || file.name || `file_${Date.now()}`
            const arrayBuf = await file.arrayBuffer()
            const data = new Uint8Array(arrayBuf)

            set.status = 201
            const object = await service.putObject(
              storageDocuments(session),
              devices,
              auth,
              params.bucketId,
              key,
              {
                data,
                mimeType: file.type || 'application/octet-stream',
                permissions: body.permissions,
              },
            )
            return mapObject(object)
          }),
      )
      .post(
        '/storage/buckets/:bucketId/presign',
        {
          params: t.Object({ bucketId: BucketId }),
          body: PresignBody,
          response: PresignResponse,
          detail: { tags: ['storage'] },
        },
        ({ params, body, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            return await service.presign(
              storageDocuments(session),
              auth,
              params.bucketId,
              body.key,
              body.action,
              body.expiresIn,
            )
          }),
      )

      // ================= Multipart Uploads =================
      .post(
        '/storage/buckets/:bucketId/multipart/initiate',
        {
          params: t.Object({ bucketId: BucketId }),
          body: InitiateMultipartBody,
          detail: { tags: ['storage'] },
        },
        ({ params, body, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            set.status = 201
            return await service.initiateMultipart(
              storageDocuments(session),
              auth,
              params.bucketId,
              body.key,
              body.metadata as Record<string, unknown>,
            )
          }),
      )
      .put(
        '/storage/buckets/:bucketId/multipart/:uploadId',
        {
          params: t.Object({ bucketId: BucketId, uploadId: t.String() }),
          query: t.Object({ partNumber: t.Numeric() }),
          body: t.Object({ chunk: t.File() }),
          detail: { tags: ['storage'] },
        },
        async ({ params, query, body, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            const arrayBuf = await body.chunk.arrayBuffer()
            const data = new Uint8Array(arrayBuf)
            const partNumber = Number(query.partNumber)
            return await service.uploadPart(
              storageDocuments(session),
              devices,
              auth,
              params.bucketId,
              params.uploadId,
              partNumber,
              data,
            )
          }),
      )
      .post(
        '/storage/buckets/:bucketId/multipart/:uploadId/complete',
        {
          params: t.Object({ bucketId: BucketId, uploadId: t.String() }),
          body: CompleteMultipartBody,
          response: ObjectResponse,
          detail: { tags: ['storage'] },
        },
        ({ params, body, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            const doc = await service.completeMultipart(
              storageDocuments(session),
              devices,
              auth,
              params.bucketId,
              params.uploadId,
              body.parts,
            )
            return mapObject(doc)
          }),
      )
      .delete(
        '/storage/buckets/:bucketId/multipart/:uploadId',
        {
          params: t.Object({ bucketId: BucketId, uploadId: t.String() }),
          detail: { tags: ['storage'] },
        },
        ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            await service.abortMultipart(
              storageDocuments(session),
              devices,
              auth,
              params.bucketId,
              params.uploadId,
            )
            set.status = 204
            return ''
          }),
      )

      // ================= Catch-All Wildcard Object Routes =================
      .get(
        '/storage/buckets/:bucketId/objects/*',
        {
          params: t.Object({ bucketId: BucketId, '*': t.String() }),
          detail: { tags: ['storage'] },
        },
        async ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            const key = params['*']
            const range = parseRangeHeader(request.headers.get('range'))
            const res = await service.getObject(
              storageDocuments(session),
              devices,
              auth,
              params.bucketId,
              key,
              range,
            )

            const mimeType =
              (res.object.get(STORAGE_MODEL.fields.objects.mimeType) as string) ||
              'application/octet-stream'
            const etag = (res.object.get(STORAGE_MODEL.fields.objects.etag) as string) || ''
            const headers: Record<string, string> = {
              'Content-Type': mimeType,
              ETag: `"${etag}"`,
              'Accept-Ranges': 'bytes',
            }

            if (res.range) {
              headers['Content-Range'] =
                `bytes ${res.range.start}-${res.range.end}/${res.range.total}`
              headers['Content-Length'] = String(res.data.byteLength)
              return new Response(res.data, { status: 206, headers })
            }

            headers['Content-Length'] = String(res.data.byteLength)
            return new Response(res.data, { status: 200, headers })
          }),
      )
      .head(
        '/storage/buckets/:bucketId/objects/*',
        {
          params: t.Object({ bucketId: BucketId, '*': t.String() }),
          detail: { tags: ['storage'] },
        },
        async ({ params, request }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            const key = params['*']
            const object = await service.headObject(
              storageDocuments(session),
              auth,
              params.bucketId,
              key,
            )
            const mimeType =
              (object.get(STORAGE_MODEL.fields.objects.mimeType) as string) ||
              'application/octet-stream'
            const etag = (object.get(STORAGE_MODEL.fields.objects.etag) as string) || ''
            const size = Number(object.get(STORAGE_MODEL.fields.objects.size, 0))

            return new Response(null, {
              status: 200,
              headers: {
                'Content-Type': mimeType,
                'Content-Length': String(size),
                ETag: `"${etag}"`,
                'Accept-Ranges': 'bytes',
              },
            })
          }),
      )
      .delete(
        '/storage/buckets/:bucketId/objects/*',
        {
          params: t.Object({ bucketId: BucketId, '*': t.String() }),
          detail: { tags: ['storage'] },
        },
        ({ params, request, set }) =>
          requests.withProject(request.headers, async ({ auth, session }) => {
            const key = params['*']
            await service.deleteObject(
              storageDocuments(session),
              devices,
              auth,
              params.bucketId,
              key,
            )
            set.status = 204
            return ''
          }),
      )
  )
}
