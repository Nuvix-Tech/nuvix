import { faker } from '@faker-js/faker'
import { CreateMembershipDTO } from '@/server/teams/memberships/DTO/membership.dto'

export function buildCreateMembershipDTO(
  overrides: Partial<CreateMembershipDTO> = {},
): CreateMembershipDTO {
  return {
    email: faker.internet.email().toLowerCase(),
    roles: ['member'],
    name: faker.person.fullName(),
    url: 'https://example.com/welcome',
    ...overrides,
  }
}

export function buildUpdateMembershipDTO(
  overrides: Partial<{ roles: string[] }> = {},
): { roles: string[] } {
  return {
    roles: ['admin'],
    ...overrides,
  }
}
