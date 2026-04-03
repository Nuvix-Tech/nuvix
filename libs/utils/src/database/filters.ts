import { Auth } from '@nuvix/core/helpers'
import {
  AttributeType,
  Authorization,
  Doc,
  Filter,
  FilterValue,
  Query,
} from '@nuvix/db'
import { configuration } from '../configuration'
import { SchemaMeta } from '../constants'

export const filters: Record<
  string,
  Filter<FilterValue, FilterValue, Doc<Record<string, any>>>
> = {
  json: {
    encode(value) {
      if (value !== null) {
        return JSON.stringify(value)
      }
      return null
    },
    decode(value) {
      if (typeof value === 'string') {
        return JSON.parse(value)
      }
      return value
    },
  },
  casting: {
    encode: value => {
      return JSON.stringify({ value: value }, (_key, value) => {
        return typeof value === 'number' && !Number.isFinite(value)
          ? String(value)
          : value
      })
    },
    decode: value => {
      if (value == null || value === undefined) {
        return null
      }

      return JSON.parse(value as string)?.value
    },
  },
  enum: {
    encode: (value, attribute) => {
      if (attribute.has('elements')) {
        attribute.delete('elements')
      }

      return value
    },
    decode: (value, attribute) => {
      const formatOptions = attribute.get('formatOptions')
      if (formatOptions.elements) {
        attribute.set('elements', formatOptions.elements)
      }

      return value
    },
  },
  range: {
    encode: (value, attribute) => {
      if (attribute.has('min')) {
        attribute.delete('min')
      }
      if (attribute.has('max')) {
        attribute.delete('max')
      }

      return value
    },
    decode: (value, attribute) => {
      const formatOptions = attribute.get('formatOptions', {})
      if (formatOptions.min || formatOptions.max) {
        attribute.set('min', formatOptions.min).set('max', formatOptions.max)
      }

      return value
    },
  },
  subQueryAttributes: {
    encode: () => null,
    decode: async (_, document, database) => {
      const attributes = await database.find(SchemaMeta.attributes, [
        Query.equal('collectionInternalId', [document.getSequence()]),
        Query.limit(database.getAdapter().$limitForAttributes),
      ])

      attributes.forEach(attribute => {
        if (attribute.get('type') === AttributeType.Relationship) {
          const options = attribute.get('options')
          Object.keys(options).forEach(key => {
            attribute.set(key, options[key])
          })
          attribute.delete('options')
        }
      })

      return attributes
    },
  },
  subQueryIndexes: {
    encode: () => null,
    decode: async (_, document, database) => {
      return database.find(SchemaMeta.indexes, [
        Query.equal('collectionInternalId', [document.getSequence()]),
        Query.limit(database.getAdapter().$limitForIndexes),
      ])
    },
  },
  subQueryPlatforms: {
    encode: () => null,
    decode: (_, document, database) => {
      return database.find('platforms', [
        Query.equal('projectInternalId', [document.getSequence()]),
        Query.limit(configuration.limits.subquery),
      ])
    },
  },

  subQueryKeys: {
    encode: () => {
      return null
    },
    decode: (_, document, database) => {
      return database.find('keys', [
        Query.equal('projectInternalId', [document.getSequence()]),
        Query.limit(configuration.limits.subquery),
      ])
    },
  },
  subQueryWebhooks: {
    encode: () => {
      return null
    },
    decode: (_, document, database) => {
      return database.find('webhooks', [
        Query.equal('projectInternalId', [document.getSequence()]),
        Query.limit(configuration.limits.subquery),
      ])
    },
  },
  subQuerySessions: {
    encode: () => {
      return null
    },
    decode: (_, document, database) => {
      return Authorization.skip(() => {
        return database.find('sessions', [
          Query.equal('userInternalId', [document.getSequence()]),
          Query.limit(configuration.limits.subquery),
        ])
      })
    },
  },
  subQueryTokens: {
    encode: () => {
      return null
    },
    decode: (_, document, database) => {
      return Authorization.skip(() => {
        return database.find('tokens', [
          Query.equal('userInternalId', [document.getSequence()]),
          Query.limit(configuration.limits.subquery),
        ])
      })
    },
  },
  subQueryChallenges: {
    encode: () => {
      return null
    },
    decode: (_, document, database) => {
      return Authorization.skip(() => {
        return database.find('challenges', [
          Query.equal('userInternalId', [document.getSequence()]),
          Query.limit(configuration.limits.subquery),
        ])
      })
    },
  },
  subQueryAuthenticators: {
    encode: () => {
      return null
    },
    decode: (_, document, database) => {
      return Authorization.skip(() => {
        return database.find('authenticators', [
          Query.equal('userInternalId', [document.getSequence()]),
          Query.limit(configuration.limits.subquery),
        ])
      })
    },
  },
  subQueryMemberships: {
    encode: () => {
      return null
    },
    decode: (_, document, database) => {
      return Authorization.skip(async () => {
        return database.find('memberships', [
          Query.equal('userInternalId', [document.getSequence()]),
          Query.limit(configuration.limits.subquery),
        ])
      })
    },
  },
  subQueryVariables: {
    encode: () => {
      return null
    },
    decode: (_, document, database) => {
      return database.find('variables', [
        Query.equal('resourceInternalId', [document.getSequence()]),
        Query.equal('resourceType', ['function']),
        Query.limit(configuration.limits.subquery),
      ])
    },
  },

  encrypt: {
    encode: value => {
      if (typeof value !== 'string') {
        return
      }
      return Auth.encrypt(value)
    },
    decode: (value: any) => {
      if (!value || typeof value !== 'string') {
        return value
      }

      return Auth.decrypt(value)
    },
  },

  subQueryProjectVariables: {
    encode: () => {
      return null
    },
    decode: async (_, __, database) => {
      return database.find('variables', [
        Query.equal('resourceType', ['project']),
        Query.limit(configuration.limits.subquery),
      ])
    },
  },
  userSearch: {
    encode: (_, user) => {
      const searchValues = [
        user.getId(),
        user.get('email', ''),
        user.get('name', ''),
        user.get('phone', ''),
      ]

      user.get('labels', []).forEach((label: string) => {
        searchValues.push(`label:${label}`)
      })

      return searchValues.filter(Boolean).join(' ')
    },
    decode: value => {
      return value
    },
  },
  subQueryTargets: {
    encode: () => {
      return null
    },
    decode: (_, document, database) => {
      return Authorization.skip(() => {
        return database.find('targets', [
          Query.equal('userInternalId', [document.getSequence()]),
          Query.limit(configuration.limits.subquery),
        ])
      })
    },
  },
  subQueryTopicTargets: {
    encode: () => null,
    decode: async (_, document, database) => {
      const targetIds = await Authorization.skip(async () => {
        const subscribers = await database.find('subscribers', [
          Query.equal('topicInternalId', [document.getSequence()]),
          Query.limit(configuration.limits.subscribersSubquery),
        ])
        return subscribers.map(subscriber => subscriber.get('targetInternalId'))
      })

      if (targetIds.length > 0) {
        return database.skipValidation(() =>
          database.find('targets', [Query.equal('$sequence', targetIds)]),
        )
      }
      return []
    },
  },
  providerSearch: {
    encode: (_, provider) => {
      const searchValues = [
        provider.getId(),
        provider.get('name', ''),
        provider.get('provider', ''),
        provider.get('type', ''),
      ]

      return searchValues.filter(Boolean).join(' ')
    },
    decode: value => {
      return value
    },
  },
  topicSearch: {
    encode: (_, topic) => {
      const searchValues = [
        topic.getId(),
        topic.get('name', ''),
        topic.get('description', ''),
      ]

      return searchValues.filter(Boolean).join(' ')
    },
    decode: value => {
      return value
    },
  },
  messageSearch: {
    encode: (_, message) => {
      const searchValues = [
        message.getId(),
        message.get('description', ''),
        message.get('status', ''),
      ]

      const data = message.get('data', {})
      const providerType = message.get('providerType', '')

      if (providerType === 'email') {
        searchValues.push(data.subject, 'email')
      } else if (providerType === 'sms') {
        searchValues.push(data.content, 'sms')
      } else {
        searchValues.push(data.title, 'push')
      }

      return searchValues.filter(Boolean).join(' ')
    },
    decode: (value: any) => {
      return value
    },
  },
}
