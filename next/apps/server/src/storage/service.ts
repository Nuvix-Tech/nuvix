import crypto from 'node:crypto'
import { Doc, Query } from '@nuvix/db'
import type { ProjectAuthContext } from '../context/project'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../shared/errors'
import type { StorageDevices } from './devices'
import type { StorageDocuments } from './documents'
import { STORAGE_MODEL } from './model'
import { type BucketPolicy, evaluateStorageAccess, STORAGE_ACTIONS } from './policy'

export interface CreateBucketInput {
  readonly bucketId?: string
  readonly name: string
  readonly permissions?: readonly string[]
  readonly fileSecurity?: boolean
  readonly enabled?: boolean
  readonly maximumFileSize?: number
  readonly allowedFileExtensions?: readonly string[]
  readonly compression?: string
  readonly encryption?: boolean
  readonly antivirus?: boolean
}

export interface UpdateBucketInput {
  readonly name?: string
  readonly permissions?: readonly string[]
  readonly fileSecurity?: boolean
  readonly enabled?: boolean
  readonly maximumFileSize?: number
  readonly allowedFileExtensions?: readonly string[]
  readonly compression?: string
  readonly encryption?: boolean
  readonly antivirus?: boolean
}

export interface PutObjectInput {
  readonly data: Uint8Array | Buffer
  readonly mimeType?: string
  readonly permissions?: readonly string[]
  readonly metadata?: Record<string, unknown>
}

export interface RangeOption {
  readonly start?: number
  readonly end?: number
}

export interface StorageService {
  createBucket(documents: StorageDocuments, input: CreateBucketInput): Promise<Doc>
  listBuckets(
    documents: StorageDocuments,
    options?: { limit?: number; offset?: number },
  ): Promise<{ data: Doc[]; total: number }>
  getBucket(documents: StorageDocuments, bucketId: string): Promise<Doc>
  updateBucket(
    documents: StorageDocuments,
    bucketId: string,
    input: UpdateBucketInput,
  ): Promise<Doc>
  deleteBucket(
    documents: StorageDocuments,
    devices: StorageDevices,
    bucketId: string,
  ): Promise<void>
  getBucketPolicy(documents: StorageDocuments, bucketId: string): Promise<BucketPolicy | null>
  putBucketPolicy(
    documents: StorageDocuments,
    bucketId: string,
    policy: BucketPolicy,
  ): Promise<void>
  deleteBucketPolicy(documents: StorageDocuments, bucketId: string): Promise<void>

  putObject(
    documents: StorageDocuments,
    devices: StorageDevices,
    auth: ProjectAuthContext,
    bucketId: string,
    key: string,
    input: PutObjectInput,
  ): Promise<Doc>

  getObject(
    documents: StorageDocuments,
    devices: StorageDevices,
    auth: ProjectAuthContext,
    bucketId: string,
    key: string,
    range?: RangeOption,
    action?: 'preview' | 'view' | 'download',
    query?: {
      width?: number
      height?: number
      quality?: number
      format?: 'jpg' | 'jpeg' | 'png' | 'webp'
      gravity?: string
    },
  ): Promise<{
    object: Doc
    data: Buffer
    range?: { start: number; end: number; total: number }
  }>

  headObject(
    documents: StorageDocuments,
    auth: ProjectAuthContext,
    bucketId: string,
    key: string,
  ): Promise<Doc>

  listObjects(
    documents: StorageDocuments,
    auth: ProjectAuthContext,
    bucketId: string,
    options?: { prefix?: string; delimiter?: string; limit?: number; offset?: number },
  ): Promise<{ data: Doc[]; commonPrefixes: string[]; total: number }>

  deleteObject(
    documents: StorageDocuments,
    devices: StorageDevices,
    auth: ProjectAuthContext,
    bucketId: string,
    key: string,
  ): Promise<void>

  presign(
    documents: StorageDocuments,
    auth: ProjectAuthContext,
    bucketId: string,
    key: string,
    action: 'getObject' | 'putObject',
    expiresIn?: number,
  ): Promise<{ url: string; expiresAt: string }>

  initiateMultipart(
    documents: StorageDocuments,
    auth: ProjectAuthContext,
    bucketId: string,
    key: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ uploadId: string; expiresAt: string }>

  uploadPart(
    documents: StorageDocuments,
    devices: StorageDevices,
    auth: ProjectAuthContext,
    bucketId: string,
    uploadId: string,
    partNumber: number,
    data: Uint8Array | Buffer,
  ): Promise<{ partNumber: number; etag: string }>

  completeMultipart(
    documents: StorageDocuments,
    devices: StorageDevices,
    auth: ProjectAuthContext,
    bucketId: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<Doc>

  abortMultipart(
    documents: StorageDocuments,
    devices: StorageDevices,
    auth: ProjectAuthContext,
    bucketId: string,
    uploadId: string,
  ): Promise<void>
}

function computeEtag(data: Uint8Array | Buffer): string {
  return crypto.createHash('md5').update(data).digest('hex')
}

function normalizeKey(rawKey: string): string {
  return rawKey.replace(/^\/+/, '').replace(/\/\/+/g, '/')
}

function getFileExtension(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? parts[parts.length - 1]!.toLowerCase() : ''
}

export function createStorageService(
  options: { createId?: () => string; now?: () => Date } = {},
): StorageService {
  const createId = options.createId ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date())
  const fields = STORAGE_MODEL.fields

  return {
    async createBucket(documents, input) {
      const bucketId = input.bucketId && input.bucketId !== 'unique()' ? input.bucketId : createId()

      try {
        const existing = await documents.getBucket(bucketId)
        if (existing.getId()) {
          throw new ConflictError('Bucket already exists', { code: 'bucket_already_exists' })
        }
      } catch (error) {
        if (error instanceof ConflictError) throw error
        // Not found is expected
      }

      const doc = new Doc({
        $id: bucketId,
        [fields.buckets.name]: input.name,
        [fields.buckets.permissions]: input.permissions ?? [],
        [fields.buckets.fileSecurity]: input.fileSecurity ?? true,
        [fields.buckets.enabled]: input.enabled ?? true,
        [fields.buckets.maximumFileSize]: input.maximumFileSize ?? 26214400,
        [fields.buckets.allowedFileExtensions]: input.allowedFileExtensions ?? [],
        [fields.buckets.compression]: input.compression ?? 'none',
        [fields.buckets.encryption]: input.encryption ?? true,
        [fields.buckets.antivirus]: input.antivirus ?? false,
        [fields.buckets.policy]: {},
        [fields.buckets.cors]: [],
        $createdAt: now().toISOString(),
        $updatedAt: now().toISOString(),
        $permissions: input.permissions ?? [],
      })

      return await documents.createBucket(doc)
    },

    async listBuckets(documents, pagination = {}) {
      const limit = Math.min(Math.max(pagination.limit ?? 25, 1), 100)
      const offset = Math.max(pagination.offset ?? 0, 0)
      const queries = [Query.limit(limit), Query.offset(offset)]
      const [data, total] = await Promise.all([
        documents.findBuckets(queries),
        documents.countBuckets(),
      ])
      return { data, total }
    },

    async getBucket(documents, bucketId) {
      try {
        const bucket = await documents.getBucket(bucketId)
        if (!bucket.getId()) {
          throw new NotFoundError('Bucket not found', { code: 'bucket_not_found' })
        }
        return bucket
      } catch {
        throw new NotFoundError('Bucket not found', { code: 'bucket_not_found' })
      }
    },

    async updateBucket(documents, bucketId, input) {
      const bucket = await this.getBucket(documents, bucketId)

      if (input.name !== undefined) bucket.set(fields.buckets.name, input.name)
      if (input.permissions !== undefined) {
        bucket.set(fields.buckets.permissions, input.permissions)
        bucket.set('$permissions', input.permissions)
      }
      if (input.fileSecurity !== undefined)
        bucket.set(fields.buckets.fileSecurity, input.fileSecurity)
      if (input.enabled !== undefined) bucket.set(fields.buckets.enabled, input.enabled)
      if (input.maximumFileSize !== undefined)
        bucket.set(fields.buckets.maximumFileSize, input.maximumFileSize)
      if (input.allowedFileExtensions !== undefined) {
        bucket.set(fields.buckets.allowedFileExtensions, input.allowedFileExtensions)
      }
      if (input.compression !== undefined) bucket.set(fields.buckets.compression, input.compression)
      if (input.encryption !== undefined) bucket.set(fields.buckets.encryption, input.encryption)
      if (input.antivirus !== undefined) bucket.set(fields.buckets.antivirus, input.antivirus)
      bucket.set('$updatedAt', now().toISOString())

      return await documents.updateBucket(bucketId, bucket)
    },

    async deleteBucket(documents, devices, bucketId) {
      await this.getBucket(documents, bucketId)
      // Cascade delete files from storage device
      const objects = await documents.findObjects([
        Query.equal(fields.objects.bucketId, [bucketId]),
      ])
      const device = devices.get()
      for (const obj of objects) {
        const key = obj.get(fields.objects.key)
        if (key) {
          await device.delete(`${bucketId}/${key}`).catch(() => false)
        }
      }
      await documents.deleteObjectsByBucket(bucketId)
      await documents.deleteBucket(bucketId)
    },

    async getBucketPolicy(documents, bucketId) {
      const bucket = await this.getBucket(documents, bucketId)
      const policy = bucket.get(fields.buckets.policy)
      return (policy && Object.keys(policy).length > 0 ? policy : null) as BucketPolicy | null
    },

    async putBucketPolicy(documents, bucketId, policy) {
      const bucket = await this.getBucket(documents, bucketId)
      bucket.set(fields.buckets.policy, policy)
      bucket.set('$updatedAt', now().toISOString())
      await documents.updateBucket(bucketId, bucket)
    },

    async deleteBucketPolicy(documents, bucketId) {
      const bucket = await this.getBucket(documents, bucketId)
      bucket.set(fields.buckets.policy, {})
      bucket.set('$updatedAt', now().toISOString())
      await documents.updateBucket(bucketId, bucket)
    },

    async putObject(documents, devices, auth, bucketId, rawKey, input) {
      const key = normalizeKey(rawKey)
      if (!key) throw new BadRequestError('Object key is required', { code: 'invalid_key' })

      const bucket = await this.getBucket(documents, bucketId)
      if (!bucket.get(fields.buckets.enabled, true)) {
        throw new BadRequestError('Bucket is disabled', { code: 'bucket_disabled' })
      }

      const policy = bucket.get(fields.buckets.policy) as BucketPolicy | undefined
      const bucketPerms = bucket.get(fields.buckets.permissions, []) as string[]

      const decision = evaluateStorageAccess({
        auth,
        action: STORAGE_ACTIONS.put,
        resourceKey: key,
        policy,
        bucketPermissions: bucketPerms,
      })
      if (decision === 'deny') {
        throw new ForbiddenError('Access denied by storage policy or permissions', {
          code: 'access_denied',
        })
      }

      const size = input.data.byteLength
      const maxSize = Number(bucket.get(fields.buckets.maximumFileSize, 26214400))
      if (size > maxSize) {
        throw new BadRequestError(`File size ${size} exceeds maximum ${maxSize} bytes`, {
          code: 'file_size_exceeded',
        })
      }

      const allowedExts = bucket.get(fields.buckets.allowedFileExtensions, []) as string[]
      if (allowedExts.length > 0) {
        const ext = getFileExtension(key)
        if (!allowedExts.includes(ext)) {
          throw new BadRequestError(`File extension .${ext} is not allowed`, {
            code: 'file_extension_not_allowed',
          })
        }
      }

      const etag = computeEtag(input.data)
      const mimeType = input.mimeType || 'application/octet-stream'
      const devicePath = `${bucketId}/${key}`
      const device = devices.get()
      await device.write(devicePath, Buffer.from(input.data), mimeType)

      const existing = await documents.findObjectByBucketAndKey(bucketId, key)
      const userId = auth.type === 'session' || auth.type === 'jwt' ? auth.userId : undefined
      const permissions =
        input.permissions ??
        (bucketPerms.length > 0
          ? bucketPerms
          : userId
            ? [`read("user:${userId}")`, `write("user:${userId}")`]
            : ['read("any")'])

      if (existing) {
        existing.set(fields.objects.size, size)
        existing.set(fields.objects.mimeType, mimeType)
        existing.set(fields.objects.etag, etag)
        existing.set(fields.objects.metadata, input.metadata ?? {})
        existing.set(fields.objects.permissions, permissions)
        existing.set('$permissions', permissions)
        existing.set('$updatedAt', now().toISOString())
        return await documents.updateObject(existing.getId(), existing)
      }

      const newDoc = new Doc({
        $id: createId(),
        [fields.objects.bucketId]: bucketId,
        [fields.objects.key]: key,
        [fields.objects.size]: size,
        [fields.objects.mimeType]: mimeType,
        [fields.objects.etag]: etag,
        [fields.objects.metadata]: input.metadata ?? {},
        [fields.objects.permissions]: permissions,
        $permissions: permissions,
        $createdAt: now().toISOString(),
        $updatedAt: now().toISOString(),
      })

      return await documents.createObject(newDoc)
    },

    async getObject(documents, devices, auth, bucketId, rawKey, range, action, query) {
      const key = normalizeKey(rawKey)
      const bucket = await this.getBucket(documents, bucketId)
      const object = await documents.findObjectByBucketAndKey(bucketId, key)
      if (!object) {
        throw new NotFoundError('Object not found', { code: 'object_not_found' })
      }

      const policy = bucket.get(fields.buckets.policy) as BucketPolicy | undefined
      const objectPerms = object.get(fields.objects.permissions, []) as string[]
      const bucketPerms = bucket.get(fields.buckets.permissions, []) as string[]

      const decision = evaluateStorageAccess({
        auth,
        action: STORAGE_ACTIONS.get,
        resourceKey: key,
        policy,
        objectPermissions: objectPerms,
        bucketPermissions: bucketPerms,
      })
      if (decision === 'deny') {
        throw new ForbiddenError('Access denied by storage policy or permissions', {
          code: 'access_denied',
        })
      }

      const devicePath = `${bucketId}/${key}`
      const device = devices.get()
      const totalSize = Number(object.get(fields.objects.size, 0))

      if (range && (range.start !== undefined || range.end !== undefined) && action !== 'preview') {
        const start = Math.max(range.start ?? 0, 0)
        const end = Math.min(range.end ?? totalSize - 1, totalSize - 1)
        const length = Math.max(end - start + 1, 0)
        const data = await device.read(devicePath, start, length)
        return { object, data, range: { start, end, total: totalSize } }
      }

      let data = await device.read(devicePath)

      if (action === 'preview') {
        try {
          let img = new Bun.Image(data)
          if (query?.width || query?.height) {
            // Check bun-types signature; if only width is provided, height can be undefined? No, we supply both or 0?
            // Wait, we can supply (width, height) and undefined is fine? Wait, img.resize() does not take undefined.
            if (query.width && query.height) {
              img = img.resize(query.width, query.height)
            } else if (query.width) {
              img = img.resize(query.width, query.width)
            } else if (query.height) {
              img = img.resize(query.height, query.height)
            }
          }
          if (query?.format) {
            const q = query.quality ?? 80
            if (query.format === 'jpg' || query.format === 'jpeg') {
              img = img.jpeg({ quality: q })
              object.set(fields.objects.mimeType, 'image/jpeg')
            } else if (query.format === 'webp') {
              img = img.webp({ quality: q })
              object.set(fields.objects.mimeType, 'image/webp')
            } else if (query.format === 'png') {
              img = img.png()
              object.set(fields.objects.mimeType, 'image/png')
            }
          }
          data = await img.toBuffer()
        } catch (_e) {
          // If image processing fails, fallback to returning original data
        }
      }

      return { object, data }
    },

    async headObject(documents, auth, bucketId, rawKey) {
      const key = normalizeKey(rawKey)
      const bucket = await this.getBucket(documents, bucketId)
      const object = await documents.findObjectByBucketAndKey(bucketId, key)
      if (!object) {
        throw new NotFoundError('Object not found', { code: 'object_not_found' })
      }

      const policy = bucket.get(fields.buckets.policy) as BucketPolicy | undefined
      const objectPerms = object.get(fields.objects.permissions, []) as string[]
      const bucketPerms = bucket.get(fields.buckets.permissions, []) as string[]

      const decision = evaluateStorageAccess({
        auth,
        action: STORAGE_ACTIONS.get,
        resourceKey: key,
        policy,
        objectPermissions: objectPerms,
        bucketPermissions: bucketPerms,
      })
      if (decision === 'deny') {
        throw new ForbiddenError('Access denied by storage policy or permissions', {
          code: 'access_denied',
        })
      }

      return object
    },

    async listObjects(documents, auth, bucketId, options = {}) {
      const bucket = await this.getBucket(documents, bucketId)
      const policy = bucket.get(fields.buckets.policy) as BucketPolicy | undefined
      const bucketPerms = bucket.get(fields.buckets.permissions, []) as string[]

      const decision = evaluateStorageAccess({
        auth,
        action: STORAGE_ACTIONS.list,
        resourceKey: options.prefix ?? '',
        policy,
        bucketPermissions: bucketPerms,
      })
      if (decision === 'deny') {
        throw new ForbiddenError('Access denied by storage policy', { code: 'access_denied' })
      }

      const limit = Math.min(Math.max(options.limit ?? 25, 1), 100)
      const offset = Math.max(options.offset ?? 0, 0)
      const queries = [Query.equal(fields.objects.bucketId, [bucketId])]

      const allObjects = await documents.findObjects(queries)
      const prefix = options.prefix ?? ''
      const delimiter = options.delimiter

      let filtered = allObjects
      if (prefix) {
        filtered = filtered.filter((obj) =>
          (obj.get(fields.objects.key) as string)?.startsWith(prefix),
        )
      }

      const commonPrefixesSet = new Set<string>()
      const resultObjects: Doc[] = []

      if (delimiter) {
        for (const obj of filtered) {
          const k = obj.get(fields.objects.key) as string
          const remainder = prefix ? k.slice(prefix.length) : k
          const delimIndex = remainder.indexOf(delimiter)
          if (delimIndex !== -1) {
            const commonPrefix = (prefix ? prefix : '') + remainder.slice(0, delimIndex + 1)
            commonPrefixesSet.add(commonPrefix)
          } else {
            resultObjects.push(obj)
          }
        }
      } else {
        resultObjects.push(...filtered)
      }

      const total = resultObjects.length
      const paginated = resultObjects.slice(offset, offset + limit)
      return {
        data: paginated,
        commonPrefixes: [...commonPrefixesSet],
        total,
      }
    },

    async deleteObject(documents, devices, auth, bucketId, rawKey) {
      const key = normalizeKey(rawKey)
      const bucket = await this.getBucket(documents, bucketId)
      const object = await documents.findObjectByBucketAndKey(bucketId, key)
      if (!object) {
        throw new NotFoundError('Object not found', { code: 'object_not_found' })
      }

      const policy = bucket.get(fields.buckets.policy) as BucketPolicy | undefined
      const objectPerms = object.get(fields.objects.permissions, []) as string[]
      const bucketPerms = bucket.get(fields.buckets.permissions, []) as string[]

      const decision = evaluateStorageAccess({
        auth,
        action: STORAGE_ACTIONS.delete,
        resourceKey: key,
        policy,
        objectPermissions: objectPerms,
        bucketPermissions: bucketPerms,
      })
      if (decision === 'deny') {
        throw new ForbiddenError('Access denied by storage policy or permissions', {
          code: 'access_denied',
        })
      }

      const devicePath = `${bucketId}/${key}`
      const device = devices.get()
      await device.delete(devicePath).catch(() => false)
      await documents.deleteObject(object.getId())
    },

    async presign(documents, auth, bucketId, rawKey, action, expiresIn = 900) {
      const key = normalizeKey(rawKey)
      await this.getBucket(documents, bucketId)
      const expDate = new Date(now().getTime() + expiresIn * 1000)
      const userId = auth.type === 'session' || auth.type === 'jwt' ? auth.userId : 'guest'
      const tokenPayload = {
        sub: userId,
        bucketId,
        key,
        action,
        exp: Math.floor(expDate.getTime() / 1000),
      }
      const token = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url')
      const url = `/v2/storage/buckets/${bucketId}/objects/${key}?token=${token}`
      return { url, expiresAt: expDate.toISOString() }
    },

    async initiateMultipart(documents, auth, bucketId, rawKey, metadata = {}) {
      const key = normalizeKey(rawKey)
      const bucket = await this.getBucket(documents, bucketId)
      const policy = bucket.get(fields.buckets.policy) as BucketPolicy | undefined
      const bucketPerms = bucket.get(fields.buckets.permissions, []) as string[]

      const decision = evaluateStorageAccess({
        auth,
        action: STORAGE_ACTIONS.put,
        resourceKey: key,
        policy,
        bucketPermissions: bucketPerms,
      })
      if (decision === 'deny') {
        throw new ForbiddenError('Access denied by storage policy', { code: 'access_denied' })
      }

      const uploadId = createId()
      const expiresAt = new Date(now().getTime() + 86400 * 1000).toISOString() // 24 hours

      const doc = new Doc({
        $id: uploadId,
        [fields.multipartUploads.bucketId]: bucketId,
        [fields.multipartUploads.key]: key,
        [fields.multipartUploads.parts]: [],
        [fields.multipartUploads.expiresAt]: expiresAt,
        metadata,
      })

      await documents.createMultipartUpload(doc)
      return { uploadId, expiresAt }
    },

    async uploadPart(documents, devices, _auth, bucketId, uploadId, partNumber, data) {
      const upload = await documents.getMultipartUpload(uploadId)
      if (!upload || upload.get(fields.multipartUploads.bucketId) !== bucketId) {
        throw new NotFoundError('Multipart upload not found', { code: 'upload_not_found' })
      }

      const etag = computeEtag(data)
      const partPath = `${bucketId}/.multipart/${uploadId}/${partNumber}`
      const device = devices.get()
      await device.write(partPath, Buffer.from(data), 'application/octet-stream')

      const existingParts = (upload.get(fields.multipartUploads.parts) || []) as Array<{
        partNumber: number
        size: number
        etag: string
      }>
      const filteredParts = existingParts.filter((p) => p.partNumber !== partNumber)
      filteredParts.push({ partNumber, size: data.byteLength, etag })
      filteredParts.sort((a, b) => a.partNumber - b.partNumber)

      upload.set(fields.multipartUploads.parts, filteredParts)
      await documents.updateMultipartUpload(uploadId, upload)

      return { partNumber, etag }
    },

    async completeMultipart(documents, devices, auth, bucketId, uploadId, parts) {
      const upload = await documents.getMultipartUpload(uploadId)
      if (!upload || upload.get(fields.multipartUploads.bucketId) !== bucketId) {
        throw new NotFoundError('Multipart upload not found', { code: 'upload_not_found' })
      }

      const key = upload.get(fields.multipartUploads.key) as string
      const storedParts = (upload.get(fields.multipartUploads.parts) || []) as Array<{
        partNumber: number
        size: number
        etag: string
      }>

      // Verify all requested parts were uploaded and ETags match
      const buffers: Buffer[] = []
      const device = devices.get()

      for (const clientPart of parts) {
        const stored = storedParts.find((p) => p.partNumber === clientPart.partNumber)
        if (!stored || stored.etag !== clientPart.etag) {
          throw new BadRequestError(`Invalid part ${clientPart.partNumber}`, {
            code: 'invalid_part',
          })
        }
        const partPath = `${bucketId}/.multipart/${uploadId}/${clientPart.partNumber}`
        const chunk = await device.read(partPath)
        buffers.push(chunk)
      }

      // Assemble all parts into the target object
      const assembled = Buffer.concat(buffers)
      const resultDoc = await this.putObject(documents, devices, auth, bucketId, key, {
        data: assembled,
        metadata: (upload.get('metadata') || {}) as Record<string, unknown>,
      })

      // Cleanup staged parts & upload doc
      for (const p of storedParts) {
        await device.delete(`${bucketId}/.multipart/${uploadId}/${p.partNumber}`).catch(() => false)
      }
      await documents.deleteMultipartUpload(uploadId)

      return resultDoc
    },

    async abortMultipart(documents, devices, _auth, bucketId, uploadId) {
      const upload = await documents.getMultipartUpload(uploadId)
      if (!upload || upload.get(fields.multipartUploads.bucketId) !== bucketId) {
        throw new NotFoundError('Multipart upload not found', { code: 'upload_not_found' })
      }

      const storedParts = (upload.get(fields.multipartUploads.parts) || []) as Array<{
        partNumber: number
      }>
      const device = devices.get()
      for (const p of storedParts) {
        await device.delete(`${bucketId}/.multipart/${uploadId}/${p.partNumber}`).catch(() => false)
      }
      await documents.deleteMultipartUpload(uploadId)
    },
  }
}
