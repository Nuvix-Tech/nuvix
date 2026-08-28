import { describe, expect, test } from 'bun:test'
import { CacheError, CacheKeyError, UnsupportedOperationError } from '@nuvix/cache'
import {
  AuthorizationException,
  ConflictException,
  DatabaseException,
  DependencyException,
  DuplicateException,
  IndexException,
  LimitException,
  NotFoundException,
  OrderException,
  QueryException,
  RelationshipException,
  RestrictedException,
  StructureException,
  TimeoutException,
  TransactionException,
  TruncateException,
} from '@nuvix/db'
import { MessagingError, MessagingErrorCode } from '@nuvix/messaging'
import { StorageError, type StorageErrorCode } from '@nuvix/storage'
import { translatePackageError } from '../src/infrastructure/package-errors'
import { AppError } from '../src/shared/errors'

const CONTEXT = {
  operation: 'perform package operation',
  publicCode: 'operation_failed',
}

const DATABASE_MESSAGE =
  "secret package message: SELECT * FROM secret_table WHERE id = 'secret_identifier'"

class FutureDatabaseException extends DatabaseException {}

const databaseCases = [
  ['authorization', new AuthorizationException(DATABASE_MESSAGE), 403, '/errors/forbidden'],
  ['not found', new NotFoundException(DATABASE_MESSAGE), 404, '/errors/not-found'],
  ['duplicate', new DuplicateException(DATABASE_MESSAGE), 409, '/errors/conflict'],
  ['conflict', new ConflictException(DATABASE_MESSAGE), 409, '/errors/conflict'],
  ['structure', new StructureException(DATABASE_MESSAGE), 400, '/errors/bad-request'],
  ['query', new QueryException(DATABASE_MESSAGE), 400, '/errors/bad-request'],
  ['relationship', new RelationshipException(DATABASE_MESSAGE), 400, '/errors/bad-request'],
  ['index', new IndexException(DATABASE_MESSAGE), 400, '/errors/bad-request'],
  ['dependency', new DependencyException(DATABASE_MESSAGE), 500, '/errors/internal'],
  ['limit', new LimitException(DATABASE_MESSAGE), 500, '/errors/internal'],
  ['timeout', new TimeoutException(DATABASE_MESSAGE), 500, '/errors/internal'],
  ['transaction', new TransactionException(DATABASE_MESSAGE), 500, '/errors/internal'],
  ['truncate', new TruncateException(DATABASE_MESSAGE), 500, '/errors/internal'],
  ['restricted', new RestrictedException(DATABASE_MESSAGE), 500, '/errors/internal'],
  ['order', new OrderException(DATABASE_MESSAGE, 'secret_identifier'), 500, '/errors/internal'],
  [
    'generic',
    new DatabaseException(DATABASE_MESSAGE, 'SECRET_PACKAGE_CODE'),
    500,
    '/errors/internal',
  ],
  ['unmapped', new FutureDatabaseException(DATABASE_MESSAGE), 500, '/errors/internal'],
] as const

const cacheCases = [
  ['validation', new CacheKeyError('secret invalid key'), 400, '/errors/bad-request'],
  [
    'unsupported operation',
    new UnsupportedOperationError('secret operation', 'secret adapter'),
    500,
    '/errors/internal',
  ],
  ['generic failure', new CacheError('secret cache failure'), 500, '/errors/internal'],
] as const

const storageCases = [
  ['DEVICE_NOT_FOUND', 400, '/errors/bad-request'],
  ['FILE_NOT_FOUND', 404, '/errors/not-found'],
  ['WRITE_FAILED', 500, '/errors/internal'],
  ['READ_FAILED', 500, '/errors/internal'],
  ['DELETE_FAILED', 500, '/errors/internal'],
  ['UPLOAD_FAILED', 500, '/errors/internal'],
  ['TRANSFER_FAILED', 500, '/errors/internal'],
  ['UNSUPPORTED_OPERATION', 400, '/errors/bad-request'],
  ['INVALID_CONFIG', 400, '/errors/bad-request'],
] as const satisfies ReadonlyArray<readonly [StorageErrorCode, number, string]>

const messagingCases = [
  [MessagingErrorCode.NO_RECIPIENTS, 400, '/errors/bad-request'],
  [MessagingErrorCode.BATCH_LIMIT_EXCEEDED, 400, '/errors/bad-request'],
  [MessagingErrorCode.INVALID_URL, 400, '/errors/bad-request'],
  [MessagingErrorCode.INVALID_TIMEOUT, 400, '/errors/bad-request'],
  [MessagingErrorCode.INVALID_RETRY_POLICY, 400, '/errors/bad-request'],
  [MessagingErrorCode.ATTACHMENT_ERROR, 400, '/errors/bad-request'],
  [MessagingErrorCode.CONFIGURATION_ERROR, 500, '/errors/internal'],
  [MessagingErrorCode.PROVIDER_ERROR, 500, '/errors/internal'],
  [MessagingErrorCode.AUTH_ERROR, 500, '/errors/internal'],
] as const

describe('package error translation', () => {
  for (const [name, packageError, status, type] of databaseCases) {
    test(`classifies database ${name} without disclosing package details`, () => {
      // Arrange
      const error = packageError
      error.stack = 'secret stack details'

      // Act
      const result = translatePackageError(error, CONTEXT)

      // Assert
      expect({
        status: result.status,
        type: result.fields.type,
        code: result.fields.code,
      }).toEqual({
        status,
        type,
        code: CONTEXT.publicCode,
      })

      const serialized = JSON.stringify(result.fields)
      expect(serialized).not.toContain('secret')
      expect(serialized).not.toContain('SELECT')
      expect(serialized).not.toContain(error.name)
    })
  }

  for (const [name, packageError, status, type] of cacheCases) {
    test(`classifies cache ${name}`, () => {
      // Arrange
      const error = packageError

      // Act
      const result = translatePackageError(error, CONTEXT)

      // Assert
      expect(result).toBeInstanceOf(AppError)
      expect({
        status: result.status,
        type: result.fields.type,
        code: result.fields.code,
      }).toEqual({
        status,
        type,
        code: CONTEXT.publicCode,
      })
    })
  }

  for (const [code, status, type] of storageCases) {
    test(`classifies storage ${code}`, () => {
      // Arrange
      const error = new StorageError(code, 'secret storage failure', '/secret/path')

      // Act
      const result = translatePackageError(error, CONTEXT)

      // Assert
      expect({
        status: result.status,
        type: result.fields.type,
        code: result.fields.code,
      }).toEqual({
        status,
        type,
        code: CONTEXT.publicCode,
      })
    })
  }

  for (const [code, status, type] of messagingCases) {
    test(`classifies messaging ${code}`, () => {
      // Arrange
      const error = new MessagingError(code, 'secret provider failure', {
        provider: 'secret provider',
      })

      // Act
      const result = translatePackageError(error, CONTEXT)

      // Assert
      expect({
        status: result.status,
        type: result.fields.type,
        code: result.fields.code,
      }).toEqual({
        status,
        type,
        code: CONTEXT.publicCode,
      })
    })
  }

  test('propagates only a caller-supplied snake_case public code', () => {
    // Arrange
    const error = new StorageError('FILE_NOT_FOUND', 'secret message', '/secret/path')

    // Act
    const result = translatePackageError(error, {
      operation: 'file',
      publicCode: 'file_not_found',
    })

    // Assert
    expect(result.fields).toEqual({
      type: '/errors/not-found',
      detail: 'file not found',
      code: 'file_not_found',
    })
  })

  test('omits a caller code that is not snake_case', () => {
    // Arrange
    const error = new CacheKeyError('secret invalid key')

    // Act
    const result = translatePackageError(error, {
      operation: 'read cache entry',
      publicCode: 'CACHE_KEY_INVALID',
    })

    // Assert
    expect(result.fields.code).toBeUndefined()
  })

  test('does not promote a database package code to a public code', () => {
    // Arrange
    const error = new DatabaseException(DATABASE_MESSAGE, 'SECRET_PACKAGE_CODE')

    // Act
    const result = translatePackageError(error, { operation: 'query records' })

    // Assert
    expect(result.fields).toEqual({
      type: '/errors/internal',
      detail: 'Unable to query records',
    })
    expect(JSON.stringify(result.fields)).not.toContain('SECRET_PACKAGE_CODE')
  })

  test('does not expose package details in mapped errors', () => {
    // Arrange
    const error = new MessagingError(MessagingErrorCode.PROVIDER_ERROR, 'secret raw message', {
      provider: 'secret provider',
    })

    // Act
    const result = translatePackageError(error, { operation: 'send message' })

    // Assert
    const serialized = JSON.stringify(result.fields)
    expect(serialized).toBe('{"type":"/errors/internal","detail":"Unable to send message"}')
    expect(serialized).not.toContain('PROVIDER_ERROR')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('MessagingError')
  })

  test('fails closed for unknown errors', () => {
    // Arrange
    const error = new Error('secret unknown failure')

    // Act
    const result = translatePackageError(error, CONTEXT)

    // Assert
    expect({ status: result.status, fields: result.fields }).toEqual({
      status: 500,
      fields: { type: '/errors/internal', detail: 'Internal server error' },
    })
  })

  const unmappedPackageCases = [
    new StorageError(
      'FUTURE_STORAGE_CODE' as StorageErrorCode,
      'secret future failure',
      '/secret/path',
    ),
    new MessagingError('FUTURE_MESSAGING_CODE' as MessagingErrorCode, 'secret future failure', {
      provider: 'secret provider',
    }),
  ]

  for (const packageError of unmappedPackageCases) {
    test(`fails closed for unmapped ${packageError.name} signals`, () => {
      // Arrange
      const error = packageError

      // Act
      const result = translatePackageError(error, CONTEXT)

      // Assert
      expect({ status: result.status, fields: result.fields }).toEqual({
        status: 500,
        fields: { type: '/errors/internal', detail: 'Internal server error' },
      })
    })
  }
})
