import { faker } from '@faker-js/faker'
import { CreatePushTargetDTO } from '@/server/account/targets/DTO/target.dto'

export function buildCreatePushTargetDTO(
  overrides: Partial<CreatePushTargetDTO> = {},
): CreatePushTargetDTO {
  return {
    targetId: faker.string.alphanumeric(12),
    identifier: faker.string.alphanumeric(32),
    ...overrides,
  }
}
