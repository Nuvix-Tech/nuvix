import { faker } from '@faker-js/faker'
import { CreateEmailSessionDTO } from '@/server/account/sessions/DTO/session.dto'

export function buildCreateEmailSessionDTO(
  overrides: Partial<CreateEmailSessionDTO> = {},
): CreateEmailSessionDTO {
  return {
    email: faker.internet.email().toLowerCase(),
    password: faker.internet.password({ length: 16 }),
    ...overrides,
  }
}
