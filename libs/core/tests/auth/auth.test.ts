import { Authorization, Doc, ID, Role, UserDimension } from '@nuvix/db'
import { HashAlgorithm, SessionProvider, TokenType } from '@nuvix/utils'
import { Sessions, Tokens, Users } from '@nuvix/utils/types'
import { afterEach, describe, expect, test } from 'vitest'
import { Auth } from '../../src/helpers'

describe('Auth', () => {
  /**
   * Reset Roles
   */
  afterEach(() => {
    Authorization.cleanRoles()
    Authorization.setRole(Role.any().toString())
  })

  test('encode decode session', () => {
    const id = 'test-session-id'
    const secret = 'test-secret-key'

    // Encode the session
    const encoded = Auth.encodeSession(id, secret)

    // Verify it has the v1: prefix
    expect(encoded.startsWith('v1:')).toBe(true)

    // Decode with full prefix to verify round-trip
    const decoded = Auth.decodeSession(encoded)

    expect(decoded).toEqual({ id, secret })

    // Legacy format test - verify backward compatibility
    const legacySession = 'eyJpZC...0In0='
    expect(Auth.decodeSession(legacySession)).toEqual({
      id: 'id',
      secret: 'secret',
    })
  })

  test('hash', () => {
    const secret = 'secret'
    expect(Auth.hash(secret)).toBe(
      '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b',
    )
  })

  test('password hashing and verification', async () => {
    // ----- BCRYPT -----
    const bcryptTests = [
      { plain: 'nuvix123' },
      { plain: 'secureNuvixPass' },
      { plain: 'NuvixIsAwesome' },
    ]

    for (const { plain } of bcryptTests) {
      const generatedHash = await Auth.passwordHash(plain, HashAlgorithm.BCRYPT)
      expect(generatedHash).toMatch(/^\$2[aby]\$.{56}$/) // Bcrypt hash pattern
      await expect(
        Auth.passwordVerify(plain, generatedHash!, HashAlgorithm.BCRYPT),
      ).resolves.toBe(true)
      await expect(
        Auth.passwordVerify(
          'wrongPassword',
          generatedHash!,
          HashAlgorithm.BCRYPT,
        ),
      ).resolves.toBe(false)
    }

    // ----- MD5 -----
    const md5Tests = ['NuvixApp', 'NuvixBackendService']

    for (const plain of md5Tests) {
      const hash = await Auth.passwordHash(plain, HashAlgorithm.MD5)
      expect(hash).toMatch(/^[a-f0-9]{32}$/) // MD5 hash pattern
      await expect(
        Auth.passwordVerify(plain, hash!, HashAlgorithm.MD5),
      ).resolves.toBe(true)
      await expect(
        Auth.passwordVerify('wrongPassword', hash!, HashAlgorithm.MD5),
      ).resolves.toBe(false)
    }

    // ----- SHA -----
    const shaTests = ['NuvixDevelopers']

    for (const plain of shaTests) {
      const hash = await Auth.passwordHash(plain, HashAlgorithm.SHA)
      expect(hash).toMatch(/^[a-f0-9]{64}$/) // SHA-256 hash pattern
      await expect(
        Auth.passwordVerify(plain, hash!, HashAlgorithm.SHA),
      ).resolves.toBe(true)
      await expect(
        Auth.passwordVerify('wrongPassword', hash!, HashAlgorithm.SHA),
      ).resolves.toBe(false)
    }

    // ----- ARGON2 -----
    const argonTests = ['NuvixSecurePass']

    for (const plain of argonTests) {
      const hash = await Auth.passwordHash(plain, HashAlgorithm.ARGON2)
      expect(hash).toMatch(/^\$argon2(id|i|d)\$.+/) // Argon2 hash pattern
      await expect(
        Auth.passwordVerify(plain, hash!, HashAlgorithm.ARGON2),
      ).resolves.toBe(true)
      await expect(
        Auth.passwordVerify('wrongPassword', hash!, HashAlgorithm.ARGON2),
      ).resolves.toBe(false)
    }

    // // ----- SCRYPT -----
    const scryptOptions = {
      salt: 'nuvixSalt',
      length: 64,
      costCpu: 16384,
      costMemory: 12,
      costParallel: 2,
    }
    const scryptTests = ['NuvixScryptPass']

    for (const plain of scryptTests) {
      const hash = await Auth.passwordHash(
        plain,
        HashAlgorithm.SCRYPT,
        scryptOptions,
      )
      expect(hash).toMatch(/^[a-f0-9]{128}$/) // Scrypt hash pattern (64 bytes in hex)
      await expect(
        Auth.passwordVerify(plain, hash!, HashAlgorithm.SCRYPT, scryptOptions),
      ).resolves.toBe(true)
      await expect(
        Auth.passwordVerify(
          'wrongPassword',
          hash!,
          HashAlgorithm.SCRYPT,
          scryptOptions,
        ),
      ).resolves.toBe(false)
    }
  })

  test('unknown algo', async () => {
    const plain = 'whatIsMd8?!?'
    await expect(Auth.passwordHash(plain, 'md8' as any)).rejects.toThrow(
      Error("Hashing algorithm 'md8' is not supported."),
    )
  })

  test('password generator', () => {
    expect(Auth.passwordGenerator().length).toBe(40)
    expect(Auth.passwordGenerator(5).length).toBe(10)
  })

  test('token generator', () => {
    expect(Auth.tokenGenerator().length).toBe(256)
    expect(Auth.tokenGenerator(5).length).toBe(5)
  })

  test('code generator', () => {
    expect(Auth.codeGenerator().length).toBe(6)
    expect(Auth.codeGenerator(256).length).toBe(256)
    expect(Auth.codeGenerator(10).length).toBe(10)
    expect(Number.isInteger(Number(Auth.codeGenerator(5)))).toBe(true)
  })

  test('session verify', () => {
    const expireTime1 = 60 * 60 * 24

    const secret = 'secret1'
    const hash = Auth.hash(secret)
    const tokens1 = [
      new Doc<Sessions>({
        $id: ID.custom('token1'),
        secret: hash,
        provider: SessionProvider.EMAIL,
        providerUid: 'test@example.com',
        expire: new Date(Date.now() + expireTime1).toISOString(),
      }),
      new Doc<Sessions>({
        $id: ID.custom('token2'),
        secret: 'secret2',
        provider: SessionProvider.EMAIL,
        providerUid: 'test@example.com',
        expire: new Date(Date.now() + expireTime1).toISOString(),
      }),
    ]

    const expireTime2 = -60 * 60 * 24

    const tokens2 = [
      new Doc<Sessions>({
        // Correct secret and type time, wrong expire time
        $id: ID.custom('token1'),
        secret: hash,
        provider: SessionProvider.EMAIL,
        providerUid: 'test@example.com',
        expire: new Date(Date.now() + expireTime2).toISOString(),
      }),
      new Doc<Sessions>({
        $id: ID.custom('token2'),
        secret: 'secret2',
        provider: SessionProvider.EMAIL,
        providerUid: 'test@example.com',
        expire: new Date(Date.now() + expireTime2).toISOString(),
      }),
    ]

    expect(Auth.sessionVerify(tokens1, secret)).toBe('token1')
    expect(Auth.sessionVerify(tokens1, 'false-secret')).toBe(false)
    expect(Auth.sessionVerify(tokens2, secret)).toBe(false)
    expect(Auth.sessionVerify(tokens2, 'false-secret')).toBe(false)
  })

  test('token verify', () => {
    const secret = 'secret1'
    const hash = Auth.hash(secret)
    const tokens1 = [
      new Doc<Tokens>({
        $id: ID.custom('token1'),
        type: TokenType.RECOVERY,
        expire: new Date(Date.now() + 60 * 60 * 24).toISOString(),
        secret: hash,
      }),
      new Doc<Tokens>({
        $id: ID.custom('token2'),
        type: TokenType.RECOVERY,
        expire: new Date(Date.now() - 60 * 60 * 24).toISOString(),
        secret: 'secret2',
      }),
    ]

    const tokens2 = [
      new Doc<Tokens>({
        // Correct secret and type time, wrong expire time
        $id: ID.custom('token1'),
        type: TokenType.RECOVERY,
        expire: new Date(Date.now() - 60 * 60 * 24 * 1000).toISOString(),
        secret: hash,
      }),
      new Doc<Tokens>({
        $id: ID.custom('token2'),
        type: TokenType.RECOVERY,
        expire: new Date(Date.now() - 60 * 60 * 24 * 1000).toISOString(),
        secret: 'secret2',
      }),
    ]

    const tokens3 = [
      // Correct secret and expire time, wrong type
      new Doc<Tokens>({
        $id: ID.custom('token1'),
        type: TokenType.INVITE,
        expire: new Date(Date.now() + 60 * 60 * 24).toISOString(),
        secret: hash,
      }),
      new Doc<Tokens>({
        $id: ID.custom('token2'),
        type: TokenType.RECOVERY,
        expire: new Date(Date.now() - 60 * 60 * 24).toISOString(),
        secret: 'secret2',
      }),
    ]

    expect(Auth.tokenVerify(tokens1, TokenType.RECOVERY, secret)).toBe(
      tokens1[0],
    )
    expect(Auth.tokenVerify(tokens1, null, secret)).toBe(tokens1[0])
    expect(Auth.tokenVerify(tokens1, TokenType.RECOVERY, 'false-secret')).toBe(
      false,
    )
    expect(Auth.tokenVerify(tokens2, TokenType.RECOVERY, secret)).toBe(false)
    expect(Auth.tokenVerify(tokens2, TokenType.RECOVERY, 'false-secret')).toBe(
      false,
    )
    expect(Auth.tokenVerify(tokens3, TokenType.RECOVERY, secret)).toBe(false)
    expect(Auth.tokenVerify(tokens3, TokenType.RECOVERY, 'false-secret')).toBe(
      false,
    )
  })

  test('guest roles', () => {
    const user = new Doc<Users>({
      $id: '',
    })

    const roles = Auth.getRoles(user)
    expect(roles).toHaveLength(1)
    expect(roles).toContain(Role.guests().toString())
  })

  test('user roles', () => {
    const user = new Doc<Users>({
      $id: ID.custom('123'),
      labels: ['vip', 'admin'],
      emailVerification: true,
      phoneVerification: true,
      memberships: [
        {
          $id: ID.custom('456'),
          teamId: ID.custom('abc'),
          confirm: true,
          roles: ['administrator', 'moderator'],
        },
        {
          $id: ID.custom('abc'),
          teamId: ID.custom('def'),
          confirm: true,
          roles: ['guest'],
        },
      ],
    })

    const roles = Auth.getRoles(user)

    expect(roles).toHaveLength(13)
    expect(roles).toContain(Role.users().toString())
    expect(roles).toContain(Role.user(ID.custom('123')).toString())
    expect(roles).toContain(Role.users(UserDimension.VERIFIED).toString())
    expect(roles).toContain(
      Role.user(ID.custom('123'), UserDimension.VERIFIED).toString(),
    )
    expect(roles).toContain(Role.team(ID.custom('abc')).toString())
    expect(roles).toContain(
      Role.team(ID.custom('abc'), 'administrator').toString(),
    )
    expect(roles).toContain(Role.team(ID.custom('abc'), 'moderator').toString())
    expect(roles).toContain(Role.team(ID.custom('def')).toString())
    expect(roles).toContain(Role.team(ID.custom('def'), 'guest').toString())
    expect(roles).toContain(Role.member(ID.custom('456')).toString())
    expect(roles).toContain(Role.member(ID.custom('abc')).toString())
    expect(roles).toContain('label:vip')
    expect(roles).toContain('label:admin')

    // Disable all verification
    user.set('emailVerification', false)
    user.set('phoneVerification', false)

    const roles2 = Auth.getRoles(user)
    expect(roles2).toContain(Role.users(UserDimension.UNVERIFIED).toString())
    expect(roles2).toContain(
      Role.user(ID.custom('123'), UserDimension.UNVERIFIED).toString(),
    )

    // Enable single verification type
    user.set('emailVerification', true)

    const roles3 = Auth.getRoles(user)
    expect(roles3).toContain(Role.users(UserDimension.VERIFIED).toString())
    expect(roles3).toContain(
      Role.user(ID.custom('123'), UserDimension.VERIFIED).toString(),
    )
  })

  test('privileged user roles', () => {
    const user = new Doc<Users>({
      $id: ID.custom('123'),
      emailVerification: true,
      phoneVerification: true,
      memberships: [
        {
          $id: ID.custom('def'),
          teamId: ID.custom('abc'),
          confirm: true,
          roles: ['administrator', 'moderator'],
        },
        {
          $id: ID.custom('abc'),
          teamId: ID.custom('def'),
          confirm: true,
          roles: ['guest'],
        },
      ],
    })

    const roles = Auth.getRoles(user, true, false)

    expect(roles).toHaveLength(7)
    expect(roles).not.toContain(Role.users().toString())
    expect(roles).not.toContain(Role.user(ID.custom('123')).toString())
    expect(roles).not.toContain(Role.users(UserDimension.VERIFIED).toString())
    expect(roles).not.toContain(
      Role.user(ID.custom('123'), UserDimension.VERIFIED).toString(),
    )
    expect(roles).toContain(Role.team(ID.custom('abc')).toString())
    expect(roles).toContain(
      Role.team(ID.custom('abc'), 'administrator').toString(),
    )
    expect(roles).toContain(Role.team(ID.custom('abc'), 'moderator').toString())
    expect(roles).toContain(Role.team(ID.custom('def')).toString())
    expect(roles).toContain(Role.team(ID.custom('def'), 'guest').toString())
    expect(roles).toContain(Role.member(ID.custom('def')).toString())
    expect(roles).toContain(Role.member(ID.custom('abc')).toString())
  })

  test('app user roles', () => {
    const user = new Doc<Users>({
      $id: ID.custom('123'),
      memberships: [
        {
          $id: ID.custom('def'),
          teamId: ID.custom('abc'),
          confirm: true,
          roles: ['administrator', 'moderator'],
        },
        {
          $id: ID.custom('abc'),
          teamId: ID.custom('def'),
          confirm: true,
          roles: ['guest'],
        },
      ],
    })

    const roles = Auth.getRoles(user, false, true)

    expect(roles).toHaveLength(7)
    expect(roles).not.toContain(Role.users().toString())
    expect(roles).not.toContain(Role.user(ID.custom('123')).toString())
    expect(roles).toContain(Role.team(ID.custom('abc')).toString())
    expect(roles).toContain(
      Role.team(ID.custom('abc'), 'administrator').toString(),
    )
    expect(roles).toContain(Role.team(ID.custom('abc'), 'moderator').toString())
    expect(roles).toContain(Role.team(ID.custom('def')).toString())
    expect(roles).toContain(Role.team(ID.custom('def'), 'guest').toString())
    expect(roles).toContain(Role.member(ID.custom('def')).toString())
    expect(roles).toContain(Role.member(ID.custom('abc')).toString())
  })
})
