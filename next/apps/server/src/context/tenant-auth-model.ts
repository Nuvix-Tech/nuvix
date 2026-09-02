export interface TenantAuthModel {
  readonly collections: {
    readonly users: string
    readonly sessions: string
    readonly memberships: string
    readonly apiKeys: string
    readonly jwtKeys: string
  }
  readonly fields: {
    readonly users: {
      readonly name: string
      readonly email: string
      readonly phone: string
      readonly status: string
      readonly emailVerified: string
      readonly phoneVerified: string
      readonly labels: string
      readonly prefs: string
      readonly passwordHash: string
      readonly passwordUpdate: string
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
    readonly jwtKeys: {
      readonly signingKey: string
      readonly algorithm: string
      readonly active: string
      readonly expiresAt: string
    }
  }
}

export const TENANT_AUTH_MODEL = {
  collections: {
    users: 'users',
    sessions: 'sessions',
    memberships: 'memberships',
    apiKeys: 'api_keys',
    jwtKeys: 'jwt_keys',
  },
  fields: {
    users: {
      name: 'name',
      email: 'email',
      phone: 'phone',
      status: 'status',
      emailVerified: 'emailVerified',
      phoneVerified: 'phoneVerified',
      labels: 'labels',
      prefs: 'prefs',
      passwordHash: 'passwordHash',
      passwordUpdate: 'passwordUpdate',
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
    jwtKeys: {
      signingKey: 'signingKey',
      algorithm: 'algorithm',
      active: 'active',
      expiresAt: 'expiresAt',
    },
  },
} as const satisfies TenantAuthModel
