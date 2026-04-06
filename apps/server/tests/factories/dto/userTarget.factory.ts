import { faker } from '@faker-js/faker'
import { CreateTargetDTO } from '@/server/users/targets/DTO/target.dto'

export function buildCreateUserTargetDTO(
  overrides: Partial<CreateTargetDTO> = {},
): CreateTargetDTO {
  return {
    targetId: faker.string.alphanumeric(12),
    providerId: faker.string.alphanumeric(12),
    identifier: faker.internet.email().toLowerCase(),
    name: faker.person.fullName(),
    providerType: 'email',
    ...overrides,
  }
}

export function buildUpdateUserTargetDTO(
  overrides: { identifier?: string; name?: string; providerId?: string } = {},
): { identifier?: string; name?: string; providerId?: string } {
  return {
    identifier: overrides.identifier ?? faker.internet.email().toLowerCase(),
    name: overrides.name ?? faker.person.fullName(),
    ...overrides,
  }
}
