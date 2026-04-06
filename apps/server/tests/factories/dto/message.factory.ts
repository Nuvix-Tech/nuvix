import { faker } from '@faker-js/faker'
import {
  CreateEmailMessageDTO,
  CreatePushMessageDTO,
  CreateSmsMessageDTO,
} from '@/server/messaging/DTO/message.dto'

export function buildCreateEmailMessageDTO(
  overrides: Partial<CreateEmailMessageDTO> = {},
): CreateEmailMessageDTO {
  return {
    messageId: faker.string.alphanumeric(12),
    subject: faker.lorem.sentence(),
    content: faker.lorem.paragraphs(2),
    topics: [],
    users: [],
    targets: [],
    cc: [],
    bcc: [],
    draft: true,
    html: false,
    ...overrides,
  }
}

export function buildCreateSmsMessageDTO(
  overrides: Partial<CreateSmsMessageDTO> = {},
): CreateSmsMessageDTO {
  return {
    messageId: faker.string.alphanumeric(12),
    content: faker.lorem.sentence(),
    topics: [],
    users: [],
    targets: [],
    draft: true,
    ...overrides,
  }
}

export function buildCreatePushMessageDTO(
  overrides: Partial<CreatePushMessageDTO> = {},
): CreatePushMessageDTO {
  return {
    messageId: faker.string.alphanumeric(12),
    title: faker.lorem.words(3),
    body: faker.lorem.sentence(),
    topics: [],
    users: [],
    targets: [],
    data: {},
    draft: true,
    ...overrides,
  }
}
