import * as crypto from 'node:crypto'
import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { Logger } from '@nestjs/common'
import { Role, UserDimension } from '@nuvix/db'
import {
  configuration,
  HashAlgorithm,
  SessionProvider,
  TokenType,
} from '@nuvix/utils'
import type {
  MembershipsDoc,
  SessionsDoc,
  TokensDoc,
  UsersDoc,
} from '@nuvix/utils/types'
import { hash, verify } from 'argon2'
import { CoreService } from '../core.service'
import { Exception } from '../extend/exception'

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12
const VERSION = 'v1'
const DERIVED_KEY = crypto
  .createHash('sha256')
  .update(configuration.security.encryptionKey)
  .digest()

export enum UserRole {
  ADMIN = 'admin',
  DEVLOPER = 'developer',
  OWNER = 'owner',
  APPS = 'apps',
  SYSTEM = 'system',
  USERS = 'users',
  GUESTS = 'guests',
}

export class Auth {
  public static readonly SUPPORTED_ALGOS = Object.values(HashAlgorithm)

  public static readonly DEFAULT_ALGO = HashAlgorithm.ARGON2
  public static readonly DEFAULT_ALGO_OPTIONS = {
    type: HashAlgorithm.ARGON2,
    hashLength: 32,
    timeCost: 3,
    memoryCost: 1 << 16,
    parallelism: 4,
  }

  // Token Expiration times
  public static readonly TOKEN_EXPIRATION_LOGIN_LONG = 31536000 // 1 year
  public static readonly TOKEN_EXPIRATION_LOGIN_SHORT = 3600 // 1 hour
  public static readonly TOKEN_EXPIRATION_RECOVERY = 3600 // 1 hour
  public static readonly TOKEN_EXPIRATION_CONFIRM = 3600 // 1 hour
  public static readonly TOKEN_EXPIRATION_OTP = 60 * 15 // 15 minutes
  public static readonly TOKEN_EXPIRATION_GENERIC = 60 * 15 // 15 minutes

  // Token Lengths
  public static readonly TOKEN_LENGTH_MAGIC_URL = 64
  public static readonly TOKEN_LENGTH_VERIFICATION = 256
  public static readonly TOKEN_LENGTH_RECOVERY = 256
  public static readonly TOKEN_LENGTH_OAUTH2 = 64
  public static readonly TOKEN_LENGTH_SESSION = 256

  // MFA
  public static readonly MFA_RECENT_DURATION = 1800 // 30 mins

  public static encodeSession(id: string, secret: string): string {
    // Encrypt session data to prevent tampering and hijacking
    const sessionData = JSON.stringify({ id, secret })
    return Auth.encrypt(sessionData)
  }

  public static get cookieName(): string {
    return `nx_${configuration.server.cookieName}`
  }

  public static getSessionProviderByTokenType(
    type: TokenType,
  ): SessionProvider {
    switch (type) {
      case TokenType.VERIFICATION:
      case TokenType.RECOVERY:
      case TokenType.INVITE:
        return SessionProvider.EMAIL
      case TokenType.MAGIC_URL:
        return SessionProvider.MAGIC_URL
      case TokenType.PHONE:
        return SessionProvider.PHONE
      case TokenType.OAUTH2:
        return SessionProvider.OAUTH2
      default:
        return SessionProvider.TOKEN
    }
  }

  public static decodeSession(session: string): {
    id?: string
    secret?: string
  } {
    const defaultSession = { id: undefined, secret: undefined }

    try {
      // Try encrypted format first (v1:)
      const decrypted = Auth.decrypt(session)
      const decoded = JSON.parse(decrypted)

      if (typeof decoded !== 'object' || decoded === null) {
        return defaultSession
      }

      return { ...defaultSession, ...decoded }
    } catch (decryptError) {
      // Fall back to legacy base64 format for backward compatibility
      // TODO: Remove this fallback in next major version after all sessions rotate
      try {
        const bufferStr = Buffer.from(session, 'base64').toString()
        const decoded = JSON.parse(bufferStr)

        if (typeof decoded !== 'object' || decoded === null) {
          return defaultSession
        }

        return { ...defaultSession, ...decoded }
      } catch (legacyError) {
        return defaultSession
      }
    }
  }

  public static hash(string: string): string {
    return crypto.createHash('sha256').update(string).digest('hex')
  }

  /**
   * Hash a string using the specified algorithm.
   */
  public static async passwordHash(
    string: string,
    algo: HashAlgorithm,
    options: any = {},
  ): Promise<string | null> {
    if (algo === HashAlgorithm.PLAINTEXT) {
      algo = Auth.DEFAULT_ALGO
      options = Auth.DEFAULT_ALGO_OPTIONS
    }

    if (!Auth.SUPPORTED_ALGOS.includes(algo)) {
      throw new Error(`Hashing algorithm '${algo}' is not supported.`)
    }

    switch (algo) {
      case HashAlgorithm.ARGON2: {
        const aOptions =
          Object.keys(options).length === 0
            ? undefined
            : {
                hashLength: options.hashLength,
                timeCost: options.timeCost,
                memoryCost: options.memoryCost,
                parallelism: options.parallelism,
              }
        return hash(string, { raw: false, ...aOptions })
      }
      case HashAlgorithm.BCRYPT: {
        const saltRounds = options.saltRounds || 10
        return (await Auth.getBcrypt()).hash(string, saltRounds)
      }
      case HashAlgorithm.MD5:
        return createHash('md5').update(string).digest('hex')

      case HashAlgorithm.SHA:
        return createHash('sha256').update(string).digest('hex')

      case HashAlgorithm.PHPASS: {
        // Basic phpass implementation (insecure, for legacy systems only)
        const salt = options.salt || randomBytes(6).toString('base64')
        return createHmac('sha1', salt).update(string).digest('base64')
      }
      case HashAlgorithm.SCRYPT: {
        const scryptSalt = options.salt || randomBytes(16)
        const scryptOptions = { N: 16384, r: 8, p: 1, ...options }
        return scryptSync(string, scryptSalt, 64, scryptOptions).toString('hex')
      }

      case HashAlgorithm.SCRYPT_MOD: {
        const modSalt = options.salt || randomBytes(16)
        return createHmac('sha256', modSalt).update(string).digest('hex')
      }

      default:
        throw new Error(`Hashing algorithm '${algo}' is not supported.`)
    }
  }

  /**
   * Verify if a plain string matches a hashed value using the specified algorithm.
   */
  public static async passwordVerify(
    plain: string,
    hash: string,
    algo: HashAlgorithm,
    options: any = {},
  ): Promise<boolean> {
    if (algo === HashAlgorithm.PLAINTEXT) {
      algo = Auth.DEFAULT_ALGO
      options = Auth.DEFAULT_ALGO_OPTIONS
    }

    if (!Auth.SUPPORTED_ALGOS.includes(algo)) {
      throw new Error(`Hashing algorithm '${algo}' is not supported.`)
    }

    switch (algo) {
      case HashAlgorithm.ARGON2:
        return verify(hash, plain, { ...options })

      case HashAlgorithm.BCRYPT:
        return (await Auth.getBcrypt()).compare(plain, hash)

      case HashAlgorithm.MD5:
      case HashAlgorithm.SHA: {
        const generatedHash = await Auth.passwordHash(plain, algo, options)
        if (!generatedHash || !hash) return false
        return Auth.safeCompare(generatedHash, hash)
      }

      case HashAlgorithm.PHPASS: {
        // TODO: recheck or remove
        if (!hash) return false
        const salt = hash.slice(0, 6)
        const phpHash = createHmac('sha1', salt).update(plain).digest('base64')
        return Auth.safeCompare(phpHash, hash)
      }

      case HashAlgorithm.SCRYPT:
      case HashAlgorithm.SCRYPT_MOD: {
        const scryptGeneratedHash = await Auth.passwordHash(
          plain,
          algo,
          options,
        )
        if (!scryptGeneratedHash || !hash) return false
        return Auth.safeCompare(scryptGeneratedHash, hash)
      }

      default:
        throw new Error(`Hashing algorithm '${algo}' is not supported.`)
    }
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   * Returns true if both strings are equal, false otherwise.
   * If lengths differ, still performs comparison with a dummy buffer
   * to avoid leaking length information through timing.
   * Validates inputs are strings before comparison.
   */
  public static safeCompare(a: unknown, b: unknown): boolean {
    // Validate inputs are strings
    if (typeof a !== 'string' || typeof b !== 'string') {
      return false
    }

    const bufA = Buffer.from(a, 'utf-8')
    const bufB = Buffer.from(b, 'utf-8')
    if (bufA.length !== bufB.length) {
      // Still perform a comparison to avoid timing leak on length difference
      return timingSafeEqual(bufA, Buffer.alloc(bufA.length)) && false
    }
    return timingSafeEqual(bufA, bufB)
  }

  public static passwordGenerator(length = 20): string {
    return crypto.randomBytes(length).toString('hex')
  }

  public static tokenGenerator(length = 256): string {
    if (length <= 0) {
      throw new Error('Token length must be greater than 0')
    }

    const bytesLength = Math.ceil(length / 2)
    const token = crypto.randomBytes(bytesLength).toString('hex')

    return token.slice(0, length)
  }

  public static codeGenerator(length = 6): string {
    // if more security is needed, we can switch to alphanumeric codes using crypto.randomBytes and base64 encoding,
    // but for now numeric codes are sufficient and more user-friendly for OTPs
    let value = ''
    for (let i = 0; i < length; i++) {
      value += crypto.randomInt(0, 10).toString()
    }
    return value
  }

  public static tokenVerify(
    tokens: TokensDoc[],
    type: TokenType | null,
    secret: string,
  ): TokensDoc | false {
    for (const token of tokens) {
      if (
        token.get('secret') !== null &&
        token.get('expire') !== null &&
        token.get('type') !== null &&
        (type === null || token.get('type') === type) &&
        Auth.safeCompare(token.get('secret'), Auth.hash(secret)) &&
        new Date(token.get('expire') as string).getTime() >= Date.now()
      ) {
        return token
      }
    }

    return false
  }

  public static sessionVerify(
    sessions: SessionsDoc[],
    secret?: string,
  ): string | false {
    if (!secret) {
      return false
    }

    for (const session of sessions) {
      if (
        session.get('secret') !== null &&
        session.get('expire') !== null &&
        session.get('provider') !== null &&
        Auth.safeCompare(session.get('secret'), Auth.hash(secret)) &&
        new Date(session.get('expire') as string).getTime() >= Date.now()
      ) {
        return session.getId()
      }
    }

    return false
  }

  public static getRoles(
    user: UsersDoc,
    isAdmin?: boolean,
    isAPIUser?: boolean,
  ): string[] {
    const roles: string[] = []

    if (CoreService.isConsole() || (!isAdmin && !isAPIUser)) {
      if (user.getId()) {
        roles.push(Role.user(user.getId()).toString())
        roles.push(Role.users().toString())

        const emailVerified = user.get('emailVerification', false)
        const phoneVerified = user.get('phoneVerification', false)

        if (emailVerified || phoneVerified) {
          roles.push(Role.user(user.getId(), UserDimension.VERIFIED).toString())
          roles.push(Role.users(UserDimension.VERIFIED).toString())
        } else {
          roles.push(
            Role.user(user.getId(), UserDimension.UNVERIFIED).toString(),
          )
          roles.push(Role.users(UserDimension.UNVERIFIED).toString())
        }
      } else {
        return [Role.guests().toString()]
      }
    }

    for (const node of (user.get('memberships') || []) as MembershipsDoc[]) {
      if (!node.get('confirm')) {
        continue
      }

      if (node.getId() && node.get('teamId')) {
        roles.push(Role.team(node.get('teamId')).toString())
        roles.push(Role.member(node.getId()).toString())

        if (node.get('roles')) {
          for (const nodeRole of node.get('roles')) {
            roles.push(Role.team(node.get('teamId'), nodeRole).toString())
          }
        }
      }
    }

    for (const label of user.get('labels', [])) {
      roles.push(`label:${label}`)
    }

    return roles
  }

  public static isAnonymousUser(user: UsersDoc): boolean {
    return user.get('email') === null && user.get('phone') === null
  }

  private static async getBcrypt() {
    try {
      const bcrypt = await import('bcrypt')
      return bcrypt
    } catch (error) {
      Logger.warn(error)
      throw new Exception(
        Exception.GENERAL_SERVER_ERROR,
        'bcrypt is not available on the server.',
      )
    }
  }

  static encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGO, DERIVED_KEY, iv)

    const ciphertext = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ])

    const tag = cipher.getAuthTag()

    return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`
  }

  static decrypt(text: string): string {
    const [version, payload] = text.split(':')
    if (version !== VERSION) {
      throw new Exception('Unsupported encryption version')
    }

    if (!payload) {
      throw new Exception('Invalid encrypted payload')
    }

    const raw = Buffer.from(payload, 'base64')
    if (raw.length < IV_LENGTH + 16) {
      throw new Exception('Invalid encrypted payload')
    }

    const iv = raw.subarray(0, IV_LENGTH)
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + 16)
    const ciphertext = raw.subarray(IV_LENGTH + 16)

    const decipher = crypto.createDecipheriv(ALGO, DERIVED_KEY, iv)
    decipher.setAuthTag(tag)

    return (
      decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8')
    )
  }

  static decryptIfDefined(text?: string | null): string | null {
    if (text === null || text === undefined) {
      return null
    }
    return Auth.decrypt(text)
  }
}
