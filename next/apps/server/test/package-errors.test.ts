import { describe, expect, test } from 'bun:test'
import { CacheError, CacheKeyError, UnsupportedOperationError } from '@nuvix/cache'
import { MessagingError, MessagingErrorCode } from '@nuvix/messaging'
import { StorageError, type StorageErrorCode } from '@nuvix/storage'
import { translatePackageError } from '../src/infrastructure/package-errors'
import { AppError } from '../src/shared/errors'

const CONTEXT = {
  operation: 'perform package operation',
  publicCode: 'operation_failed',
}

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
