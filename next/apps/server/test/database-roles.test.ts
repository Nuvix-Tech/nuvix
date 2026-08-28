import { describe, expect, test } from 'bun:test'
import { rolesFor } from '../src/context/database-roles'
import type { ProjectAuthContext, ProjectContext, TeamClaim } from '../src/context/project'
import { ForbiddenError } from '../src/shared/errors'

const PROJECT: ProjectContext = {
  id: 'project-1',
  internalId: '17',
  enabled: true,
}

describe('database role mapping', () => {
  test.each([
    {
      name: 'guest',
      auth: { type: 'guest' } as const,
      expected: ['any', 'guests'],
    },
    {
      name: 'verified user with team and label claims',
      auth: {
        type: 'session',
        sessionId: 'session-1',
        userId: 'user-1',
        projectId: PROJECT.id,
        verified: true,
        teams: [
          { teamId: 'team-2', roles: ['viewer', 'owner', 'owner'] },
          { teamId: 'team-1', roles: [] },
          { teamId: 'team-2', roles: ['viewer'] },
        ],
        labels: ['staff', 'beta', 'staff'],
        scopes: ['users.read'],
      } satisfies ProjectAuthContext,
      expected: [
        'any',
        'users',
        'users/verified',
        'user:user-1',
        'user:user-1/verified',
        'team:team-1',
        'team:team-2',
        'team:team-2/owner',
        'team:team-2/viewer',
        'label:beta',
        'label:staff',
      ],
    },
    {
      name: 'unverified user without optional claims',
      auth: {
        type: 'jwt',
        userId: 'user-2',
        projectId: PROJECT.id,
        verified: false,
        scopes: [],
      } satisfies ProjectAuthContext,
      expected: ['any', 'users', 'users/unverified', 'user:user-2', 'user:user-2/unverified'],
    },
  ])('constructs canonical roles for $name', ({ auth, expected }) => {
    expect(rolesFor(auth, PROJECT)).toEqual(expected)
  })

  test('does not grant admin roles from API key mode', () => {
    const auth: ProjectAuthContext = {
      type: 'apiKey',
      keyId: 'key-1',
      mode: 'admin',
      projectId: PROJECT.id,
      scopes: ['schemas.write'],
    }

    expect(rolesFor(auth, PROJECT)).toEqual(['any'])
  })

  test('orders disjoint roles from duplicate team claims canonically', () => {
    const claims = [
      { teamId: 'team-1', roles: ['viewer'] },
      { teamId: 'team-1', roles: ['owner'] },
    ] as const
    const auth = (teams: readonly TeamClaim[]): ProjectAuthContext => ({
      type: 'jwt',
      userId: 'user-1',
      projectId: PROJECT.id,
      verified: true,
      scopes: [],
      teams,
    })

    const forward = rolesFor(auth(claims), PROJECT)
    const reversed = rolesFor(auth(claims.toReversed()), PROJECT)

    expect(forward).toEqual(reversed)
    expect(forward).toContain('team:team-1/owner')
    expect(forward).toContain('team:team-1/viewer')
    expect(forward.indexOf('team:team-1/owner')).toBeLessThan(forward.indexOf('team:team-1/viewer'))
  })

  test('rejects credentials bound to another project', () => {
    const auth: ProjectAuthContext = {
      type: 'jwt',
      userId: 'user-1',
      projectId: 'project-2',
      verified: false,
      scopes: [],
    }

    expect(() => rolesFor(auth, PROJECT)).toThrow(ForbiddenError)
  })

  test('rejects disabled projects', () => {
    expect(() => rolesFor({ type: 'guest' }, { ...PROJECT, enabled: false })).toThrow(
      ForbiddenError,
    )
  })

  test.each([
    {
      name: 'empty user ID',
      claims: { userId: '' },
    },
    {
      name: 'unnormalized user ID',
      claims: { userId: 'e\u0301' },
    },
    {
      name: 'delimiter-injecting team ID',
      claims: { teams: [{ teamId: 'team:admin', roles: [] }] },
    },
    {
      name: 'delimiter-injecting membership role',
      claims: { teams: [{ teamId: 'team-1', roles: ['owner/admin'] }] },
    },
    {
      name: 'empty membership role',
      claims: { teams: [{ teamId: 'team-1', roles: [''] }] },
    },
    {
      name: 'unsupported label characters',
      claims: { labels: ['staff access'] },
    },
  ])('rejects $name', ({ claims }) => {
    const auth: ProjectAuthContext = {
      type: 'jwt',
      userId: 'user-1',
      projectId: PROJECT.id,
      verified: true,
      scopes: [],
      ...claims,
    }

    expect(() => rolesFor(auth, PROJECT)).toThrow(ForbiddenError)
  })
})
