import { describe, expect, test } from 'bun:test'
import type { Doc, Query, Session } from '@nuvix/db'
import { Elysia } from 'elysia'
import type { ProjectAuthContext } from '../src/context/project'
import type { DatabaseRequestCapabilities } from '../src/infrastructure/database-composition'
import { problemErrors } from '../src/plugins/errors'
import type { FileDevice, StorageDevices } from '../src/storage/devices'
import type { StorageDocuments } from '../src/storage/documents'
import { storageRoutes } from '../src/storage/route'
import { createStorageService, type StorageService } from '../src/storage/service'

function createTestHarness(auth: ProjectAuthContext) {
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

    async findObjects() {
      return [...objects.values()]
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
        if (obj.get('bucketId') === bucketId && obj.get('key') === key) {
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
        if (obj.get('bucketId') === bucketId) {
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

  const session = {
    find: async (col: string, queries: readonly Query[] = []) => {
      if (col === 'buckets') return [...buckets.values()]
      if (col === 'objects') {
        const bucketQuery = queries.find((q) => q?.getAttribute?.() === 'bucketId')
        const target = bucketQuery?.getValues?.()?.[0]
        const all = [...objects.values()]
        return target ? all.filter((o) => o.get('bucketId') === target) : all
      }
      return []
    },
    count: async (col: string) => {
      if (col === 'buckets') return buckets.size
      if (col === 'objects') return objects.size
      return 0
    },
    getDocument: async (col: string, id: string) => {
      const map = col === 'buckets' ? buckets : col === 'objects' ? objects : multipart
      const doc = map.get(id)
      if (!doc) throw new Error(`${col} ${id} not found`)
      return doc
    },
    createDocument: async (col: string, doc: Doc) => {
      const map = col === 'buckets' ? buckets : col === 'objects' ? objects : multipart
      map.set(doc.getId(), doc)
      return doc
    },
    updateDocument: async (col: string, id: string, doc: Doc) => {
      const map = col === 'buckets' ? buckets : col === 'objects' ? objects : multipart
      map.set(id, doc)
      return doc
    },
    deleteDocument: async (col: string, id: string) => {
      const map = col === 'buckets' ? buckets : col === 'objects' ? objects : multipart
      return map.delete(id)
    },
  } as unknown as Session

  const requests: DatabaseRequestCapabilities = {
    withProject: async (_headers, operation) =>
      await operation({
        project: { id: 'project_test', enabled: true },
        auth,
        session,
        schemas: {} as never,
        account: {} as never,
      }),
  }

  const service: StorageService = createStorageService()

  const app = new Elysia({ prefix: '/v2' })
    .use(problemErrors({ getTranslator: () => ({ t: (k: string) => k }) as never }))
    .use(storageRoutes(requests, service, devices))

  return { app, documents, devices, fileStore }
}

const WRITE_AUTH: ProjectAuthContext = {
  type: 'apiKey',
  keyId: 'key_write',
  mode: 'admin',
  scopes: ['buckets.read', 'buckets.write', 'files.read', 'files.write'],
}

const GUEST_AUTH: ProjectAuthContext = { type: 'guest' }

describe('Storage Routes', () => {
  test('bucket lifecycle via HTTP', async () => {
    const { app, documents } = createTestHarness(WRITE_AUTH)

    // 1. Create bucket
    const createRes = await app.handle(
      new Request('http://localhost/v2/storage/buckets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bucketId: 'assets',
          name: 'Assets Bucket',
          permissions: ['read("any")'],
        }),
      }),
    )
    expect(createRes.status).toBe(201)
    const bucketData = (await createRes.json()) as { $id: string; name: string }
    expect(bucketData.$id).toBe('assets')
    expect(bucketData.name).toBe('Assets Bucket')

    // 2. Reject unprivileged create
    const { app: guestApp } = createTestHarness(GUEST_AUTH)
    const guestRes = await guestApp.handle(
      new Request('http://localhost/v2/storage/buckets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bucketId: 'b2', name: 'Bucket 2' }),
      }),
    )
    expect(guestRes.status).toBe(403)

    // 3. Get bucket
    const getRes = await app.handle(new Request('http://localhost/v2/storage/buckets/assets'))
    expect(getRes.status).toBe(200)

    // 4. Update bucket
    const updateRes = await app.handle(
      new Request('http://localhost/v2/storage/buckets/assets', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Assets' }),
      }),
    )
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as { name: string }
    expect(updated.name).toBe('Renamed Assets')

    // 5. Delete bucket
    const deleteRes = await app.handle(
      new Request('http://localhost/v2/storage/buckets/assets', {
        method: 'DELETE',
      }),
    )
    expect(deleteRes.status).toBe(204)
    expect(await documents.findBuckets()).toHaveLength(0)
  })

  test('S3 bucket policy endpoints', async () => {
    const { app } = createTestHarness(WRITE_AUTH)
    await app.handle(
      new Request('http://localhost/v2/storage/buckets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bucketId: 'public-bucket', name: 'Public' }),
      }),
    )

    const policy = {
      version: '2026-09-03',
      statements: [
        {
          sid: 'PublicGet',
          effect: 'allow',
          principal: '*',
          actions: ['storage:GetObject'],
          resources: ['images/*'],
        },
      ],
    }

    // PUT policy
    const putPolicy = await app.handle(
      new Request('http://localhost/v2/storage/buckets/public-bucket/policy', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(policy),
      }),
    )
    expect(putPolicy.status).toBe(200)

    // GET policy
    const getPolicy = await app.handle(
      new Request('http://localhost/v2/storage/buckets/public-bucket/policy'),
    )
    expect(getPolicy.status).toBe(200)
    const fetchedPolicy = await getPolicy.json()
    expect(fetchedPolicy).toEqual(policy)

    // DELETE policy
    const delPolicy = await app.handle(
      new Request('http://localhost/v2/storage/buckets/public-bucket/policy', {
        method: 'DELETE',
      }),
    )
    expect(delPolicy.status).toBe(204)
  })

  test('object upload, wildcard catch-all download, and Range requests', async () => {
    const { app } = createTestHarness(WRITE_AUTH)
    await app.handle(
      new Request('http://localhost/v2/storage/buckets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bucketId: 'media', name: 'Media', permissions: ['read("any")'] }),
      }),
    )

    // 1. Upload object via Multipart Form
    const formData = new FormData()
    const fileContent = 'Hello Video Stream World 1234567890'
    const blob = new Blob([fileContent], { type: 'text/plain' })
    formData.append('file', blob, 'video.mp4')
    formData.append('key', 'movies/sci-fi/video.mp4')

    const uploadRes = await app.handle(
      new Request('http://localhost/v2/storage/buckets/media/objects', {
        method: 'POST',
        body: formData,
      }),
    )
    expect(uploadRes.status).toBe(201)
    const obj = (await uploadRes.json()) as { key: string; size: number }
    expect(obj.key).toBe('movies/sci-fi/video.mp4')
    expect(obj.size).toBe(fileContent.length)

    // 2. Full download via catch-all wildcard
    const downloadRes = await app.handle(
      new Request('http://localhost/v2/storage/buckets/media/objects/movies/sci-fi/video.mp4'),
    )
    expect(downloadRes.status).toBe(200)
    expect(await downloadRes.text()).toBe(fileContent)
    expect(downloadRes.headers.get('content-type')).toBe('video/mp4')
    expect(downloadRes.headers.get('accept-ranges')).toBe('bytes')

    // 3. Partial download via HTTP Range header (bytes 0-10 -> "Hello Video")
    const rangeRes = await app.handle(
      new Request('http://localhost/v2/storage/buckets/media/objects/movies/sci-fi/video.mp4', {
        headers: { range: 'bytes=0-10' },
      }),
    )
    expect(rangeRes.status).toBe(206)
    expect(rangeRes.headers.get('content-range')).toBe(`bytes 0-10/${fileContent.length}`)
    expect(await rangeRes.text()).toBe('Hello Video')

    // 4. HEAD request via catch-all wildcard
    const headRes = await app.handle(
      new Request('http://localhost/v2/storage/buckets/media/objects/movies/sci-fi/video.mp4', {
        method: 'HEAD',
      }),
    )
    expect(headRes.status).toBe(200)
    expect(headRes.headers.get('content-length')).toBe(String(fileContent.length))

    // 5. DELETE object via catch-all wildcard
    const delRes = await app.handle(
      new Request('http://localhost/v2/storage/buckets/media/objects/movies/sci-fi/video.mp4', {
        method: 'DELETE',
      }),
    )
    expect(delRes.status).toBe(204)
  })

  test('presign URL generation', async () => {
    const { app } = createTestHarness(WRITE_AUTH)
    await app.handle(
      new Request('http://localhost/v2/storage/buckets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bucketId: 'secure', name: 'Secure' }),
      }),
    )

    const presignRes = await app.handle(
      new Request('http://localhost/v2/storage/buckets/secure/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'documents/contract.pdf',
          action: 'getObject',
          expiresIn: 3600,
        }),
      }),
    )
    expect(presignRes.status).toBe(200)
    const presignData = (await presignRes.json()) as { url: string; expiresAt: string }
    expect(presignData.url).toStartWith(
      '/v2/storage/buckets/secure/objects/documents/contract.pdf?token=',
    )
    expect(presignData.expiresAt).toBeDefined()
  })
})
