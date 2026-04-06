import { faker } from '@faker-js/faker'
import { SchemaType } from '@nuvix/utils'
import { CreateSchemaDTO } from '@/server/database/DTO/create-schema.dto'

export function buildCreateSchemaDTO(
  overrides: Partial<CreateSchemaDTO> = {},
): CreateSchemaDTO {
  // Schema names must start with lowercase letter, contain only lowercase letters, numbers, underscores
  const baseName = faker.word
    .noun()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
  const name = baseName.charAt(0).match(/[a-z]/)
    ? baseName
    : `schema_${baseName}`

  return {
    name: `${name.substring(0, 20)}_${faker.string.alphanumeric(6).toLowerCase()}`,
    description: faker.lorem.sentence(),
    type: SchemaType.Managed,
    ...overrides,
  }
}

export function buildCreateDocumentSchemaDTO(
  overrides: Partial<CreateSchemaDTO> = {},
): CreateSchemaDTO {
  return buildCreateSchemaDTO({
    type: SchemaType.Document,
    ...overrides,
  })
}

export function buildCreateUnmanagedSchemaDTO(
  overrides: Partial<CreateSchemaDTO> = {},
): CreateSchemaDTO {
  return buildCreateSchemaDTO({
    type: SchemaType.Unmanaged,
    ...overrides,
  })
}
