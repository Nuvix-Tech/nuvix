import { CacheError, CacheKeyError, UnsupportedOperationError } from '@nuvix/cache'
import {
  AuthorizationException,
  ConflictException as DatabaseConflictException,
  DatabaseException,
  NotFoundException as DatabaseNotFoundException,
  DuplicateException,
  IndexException,
  QueryException,
  RelationshipException,
  StructureException,
} from '@nuvix/db'
import { MessagingError, MessagingErrorCode } from '@nuvix/messaging'
import { StorageError, type StorageErrorCode } from '@nuvix/storage'
import { AppError, BadRequestError, ConflictError, NotFoundError } from '../shared/errors'

type ErrorKind = 'bad-request' | 'forbidden' | 'not-found' | 'conflict' | 'internal'

interface OperationContext {
  readonly operation: string
  readonly publicCode?: string
}

const PUBLIC_CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/

const STORAGE_ERROR_KINDS = {
  DEVICE_NOT_FOUND: 'bad-request',
  FILE_NOT_FOUND: 'not-found',
  WRITE_FAILED: 'internal',
  READ_FAILED: 'internal',
  DELETE_FAILED: 'internal',
  UPLOAD_FAILED: 'internal',
  TRANSFER_FAILED: 'internal',
  UNSUPPORTED_OPERATION: 'bad-request',
  INVALID_CONFIG: 'bad-request',
} as const satisfies Record<StorageErrorCode, ErrorKind>

const MESSAGING_ERROR_KINDS = {
  [MessagingErrorCode.NO_RECIPIENTS]: 'bad-request',
  [MessagingErrorCode.BATCH_LIMIT_EXCEEDED]: 'bad-request',
  [MessagingErrorCode.INVALID_URL]: 'bad-request',
  [MessagingErrorCode.INVALID_TIMEOUT]: 'bad-request',
  [MessagingErrorCode.INVALID_RETRY_POLICY]: 'bad-request',
  [MessagingErrorCode.ATTACHMENT_ERROR]: 'bad-request',
  [MessagingErrorCode.CONFIGURATION_ERROR]: 'internal',
  [MessagingErrorCode.PROVIDER_ERROR]: 'internal',
  [MessagingErrorCode.AUTH_ERROR]: 'internal',
} as const satisfies Record<MessagingErrorCode, ErrorKind>

function classify(error: unknown): ErrorKind | undefined {
  if (error instanceof AuthorizationException) return 'forbidden'
  if (error instanceof DatabaseNotFoundException) return 'not-found'
  if (error instanceof DuplicateException || error instanceof DatabaseConflictException) {
    return 'conflict'
  }
  if (
    error instanceof StructureException ||
    error instanceof QueryException ||
    error instanceof RelationshipException ||
    error instanceof IndexException
  ) {
    return 'bad-request'
  }
  if (error instanceof DatabaseException) return 'internal'
  if (error instanceof CacheKeyError) return 'bad-request'
  if (error instanceof UnsupportedOperationError || error instanceof CacheError) return 'internal'
  if (error instanceof StorageError && Object.hasOwn(STORAGE_ERROR_KINDS, error.code)) {
    return STORAGE_ERROR_KINDS[error.code]
  }
  if (error instanceof MessagingError && Object.hasOwn(MESSAGING_ERROR_KINDS, error.code)) {
    return MESSAGING_ERROR_KINDS[error.code]
  }
  return undefined
}

function mapped(kind: ErrorKind, context: OperationContext): AppError {
  const fields =
    context.publicCode && PUBLIC_CODE_PATTERN.test(context.publicCode)
      ? { code: context.publicCode }
      : undefined

  if (kind === 'bad-request') {
    return new BadRequestError(`Invalid request for ${context.operation}`, fields)
  }
  if (kind === 'forbidden') {
    return new AppError(403, {
      type: '/errors/forbidden',
      detail: 'Insufficient permissions',
      ...fields,
    })
  }
  if (kind === 'not-found') return new NotFoundError(context.operation, fields)
  if (kind === 'conflict') return new ConflictError(`Unable to ${context.operation}`, fields)

  return new AppError(500, {
    type: '/errors/internal',
    detail: `Unable to ${context.operation}`,
    ...fields,
  })
}

/** Converts supported package failures into safe, public application errors. */
export function translatePackageError(error: unknown, context: OperationContext): AppError {
  const kind = classify(error)
  if (kind) return mapped(kind, context)

  return new AppError(500, {
    type: '/errors/internal',
    detail: 'Internal server error',
  })
}
