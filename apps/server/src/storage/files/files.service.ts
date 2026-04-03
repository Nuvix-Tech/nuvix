import * as fs from 'node:fs/promises'
import path from 'node:path'
import { type SavedMultipartFile } from '@fastify/multipart'
import { Injectable, StreamableFile } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { JwtService } from '@nestjs/jwt'
import { CoreService } from '@nuvix/core'
import { logos } from '@nuvix/core/config'
import { Exception } from '@nuvix/core/extend/exception'
import { RequestContext } from '@nuvix/core/helpers'
import {
  Authorization,
  Database,
  Doc,
  ID,
  KeyValidator,
  Permission,
  PermissionType,
  Query,
  Role,
} from '@nuvix/db'
import { Device, FileExt, FileSize } from '@nuvix/storage'
import { AppEvents, configuration } from '@nuvix/utils'
import type { Files, FilesDoc } from '@nuvix/utils/types'
import {
  CreateFileDTO,
  PreviewFileQueryDTO,
  UpdateFileDTO,
} from './DTO/file.dto'

@Injectable()
export class FilesService {
  private sharpModule?: typeof import('sharp')
  private readonly db: Database
  private readonly deviceForFiles: Device

  constructor(
    private readonly coreService: CoreService,
    private readonly jwtService: JwtService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.db = this.coreService.getDatabase()
    this.deviceForFiles = this.coreService.getStorageDevice()
  }

  private async getSharp() {
    if (!this.sharpModule) {
      this.sharpModule = await import('sharp')
        .then(({ default: _default }) => _default)
        .catch(() => {
          throw new Exception(
            Exception.GENERAL_SERVER_ERROR,
            'Image processing library not available',
          )
        })
    }
    return this.sharpModule
  }

  private getCollectionName(s: number) {
    return `bucket_${s}`
  }

  /**
   * Get files.
   */
  async getFiles(
    bucketId: string,
    ctx: RequestContext,
    queries: Query[] = [],
    search?: string,
  ) {
    const bucket = await Authorization.skip(() =>
      this.db.getDocument('buckets', bucketId),
    )

    if (
      bucket.empty() ||
      (!bucket.get('enabled') && !ctx.isAPIUser && !ctx.isAdminUser)
    ) {
      throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
    }

    const fileSecurity = bucket.get('fileSecurity', false)
    const validator = new Authorization(PermissionType.Read)
    const valid = validator.$valid(bucket.getRead())
    if (!fileSecurity && !valid) {
      throw new Exception(Exception.USER_UNAUTHORIZED)
    }

    if (search) {
      queries.push(Query.search('search', search))
    }

    const filterQueries = Query.groupByType(queries).filters
    const files = (await this.db.find(
      this.getCollectionName(bucket.getSequence()),
      queries,
    )) as FilesDoc[]

    const total = await this.db.count(
      this.getCollectionName(bucket.getSequence()),
      filterQueries,
      configuration.limits.limitCount,
    )

    return {
      data: files,
      total,
    }
  }

  /**
   * Create|Upload file.
   * Supports single-request uploads and resumable chunked uploads via Content-Range.
   *
   * Chunked upload flow:
   * 1. First chunk creates the file document with upload metadata.
   * 2. Subsequent chunks are validated against the existing document for consistency.
   * 3. Final chunk triggers file finalization (hash, write, metadata update).
   *
   * Headers for chunked uploads:
   * - Content-Range: bytes <start>-<end>/<totalSize>
   * - x-nuvix-id: <fileId> (required for chunks after the first)
   */
  async createFile(
    bucketId: string,
    input: CreateFileDTO,
    file: SavedMultipartFile,
    request: NuvixRequest,
    user: Doc,
  ) {
    const ctx = request.context
    const bucket = await Authorization.skip(() =>
      this.db.getDocument('buckets', bucketId),
    )

    if (
      bucket.empty() ||
      (!bucket.get('enabled') && !ctx.isAPIUser && !ctx.isAdminUser)
    ) {
      throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
    }

    const validator = new Authorization(PermissionType.Create)
    if (!validator.$valid(bucket.getCreate())) {
      throw new Exception(Exception.USER_UNAUTHORIZED)
    }

    const allowedPermissions = [
      PermissionType.Read,
      PermissionType.Update,
      PermissionType.Delete,
    ]

    let permissions = Permission.aggregate(
      input.permissions ?? [],
      allowedPermissions,
    )

    const roles = Authorization.getRoles()
    if (!permissions || permissions.length === 0) {
      permissions = user.getId()
        ? allowedPermissions.map(permission =>
            new Permission(permission, Role.user(user.getId())).toString(),
          )
        : []
    }

    if (!ctx.isAPIUser && !ctx.isAdminUser) {
      permissions.forEach(permission => {
        const parsedPermission = Permission.parse(permission)
        if (!Authorization.isRole(parsedPermission.role.toString())) {
          throw new Exception(
            Exception.USER_UNAUTHORIZED,
            `Permissions must be one of: (${roles.join(', ')})`,
          )
        }
      })
    }

    const maximumFileSize = Math.min(
      bucket.get('maximumFileSize', configuration.storage.limit),
      configuration.storage.limit,
    )
    if (maximumFileSize > configuration.storage.limit) {
      throw new Exception(
        Exception.GENERAL_SERVER_ERROR,
        'Maximum bucket file size exceeds APP_STORAGE_LIMIT',
      )
    }

    if (!file) {
      throw new Exception(Exception.STORAGE_FILE_EMPTY)
    }

    const fileName = file.filename
    const stats = await fs.stat(file.filepath)
    const fileSize = stats.size
    const fileExt = fileName.split('.').pop()?.toLowerCase() ?? ''
    const contentRange = request.headers['content-range'] as string | undefined

    if (!fileSize || fileSize <= 0) {
      throw new Exception(Exception.STORAGE_FILE_EMPTY, 'File size is zero.')
    }

    let fileId = input.fileId === 'unique()' ? ID.unique() : input.fileId
    let chunk = 1
    let chunks = 1
    let chunkSize = 0
    let rangeStart = 0
    let rangeEnd = 0
    let finalFileSize = fileSize
    let isChunkedUpload = false

    if (contentRange) {
      isChunkedUpload = true
      const contentRangeTrimmed = contentRange.trim()
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRangeTrimmed)
      if (!match) {
        throw new Exception(
          Exception.STORAGE_INVALID_CONTENT_RANGE,
          'Invalid Content-Range header format. Expected: bytes <start>-<end>/<total>',
        )
      }

      const [, startStr, endStr, sizeStr] = match
      rangeStart = Number(startStr)
      rangeEnd = Number(endStr)
      const totalSize = Number(sizeStr)

      // Validate parsed numbers are finite integers
      if (
        !Number.isFinite(rangeStart) ||
        !Number.isFinite(rangeEnd) ||
        !Number.isFinite(totalSize) ||
        !Number.isInteger(rangeStart) ||
        !Number.isInteger(rangeEnd) ||
        !Number.isInteger(totalSize)
      ) {
        throw new Exception(
          Exception.STORAGE_INVALID_CONTENT_RANGE,
          'Content-Range values must be valid integers',
        )
      }

      // Validate range boundaries
      if (rangeStart < 0) {
        throw new Exception(
          Exception.STORAGE_INVALID_CONTENT_RANGE,
          'Range start must be non-negative',
        )
      }

      if (rangeEnd < rangeStart) {
        throw new Exception(
          Exception.STORAGE_INVALID_CONTENT_RANGE,
          'Range end must be greater than or equal to range start',
        )
      }

      if (rangeEnd >= totalSize) {
        throw new Exception(
          Exception.STORAGE_INVALID_CONTENT_RANGE,
          'Range end must be less than total size',
        )
      }

      if (totalSize <= 0) {
        throw new Exception(
          Exception.STORAGE_INVALID_CONTENT_RANGE,
          'Total size must be positive',
        )
      }

      // Resolve file ID from header for subsequent chunks
      const headerFileId = request.headers['x-nuvix-id']
      if (headerFileId) {
        fileId = (
          Array.isArray(headerFileId) ? headerFileId[0] : headerFileId
        ) as string
        if (!new KeyValidator().$valid(fileId)) {
          throw new Exception(
            Exception.INVALID_PARAMS,
            'Invalid file ID format in x-nuvix-id header',
          )
        }
      }

      chunkSize = rangeEnd - rangeStart + 1

      // Validate that the actual uploaded file size matches the declared range
      if (fileSize !== chunkSize) {
        throw new Exception(
          Exception.STORAGE_INVALID_CONTENT_RANGE,
          `Uploaded chunk size (${fileSize}) does not match Content-Range declaration (${chunkSize})`,
        )
      }

      const isLastChunk = rangeEnd + 1 === totalSize

      if (isLastChunk && rangeStart > 0 && totalSize % chunkSize !== 0) {
        // This is the last chunk and its size differs from the regular chunk size.
        // We cannot reliably derive the standard chunk size, chunk count, or chunk
        // index from the remainder chunk alone. Set chunk = -1 to signal that
        // these values should be resolved from the existing file document
        // (which was created by the first chunk).
        chunk = -1
        chunks = -1
      } else {
        // Calculate chunk index and total chunks based on chunk size
        chunks = Math.ceil(totalSize / chunkSize)
        chunk = Math.floor(rangeStart / chunkSize) + 1

        // Validate chunk alignment (start should be a multiple of chunkSize)
        const expectedStart = (chunk - 1) * chunkSize
        if (rangeStart !== expectedStart) {
          throw new Exception(
            Exception.STORAGE_INVALID_CONTENT_RANGE,
            `Chunk is not aligned. Expected start offset ${expectedStart} but got ${rangeStart}`,
          )
        }

        // For the last chunk, validate the expected remainder size
        if (chunk === chunks) {
          const expectedLastChunkSize = totalSize - expectedStart
          if (chunkSize !== expectedLastChunkSize) {
            throw new Exception(
              Exception.STORAGE_INVALID_CONTENT_RANGE,
              `Last chunk size mismatch. Expected ${expectedLastChunkSize} but got ${chunkSize}`,
            )
          }
        }
      }

      finalFileSize = totalSize
    }

    // Validate file extension
    const allowedFileExtensions = bucket.get('allowedFileExtensions', [])
    const fileExtValidator = new FileExt(allowedFileExtensions)
    if (allowedFileExtensions.length && !fileExtValidator.isValid(fileName)) {
      throw new Exception(
        Exception.STORAGE_FILE_TYPE_UNSUPPORTED,
        'File extension not allowed',
      )
    }

    // Validate total file size against bucket limit
    const fileSizeValidator = new FileSize(maximumFileSize)
    if (!fileSizeValidator.isValid(finalFileSize)) {
      throw new Exception(
        Exception.STORAGE_INVALID_FILE_SIZE,
        `File size (${finalFileSize} bytes) exceeds the bucket limit (${maximumFileSize} bytes)`,
      )
    }

    const _path = this.deviceForFiles.getPath(
      path.join(bucket.getId(), `${fileId}.${fileExt}`),
    )

    let fileDocument: FilesDoc
    let metadata: Record<string, any> = {
      content_type: file.mimetype,
      ...(isChunkedUpload && {
        chunked: true,
        chunkSize,
        uploadStartedAt: Date.now(),
      }),
    }
    let chunksUploaded = 0

    // Fetch existing document for resumable uploads
    fileDocument = await this.db.getDocument<Files>(
      this.getCollectionName(bucket.getSequence()),
      fileId,
    )

    if (!fileDocument.empty()) {
      const existingChunksTotal = fileDocument.get('chunksTotal', 1)
      chunksUploaded = fileDocument.get('chunksUploaded', 0)
      metadata = fileDocument.get('metadata', {})
      const existingSizeOriginal = fileDocument.get('sizeOriginal', 0)

      // Validate consistency for resumable uploads
      if (isChunkedUpload) {
        // Ensure total file size matches the original declaration
        if (existingSizeOriginal !== finalFileSize) {
          throw new Exception(
            Exception.STORAGE_INVALID_CONTENT_RANGE,
            `Total file size mismatch. Existing document declares ${existingSizeOriginal} bytes but this chunk declares ${finalFileSize} bytes`,
          )
        }

        // Ensure chunk count is consistent
        if (chunks !== -1 && existingChunksTotal !== chunks) {
          throw new Exception(
            Exception.STORAGE_INVALID_CONTENT_RANGE,
            `Chunk count mismatch. Existing document has ${existingChunksTotal} chunks but calculated ${chunks} from Content-Range`,
          )
        }

        // Ensure chunk size is consistent with initial upload
        const existingChunkSize = metadata.chunkSize
        if (
          existingChunkSize &&
          chunk !== chunks &&
          chunkSize !== existingChunkSize
        ) {
          throw new Exception(
            Exception.STORAGE_INVALID_CONTENT_RANGE,
            `Chunk size mismatch. Expected ${existingChunkSize} bytes per chunk but got ${chunkSize}`,
          )
        }
      }

      chunks = existingChunksTotal

      if (chunk === -1) {
        chunk = existingChunksTotal
      }

      // Validate consistency for resumable uploads (after chunk resolution)
      if (isChunkedUpload) {
        // Validate the chunk hasn't already been uploaded (duplicate detection)
        const uploadedChunks: number[] = metadata.uploadedChunks ?? []
        if (uploadedChunks.includes(chunk)) {
          throw new Exception(
            Exception.STORAGE_FILE_ALREADY_EXISTS,
            `Chunk ${chunk} has already been uploaded`,
          )
        }
      }

      if (chunksUploaded === existingChunksTotal) {
        throw new Exception(Exception.STORAGE_FILE_ALREADY_EXISTS)
      }
    } else if (isChunkedUpload && chunk !== 1) {
      // If this is a chunked upload but not the first chunk and no document exists,
      // the upload session may have expired or never started.
      // chunk = -1 means this was identified as the last chunk (smaller remainder)
      // and requires an existing document to resolve chunk metadata.
      throw new Exception(
        Exception.STORAGE_FILE_NOT_FOUND,
        'Upload session not found. The first chunk must be uploaded before subsequent chunks.',
      )
    }

    // Perform the actual upload
    try {
      chunksUploaded = await this.deviceForFiles.upload(
        file.filepath,
        _path,
        chunk,
        chunks,
        metadata,
      )
    } catch (error) {
      // Clean up temp file on upload failure
      try {
        await fs.unlink(file.filepath).catch(() => {})
      } catch {
        // Ignore cleanup errors
      }
      throw new Exception(
        Exception.GENERAL_SERVER_ERROR,
        `Failed uploading chunk ${chunk}/${chunks}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }

    if (!chunksUploaded) {
      throw new Exception(
        Exception.GENERAL_SERVER_ERROR,
        'Failed uploading file: device returned zero chunks uploaded',
      )
    }

    // Track uploaded chunk indices in metadata for duplicate detection
    if (isChunkedUpload) {
      const uploadedChunks: number[] = metadata.uploadedChunks ?? []
      if (!uploadedChunks.includes(chunk)) {
        uploadedChunks.push(chunk)
        uploadedChunks.sort((a, b) => a - b)
      }
      metadata.uploadedChunks = uploadedChunks
      metadata.lastChunkUploadedAt = Date.now()
    }

    if (chunksUploaded === chunks) {
      // === All chunks uploaded — finalize the file ===
      const fileHash = await this.deviceForFiles.getFileHash(_path)
      const mimeType = file.mimetype

      const data = await this.deviceForFiles.read(_path)
      if (data) {
        if (!(await this.deviceForFiles.write(_path, data, mimeType))) {
          throw new Exception(
            Exception.GENERAL_SERVER_ERROR,
            'Failed to save file',
          )
        }
      }

      // Compute actual size on disk after assembly
      let sizeActual: number
      try {
        const finalStats = await fs.stat(
          this.deviceForFiles.getPath(
            path.join(bucket.getId(), `${fileId}.${fileExt}`),
          ),
        )
        sizeActual = finalStats.size
      } catch {
        sizeActual = fileSize
      }

      // Clean up upload tracking metadata from the final document
      const finalMetadata: Record<string, any> = {
        content_type: mimeType,
        completedAt: Date.now(),
        ...(isChunkedUpload && {
          chunked: true,
          chunkSize: metadata.chunkSize,
          uploadStartedAt: metadata.uploadStartedAt,
        }),
      }

      // Create or update file document
      if (fileDocument.empty()) {
        fileDocument = (await this.db.createDocument<Files, string>(
          this.getCollectionName(bucket.getSequence()),
          Doc.from<Files>({
            $id: fileId,
            $permissions: permissions,
            bucketId: bucket.getId(),
            bucketInternalId: bucket.getSequence(),
            name: fileName,
            path: _path,
            signature: fileHash,
            mimeType,
            sizeOriginal: finalFileSize,
            sizeActual,
            chunksTotal: chunks,
            chunksUploaded,
            search: [fileId, fileName].join(' '),
            metadata: finalMetadata,
          }),
        )) as FilesDoc

        this.eventEmitter.emit(AppEvents.FILES_CREATE, {
          bucketId: bucket.getId(),
          fileId: fileDocument.getId(),
          payload: {
            data: fileDocument,
          },
        })
      } else {
        fileDocument = fileDocument
          .set('$permissions', permissions)
          .set('signature', fileHash)
          .set('mimeType', mimeType)
          .set('sizeActual', sizeActual)
          .set('metadata', finalMetadata)
          .set('chunksUploaded', chunksUploaded)

        const updateValidator = new Authorization(PermissionType.Update)
        if (!updateValidator.$valid(bucket.getUpdate())) {
          throw new Exception(Exception.USER_UNAUTHORIZED)
        }

        fileDocument = await this.db.updateDocument<FilesDoc>(
          this.getCollectionName(bucket.getSequence()),
          fileId,
          fileDocument,
        )

        this.eventEmitter.emit(AppEvents.FILES_CREATE, {
          bucketId: bucket.getId(),
          fileId: fileDocument.getId(),
          payload: {
            data: fileDocument,
          },
        })
      }
    } else if (fileDocument.empty()) {
      // === First chunk of a new chunked upload ===
      fileDocument = await this.db.createDocument<Files, string>(
        this.getCollectionName(bucket.getSequence()),
        Doc.from<Files>({
          $id: fileId,
          $permissions: permissions,
          bucketId: bucket.getId(),
          bucketInternalId: bucket.getSequence(),
          name: fileName,
          path: _path,
          signature: '',
          mimeType: '',
          sizeOriginal: finalFileSize,
          sizeActual: 0,
          chunksTotal: chunks,
          chunksUploaded,
          search: [fileId, fileName].join(' '),
          metadata,
        }),
      )
    } else {
      // === Intermediate chunk of an existing chunked upload ===
      fileDocument = await this.db.updateDocument<FilesDoc>(
        this.getCollectionName(bucket.getSequence()),
        fileId,
        fileDocument
          .set('chunksUploaded', chunksUploaded)
          .set('metadata', metadata),
      )
    }

    return fileDocument
  }

  /**
   * Get a File.
   */
  async getFile(bucketId: string, fileId: string, ctx: RequestContext) {
    const bucket = await Authorization.skip(() =>
      this.db.getDocument('buckets', bucketId),
    )

    if (
      bucket.empty() ||
      (!bucket.get('enabled') && !ctx.isAPIUser && !ctx.isAdminUser)
    ) {
      throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
    }

    const fileSecurity = bucket.get('fileSecurity', false)
    const validator = new Authorization(PermissionType.Read)

    const valid = validator.$valid(bucket.getRead())
    if (!fileSecurity && !valid) {
      throw new Exception(Exception.USER_UNAUTHORIZED)
    }

    const file = (
      fileSecurity && !valid
        ? await this.db.getDocument(
            this.getCollectionName(bucket.getSequence()),
            fileId,
          )
        : await Authorization.skip(() =>
            this.db.getDocument(
              this.getCollectionName(bucket.getSequence()),
              fileId,
            ),
          )
    ) as FilesDoc

    if (file.empty()) {
      throw new Exception(Exception.STORAGE_FILE_NOT_FOUND)
    }

    return file
  }

  /**
   * Preview a file.
   * @todo optimize image processing for large images
   */
  async previewFile(
    bucketId: string,
    fileId: string,
    params: PreviewFileQueryDTO,
    ctx: RequestContext,
  ) {
    const {
      width,
      height,
      gravity,
      quality,
      borderWidth,
      borderColor,
      borderRadius,
      opacity,
      rotation,
      background,
      output,
    } = params
    const bucket = await Authorization.skip(
      async () => await this.db.getDocument('buckets', bucketId),
    )

    if (
      bucket.empty() ||
      (!bucket.get('enabled') && !ctx.isAPIUser && !ctx.isAdminUser)
    ) {
      throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
    }

    const fileSecurity = bucket.get('fileSecurity', false)
    const validator = new Authorization(PermissionType.Read)
    const valid = validator.$valid(bucket.getRead())
    if (!fileSecurity && !valid) {
      throw new Exception(Exception.USER_UNAUTHORIZED)
    }

    const file =
      fileSecurity && !valid
        ? await this.db.getDocument(
            this.getCollectionName(bucket.getSequence()),
            fileId,
          )
        : await Authorization.skip(
            async () =>
              await this.db.getDocument(
                this.getCollectionName(bucket.getSequence()),
                fileId,
              ),
          )

    if (file.empty()) {
      throw new Exception(Exception.STORAGE_FILE_NOT_FOUND)
    }

    const path = file.get('path', '')

    try {
      await this.deviceForFiles.exists(path)
    } catch {
      throw new Exception(
        Exception.STORAGE_FILE_NOT_FOUND,
        `File not found in ${path}`,
      )
    }

    const mimeType = file.get('mimeType')
    const fileName = file.get('name', '')
    const size = file.get('sizeOriginal', 0)

    // Unsupported file types or files larger then 10 MB
    if (!mimeType.startsWith('image/') || size / 1024 > 10 * 1024) {
      const path = logos[mimeType as keyof typeof logos] ?? logos.default
      const buffer = await this.deviceForFiles.read(path)
      return new StreamableFile(buffer, {
        type: 'image/png',
        disposition: `inline; filename="${fileName}"`,
        length: buffer.length,
      })
    }

    const fileBuffer = await this.deviceForFiles.read(path)
    const sharp = await this.getSharp()
    let image = sharp(fileBuffer)

    if (width || height) {
      image = image.resize(width, height, {
        fit: sharp.fit.cover,
        position: gravity,
      })
    }

    if (borderWidth) {
      image = image.extend({
        top: borderWidth,
        bottom: borderWidth,
        left: borderWidth,
        right: borderWidth,
        background: borderColor,
      })
    }

    if (borderRadius) {
      const metadata = await image.metadata()
      const imageWidth = width || metadata.width || 0
      const imageHeight = height || metadata.height || 0

      image = image.composite([
        {
          input: Buffer.from(
            `<svg><rect x="0" y="0" width="${imageWidth}" height="${imageHeight}" rx="${borderRadius}" ry="${borderRadius}"/></svg>`,
          ),
          blend: 'dest-in',
        },
      ])
    }

    if (opacity !== undefined) {
      const metadata = await image.metadata()
      const imageWidth = width || metadata.width || 0
      const imageHeight = height || metadata.height || 0

      image = image.composite([
        {
          input: Buffer.from(
            `<svg><rect x="0" y="0" width="${imageWidth}" height="${imageHeight}" fill="rgba(255, 255, 255, ${opacity})"/></svg>`,
          ),
          blend: 'dest-in',
        },
      ])
    }

    if (rotation) {
      image = image.rotate(rotation)
    }

    if (background) {
      image = image.flatten({ background })
    }

    const outputFormat = output || mimeType.split('/')[1]
    const buffer = await image.toFormat(outputFormat, { quality }).toBuffer()

    return new StreamableFile(buffer, {
      type: `image/${outputFormat}`,
      disposition: `inline; filename="${fileName}"`,
      length: buffer.length,
    })
  }

  /**
   * Download a file.
   */
  async downloadFile(
    bucketId: string,
    fileId: string,
    response: NuvixRes,
    request: NuvixRequest,
  ) {
    const ctx = request.context
    const bucket = await Authorization.skip(() =>
      this.db.getDocument('buckets', bucketId),
    )

    if (
      bucket.empty() ||
      (!bucket.get('enabled') && !ctx.isAPIUser && !ctx.isAdminUser)
    ) {
      throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
    }

    const fileSecurity = bucket.get('fileSecurity', false)
    const validator = new Authorization(PermissionType.Read)
    const valid = validator.$valid(bucket.getRead())
    if (!fileSecurity && !valid) {
      throw new Exception(Exception.USER_UNAUTHORIZED)
    }

    const file =
      fileSecurity && !valid
        ? await this.db.getDocument(
            this.getCollectionName(bucket.getSequence()),
            fileId,
          )
        : await Authorization.skip(() =>
            this.db.getDocument(
              this.getCollectionName(bucket.getSequence()),
              fileId,
            ),
          )

    if (file.empty()) {
      throw new Exception(Exception.STORAGE_FILE_NOT_FOUND)
    }

    const path = file.get('path', '')

    try {
      await this.deviceForFiles.exists(path)
    } catch {
      throw new Exception(
        Exception.STORAGE_FILE_NOT_FOUND,
        `File not found in ${path}`,
      )
    }

    const mimeType = file.get('mimeType')
    const fileName = file.get('name', '')
    const size = file.get('sizeOriginal', 0)

    const rangeHeader = request.headers.range
    let start = 0
    let end = size - 1

    if (rangeHeader) {
      const [unit, range] = rangeHeader.split('=') as [string, string]
      if (unit !== 'bytes') {
        throw new Exception(Exception.STORAGE_INVALID_RANGE)
      }

      const [rangeStart, rangeEnd] = range.split('-').map(Number) as [
        number,
        number,
      ]
      start = rangeStart
      end = rangeEnd || end

      if (start >= end || end >= size) {
        throw new Exception(Exception.STORAGE_INVALID_RANGE)
      }

      response.header('Accept-Ranges', 'bytes')
      response.header('Content-Range', `bytes ${start}-${end}/${size}`)
      response.header('Content-Length', end - start + 1)
      response.status(206)
    } else {
      response.header('Content-Length', size)
    }

    response.header('Content-Type', mimeType)
    response.header('Content-Disposition', `attachment; filename="${fileName}"`)
    response.header(
      'Expires',
      new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toUTCString(),
    )

    if (rangeHeader) {
      const source = await this.deviceForFiles.read(path)
      const buffer = source.subarray(start, end + 1)
      return new StreamableFile(buffer, {
        type: mimeType,
        disposition: `attachment; filename="${fileName}"`,
        length: buffer.length,
      })
    }

    if (size > configuration.storage.readBuffer) {
      const totalChunks = Math.ceil(
        size / configuration.storage.maxOutputChunkSize,
      )
      const chunks: Buffer[] = []

      for (let i = 0; i < totalChunks; i++) {
        const offset = i * configuration.storage.maxOutputChunkSize
        const chunkSize = Math.min(
          configuration.storage.maxOutputChunkSize,
          size - offset,
        )
        const chunkData = await this.deviceForFiles.read(
          path,
          offset,
          chunkSize,
        )
        chunks.push(chunkData)
      }

      const buffer = Buffer.concat(chunks)
      return new StreamableFile(buffer, {
        type: mimeType,
        disposition: `attachment; filename="${fileName}"`,
        length: buffer.length,
      })
    }
    const buffer = await this.deviceForFiles.read(path)
    return new StreamableFile(buffer, {
      type: mimeType,
      disposition: `attachment; filename="${fileName}"`,
      length: buffer.length,
    })
  }

  /**
   * View a file.
   */
  async viewFile(
    bucketId: string,
    fileId: string,
    response: NuvixRes,
    request: NuvixRequest,
  ) {
    const ctx = request.context
    const bucket = await Authorization.skip(() =>
      this.db.getDocument('buckets', bucketId),
    )

    if (
      bucket.empty() ||
      (!bucket.get('enabled') && !ctx.isAPIUser && !ctx.isAdminUser)
    ) {
      throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
    }

    const fileSecurity = bucket.get('fileSecurity', false)
    const validator = new Authorization(PermissionType.Read)
    const valid = validator.$valid(bucket.getRead())
    if (!fileSecurity && !valid) {
      throw new Exception(Exception.USER_UNAUTHORIZED)
    }

    const file =
      fileSecurity && !valid
        ? await this.db.getDocument(
            this.getCollectionName(bucket.getSequence()),
            fileId,
          )
        : await Authorization.skip(() =>
            this.db.getDocument(
              this.getCollectionName(bucket.getSequence()),
              fileId,
            ),
          )

    if (file.empty()) {
      throw new Exception(Exception.STORAGE_FILE_NOT_FOUND)
    }

    const path = file.get('path', '')

    try {
      await this.deviceForFiles.exists(path)
    } catch {
      throw new Exception(
        Exception.STORAGE_FILE_NOT_FOUND,
        `File not found in ${path}`,
      )
    }

    const mimeType = file.get('mimeType')
    const fileName = file.get('name', '')
    const size = file.get('sizeOriginal', 0)

    const rangeHeader = request.headers.range
    let start = 0
    let end = size - 1

    if (rangeHeader) {
      const [unit, range] = rangeHeader.split('=') as [string, string]
      if (unit !== 'bytes') {
        throw new Exception(Exception.STORAGE_INVALID_RANGE)
      }

      const [rangeStart, rangeEnd] = range.split('-').map(Number) as [
        number,
        number,
      ]
      start = rangeStart
      end = rangeEnd || end

      if (start >= end || end >= size) {
        throw new Exception(Exception.STORAGE_INVALID_RANGE)
      }

      response.header('Accept-Ranges', 'bytes')
      response.header('Content-Range', `bytes ${start}-${end}/${size}`)
      response.header('Content-Length', end - start + 1)
      response.status(206)
    } else {
      response.header('Content-Length', size)
    }

    response.header('Content-Type', mimeType)
    response.header('Content-Disposition', `inline; filename="${fileName}"`)
    response.header(
      'Expires',
      new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toUTCString(),
    )

    if (rangeHeader) {
      const source = await this.deviceForFiles.read(path)
      const buffer = source.subarray(start, end + 1)
      return new StreamableFile(buffer, {
        type: mimeType,
        disposition: `attachment; filename="${fileName}"`,
        length: buffer.length,
      })
    }

    if (size > configuration.storage.readBuffer) {
      const totalChunks = Math.ceil(
        size / configuration.storage.maxOutputChunkSize,
      )
      const chunks: Buffer[] = []

      for (let i = 0; i < totalChunks; i++) {
        const offset = i * configuration.storage.maxOutputChunkSize
        const chunkSize = Math.min(
          configuration.storage.maxOutputChunkSize,
          size - offset,
        )
        const chunkData = await this.deviceForFiles.read(
          path,
          offset,
          chunkSize,
        )
        chunks.push(chunkData)
      }

      const buffer = Buffer.concat(chunks)
      return new StreamableFile(buffer, {
        type: mimeType,
        disposition: `attachment; filename="${fileName}"`,
        length: buffer.length,
      })
    }
    const buffer = await this.deviceForFiles.read(path)
    return new StreamableFile(buffer, {
      type: mimeType,
      disposition: `attachment; filename="${fileName}"`,
      length: buffer.length,
    })
  }

  /**
   * Get file for push notification
   */
  async getFileForPushNotification(
    bucketId: string,
    fileId: string,
    jwt: string,
    request: NuvixRequest,
    response: NuvixRes,
  ) {
    const ctx = request.context
    const bucket = await Authorization.skip(() =>
      this.db.getDocument('buckets', bucketId),
    )

    let decoded: Record<string, unknown>
    try {
      decoded = this.jwtService.verify(jwt)
    } catch (_error) {
      throw new Exception(Exception.USER_UNAUTHORIZED)
    }

    if (
      decoded.projectId !== bucket.get('projectId') ||
      decoded.bucketId !== bucketId ||
      decoded.fileId !== fileId
    ) {
      throw new Exception(Exception.USER_UNAUTHORIZED)
    }

    if (
      bucket.empty() ||
      (!bucket.get('enabled') && !ctx.isAPIUser && !ctx.isAdminUser)
    ) {
      throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
    }

    const file = await Authorization.skip(() =>
      this.db.getDocument(this.getCollectionName(bucket.getSequence()), fileId),
    )

    if (file.empty()) {
      throw new Exception(Exception.STORAGE_FILE_NOT_FOUND)
    }

    const path = file.get('path', '')

    try {
      await this.deviceForFiles.exists(path)
    } catch {
      throw new Exception(
        Exception.STORAGE_FILE_NOT_FOUND,
        `File not found in ${path}`,
      )
    }

    const mimeType = file.get('mimeType', 'text/plain')
    const fileName = file.get('name', '')
    const size = file.get('sizeOriginal', 0)

    response.header('Content-Type', mimeType)
    response.header('Content-Disposition', `inline; filename="${fileName}"`)
    response.header(
      'Expires',
      new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toUTCString(),
    )
    response.header('X-Peak', process.memoryUsage().heapUsed.toString())

    const rangeHeader = request.headers.range
    if (rangeHeader) {
      const [unit, range] = rangeHeader.split('=') as [string, string]
      if (unit !== 'bytes') {
        throw new Exception(Exception.STORAGE_INVALID_RANGE)
      }

      const [start, end] = range.split('-').map(Number) as [number, number]
      const finalEnd = end || size - 1

      if (start >= finalEnd || finalEnd >= size) {
        throw new Exception(Exception.STORAGE_INVALID_RANGE)
      }

      response.header('Accept-Ranges', 'bytes')
      response.header('Content-Range', `bytes ${start}-${finalEnd}/${size}`)
      response.header('Content-Length', finalEnd - start + 1)
      response.status(206)

      const source = await this.deviceForFiles.read(path)
      const buffer = source.subarray(start, end + 1)
      return new StreamableFile(buffer, {
        type: mimeType,
        disposition: `attachment; filename="${fileName}"`,
        length: buffer.length,
      })
    }

    response.header('Content-Length', size)
    const buffer = await this.deviceForFiles.read(path)
    return new StreamableFile(buffer, {
      type: mimeType,
      disposition: `attachment; filename="${fileName}"`,
      length: buffer.length,
    })
  }

  /**
   * Update a file.
   */
  async updateFile(
    bucketId: string,
    fileId: string,
    input: UpdateFileDTO,
    ctx: RequestContext,
  ) {
    const bucket = await Authorization.skip(() =>
      this.db.getDocument('buckets', bucketId),
    )

    if (
      bucket.empty() ||
      (!bucket.get('enabled') && !ctx.isAPIUser && !ctx.isAdminUser)
    ) {
      throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
    }

    const fileSecurity = bucket.get('fileSecurity', false)
    const validator = new Authorization(PermissionType.Update)
    const valid = validator.$valid(bucket.getUpdate())
    if (!fileSecurity && !valid) {
      throw new Exception(Exception.USER_UNAUTHORIZED)
    }

    const file = (await Authorization.skip(() =>
      this.db.getDocument(this.getCollectionName(bucket.getSequence()), fileId),
    )) as FilesDoc

    if (file.empty()) {
      throw new Exception(Exception.STORAGE_FILE_NOT_FOUND)
    }

    let permissions = Permission.aggregate(input.permissions ?? [], [
      PermissionType.Read,
      PermissionType.Update,
      PermissionType.Delete,
    ])

    const roles = Authorization.getRoles()
    if (!ctx.isAPIUser && !ctx.isAdminUser && permissions) {
      permissions.forEach(permission => {
        const parsedPermission = Permission.parse(permission)
        if (!Authorization.isRole(parsedPermission.toString())) {
          throw new Exception(
            Exception.USER_UNAUTHORIZED,
            `Permissions must be one of: (${roles.join(', ')})`,
          )
        }
      })
    }

    if (!permissions) {
      permissions = file.getPermissions() ?? []
    }

    file.set('$permissions', permissions)

    if (input.name) {
      file.set('name', input.name)
    }

    if (fileSecurity && !valid) {
      const updatedFile = await this.db.updateDocument<FilesDoc>(
        this.getCollectionName(bucket.getSequence()),
        fileId,
        file,
      )
      this.eventEmitter.emit(AppEvents.FILES_UPDATE, {
        bucketId,
        fileId,
        payload: {
          data: updatedFile,
        },
      })
      return updatedFile
    }
    const updatedFileSkipped = await Authorization.skip(() =>
      this.db.updateDocument<FilesDoc>(
        this.getCollectionName(bucket.getSequence()),
        fileId,
        file,
      ),
    )
    this.eventEmitter.emit(AppEvents.FILES_UPDATE, {
      bucketId,
      fileId,
      payload: {
        data: updatedFileSkipped,
      },
    })
    return updatedFileSkipped
  }

  /**
   * Delete a file.
   */
  async deleteFile(bucketId: string, fileId: string, ctx: RequestContext) {
    const bucket = await Authorization.skip(() =>
      this.db.getDocument('buckets', bucketId),
    )

    if (
      bucket.empty() ||
      (!bucket.get('enabled') && !ctx.isAPIUser && !ctx.isAdminUser)
    ) {
      throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
    }

    const fileSecurity = bucket.get('fileSecurity', false)
    const validator = new Authorization(PermissionType.Delete)
    const valid = validator.$valid(bucket.getDelete())
    if (!fileSecurity && !valid) {
      throw new Exception(Exception.USER_UNAUTHORIZED)
    }

    const file = await Authorization.skip(() =>
      this.db.getDocument(this.getCollectionName(bucket.getSequence()), fileId),
    )

    if (file.empty()) {
      throw new Exception(Exception.STORAGE_FILE_NOT_FOUND)
    }

    if (fileSecurity && !valid && !validator.$valid(file.getDelete())) {
      throw new Exception(Exception.USER_UNAUTHORIZED)
    }

    const filePath = file.get('path')
    let deviceDeleted = false

    if (file.get('chunksTotal') !== file.get('chunksUploaded')) {
      deviceDeleted = await this.deviceForFiles.abort(
        filePath,
        file.get('metadata', {}).uploadId ?? '',
      )
    } else {
      deviceDeleted = await this.deviceForFiles.delete(filePath)
    }

    if (deviceDeleted) {
      const deleted =
        fileSecurity && !valid
          ? await this.db.deleteDocument(
              this.getCollectionName(bucket.getSequence()),
              fileId,
            )
          : await Authorization.skip(
              async () =>
                await this.db.deleteDocument(
                  this.getCollectionName(bucket.getSequence()),
                  fileId,
                ),
            )

      if (!deleted) {
        throw new Exception(
          Exception.GENERAL_SERVER_ERROR,
          'Failed to remove file from DB',
        )
      }

      this.eventEmitter.emit(AppEvents.FILES_DELETE, {
        bucketId,
        fileId,
      })
    } else {
      throw new Exception(
        Exception.GENERAL_SERVER_ERROR,
        'Failed to delete file from device',
      )
    }
  }
}
