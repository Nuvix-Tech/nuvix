export interface TenantAuthModel {
  readonly collections: {
    readonly users: string
    readonly sessions: string
    readonly memberships: string
    readonly apiKeys: string
  }
  readonly fields: {
    readonly users: {
      readonly status: string
      readonly emailVerified: string
      readonly phoneVerified: string
      readonly labels: string
    }
    readonly sessions: {
      readonly userId: string
      readonly secretDigest: string
      readonly secretSalt: string
      readonly expiresAt: string
      readonly revokedAt: string
    }
    readonly memberships: {
      readonly userId: string
      readonly teamId: string
      readonly roles: string
      readonly status: string
      readonly invited: string
      readonly joined: string
      readonly secretDigest: string
      readonly secretSalt: string
      readonly inviteExpiresAt: string
    }
    readonly apiKeys: {
      readonly secretDigest: string
      readonly secretSalt: string
      readonly scopes: string
      readonly modes: string
      readonly enabled: string
      readonly expiresAt: string
      readonly revokedAt: string
    }
  }
}

export const TENANT_AUTH_MODEL = {
  collections: {
    users: 'users',
    sessions: 'sessions',
    memberships: 'memberships',
    apiKeys: 'api_keys',
  },
  fields: {
    users: {
      status: 'status',
      emailVerified: 'emailVerified',
      phoneVerified: 'phoneVerified',
      labels: 'labels',
    },
    sessions: {
      userId: 'userId',
      secretDigest: 'secretDigest',
      secretSalt: 'secretSalt',
      expiresAt: 'expiresAt',
      revokedAt: 'revokedAt',
    },
    memberships: {
      userId: 'userId',
      teamId: 'teamId',
      roles: 'roles',
      status: 'status',
      invited: 'invited',
      joined: 'joined',
      secretDigest: 'secretDigest',
      secretSalt: 'secretSalt',
      inviteExpiresAt: 'inviteExpiresAt',
    },
    apiKeys: {
      secretDigest: 'secretDigest',
      secretSalt: 'secretSalt',
      scopes: 'scopes',
      modes: 'modes',
      enabled: 'enabled',
      expiresAt: 'expiresAt',
      revokedAt: 'revokedAt',
    },
  },
} as const satisfies TenantAuthModel
