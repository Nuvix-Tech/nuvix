import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CoreService } from '@nuvix/core/core.service'
import { Exception } from '@nuvix/core/extend/exception'
import { Database, Doc, DuplicateException, ID, Query } from '@nuvix/db'
import { AppEvents, MessageType } from '@nuvix/utils'
import type { Providers } from '@nuvix/utils/types'
import type {
  CreateApnsProvider,
  CreateFcmProvider,
  CreateMailgunProvider,
  CreateMsg91Provider,
  CreateProviderInput,
  CreateSendgridProvider,
  CreateSmtpProvider,
  CreateTelesignProvider,
  CreateTextmagicProvider,
  CreateTwilioProvider,
  CreateVonageProvider,
  ListProviders,
  UpdateApnsProvider,
  UpdateFcmProvider,
  UpdateMailgunProvider,
  UpdateMsg91Provider,
  UpdateSendgridProvider,
  UpdateSmtpProvider,
  UpdateTelesignProvider,
  UpdateTextmagicProvider,
  UpdateTwilioProvider,
  UpdateVonageProvider,
} from './providers.types'

@Injectable()
export class ProvidersService {
  private readonly db: Database

  constructor(
    private readonly coreService: CoreService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.db = this.coreService.getDatabase()
  }

  /**
   * Common method to create a provider.
   */
  private async createProvider<T extends CreateProviderInput>({
    input,

    providerType,
    messageType,
    credentialFields,
    optionFields,
    enabledCondition,
  }: {
    input: T

    providerType: string
    messageType: string
    credentialFields: Record<string, keyof typeof input>
    optionFields: Record<string, keyof typeof input>
    enabledCondition: (
      credentials: Record<string, keyof typeof input>,
      options: Record<string, keyof typeof input>,
    ) => boolean
  }) {
    const { providerId: inputProviderId, name, enabled: inputEnabled } = input
    const providerId =
      inputProviderId === 'unique()' ? ID.unique() : inputProviderId

    const credentials: Record<string, any> = {}
    const options: Record<string, any> = {}

    Object.entries(credentialFields).forEach(([key, inputKey]) => {
      if (input[inputKey as keyof typeof input]) {
        credentials[key] = input[inputKey as keyof typeof input]
      }
    })
    Object.entries(optionFields).forEach(([key, inputKey]) => {
      if (input[inputKey as keyof typeof input]) {
        options[key] = input[inputKey as keyof typeof input]
      }
    })

    const enabled =
      inputEnabled === true && enabledCondition(credentials, options)

    const provider = new Doc<Providers>({
      $id: providerId,
      name,
      provider: providerType,
      type: messageType,
      enabled,
      credentials,
      options,
    })

    try {
      const createdProvider = await this.db.createDocument(
        'providers',
        provider,
      )

      this.eventEmitter.emit(AppEvents.PROVIDERS_CREATE, {
        providerId: createdProvider.getId(),
        payload: {
          data: createdProvider,
        },
      })

      return createdProvider
    } catch (error) {
      if (error instanceof DuplicateException) {
        throw new Exception(Exception.PROVIDER_ALREADY_EXISTS)
      }
      throw error
    }
  }

  /**
   * Creates a Mailgun provider.
   */
  async createMailgunProvider({ input }: CreateMailgunProvider) {
    return this.createProvider({
      input,

      providerType: 'mailgun',
      messageType: MessageType.EMAIL,
      credentialFields: {
        isEuRegion: 'isEuRegion',
        apiKey: 'apiKey',
        domain: 'domain',
      },
      optionFields: {
        fromName: 'fromName',
        fromEmail: 'fromEmail',
        replyToName: 'replyToName',
        replyToEmail: 'replyToEmail',
      },
      enabledCondition: (credentials, options) =>
        !!options.fromEmail &&
        Object.hasOwn(credentials, 'isEuRegion') &&
        Object.hasOwn(credentials, 'apiKey') &&
        Object.hasOwn(credentials, 'domain'),
    })
  }

  /**
   * Creates a SendGrid provider.
   */
  async createSendGridProvider({ input }: CreateSendgridProvider) {
    return this.createProvider({
      input,

      providerType: 'sendgrid',
      messageType: MessageType.EMAIL,
      credentialFields: {
        apiKey: 'apiKey',
      },
      optionFields: {
        fromName: 'fromName',
        fromEmail: 'fromEmail',
        replyToName: 'replyToName',
        replyToEmail: 'replyToEmail',
      },
      enabledCondition: (credentials, options) =>
        !!options.fromEmail && Object.hasOwn(credentials, 'apiKey'),
    })
  }

  /**
   * Creates an SMTP provider.
   */
  async createSmtpProvider({ input }: CreateSmtpProvider) {
    return this.createProvider({
      input,

      providerType: 'smtp',
      messageType: MessageType.EMAIL,
      credentialFields: {
        port: 'port',
        username: 'username',
        password: 'password',
        host: 'host',
      },
      optionFields: {
        fromName: 'fromName',
        fromEmail: 'fromEmail',
        replyToName: 'replyToName',
        replyToEmail: 'replyToEmail',
        encryption: 'encryption',
        autoTLS: 'autoTLS',
        mailer: 'mailer',
      },
      enabledCondition: (credentials, options) =>
        !!options.fromEmail && Object.hasOwn(credentials, 'host'),
    })
  }

  /**
   * Creates a MSG91 provider.
   */
  async createMsg91Provider({ input }: CreateMsg91Provider) {
    return this.createProvider({
      input,

      providerType: 'msg91',
      messageType: MessageType.SMS,
      credentialFields: {
        templateId: 'templateId',
        senderId: 'senderId',
        authKey: 'authKey',
      },
      optionFields: {},
      enabledCondition: (credentials, options) =>
        Object.hasOwn(credentials, 'senderId') &&
        Object.hasOwn(credentials, 'authKey') &&
        Object.hasOwn(options, 'from'),
    })
  }

  /**
   * Creates a Telesign provider.
   */
  async createTelesignProvider({ input }: CreateTelesignProvider) {
    return this.createProvider({
      input,

      providerType: 'telesign',
      messageType: MessageType.SMS,
      credentialFields: {
        customerId: 'customerId',
        apiKey: 'apiKey',
      },
      optionFields: {
        from: 'from',
      },
      enabledCondition: (credentials, options) =>
        Object.hasOwn(credentials, 'customerId') &&
        Object.hasOwn(credentials, 'apiKey') &&
        Object.hasOwn(options, 'from'),
    })
  }

  /**
   * Creates a TextMagic provider.
   */
  async createTextMagicProvider({ input }: CreateTextmagicProvider) {
    return this.createProvider({
      input,

      providerType: 'textmagic',
      messageType: MessageType.SMS,
      credentialFields: {
        username: 'username',
        apiKey: 'apiKey',
      },
      optionFields: {
        from: 'from',
      },
      enabledCondition: (credentials, options) =>
        Object.hasOwn(credentials, 'username') &&
        Object.hasOwn(credentials, 'apiKey') &&
        Object.hasOwn(options, 'from'),
    })
  }

  /**
   * Creates a Twilio provider.
   */
  async createTwilioProvider({ input }: CreateTwilioProvider) {
    return this.createProvider({
      input,

      providerType: 'twilio',
      messageType: MessageType.SMS,
      credentialFields: {
        accountSid: 'accountSid',
        authToken: 'authToken',
      },
      optionFields: {
        from: 'from',
      },
      enabledCondition: (credentials, options) =>
        Object.hasOwn(credentials, 'accountSid') &&
        Object.hasOwn(credentials, 'authToken') &&
        Object.hasOwn(options, 'from'),
    })
  }

  /**
   * Creates a Vonage provider.
   */
  async createVonageProvider({ input }: CreateVonageProvider) {
    return this.createProvider({
      input,

      providerType: 'vonage',
      messageType: MessageType.SMS,
      credentialFields: {
        apiKey: 'apiKey',
        apiSecret: 'apiSecret',
      },
      optionFields: {
        from: 'from',
      },
      enabledCondition: (credentials, options) =>
        Object.hasOwn(credentials, 'apiKey') &&
        Object.hasOwn(credentials, 'apiSecret') &&
        Object.hasOwn(options, 'from'),
    })
  }

  /**
   * Creates a Firebase Cloud Messaging (FCM) provider.
   */
  async createFcmProvider({ input }: CreateFcmProvider) {
    return this.createProvider({
      input,

      providerType: 'fcm',
      messageType: MessageType.PUSH,
      credentialFields: {
        serviceAccountJSON: 'serviceAccountJSON',
      },
      optionFields: {},
      enabledCondition: credentials =>
        Object.hasOwn(credentials, 'serviceAccountJSON'),
    })
  }

  /**
   * Creates an APNS provider.
   */
  async createApnsProvider({ input }: CreateApnsProvider) {
    return this.createProvider({
      input,

      providerType: 'apns',
      messageType: MessageType.PUSH,
      credentialFields: {
        authKey: 'authKey',
        authKeyId: 'authKeyId',
        teamId: 'teamId',
        bundleId: 'bundleId',
      },
      optionFields: {
        sandbox: 'sandbox',
      },
      enabledCondition: credentials =>
        Object.hasOwn(credentials, 'authKey') &&
        Object.hasOwn(credentials, 'authKeyId') &&
        Object.hasOwn(credentials, 'teamId') &&
        Object.hasOwn(credentials, 'bundleId'),
    })
  }

  /**
   * Lists all providers.
   */
  async listProviders({ queries = [], search }: ListProviders) {
    if (search) {
      queries.push(Query.search('search', search))
    }

    const { filters } = Query.groupByType(queries)

    const providers = await this.db.find('providers', queries)
    const total = await this.db.count('providers', filters)

    return {
      data: providers,
      total,
    }
  }

  /**
   * Get Provider
   */
  async getProvider(id: string) {
    const provider = await this.db.getDocument('providers', id)

    if (provider.empty()) {
      throw new Exception(Exception.PROVIDER_NOT_FOUND)
    }

    return provider
  }

  /**
   * Common method to update a provider.
   */
  private async updateProvider<T extends Record<string, any>>({
    providerId,

    providerType,
    updatedFields,
    credentialFields,
    optionFields,
    enabledCondition,
  }: {
    providerId: string

    providerType: string
    updatedFields: T
    credentialFields: Record<string, keyof typeof updatedFields>
    optionFields: Record<string, keyof typeof updatedFields>
    enabledCondition: (
      credentials: Record<string, keyof typeof updatedFields>,
      options: Record<string, keyof typeof updatedFields>,
    ) => boolean
  }) {
    const provider = await this.db.getDocument('providers', providerId)

    if (provider.empty()) {
      throw new Exception(Exception.PROVIDER_NOT_FOUND)
    }

    if (provider.get('provider') !== providerType) {
      throw new Exception(Exception.PROVIDER_INCORRECT_TYPE)
    }

    if (updatedFields.name) {
      provider.set('name', updatedFields.name)
    }

    // Update credentials
    const credentials = provider.get('credentials', {}) as Record<string, any>
    Object.entries(credentialFields).forEach(([key, inputKey]) => {
      if (
        updatedFields[inputKey] !== undefined &&
        updatedFields[inputKey] !== ''
      ) {
        credentials[key] = updatedFields[inputKey]
      }
    })
    provider.set('credentials', credentials)

    // Update options
    const options = (provider.get('options', {}) || {}) as Record<string, any>
    Object.entries(optionFields).forEach(([key, inputKey]) => {
      if (
        updatedFields[inputKey] !== undefined &&
        updatedFields[inputKey] !== ''
      ) {
        options[key] = updatedFields[inputKey]
      }
    })
    provider.set('options', options)

    // Update enabled status
    if (updatedFields.enabled !== undefined && updatedFields.enabled !== null) {
      if (updatedFields.enabled) {
        if (enabledCondition(credentials, options)) {
          provider.set('enabled', true)
        } else {
          throw new Exception(Exception.PROVIDER_MISSING_CREDENTIALS)
        }
      } else {
        provider.set('enabled', false)
      }
    }

    const updatedProvider = await this.db.updateDocument(
      'providers',
      provider.getId(),
      provider,
    )

    this.eventEmitter.emit(AppEvents.PROVIDERS_UPDATE, {
      providerId: updatedProvider.getId(),
      payload: {
        data: updatedProvider,
      },
    })

    return updatedProvider
  }

  /**
   * Updates a Mailgun provider.
   */
  async updateMailgunProvider({
    providerId,

    input,
  }: UpdateMailgunProvider) {
    return this.updateProvider({
      providerId,

      providerType: 'mailgun',
      updatedFields: input,
      credentialFields: {
        isEuRegion: 'isEuRegion',
        apiKey: 'apiKey',
        domain: 'domain',
      },
      optionFields: {
        fromName: 'fromName',
        fromEmail: 'fromEmail',
        replyToName: 'replyToName',
        replyToEmail: 'replyToEmail',
      },
      enabledCondition: (credentials, options) =>
        Object.hasOwn(options, 'fromEmail') &&
        Object.hasOwn(credentials, 'isEuRegion') &&
        Object.hasOwn(credentials, 'apiKey') &&
        Object.hasOwn(credentials, 'domain'),
    })
  }

  /**
   * Updates a SendGrid provider.
   */
  async updateSendGridProvider({
    providerId,

    input,
  }: UpdateSendgridProvider) {
    return this.updateProvider({
      providerId,

      providerType: 'sendgrid',
      updatedFields: input,
      credentialFields: {
        apiKey: 'apiKey',
      },
      optionFields: {
        fromName: 'fromName',
        fromEmail: 'fromEmail',
        replyToName: 'replyToName',
        replyToEmail: 'replyToEmail',
      },
      enabledCondition: (credentials, options) =>
        Object.hasOwn(options, 'fromEmail') &&
        Object.hasOwn(credentials, 'apiKey'),
    })
  }

  /**
   * Updates an SMTP provider.
   */
  async updateSmtpProvider({ providerId, input }: UpdateSmtpProvider) {
    return this.updateProvider({
      providerId,

      providerType: 'smtp',
      updatedFields: input,
      credentialFields: {
        host: 'host',
        port: 'port',
        username: 'username',
        password: 'password',
      },
      optionFields: {
        fromName: 'fromName',
        fromEmail: 'fromEmail',
        replyToName: 'replyToName',
        replyToEmail: 'replyToEmail',
        encryption: 'encryption',
        autoTLS: 'autoTLS',
        mailer: 'mailer',
      },
      enabledCondition: (credentials, options) =>
        Object.hasOwn(options, 'fromEmail') &&
        Object.hasOwn(credentials, 'host'),
    })
  }

  /**
   * Updates a MSG91 provider.
   */
  async updateMsg91Provider({ providerId, input }: UpdateMsg91Provider) {
    return this.updateProvider({
      providerId,

      providerType: 'msg91',
      updatedFields: input,
      credentialFields: {
        templateId: 'templateId',
        senderId: 'senderId',
        authKey: 'authKey',
      },
      optionFields: {},
      enabledCondition: (credentials, options) =>
        Object.hasOwn(credentials, 'senderId') &&
        Object.hasOwn(credentials, 'authKey') &&
        Object.hasOwn(options, 'from'),
    })
  }

  /**
   * Updates a Telesign provider.
   */
  async updateTelesignProvider({
    providerId,

    input,
  }: UpdateTelesignProvider) {
    return this.updateProvider({
      providerId,

      providerType: 'telesign',
      updatedFields: input,
      credentialFields: {
        customerId: 'customerId',
        apiKey: 'apiKey',
      },
      optionFields: {
        from: 'from',
      },
      enabledCondition: (credentials, options) =>
        Object.hasOwn(credentials, 'customerId') &&
        Object.hasOwn(credentials, 'apiKey') &&
        Object.hasOwn(options, 'from'),
    })
  }

  /**
   * Updates a TextMagic provider.
   */
  async updateTextMagicProvider({
    providerId,

    input,
  }: UpdateTextmagicProvider) {
    return this.updateProvider({
      providerId,

      providerType: 'textmagic',
      updatedFields: input,
      credentialFields: {
        username: 'username',
        apiKey: 'apiKey',
      },
      optionFields: {
        from: 'from',
      },
      enabledCondition: (credentials, options) =>
        Object.hasOwn(credentials, 'username') &&
        Object.hasOwn(credentials, 'apiKey') &&
        Object.hasOwn(options, 'from'),
    })
  }

  /**
   * Updates a Twilio provider.
   */
  async updateTwilioProvider({ providerId, input }: UpdateTwilioProvider) {
    return this.updateProvider({
      providerId,

      providerType: 'twilio',
      updatedFields: input,
      credentialFields: {
        accountSid: 'accountSid',
        authToken: 'authToken',
      },
      optionFields: {
        from: 'from',
      },
      enabledCondition: (credentials, options) =>
        Object.hasOwn(credentials, 'accountSid') &&
        Object.hasOwn(credentials, 'authToken') &&
        Object.hasOwn(options, 'from'),
    })
  }

  /**
   * Updates a Vonage provider.
   */
  async updateVonageProvider({ providerId, input }: UpdateVonageProvider) {
    return this.updateProvider({
      providerId,

      providerType: 'vonage',
      updatedFields: input,
      credentialFields: {
        apiKey: 'apiKey',
        apiSecret: 'apiSecret',
      },
      optionFields: {
        from: 'from',
      },
      enabledCondition: (credentials, options) =>
        Object.hasOwn(credentials, 'apiKey') &&
        Object.hasOwn(credentials, 'apiSecret') &&
        Object.hasOwn(options, 'from'),
    })
  }

  /**
   * Updates an FCM provider.
   */
  async updateFcmProvider({ providerId, input }: UpdateFcmProvider) {
    // Handle serviceAccountJSON parsing if it's a string
    if (
      input.serviceAccountJSON &&
      typeof input.serviceAccountJSON === 'string'
    ) {
      input.serviceAccountJSON = JSON.parse(input.serviceAccountJSON)
    }

    return this.updateProvider({
      providerId,

      providerType: 'fcm',
      updatedFields: input,
      credentialFields: {
        serviceAccountJSON: 'serviceAccountJSON',
      },
      optionFields: {},
      enabledCondition: credentials =>
        Object.hasOwn(credentials, 'serviceAccountJSON'),
    })
  }

  /**
   * Updates an APNS provider.
   */
  async updateApnsProvider({ providerId, input }: UpdateApnsProvider) {
    return this.updateProvider({
      providerId,

      providerType: 'apns',
      updatedFields: input,
      credentialFields: {
        authKey: 'authKey',
        authKeyId: 'authKeyId',
        teamId: 'teamId',
        bundleId: 'bundleId',
      },
      optionFields: {
        sandbox: 'sandbox',
      },
      enabledCondition: credentials =>
        Object.hasOwn(credentials, 'authKey') &&
        Object.hasOwn(credentials, 'authKeyId') &&
        Object.hasOwn(credentials, 'teamId') &&
        Object.hasOwn(credentials, 'bundleId'),
    })
  }

  /**
   * Deletes a provider.
   */
  async deleteProvider(providerId: string) {
    const provider = await this.db.getDocument('providers', providerId)

    if (provider.empty()) {
      throw new Exception(Exception.PROVIDER_NOT_FOUND)
    }

    await this.db.deleteDocument('providers', providerId)

    this.eventEmitter.emit(AppEvents.PROVIDERS_DELETE, {
      providerId,
    })
  }
}
