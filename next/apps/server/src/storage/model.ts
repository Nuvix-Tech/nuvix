export interface StorageModel {
  readonly collections: {
    readonly buckets: string
    readonly objects: string
    readonly multipartUploads: string
  }
  readonly fields: {
    readonly buckets: {
      readonly name: string
      readonly permissions: string
      readonly fileSecurity: string
      readonly enabled: string
      readonly maximumFileSize: string
      readonly allowedFileExtensions: string
      readonly compression: string
      readonly encryption: string
      readonly antivirus: string
      readonly policy: string
      readonly cors: string
    }
    readonly objects: {
      readonly bucketId: string
      readonly key: string
      readonly size: string
      readonly mimeType: string
      readonly etag: string
      readonly metadata: string
      readonly permissions: string
    }
    readonly multipartUploads: {
      readonly bucketId: string
      readonly key: string
      readonly parts: string
      readonly expiresAt: string
    }
  }
}

export const STORAGE_MODEL = {
  collections: {
    buckets: 'buckets',
    objects: 'objects',
    multipartUploads: 'multipart_uploads',
  },
  fields: {
    buckets: {
      name: 'name',
      permissions: 'permissions',
      fileSecurity: 'fileSecurity',
      enabled: 'enabled',
      maximumFileSize: 'maximumFileSize',
      allowedFileExtensions: 'allowedFileExtensions',
      compression: 'compression',
      encryption: 'encryption',
      antivirus: 'antivirus',
      policy: 'policy',
      cors: 'cors',
    },
    objects: {
      bucketId: 'bucketId',
      key: 'key',
      size: 'size',
      mimeType: 'mimeType',
      etag: 'etag',
      metadata: 'metadata',
      permissions: 'permissions',
    },
    multipartUploads: {
      bucketId: 'bucketId',
      key: 'key',
      parts: 'parts',
      expiresAt: 'expiresAt',
    },
  },
} as const satisfies StorageModel
