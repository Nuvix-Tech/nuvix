import { faker } from '@faker-js/faker'
import { CreateUserDTO } from '@/server/users/DTO/user.dto'

export function buildCreateUserDTO(
  overrides: Partial<CreateUserDTO> = {},
): CreateUserDTO {
  return {
    userId: faker.string.alphanumeric(12),
    email: faker.internet.email().toLowerCase(),
    password: faker.internet.password({ length: 16 }),
    name: faker.person.fullName(),
    ...overrides,
  }
}

export function buildUpdateUserNameDTO(overrides: { name?: string } = {}): {
  name: string
} {
  return {
    name: overrides.name ?? faker.person.fullName(),
  }
}

export function buildUpdateUserEmailDTO(overrides: { email?: string } = {}): {
  email: string
} {
  return {
    email: overrides.email ?? faker.internet.email().toLowerCase(),
  }
}

export function buildUpdateUserPasswordDTO(
  overrides: { password?: string } = {},
): { password: string } {
  return {
    password: overrides.password ?? faker.internet.password({ length: 16 }),
  }
}

export function buildUpdateUserStatusDTO(
  overrides: { status?: boolean } = {},
): { status: boolean } {
  return {
    status: overrides.status ?? true,
  }
}

export function buildUpdateUserLabelsDTO(
  overrides: { labels?: string[] } = {},
): { labels: string[] } {
  return {
    labels: overrides.labels ?? ['verified', 'premium'],
  }
}

export function buildUpdateUserPrefsDTO(
  overrides: { prefs?: Record<string, unknown> } = {},
): { prefs: Record<string, unknown> } {
  return {
    prefs: overrides.prefs ?? { theme: 'dark', notifications: true },
  }
}
