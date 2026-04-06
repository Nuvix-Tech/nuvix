import { faker } from '@faker-js/faker'
import { CreateTopicDTO } from '@/server/messaging/topics/DTO/topics.dto'

export function buildCreateTopicDTO(
  overrides: Partial<CreateTopicDTO> = {},
): CreateTopicDTO {
  return {
    topicId: faker.string.alphanumeric(12),
    name: `${faker.word.noun()}-topic`,
    subscribe: [],
    ...overrides,
  }
}

export function buildUpdateTopicDTO(
  overrides: Partial<Omit<CreateTopicDTO, 'topicId'>> = {},
): Omit<CreateTopicDTO, 'topicId'> {
  return {
    name: `${faker.word.noun()}-updated-topic`,
    subscribe: [],
    ...overrides,
  }
}
