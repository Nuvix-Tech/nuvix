import { faker } from '@faker-js/faker'
import { ID } from '@nuvix/db'
import { CreateAccountDTO } from '@/server/account/DTO/account.dto'

export function buildCreateAccountDTO(
  overrides: Partial<CreateAccountDTO> = {},
): CreateAccountDTO {
  const id = ID.unique()
  return {
    userId: id,
    email: `${id}_${faker.internet.email().toLowerCase()}`,
    password: faker.internet.password({ length: 16 }),
    name: faker.person.fullName(),
    ...overrides,
  }
}
