import { type Doc, Query, type Session } from '@nuvix/db'
import { STORAGE_MODEL } from './model'

export type DocumentSession = Pick<
  Session,
  'find' | 'getDocument' | 'createDocument' | 'updateDocument' | 'deleteDocument' | 'count'
>

export interface StorageDocuments {
  findBuckets(queries?: Query[]): Promise<Doc[]>
  countBuckets(queries?: Query[]): Promise<number>
  getBucket(id: string): Promise<Doc>
  createBucket(doc: Doc): Promise<Doc>
  updateBucket(id: string, doc: Doc): Promise<Doc>
  deleteBucket(id: string): Promise<boolean>

  findObjects(queries?: Query[]): Promise<Doc[]>
  countObjects(queries?: Query[]): Promise<number>
  getObject(id: string): Promise<Doc>
  findObjectByBucketAndKey(bucketId: string, key: string): Promise<Doc | null>
  createObject(doc: Doc): Promise<Doc>
  updateObject(id: string, doc: Doc): Promise<Doc>
  deleteObject(id: string): Promise<boolean>
  deleteObjectsByBucket(bucketId: string): Promise<number>

  getMultipartUpload(uploadId: string): Promise<Doc | null>
  createMultipartUpload(doc: Doc): Promise<Doc>
  updateMultipartUpload(uploadId: string, doc: Doc): Promise<Doc>
  deleteMultipartUpload(uploadId: string): Promise<boolean>
}

export function storageDocuments(session: Session): StorageDocuments {
  const collections = STORAGE_MODEL.collections
  const fields = STORAGE_MODEL.fields

  return Object.freeze({
    findBuckets: (queries?: Query[]) => session.find(collections.buckets, queries),
    countBuckets: (queries?: Query[]) => session.count(collections.buckets, queries),
    getBucket: (id: string) => session.getDocument(collections.buckets, id),
    createBucket: (doc: Doc) => session.createDocument(collections.buckets, doc),
    updateBucket: (id: string, doc: Doc) => session.updateDocument(collections.buckets, id, doc),
    deleteBucket: (id: string) => session.deleteDocument(collections.buckets, id),

    findObjects: (queries?: Query[]) => session.find(collections.objects, queries),
    countObjects: (queries?: Query[]) => session.count(collections.objects, queries),
    getObject: (id: string) => session.getDocument(collections.objects, id),
    findObjectByBucketAndKey: async (bucketId: string, key: string) => {
      const results = await session.find(collections.objects, [
        Query.equal(fields.objects.bucketId, [bucketId]),
        Query.equal(fields.objects.key, [key]),
        Query.limit(1),
      ])
      return results[0] ?? null
    },
    createObject: (doc: Doc) => session.createDocument(collections.objects, doc),
    updateObject: (id: string, doc: Doc) => session.updateDocument(collections.objects, id, doc),
    deleteObject: (id: string) => session.deleteDocument(collections.objects, id),
    deleteObjectsByBucket: async (bucketId: string) => {
      const objects = await session.find(collections.objects, [
        Query.equal(fields.objects.bucketId, [bucketId]),
      ])
      for (const obj of objects) {
        await session.deleteDocument(collections.objects, obj.getId())
      }
      return objects.length
    },

    getMultipartUpload: async (uploadId: string) => {
      try {
        const doc = await session.getDocument(collections.multipartUploads, uploadId)
        return doc.getId() ? doc : null
      } catch {
        return null
      }
    },
    createMultipartUpload: (doc: Doc) => session.createDocument(collections.multipartUploads, doc),
    updateMultipartUpload: (id: string, doc: Doc) =>
      session.updateDocument(collections.multipartUploads, id, doc),
    deleteMultipartUpload: (id: string) => session.deleteDocument(collections.multipartUploads, id),
  })
}
