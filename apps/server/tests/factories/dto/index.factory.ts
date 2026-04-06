import { faker } from '@faker-js/faker'
import { IndexType, Order } from '@nuvix/db'
import { CreateIndexDTO } from '@/server/schemas/collections/indexes/DTO/indexes.dto'

export function buildCreateIndexDTO(
  overrides: Partial<CreateIndexDTO> = {},
): CreateIndexDTO {
  return {
    key: `idx_${faker.string.alphanumeric(8)}`,
    type: IndexType.Key,
    attributes: ['title'],
    orders: [Order.Asc],
    ...overrides,
  }
}
