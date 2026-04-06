import { faker } from '@faker-js/faker'
import { CreateFcmProviderDTO } from '@/server/messaging/providers/DTO/fcm.dto'
import { CreateSMTPProviderDTO } from '@/server/messaging/providers/DTO/smtp.dto'

export function buildCreateSmtpProviderDTO(
  overrides: Partial<CreateSMTPProviderDTO> = {},
): CreateSMTPProviderDTO {
  return {
    providerId: faker.string.alphanumeric(12),
    name: `${faker.company.name()} SMTP`,
    host: `smtp.${faker.internet.domainName()}`,
    port: 587,
    username: faker.internet.email(),
    password: faker.internet.password(),
    encryption: 'tls',
    autoTLS: true,
    fromName: faker.person.fullName(),
    fromEmail: faker.internet.email(),
    enabled: true,
    ...overrides,
  }
}

export function buildCreateFcmProviderDTO(
  overrides: Partial<CreateFcmProviderDTO> = {},
): CreateFcmProviderDTO {
  return {
    providerId: faker.string.alphanumeric(12),
    name: `${faker.company.name()} FCM`,
    serviceAccountJSON: {
      type: 'service_account',
      project_id: faker.string.alphanumeric(12),
      private_key_id: faker.string.alphanumeric(40),
      private_key:
        '-----BEGIN PRIVATE KEY-----\nMIItest\n-----END PRIVATE KEY-----\n',
      client_email: `test@${faker.string.alphanumeric(12)}.iam.gserviceaccount.com`,
      client_id: faker.string.numeric(21),
    },
    enabled: true,
    ...overrides,
  }
}
