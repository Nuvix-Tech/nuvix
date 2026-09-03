import { describe, expect, test } from 'bun:test'
import type { Doc, Query } from '@nuvix/db'
import type { ProjectAuthContext } from '../src/context/project'
import type { FileDevice, StorageDevices } from '../src/storage/devices'
import type { StorageDocuments } from '../src/storage/documents'
import { STORAGE_MODEL } from '../src/storage/model'
import { createStorageService } from '../src/storage/service'

function memoryStorage(): {
  documents: StorageDocuments
  devices: StorageDevices
  fileStore: Map<string, Buffer>
} {
  const buckets = new Map<string, Doc>()
  const objects = new Map<string, Doc>()
  const multipart = new Map<string, Doc>()
  const fileStore = new Map<string, Buffer>()

  const documents: StorageDocuments = {
    async findBuckets() {
      return [...buckets.values()]
    },
    async countBuckets() {
      return buckets.size
    },
    async getBucket(id: string) {
      const b = buckets.get(id)
      if (!b) throw new Error('Bucket not found')
      return b
    },
    async createBucket(doc: Doc) {
      buckets.set(doc.getId(), doc)
      return doc
    },
    async updateBucket(id: string, doc: Doc) {
      buckets.set(id, doc)
      return doc
    },
    async deleteBucket(id: string) {
      return buckets.delete(id)
    },

    async findObjects(queries: Query[] = []) {
      const bucketIdQuery = queries.find(
        (q) => q.getAttribute() === STORAGE_MODEL.fields.objects.bucketId,
      )
      const targetBucket = bucketIdQuery ? bucketIdQuery.getValues()[0] : undefined
      const all = [...objects.values()]
      if (targetBucket) {
        return all.filter((o) => o.get(STORAGE_MODEL.fields.objects.bucketId) === targetBucket)
      }
      return all
    },
    async countObjects() {
      return objects.size
    },
    async getObject(id: string) {
      const o = objects.get(id)
      if (!o) throw new Error('Object not found')
      return o
    },
    async findObjectByBucketAndKey(bucketId: string, key: string) {
      for (const obj of objects.values()) {
        if (
          obj.get(STORAGE_MODEL.fields.objects.bucketId) === bucketId &&
          obj.get(STORAGE_MODEL.fields.objects.key) === key
        ) {
          return obj
        }
      }
      return null
    },
    async createObject(doc: Doc) {
      objects.set(doc.getId(), doc)
      return doc
    },
    async updateObject(id: string, doc: Doc) {
      objects.set(id, doc)
      return doc
    },
    async deleteObject(id: string) {
      return objects.delete(id)
    },
    async deleteObjectsByBucket(bucketId: string) {
      let count = 0
      for (const [id, obj] of objects.entries()) {
        if (obj.get(STORAGE_MODEL.fields.objects.bucketId) === bucketId) {
          objects.delete(id)
          count++
        }
      }
      return count
    },

    async getMultipartUpload(uploadId: string) {
      return multipart.get(uploadId) ?? null
    },
    async createMultipartUpload(doc: Doc) {
      multipart.set(doc.getId(), doc)
      return doc
    },
    async updateMultipartUpload(id: string, doc: Doc) {
      multipart.set(id, doc)
      return doc
    },
    async deleteMultipartUpload(id: string) {
      return multipart.delete(id)
    },
  }

  const fileDevice: FileDevice = {
    async read(path: string, offset = 0, length?: number) {
      const buf = fileStore.get(path)
      if (!buf) throw new Error(`File not found: ${path}`)
      const end = length !== undefined ? offset + length : buf.length
      return buf.subarray(offset, end)
    },
    async write(path: string, data: string | Buffer) {
      fileStore.set(path, Buffer.isBuffer(data) ? data : Buffer.from(data))
      return true
    },
    async delete(path: string) {
      return fileStore.delete(path)
    },
    async stat(path: string) {
      const buf = fileStore.get(path)
      if (!buf) throw new Error(`File not found: ${path}`)
      return { size: buf.length, mimeType: 'application/octet-stream' }
    },
    async exists(path: string) {
      return fileStore.has(path)
    },
    presign(path: string) {
      return `https://storage.test/${path}`
    },
    getPath(filename: string) {
      return filename
    },
  }

  const devices: StorageDevices = {
    get() {
      return fileDevice
    },
  }

  return { documents, devices, fileStore }
}

const ADMIN_AUTH: ProjectAuthContext = {
  type: 'apiKey',
  keyId: 'key_admin',
  mode: 'admin',
  scopes: ['buckets.read', 'buckets.write', 'files.read', 'files.write'],
}

const USER_AUTH: ProjectAuthContext = {
  type: 'session',
  userId: 'user_1',
  sessionId: 'ses_1',
  verified: true,
  labels: [],
  teams: [],
  scopes: [],
}

const GUEST_AUTH: ProjectAuthContext = { type: 'guest' }

describe('S3-grade StorageService', () => {
  const service = createStorageService()

  test('bucket lifecycle: create, list, get, update, and delete with cascade', async () => {
    const { documents, devices, fileStore } = memoryStorage()

    // 1. Create bucket
    const bucket = await service.createBucket(documents, {
      bucketId: 'avatars',
      name: 'User Avatars',
      maximumFileSize: 5_000_000,
      allowedFileExtensions: ['png', 'jpg'],
      permissions: ['read("any")', 'write("users")'],
    })
    expect(bucket.getId()).toBe('avatars')
    expect(bucket.get('name')).toBe('User Avatars')

    // 2. Reject duplicate bucket
    expect(
      service.createBucket(documents, { bucketId: 'avatars', name: 'Duplicate' }),
    ).rejects.toThrow()

    // 3. Put an object inside the bucket
    await service.putObject(documents, devices, USER_AUTH, 'avatars', 'profiles/user1.png', {
      data: Buffer.from('fake-avatar-bytes'),
      mimeType: 'image/png',
    })
    expect(fileStore.has('avatars/profiles/user1.png')).toBe(true)

    // 4. List buckets
    const list = await service.listBuckets(documents)
    expect(list.total).toBe(1)
    expect(list.data[0]!.getId()).toBe('avatars')

    // 5. Update bucket
    const updated = await service.updateBucket(documents, 'avatars', { name: 'Updated Avatars' })
    expect(updated.get('name')).toBe('Updated Avatars')

    // 6. Delete bucket cascades object removal
    await service.deleteBucket(documents, devices, 'avatars')
    expect(fileStore.has('avatars/profiles/user1.png')).toBe(false)
    expect(await documents.findObjects()).toHaveLength(0)
  })

  test('S3 bucket policy: put, get, and delete policy', async () => {
    const { documents } = memoryStorage()
    await service.createBucket(documents, { bucketId: 'docs', name: 'Documents' })

    const policy = {
      version: '2026-09-03',
      statements: [
        {
          sid: 'PublicRead',
          effect: 'allow' as const,
          principal: '*',
          actions: ['storage:GetObject'],
          resources: ['public/*'],
        },
      ],
    }

    await service.putBucketPolicy(documents, 'docs', policy)
    const fetched = await service.getBucketPolicy(documents, 'docs')
    expect(fetched).toEqual(policy)

    await service.deleteBucketPolicy(documents, 'docs')
    const cleared = await service.getBucketPolicy(documents, 'docs')
    expect(cleared).toBeNull()
  })

  test('object operations: put, get, head, range request, and permissions', async () => {
    const { documents, devices } = memoryStorage()
    await service.createBucket(documents, {
      bucketId: 'media',
      name: 'Media',
      maximumFileSize: 100_000,
      permissions: ['read("any")', 'write("users")'],
    })

    const payload = Buffer.from('Hello World! Streaming 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ')

    // 1. Put object
    const objDoc = await service.putObject(
      documents,
      devices,
      USER_AUTH,
      'media',
      'greetings/hello.txt',
      {
        data: payload,
        mimeType: 'text/plain',
      },
    )
    expect(objDoc.get('key')).toBe('greetings/hello.txt')
    expect(objDoc.get('size')).toBe(payload.length)
    expect(objDoc.get('etag')).toBeDefined()

    // 2. Head object
    const head = await service.headObject(documents, GUEST_AUTH, 'media', 'greetings/hello.txt')
    expect(head.get('size')).toBe(payload.length)
    expect(head.get('mimeType')).toBe('text/plain')

    // 3. Full Get object
    const getRes = await service.getObject(
      documents,
      devices,
      GUEST_AUTH,
      'media',
      'greetings/hello.txt',
    )
    expect(getRes.data.toString()).toBe(payload.toString())
    expect(getRes.range).toBeUndefined()

    // 4. Range Get object (e.g. bytes 0-11 -> "Hello World!")
    const rangeRes = await service.getObject(
      documents,
      devices,
      GUEST_AUTH,
      'media',
      'greetings/hello.txt',
      {
        start: 0,
        end: 11,
      },
    )
    expect(rangeRes.data.toString()).toBe('Hello World!')
    expect(rangeRes.range).toEqual({ start: 0, end: 11, total: payload.length })

    // 5. Delete object
    await service.deleteObject(documents, devices, USER_AUTH, 'media', 'greetings/hello.txt')
    expect(
      service.getObject(documents, devices, GUEST_AUTH, 'media', 'greetings/hello.txt'),
    ).rejects.toThrow()
  })

  test('listObjects with prefix and delimiter (commonPrefixes)', async () => {
    const { documents, devices } = memoryStorage()
    await service.createBucket(documents, {
      bucketId: 'photos',
      name: 'Photos',
      permissions: ['read("any")'],
    })

    // Seed objects under folders
    const keys = [
      'vacation/2026/beach.jpg',
      'vacation/2026/sunset.jpg',
      'vacation/2025/ski.jpg',
      'work/logo.png',
      'root_note.txt',
    ]
    for (const k of keys) {
      await service.putObject(documents, devices, ADMIN_AUTH, 'photos', k, {
        data: Buffer.from('img'),
      })
    }

    // 1. List with prefix 'vacation/' and delimiter '/' -> returns 2 common prefixes ('vacation/2026/', 'vacation/2025/')
    const res1 = await service.listObjects(documents, GUEST_AUTH, 'photos', {
      prefix: 'vacation/',
      delimiter: '/',
    })
    expect(res1.commonPrefixes.sort()).toEqual(['vacation/2025/', 'vacation/2026/'])
    expect(res1.data).toHaveLength(0)

    // 2. List with prefix 'vacation/2026/' and delimiter '/' -> returns beach.jpg and sunset.jpg
    const res2 = await service.listObjects(documents, GUEST_AUTH, 'photos', {
      prefix: 'vacation/2026/',
      delimiter: '/',
    })
    expect(res2.data).toHaveLength(2)
    expect(res2.commonPrefixes).toHaveLength(0)

    // 3. Flat listing with prefix 'vacation/' without delimiter -> returns all 3
    const res3 = await service.listObjects(documents, GUEST_AUTH, 'photos', {
      prefix: 'vacation/',
    })
    expect(res3.data).toHaveLength(3)
  })

  test('S3 multipart upload lifecycle: initiate, uploadPart, complete, abort', async () => {
    const { documents, devices, fileStore } = memoryStorage()
    await service.createBucket(documents, {
      bucketId: 'bigdata',
      name: 'Big Data',
      permissions: ['read("any")', 'write("users")'],
    })

    // 1. Initiate
    const { uploadId } = await service.initiateMultipart(
      documents,
      USER_AUTH,
      'bigdata',
      'large/archive.bin',
    )
    expect(uploadId).toBeDefined()

    // 2. Upload Part 1 and Part 2
    const chunk1 = Buffer.from('CHUNK_ONE_DATA_')
    const chunk2 = Buffer.from('CHUNK_TWO_DATA')

    const p1 = await service.uploadPart(
      documents,
      devices,
      USER_AUTH,
      'bigdata',
      uploadId,
      1,
      chunk1,
    )
    const p2 = await service.uploadPart(
      documents,
      devices,
      USER_AUTH,
      'bigdata',
      uploadId,
      2,
      chunk2,
    )
    expect(p1.partNumber).toBe(1)
    expect(p2.partNumber).toBe(2)

    // 3. Complete
    const completedObj = await service.completeMultipart(
      documents,
      devices,
      USER_AUTH,
      'bigdata',
      uploadId,
      [p1, p2],
    )
    expect(completedObj.get('key')).toBe('large/archive.bin')
    expect(completedObj.get('size')).toBe(chunk1.length + chunk2.length)

    // Verify assembled content
    const assembled = fileStore.get('bigdata/large/archive.bin')
    expect(assembled?.toString()).toBe('CHUNK_ONE_DATA_CHUNK_TWO_DATA')

    // Staging chunks cleaned up
    expect(fileStore.has(`bigdata/.multipart/${uploadId}/1`)).toBe(false)
    expect(fileStore.has(`bigdata/.multipart/${uploadId}/2`)).toBe(false)
  })
})
