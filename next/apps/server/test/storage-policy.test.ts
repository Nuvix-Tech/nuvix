import { describe, expect, test } from 'bun:test'
import type { ProjectAuthContext } from '../src/context/project'
import { type BucketPolicy, evaluateStorageAccess, STORAGE_ACTIONS } from '../src/storage/policy'

const GUEST_AUTH: ProjectAuthContext = { type: 'guest' }
const USER_AUTH: ProjectAuthContext = {
  type: 'session',
  userId: 'user_123',
  sessionId: 'session_abc',
  verified: true,
  labels: [],
  teams: [{ teamId: 'team_dev', roles: ['member'] }],
  scopes: [],
}
const OTHER_USER_AUTH: ProjectAuthContext = {
  type: 'session',
  userId: 'user_999',
  sessionId: 'session_xyz',
  verified: true,
  labels: [],
  teams: [],
  scopes: [],
}
const API_KEY_AUTH: ProjectAuthContext = {
  type: 'apiKey',
  keyId: 'key_1',
  mode: 'admin',
  scopes: ['files.read', 'files.write'],
}

describe('S3 Bucket Policy and ACL evaluation', () => {
  test('evaluates public allow policy for GetObject on path prefix', () => {
    const policy: BucketPolicy = {
      statements: [
        {
          sid: 'PublicAvatars',
          effect: 'allow',
          principal: '*',
          actions: ['storage:GetObject'],
          resources: ['avatars/*'],
        },
      ],
    }

    expect(
      evaluateStorageAccess({
        auth: GUEST_AUTH,
        action: STORAGE_ACTIONS.get,
        resourceKey: 'avatars/user1.png',
        policy,
      }),
    ).toBe('allow')

    // Denied on non-matching path
    expect(
      evaluateStorageAccess({
        auth: GUEST_AUTH,
        action: STORAGE_ACTIONS.get,
        resourceKey: 'private/doc.pdf',
        policy,
      }),
    ).toBe('deny')

    // Denied on non-matching action (e.g. PutObject)
    expect(
      evaluateStorageAccess({
        auth: GUEST_AUTH,
        action: STORAGE_ACTIONS.put,
        resourceKey: 'avatars/user1.png',
        policy,
      }),
    ).toBe('deny')
  })

  test('explicit deny statement overrides allow statement', () => {
    const policy: BucketPolicy = {
      statements: [
        {
          sid: 'AllowAll',
          effect: 'allow',
          principal: '*',
          actions: ['storage:*'],
          resources: ['*'],
        },
        {
          sid: 'DenySecretFolder',
          effect: 'deny',
          principal: '*',
          actions: ['storage:GetObject'],
          resources: ['secrets/*'],
        },
      ],
    }

    expect(
      evaluateStorageAccess({
        auth: USER_AUTH,
        action: STORAGE_ACTIONS.get,
        resourceKey: 'public/file.txt',
        policy,
      }),
    ).toBe('allow')

    // Explicit deny overrides allow
    expect(
      evaluateStorageAccess({
        auth: USER_AUTH,
        action: STORAGE_ACTIONS.get,
        resourceKey: 'secrets/keys.txt',
        policy,
      }),
    ).toBe('deny')
  })

  test('evaluates team-based principal matching', () => {
    const policy: BucketPolicy = {
      statements: [
        {
          sid: 'TeamDevOnly',
          effect: 'allow',
          principal: 'team:team_dev',
          actions: ['storage:PutObject'],
          resources: ['builds/*'],
        },
      ],
    }

    expect(
      evaluateStorageAccess({
        auth: USER_AUTH,
        action: STORAGE_ACTIONS.put,
        resourceKey: 'builds/app.tar.gz',
        policy,
      }),
    ).toBe('allow')

    expect(
      evaluateStorageAccess({
        auth: OTHER_USER_AUTH,
        action: STORAGE_ACTIONS.put,
        resourceKey: 'builds/app.tar.gz',
        policy,
      }),
    ).toBe('deny')
  })

  test('falls back to Nuvix document permissions when no policy matches', () => {
    expect(
      evaluateStorageAccess({
        auth: GUEST_AUTH,
        action: STORAGE_ACTIONS.get,
        resourceKey: 'file.png',
        objectPermissions: ['read("any")'],
      }),
    ).toBe('allow')

    expect(
      evaluateStorageAccess({
        auth: USER_AUTH,
        action: STORAGE_ACTIONS.put,
        resourceKey: 'profile.jpg',
        objectPermissions: ['write("user:user_123")'],
      }),
    ).toBe('allow')

    expect(
      evaluateStorageAccess({
        auth: OTHER_USER_AUTH,
        action: STORAGE_ACTIONS.put,
        resourceKey: 'profile.jpg',
        objectPermissions: ['write("user:user_123")'],
      }),
    ).toBe('deny')
  })

  test('falls back to API key scopes', () => {
    expect(
      evaluateStorageAccess({
        auth: API_KEY_AUTH,
        action: STORAGE_ACTIONS.get,
        resourceKey: 'any/file.txt',
      }),
    ).toBe('allow')

    expect(
      evaluateStorageAccess({
        auth: API_KEY_AUTH,
        action: STORAGE_ACTIONS.put,
        resourceKey: 'any/file.txt',
      }),
    ).toBe('allow')
  })
})
