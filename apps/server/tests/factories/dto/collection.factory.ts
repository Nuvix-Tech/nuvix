import { faker } from '@faker-js/faker'
import { CreateCollectionDTO } from '@/server/schemas/collections/DTO/collection.dto'

export function buildCreateCollectionDTO(
  overrides: Partial<CreateCollectionDTO> = {},
): CreateCollectionDTO {
  return {
    collectionId: faker.string.alphanumeric(12),
    name: `${faker.word.noun()}-collection`,
    permissions: [],
    documentSecurity: false,
    enabled: true,
    ...overrides,
  }
}

export function buildUpdateCollectionDTO(
  overrides: Partial<Omit<CreateCollectionDTO, 'collectionId'>> = {},
): Omit<CreateCollectionDTO, 'collectionId'> {
  return {
    name: `${faker.word.noun()}-updated-collection`,
    permissions: [],
    documentSecurity: false,
    enabled: true,
    ...overrides,
  }
}
