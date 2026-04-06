import { faker } from '@faker-js/faker'
import { CreateDocumentDTO } from '@/server/schemas/collections/documents/DTO/document.dto'

export function buildCreateDocumentDTO(
  overrides: Partial<CreateDocumentDTO> = {},
): CreateDocumentDTO {
  return {
    documentId: faker.string.alphanumeric(12),
    data: {
      title: faker.lorem.sentence(),
      content: faker.lorem.paragraph(),
    },
    permissions: [],
    ...overrides,
  }
}

export function buildUpdateDocumentDTO(
  overrides: Partial<Omit<CreateDocumentDTO, 'documentId'>> = {},
): Omit<CreateDocumentDTO, 'documentId'> {
  return {
    data: {
      title: `${faker.lorem.sentence()} (updated)`,
      content: faker.lorem.paragraph(),
    },
    permissions: [],
    ...overrides,
  }
}
