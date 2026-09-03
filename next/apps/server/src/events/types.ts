export interface EventPayload<T = unknown> {
  readonly event: string
  readonly projectId: string
  readonly timestamp: string
  readonly data: T
  readonly userId?: string
}

export const STANDARD_EVENTS = Object.freeze({
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DELETE: 'users.delete',
  SESSIONS_CREATE: 'users.sessions.create',
  SESSIONS_DELETE: 'users.sessions.delete',

  TEAMS_CREATE: 'teams.create',
  TEAMS_UPDATE: 'teams.update',
  TEAMS_DELETE: 'teams.delete',
  MEMBERSHIPS_CREATE: 'teams.memberships.create',
  MEMBERSHIPS_DELETE: 'teams.memberships.delete',

  BUCKETS_CREATE: 'storage.buckets.create',
  BUCKETS_UPDATE: 'storage.buckets.update',
  BUCKETS_DELETE: 'storage.buckets.delete',
  OBJECTS_CREATE: 'storage.objects.create',
  OBJECTS_DELETE: 'storage.objects.delete',

  MESSAGES_CREATE: 'messaging.messages.create',
  MESSAGES_SEND: 'messaging.messages.send',

  WEBHOOKS_CREATE: 'webhooks.create',
  WEBHOOKS_UPDATE: 'webhooks.update',
  WEBHOOKS_DELETE: 'webhooks.delete',
} as const)

export type StandardEvent = (typeof STANDARD_EVENTS)[keyof typeof STANDARD_EVENTS]
