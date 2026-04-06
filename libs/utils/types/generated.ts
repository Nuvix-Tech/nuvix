// This file is auto-generated. Do not edit manually.
// Generated on: 2026-04-03T06:16:52.599Z

import { Doc, IEntity } from '@nuvix/db'

export interface Users extends IEntity {
  /**
   * @optional
   * @default null
   */
  name?: string
  /**
   * @optional
   * @default null
   */
  email?: string
  /**
   * @optional
   * @default null
   */
  phone?: string
  /**
   * @optional
   * @default null
   */
  status?: boolean
  /**
   * @array
   * @optional
   * @default null
   */
  labels?: string[]
  /**
   * @array
   * @optional
   * @default null
   */
  passwordHistory?: string[]
  /**
   * @optional
   * @default null
   */
  password?: string
  /**
   * @optional
   * @default "argon2"
   */
  hash?: string | 'argon2'
  /**
   * @optional
   * @default {"type":"argon2","hashLength":32,"timeCost":3,"memoryCost":65536,"parallelism":4}
   */
  hashOptions?:
    | Record<string, any>
    | {
        type: 'argon2'
        hashLength: 32
        timeCost: 3
        memoryCost: 65536
        parallelism: 4
      }
  /**
   * @optional
   * @default null
   */
  passwordUpdate?: string | Date
  /**
   * @optional
   * @default {}
   */
  prefs?: Record<string, any>
  /**
   * @optional
   * @default null
   */
  registration?: string | Date
  /**
   * @optional
   * @default null
   */
  emailVerification?: boolean
  /**
   * @optional
   * @default null
   */
  phoneVerification?: boolean
  /**
   * @optional
   * @default null
   */
  reset?: boolean
  /**
   * @optional
   * @default null
   */
  mfa?: boolean
  /**
   * @array
   * @optional
   * @default []
   */
  mfaRecoveryCodes?: string[]
  /**
   * @optional
   * @default null
   */
  authenticators?: never
  /**
   * @optional
   * @default null
   */
  sessions?: never
  /**
   * @optional
   * @default null
   */
  tokens?: never
  /**
   * @optional
   * @default null
   */
  challenges?: never
  /**
   * @optional
   * @default null
   */
  memberships?: never
  /**
   * @optional
   * @default null
   */
  targets?: never
  /**
   * @optional
   * @default null
   */
  search?: string
  /**
   * @optional
   * @default null
   */
  accessedAt?: string | Date
}

export interface Teams extends IEntity {
  /**
   * @optional
   * @default null
   */
  name?: string
  /**
   * @optional
   * @default null
   */
  total?: number
  /**
   * @optional
   * @default null
   */
  search?: string
  /**
   * @optional
   * @default {}
   */
  prefs?: Record<string, any>
}

export interface Tokens extends IEntity {
  /** @required */
  userInternalId: number
  /**
   * @optional
   * @default null
   */
  userId?: string
  /** @required */
  type: number
  /**
   * @optional
   * @default null
   */
  secret?: string
  /**
   * @optional
   * @default null
   */
  expire?: string | Date
  /**
   * @optional
   * @default null
   */
  userAgent?: string
  /**
   * @optional
   * @default null
   */
  ip?: string
}

export interface Authenticators extends IEntity {
  /**
   * @optional
   * @default null
   */
  userInternalId?: number
  /**
   * @optional
   * @default null
   */
  userId?: string
  /**
   * @optional
   * @default null
   */
  type?: string
  /**
   * @optional
   * @default false
   */
  verified?: boolean | false
  /**
   * @optional
   * @default []
   */
  data?: string
}

export interface Challenges extends IEntity {
  /**
   * @optional
   * @default null
   */
  userInternalId?: number
  /**
   * @optional
   * @default null
   */
  userId?: string
  /**
   * @optional
   * @default null
   */
  type?: string
  /**
   * @optional
   * @default null
   */
  token?: string
  /**
   * @optional
   * @default null
   */
  code?: string
  /**
   * @optional
   * @default null
   */
  expire?: string | Date
}

export interface Sessions extends IEntity {
  /** @required */
  userInternalId: number
  /**
   * @optional
   * @default null
   */
  userId?: string
  /**
   * @optional
   * @default null
   */
  provider?: string
  /**
   * @optional
   * @default null
   */
  providerUid?: string
  /**
   * @optional
   * @default null
   */
  providerAccessToken?: string
  /**
   * @optional
   * @default null
   */
  providerAccessTokenExpiry?: string | Date
  /**
   * @optional
   * @default null
   */
  providerRefreshToken?: string
  /**
   * @optional
   * @default null
   */
  secret?: string
  /**
   * @optional
   * @default null
   */
  userAgent?: string
  /**
   * @optional
   * @default null
   */
  ip?: string
  /** @optional */
  countryCode?: string
  /**
   * @optional
   * @default null
   */
  osCode?: string
  /**
   * @optional
   * @default null
   */
  osName?: string
  /**
   * @optional
   * @default null
   */
  osVersion?: string
  /**
   * @optional
   * @default null
   */
  clientType?: string
  /**
   * @optional
   * @default null
   */
  clientCode?: string
  /**
   * @optional
   * @default null
   */
  clientName?: string
  /**
   * @optional
   * @default null
   */
  clientVersion?: string
  /**
   * @optional
   * @default null
   */
  clientEngine?: string
  /**
   * @optional
   * @default null
   */
  clientEngineVersion?: string
  /**
   * @optional
   * @default null
   */
  deviceName?: string
  /**
   * @optional
   * @default null
   */
  deviceBrand?: string
  /**
   * @optional
   * @default null
   */
  deviceModel?: string
  /**
   * @array
   * @optional
   * @default []
   */
  factors?: string[]
  /** @required */
  expire: string | Date
  /**
   * @optional
   * @default null
   */
  mfaUpdatedAt?: string | Date
}

export interface Identities extends IEntity {
  /**
   * @optional
   * @default null
   */
  userInternalId?: number
  /**
   * @optional
   * @default null
   */
  userId?: string
  /**
   * @optional
   * @default null
   */
  provider?: string
  /**
   * @optional
   * @default null
   */
  providerUid?: string
  /**
   * @optional
   * @default null
   */
  providerEmail?: string
  /**
   * @optional
   * @default null
   */
  providerAccessToken?: string
  /**
   * @optional
   * @default null
   */
  providerAccessTokenExpiry?: string | Date
  /**
   * @optional
   * @default null
   */
  providerRefreshToken?: string
  /**
   * @optional
   * @default []
   */
  secrets?: string
}

export interface Targets extends IEntity {
  /** @required */
  userId: string
  /** @required */
  userInternalId: number
  /**
   * @optional
   * @default null
   */
  sessionId?: string
  /**
   * @optional
   * @default null
   */
  sessionInternalId?: number
  /** @required */
  providerType: string
  /**
   * @optional
   * @default null
   */
  providerId?: string
  /**
   * @optional
   * @default null
   */
  providerInternalId?: number
  /** @required */
  identifier: string
  /**
   * @optional
   * @default null
   */
  name?: string
  /**
   * @optional
   * @default false
   */
  expired?: boolean | false
}

export interface Memberships extends IEntity {
  /** @required */
  userInternalId: number
  /**
   * @optional
   * @default null
   */
  userId?: string
  /** @required */
  teamInternalId: number
  /**
   * @optional
   * @default null
   */
  teamId?: string
  /**
   * @array
   * @optional
   * @default null
   */
  roles?: string[]
  /**
   * @optional
   * @default null
   */
  invited?: string | Date
  /**
   * @optional
   * @default null
   */
  joined?: string | Date
  /**
   * @optional
   * @default null
   */
  confirm?: boolean
  /**
   * @optional
   * @default null
   */
  secret?: string
  /**
   * @optional
   * @default null
   */
  search?: string
}

export interface Buckets extends IEntity {
  /** @required */
  enabled: boolean
  /** @required */
  name: string
  /** @optional */
  fileSecurity?: boolean
  /** @required */
  maximumFileSize: number
  /**
   * @array
   * @required
   */
  allowedFileExtensions: string[]
  /** @required */
  compression: string
  /** @required */
  encryption: boolean
  /** @required */
  antivirus: boolean
  /**
   * @optional
   * @default null
   */
  search?: string
}

export interface Stats extends IEntity {
  /** @required */
  metric: string
  /** @required */
  region: string
  /** @required */
  value: number
  /**
   * @optional
   * @default null
   */
  time?: string | Date
  /** @required */
  period: string
}

export interface Providers extends IEntity {
  /** @required */
  name: string
  /** @required */
  provider: string
  /** @required */
  type: string
  /** @required */
  enabled: boolean
  /** @required */
  credentials: string
  /**
   * @optional
   * @default []
   */
  options?: Record<string, any>
  /**
   * @optional
   * @default ""
   */
  search?: string | ''
}

export interface Messages extends IEntity {
  /** @required */
  providerType: string
  /** @required */
  status: string
  /** @required */
  data: Record<string, any>
  /**
   * @array
   * @optional
   */
  topics?: string[]
  /**
   * @array
   * @optional
   */
  users?: string[]
  /**
   * @array
   * @optional
   */
  targets?: string[]
  /**
   * @optional
   * @default null
   */
  scheduledAt?: string | Date
  /**
   * @optional
   * @default null
   */
  scheduleInternalId?: number
  /**
   * @optional
   * @default null
   */
  scheduleId?: string
  /**
   * @optional
   * @default null
   */
  deliveredAt?: string | Date
  /**
   * @array
   * @optional
   * @default null
   */
  deliveryErrors?: string[]
  /**
   * @optional
   * @default 0
   */
  deliveredTotal?: number | 0
  /**
   * @optional
   * @default ""
   */
  search?: string | ''
}

export interface Topics extends IEntity {
  /** @required */
  name: string
  /**
   * @array
   * @optional
   * @default null
   */
  subscribe?: string[]
  /**
   * @optional
   * @default 0
   */
  emailTotal?: number | 0
  /**
   * @optional
   * @default 0
   */
  smsTotal?: number | 0
  /**
   * @optional
   * @default 0
   */
  pushTotal?: number | 0
  /**
   * @optional
   * @default null
   */
  targets?: never
  /**
   * @optional
   * @default ""
   */
  search?: string | ''
}

export interface Subscribers extends IEntity {
  /** @required */
  targetId: string
  /** @required */
  targetInternalId: number
  /** @required */
  userId: string
  /** @required */
  userInternalId: number
  /** @required */
  topicId: string
  /** @required */
  topicInternalId: number
  /** @required */
  providerType: string
  /**
   * @optional
   * @default null
   */
  search?: string
}

export interface Collections extends IEntity {
  /** @required */
  name: string
  /** @required */
  enabled: boolean
  /** @required */
  documentSecurity: boolean
  /** @optional */
  attributes?: never
  /** @optional */
  indexes?: never
  /**
   * @optional
   * @default {}
   */
  metadata?: Record<string, any>
  /**
   * @optional
   * @default null
   */
  search?: string
}

export interface Attributes extends IEntity {
  /** @required */
  collectionInternalId: number
  /** @required */
  collectionId: string
  /**
   * @optional
   * @default null
   */
  key?: string
  /**
   * @optional
   * @default null
   */
  type?: string
  /**
   * @optional
   * @default null
   */
  status?: string
  /**
   * @optional
   * @default null
   */
  error?: string
  /**
   * @optional
   * @default null
   */
  size?: number
  /**
   * @optional
   * @default null
   */
  required?: boolean
  /**
   * @optional
   * @default null
   */
  default?: string
  /**
   * @optional
   * @default null
   */
  array?: boolean
  /**
   * @optional
   * @default null
   */
  format?: string
  /**
   * @optional
   * @default {}
   */
  formatOptions?: Record<string, any>
  /**
   * @array
   * @optional
   * @default null
   */
  filters?: string[]
  /**
   * @optional
   * @default null
   */
  options?: Record<string, any>
}

export interface Indexes extends IEntity {
  /** @required */
  collectionInternalId: number
  /** @required */
  collectionId: string
  /**
   * @optional
   * @default null
   */
  key?: string
  /**
   * @optional
   * @default null
   */
  type?: string
  /**
   * @optional
   * @default null
   */
  status?: string
  /**
   * @optional
   * @default null
   */
  error?: string
  /**
   * @array
   * @optional
   * @default null
   */
  attributes?: string[]
  /**
   * @array
   * @optional
   * @default null
   */
  orders?: string[]
}

export interface Files extends IEntity {
  /**
   * @optional
   * @default null
   */
  bucketId?: string
  /** @required */
  bucketInternalId: number
  /**
   * @optional
   * @default null
   */
  name?: string
  /**
   * @optional
   * @default null
   */
  path?: string
  /**
   * @optional
   * @default null
   */
  signature?: string
  /**
   * @optional
   * @default null
   */
  mimeType?: string
  /**
   * @optional
   * @default null
   */
  metadata?: Record<string, any>
  /**
   * @optional
   * @default null
   */
  sizeOriginal?: number
  /**
   * @optional
   * @default null
   */
  sizeActual?: number
  /**
   * @optional
   * @default null
   */
  algorithm?: string
  /**
   * @optional
   * @default null
   */
  comment?: string
  /**
   * @optional
   * @default null
   */
  encryptionOptions?: Record<string, any>
  /**
   * @optional
   * @default null
   */
  chunksTotal?: number
  /**
   * @optional
   * @default null
   */
  chunksUploaded?: number
  /**
   * @optional
   * @default null
   */
  search?: string
}

export interface Projects extends IEntity {
  /** @required */
  teamInternalId: number
  /**
   * @optional
   * @default null
   */
  teamId?: string
  /**
   * @optional
   * @default null
   */
  name?: string
  /**
   * @optional
   * @default null
   */
  region?: string
  /**
   * @optional
   * @default null
   */
  description?: string
  /** @required */
  database: string
  /**
   * @optional
   * @default null
   */
  logo?: string
  /**
   * @optional
   * @default null
   */
  url?: string
  /**
   * @optional
   * @default null
   */
  accessedAt?: string | Date
  /**
   * @optional
   * @default true
   */
  enabled?: boolean | true
  /**
   * @optional
   * @default "pending"
   */
  status?: string | 'pending'
  /**
   * @optional
   * @default "production"
   */
  environment?: string | 'production'
  /**
   * @optional
   * @default {}
   */
  metadata?: Record<string, any>
  /**
   * @optional
   * @default []
   */
  services?: Record<string, any>
  /**
   * @optional
   * @default []
   */
  apis?: Record<string, any>
  /**
   * @optional
   * @default {}
   */
  smtp?: string
  /**
   * @optional
   * @default []
   */
  templates?: Record<string, any>
  /**
   * @optional
   * @default {}
   */
  auths?: Record<string, any>
  /**
   * @optional
   * @default []
   */
  oAuthProviders?: Record<string, any>
  /**
   * @optional
   * @default null
   */
  platforms?: never
  /**
   * @optional
   * @default null
   */
  webhooks?: never
  /**
   * @optional
   * @default null
   */
  keys?: never
  /**
   * @optional
   * @default null
   */
  search?: string
}

export interface Schedules extends IEntity {
  /**
   * @optional
   * @default null
   */
  resourceType?: string
  /** @required */
  resourceInternalId: number
  /**
   * @optional
   * @default null
   */
  resourceId?: string
  /**
   * @optional
   * @default null
   */
  resourceUpdatedAt?: string | Date
  /**
   * @optional
   * @default null
   */
  projectId?: string
  /**
   * @optional
   * @default null
   */
  schedule?: string
  /**
   * @optional
   * @default {}
   */
  data?: string
  /**
   * @optional
   * @default null
   */
  active?: boolean
  /** @required */
  region: string
}

export interface Platforms extends IEntity {
  /** @required */
  projectInternalId: number
  /**
   * @optional
   * @default null
   */
  projectId?: string
  /**
   * @optional
   * @default null
   */
  type?: string
  /** @required */
  name: string
  /**
   * @optional
   * @default null
   */
  key?: string
  /**
   * @optional
   * @default null
   */
  store?: string
  /**
   * @optional
   * @default null
   */
  hostname?: string
}

export interface Keys extends IEntity {
  /** @required */
  projectInternalId: number
  /**
   * @optional
   * @default 0
   */
  projectId?: string | 0
  /** @required */
  name: string
  /**
   * @array
   * @required
   */
  scopes: string[]
  /** @required */
  secret: string
  /**
   * @optional
   * @default null
   */
  expire?: string | Date
  /**
   * @optional
   * @default null
   */
  accessedAt?: string | Date
  /**
   * @array
   * @required
   */
  sdks: string[]
}

export interface Webhooks extends IEntity {
  /** @required */
  projectInternalId: number
  /**
   * @optional
   * @default null
   */
  projectId?: string
  /** @required */
  name: string
  /** @required */
  url: string
  /**
   * @optional
   * @default null
   */
  httpUser?: string
  /**
   * @optional
   * @default null
   */
  httpPass?: string
  /** @required */
  security: boolean
  /**
   * @array
   * @required
   */
  events: string[]
  /**
   * @optional
   * @default null
   */
  signatureKey?: string
  /**
   * @optional
   * @default true
   */
  enabled?: boolean | true
  /**
   * @optional
   * @default ""
   */
  logs?: string | ''
  /**
   * @optional
   * @default 0
   */
  attempts?: number | 0
}

// Document Types
export type UsersDoc = Doc<Users>
export type TeamsDoc = Doc<Teams>
export type TokensDoc = Doc<Tokens>
export type AuthenticatorsDoc = Doc<Authenticators>
export type ChallengesDoc = Doc<Challenges>
export type SessionsDoc = Doc<Sessions>
export type IdentitiesDoc = Doc<Identities>
export type TargetsDoc = Doc<Targets>
export type MembershipsDoc = Doc<Memberships>
export type BucketsDoc = Doc<Buckets>
export type StatsDoc = Doc<Stats>
export type ProvidersDoc = Doc<Providers>
export type MessagesDoc = Doc<Messages>
export type TopicsDoc = Doc<Topics>
export type SubscribersDoc = Doc<Subscribers>
export type CollectionsDoc = Doc<Collections>
export type AttributesDoc = Doc<Attributes>
export type IndexesDoc = Doc<Indexes>
export type FilesDoc = Doc<Files>
export type ProjectsDoc = Doc<Projects>
export type SchedulesDoc = Doc<Schedules>
export type PlatformsDoc = Doc<Platforms>
export type KeysDoc = Doc<Keys>
export type WebhooksDoc = Doc<Webhooks>

// Utility Types

// Utility types for Users
export type UsersCreate = Omit<
  Users,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type UsersUpdate = Partial<UsersCreate>
export type UsersKeys = keyof Users
export type UsersValues = Users[UsersKeys]
export type UsersPick<K extends keyof Users> = Pick<Users, K>
export type UsersOmit<K extends keyof Users> = Omit<Users, K>

// Utility types for Teams
export type TeamsCreate = Omit<
  Teams,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type TeamsUpdate = Partial<TeamsCreate>
export type TeamsKeys = keyof Teams
export type TeamsValues = Teams[TeamsKeys]
export type TeamsPick<K extends keyof Teams> = Pick<Teams, K>
export type TeamsOmit<K extends keyof Teams> = Omit<Teams, K>

// Utility types for Tokens
export type TokensCreate = Omit<
  Tokens,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type TokensUpdate = Partial<TokensCreate>
export type TokensKeys = keyof Tokens
export type TokensValues = Tokens[TokensKeys]
export type TokensPick<K extends keyof Tokens> = Pick<Tokens, K>
export type TokensOmit<K extends keyof Tokens> = Omit<Tokens, K>

// Utility types for Authenticators
export type AuthenticatorsCreate = Omit<
  Authenticators,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type AuthenticatorsUpdate = Partial<AuthenticatorsCreate>
export type AuthenticatorsKeys = keyof Authenticators
export type AuthenticatorsValues = Authenticators[AuthenticatorsKeys]
export type AuthenticatorsPick<K extends keyof Authenticators> = Pick<
  Authenticators,
  K
>
export type AuthenticatorsOmit<K extends keyof Authenticators> = Omit<
  Authenticators,
  K
>

// Utility types for Challenges
export type ChallengesCreate = Omit<
  Challenges,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type ChallengesUpdate = Partial<ChallengesCreate>
export type ChallengesKeys = keyof Challenges
export type ChallengesValues = Challenges[ChallengesKeys]
export type ChallengesPick<K extends keyof Challenges> = Pick<Challenges, K>
export type ChallengesOmit<K extends keyof Challenges> = Omit<Challenges, K>

// Utility types for Sessions
export type SessionsCreate = Omit<
  Sessions,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type SessionsUpdate = Partial<SessionsCreate>
export type SessionsKeys = keyof Sessions
export type SessionsValues = Sessions[SessionsKeys]
export type SessionsPick<K extends keyof Sessions> = Pick<Sessions, K>
export type SessionsOmit<K extends keyof Sessions> = Omit<Sessions, K>

// Utility types for Identities
export type IdentitiesCreate = Omit<
  Identities,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type IdentitiesUpdate = Partial<IdentitiesCreate>
export type IdentitiesKeys = keyof Identities
export type IdentitiesValues = Identities[IdentitiesKeys]
export type IdentitiesPick<K extends keyof Identities> = Pick<Identities, K>
export type IdentitiesOmit<K extends keyof Identities> = Omit<Identities, K>

// Utility types for Targets
export type TargetsCreate = Omit<
  Targets,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type TargetsUpdate = Partial<TargetsCreate>
export type TargetsKeys = keyof Targets
export type TargetsValues = Targets[TargetsKeys]
export type TargetsPick<K extends keyof Targets> = Pick<Targets, K>
export type TargetsOmit<K extends keyof Targets> = Omit<Targets, K>

// Utility types for Memberships
export type MembershipsCreate = Omit<
  Memberships,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type MembershipsUpdate = Partial<MembershipsCreate>
export type MembershipsKeys = keyof Memberships
export type MembershipsValues = Memberships[MembershipsKeys]
export type MembershipsPick<K extends keyof Memberships> = Pick<Memberships, K>
export type MembershipsOmit<K extends keyof Memberships> = Omit<Memberships, K>

// Utility types for Buckets
export type BucketsCreate = Omit<
  Buckets,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type BucketsUpdate = Partial<BucketsCreate>
export type BucketsKeys = keyof Buckets
export type BucketsValues = Buckets[BucketsKeys]
export type BucketsPick<K extends keyof Buckets> = Pick<Buckets, K>
export type BucketsOmit<K extends keyof Buckets> = Omit<Buckets, K>

// Utility types for Stats
export type StatsCreate = Omit<
  Stats,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type StatsUpdate = Partial<StatsCreate>
export type StatsKeys = keyof Stats
export type StatsValues = Stats[StatsKeys]
export type StatsPick<K extends keyof Stats> = Pick<Stats, K>
export type StatsOmit<K extends keyof Stats> = Omit<Stats, K>

// Utility types for Providers
export type ProvidersCreate = Omit<
  Providers,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type ProvidersUpdate = Partial<ProvidersCreate>
export type ProvidersKeys = keyof Providers
export type ProvidersValues = Providers[ProvidersKeys]
export type ProvidersPick<K extends keyof Providers> = Pick<Providers, K>
export type ProvidersOmit<K extends keyof Providers> = Omit<Providers, K>

// Utility types for Messages
export type MessagesCreate = Omit<
  Messages,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type MessagesUpdate = Partial<MessagesCreate>
export type MessagesKeys = keyof Messages
export type MessagesValues = Messages[MessagesKeys]
export type MessagesPick<K extends keyof Messages> = Pick<Messages, K>
export type MessagesOmit<K extends keyof Messages> = Omit<Messages, K>

// Utility types for Topics
export type TopicsCreate = Omit<
  Topics,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type TopicsUpdate = Partial<TopicsCreate>
export type TopicsKeys = keyof Topics
export type TopicsValues = Topics[TopicsKeys]
export type TopicsPick<K extends keyof Topics> = Pick<Topics, K>
export type TopicsOmit<K extends keyof Topics> = Omit<Topics, K>

// Utility types for Subscribers
export type SubscribersCreate = Omit<
  Subscribers,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type SubscribersUpdate = Partial<SubscribersCreate>
export type SubscribersKeys = keyof Subscribers
export type SubscribersValues = Subscribers[SubscribersKeys]
export type SubscribersPick<K extends keyof Subscribers> = Pick<Subscribers, K>
export type SubscribersOmit<K extends keyof Subscribers> = Omit<Subscribers, K>

// Utility types for Collections
export type CollectionsCreate = Omit<
  Collections,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type CollectionsUpdate = Partial<CollectionsCreate>
export type CollectionsKeys = keyof Collections
export type CollectionsValues = Collections[CollectionsKeys]
export type CollectionsPick<K extends keyof Collections> = Pick<Collections, K>
export type CollectionsOmit<K extends keyof Collections> = Omit<Collections, K>

// Utility types for Attributes
export type AttributesCreate = Omit<
  Attributes,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type AttributesUpdate = Partial<AttributesCreate>
export type AttributesKeys = keyof Attributes
export type AttributesValues = Attributes[AttributesKeys]
export type AttributesPick<K extends keyof Attributes> = Pick<Attributes, K>
export type AttributesOmit<K extends keyof Attributes> = Omit<Attributes, K>

// Utility types for Indexes
export type IndexesCreate = Omit<
  Indexes,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type IndexesUpdate = Partial<IndexesCreate>
export type IndexesKeys = keyof Indexes
export type IndexesValues = Indexes[IndexesKeys]
export type IndexesPick<K extends keyof Indexes> = Pick<Indexes, K>
export type IndexesOmit<K extends keyof Indexes> = Omit<Indexes, K>

// Utility types for Files
export type FilesCreate = Omit<
  Files,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type FilesUpdate = Partial<FilesCreate>
export type FilesKeys = keyof Files
export type FilesValues = Files[FilesKeys]
export type FilesPick<K extends keyof Files> = Pick<Files, K>
export type FilesOmit<K extends keyof Files> = Omit<Files, K>

// Utility types for Projects
export type ProjectsCreate = Omit<
  Projects,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type ProjectsUpdate = Partial<ProjectsCreate>
export type ProjectsKeys = keyof Projects
export type ProjectsValues = Projects[ProjectsKeys]
export type ProjectsPick<K extends keyof Projects> = Pick<Projects, K>
export type ProjectsOmit<K extends keyof Projects> = Omit<Projects, K>

// Utility types for Schedules
export type SchedulesCreate = Omit<
  Schedules,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type SchedulesUpdate = Partial<SchedulesCreate>
export type SchedulesKeys = keyof Schedules
export type SchedulesValues = Schedules[SchedulesKeys]
export type SchedulesPick<K extends keyof Schedules> = Pick<Schedules, K>
export type SchedulesOmit<K extends keyof Schedules> = Omit<Schedules, K>

// Utility types for Platforms
export type PlatformsCreate = Omit<
  Platforms,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type PlatformsUpdate = Partial<PlatformsCreate>
export type PlatformsKeys = keyof Platforms
export type PlatformsValues = Platforms[PlatformsKeys]
export type PlatformsPick<K extends keyof Platforms> = Pick<Platforms, K>
export type PlatformsOmit<K extends keyof Platforms> = Omit<Platforms, K>

// Utility types for Keys
export type KeysCreate = Omit<
  Keys,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type KeysUpdate = Partial<KeysCreate>
export type KeysKeys = keyof Keys
export type KeysValues = Keys[KeysKeys]
export type KeysPick<K extends keyof Keys> = Pick<Keys, K>
export type KeysOmit<K extends keyof Keys> = Omit<Keys, K>

// Utility types for Webhooks
export type WebhooksCreate = Omit<
  Webhooks,
  '$id' | '$createdAt' | '$updatedAt' | '$sequence'
>
export type WebhooksUpdate = Partial<WebhooksCreate>
export type WebhooksKeys = keyof Webhooks
export type WebhooksValues = Webhooks[WebhooksKeys]
export type WebhooksPick<K extends keyof Webhooks> = Pick<Webhooks, K>
export type WebhooksOmit<K extends keyof Webhooks> = Omit<Webhooks, K>

// Input Types

// Input types for Users
export type UsersInput = Omit<
  Users,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type UsersCreateInput = UsersInput
export type UsersUpdateInput = Partial<UsersInput>

// Input types for Teams
export type TeamsInput = Omit<
  Teams,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type TeamsCreateInput = TeamsInput
export type TeamsUpdateInput = Partial<TeamsInput>

// Input types for Tokens
export type TokensInput = Omit<
  Tokens,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type TokensCreateInput = TokensInput
export type TokensUpdateInput = Partial<TokensInput>

// Input types for Authenticators
export type AuthenticatorsInput = Omit<
  Authenticators,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type AuthenticatorsCreateInput = AuthenticatorsInput
export type AuthenticatorsUpdateInput = Partial<AuthenticatorsInput>

// Input types for Challenges
export type ChallengesInput = Omit<
  Challenges,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type ChallengesCreateInput = ChallengesInput
export type ChallengesUpdateInput = Partial<ChallengesInput>

// Input types for Sessions
export type SessionsInput = Omit<
  Sessions,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type SessionsCreateInput = SessionsInput
export type SessionsUpdateInput = Partial<SessionsInput>

// Input types for Identities
export type IdentitiesInput = Omit<
  Identities,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type IdentitiesCreateInput = IdentitiesInput
export type IdentitiesUpdateInput = Partial<IdentitiesInput>

// Input types for Targets
export type TargetsInput = Omit<
  Targets,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type TargetsCreateInput = TargetsInput
export type TargetsUpdateInput = Partial<TargetsInput>

// Input types for Memberships
export type MembershipsInput = Omit<
  Memberships,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type MembershipsCreateInput = MembershipsInput
export type MembershipsUpdateInput = Partial<MembershipsInput>

// Input types for Buckets
export type BucketsInput = Omit<
  Buckets,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type BucketsCreateInput = BucketsInput
export type BucketsUpdateInput = Partial<BucketsInput>

// Input types for Stats
export type StatsInput = Omit<
  Stats,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type StatsCreateInput = StatsInput
export type StatsUpdateInput = Partial<StatsInput>

// Input types for Providers
export type ProvidersInput = Omit<
  Providers,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type ProvidersCreateInput = ProvidersInput
export type ProvidersUpdateInput = Partial<ProvidersInput>

// Input types for Messages
export type MessagesInput = Omit<
  Messages,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type MessagesCreateInput = MessagesInput
export type MessagesUpdateInput = Partial<MessagesInput>

// Input types for Topics
export type TopicsInput = Omit<
  Topics,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type TopicsCreateInput = TopicsInput
export type TopicsUpdateInput = Partial<TopicsInput>

// Input types for Subscribers
export type SubscribersInput = Omit<
  Subscribers,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type SubscribersCreateInput = SubscribersInput
export type SubscribersUpdateInput = Partial<SubscribersInput>

// Input types for Collections
export type CollectionsInput = Omit<
  Collections,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type CollectionsCreateInput = CollectionsInput
export type CollectionsUpdateInput = Partial<CollectionsInput>

// Input types for Attributes
export type AttributesInput = Omit<
  Attributes,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type AttributesCreateInput = AttributesInput
export type AttributesUpdateInput = Partial<AttributesInput>

// Input types for Indexes
export type IndexesInput = Omit<
  Indexes,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type IndexesCreateInput = IndexesInput
export type IndexesUpdateInput = Partial<IndexesInput>

// Input types for Files
export type FilesInput = Omit<
  Files,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type FilesCreateInput = FilesInput
export type FilesUpdateInput = Partial<FilesInput>

// Input types for Projects
export type ProjectsInput = Omit<
  Projects,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type ProjectsCreateInput = ProjectsInput
export type ProjectsUpdateInput = Partial<ProjectsInput>

// Input types for Schedules
export type SchedulesInput = Omit<
  Schedules,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type SchedulesCreateInput = SchedulesInput
export type SchedulesUpdateInput = Partial<SchedulesInput>

// Input types for Platforms
export type PlatformsInput = Omit<
  Platforms,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type PlatformsCreateInput = PlatformsInput
export type PlatformsUpdateInput = Partial<PlatformsInput>

// Input types for Keys
export type KeysInput = Omit<
  Keys,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type KeysCreateInput = KeysInput
export type KeysUpdateInput = Partial<KeysInput>

// Input types for Webhooks
export type WebhooksInput = Omit<
  Webhooks,
  | '$id'
  | '$createdAt'
  | '$updatedAt'
  | '$permissions'
  | '$sequence'
  | '$collection'
  | '$tenant'
>
export type WebhooksCreateInput = WebhooksInput
export type WebhooksUpdateInput = Partial<WebhooksInput>

export interface Entities {
  users: Users
  teams: Teams
  tokens: Tokens
  authenticators: Authenticators
  challenges: Challenges
  sessions: Sessions
  identities: Identities
  targets: Targets
  memberships: Memberships
  buckets: Buckets
  stats: Stats
  providers: Providers
  messages: Messages
  topics: Topics
  subscribers: Subscribers
  _collections: Collections
  _attributes: Attributes
  _indexes: Indexes
  files: Files
  projects: Projects
  schedules: Schedules
  platforms: Platforms
  keys: Keys
  webhooks: Webhooks
}
