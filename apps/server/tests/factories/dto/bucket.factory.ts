import { faker } from '@faker-js/faker'
import { CreateBucketDTO } from '@/server/storage/DTO/bucket.dto'

export function buildCreateBucketDTO(
  overrides: Partial<CreateBucketDTO> = {},
): CreateBucketDTO {
  return {
    bucketId: faker.string.alphanumeric(12),
    name: `${faker.word.noun()}-bucket`,
    permissions: [],
    fileSecurity: false,
    enabled: true,
    maximumFileSize: 10 * 1024 * 1024, // 10MB
    allowedFileExtensions: [],
    compression: 'none',
    encryption: false,
    antivirus: false,
    ...overrides,
  }
}

export function buildUpdateBucketDTO(
  overrides: Partial<Omit<CreateBucketDTO, 'bucketId'>> = {},
): Omit<CreateBucketDTO, 'bucketId'> {
  return {
    name: `${faker.word.noun()}-updated-bucket`,
    permissions: [],
    fileSecurity: false,
    enabled: true,
    maximumFileSize: 10 * 1024 * 1024,
    allowedFileExtensions: [],
    compression: 'none',
    encryption: false,
    antivirus: false,
    ...overrides,
  }
}
