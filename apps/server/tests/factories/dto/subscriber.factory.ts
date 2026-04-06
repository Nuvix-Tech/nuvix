import { faker } from '@faker-js/faker'
import { CreateSubscriberDTO } from '@/server/messaging/topics/subscribers/DTO/subscriber.dto'

export function buildCreateSubscriberDTO(
  overrides: Partial<CreateSubscriberDTO> = {},
): CreateSubscriberDTO {
  return {
    subscriberId: faker.string.alphanumeric(12),
    targetId: faker.string.alphanumeric(12),
    ...overrides,
  }
}
