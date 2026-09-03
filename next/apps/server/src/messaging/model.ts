export interface MessagingModel {
  readonly collections: {
    readonly providers: string
    readonly topics: string
    readonly subscribers: string
    readonly messages: string
  }
  readonly fields: {
    readonly providers: {
      readonly name: string
      readonly type: string
      readonly adapter: string
      readonly enabled: string
      readonly options: string
    }
    readonly topics: {
      readonly name: string
      readonly description: string
      readonly total: string
      readonly permissions: string
    }
    readonly subscribers: {
      readonly topicId: string
      readonly userId: string
      readonly userName: string
      readonly targetId: string
      readonly target: string
      readonly providerType: string
    }
    readonly messages: {
      readonly topics: string
      readonly users: string
      readonly targets: string
      readonly channel: string
      readonly status: string
      readonly deliveredTo: string
      readonly total: string
      readonly data: string
      readonly deliveryErrors: string
    }
  }
}

export const MESSAGING_MODEL = {
  collections: {
    providers: 'messaging_providers',
    topics: 'messaging_topics',
    subscribers: 'messaging_subscribers',
    messages: 'messaging_messages',
  },
  fields: {
    providers: {
      name: 'name',
      type: 'type',
      adapter: 'adapter',
      enabled: 'enabled',
      options: 'options',
    },
    topics: {
      name: 'name',
      description: 'description',
      total: 'total',
      permissions: 'permissions',
    },
    subscribers: {
      topicId: 'topicId',
      userId: 'userId',
      userName: 'userName',
      targetId: 'targetId',
      target: 'target',
      providerType: 'providerType',
    },
    messages: {
      topics: 'topics',
      users: 'users',
      targets: 'targets',
      channel: 'channel',
      status: 'status',
      deliveredTo: 'deliveredTo',
      total: 'total',
      data: 'data',
      deliveryErrors: 'deliveryErrors',
    },
  },
} as const satisfies MessagingModel
