/**
 * Password hashing and verification powered by Bun.password natives (D5, D29).
 * Supports argon2id (default) and bcrypt (for migrations / administrative import).
 */

export type PasswordAlgorithm = 'argon2id' | 'bcrypt'

export interface HashPasswordOptions {
  readonly algorithm?: PasswordAlgorithm
  readonly cost?: number
  readonly memoryCost?: number
  readonly timeCost?: number
}

const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 256

export function isValidPassword(password: unknown): password is string {
  return (
    typeof password === 'string' &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  )
}

export async function hashPassword(
  password: string,
  options: HashPasswordOptions = {},
): Promise<string> {
  if (!isValidPassword(password)) {
    throw new TypeError(
      `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
    )
  }

  const algorithm = options.algorithm ?? 'argon2id'
  if (algorithm === 'bcrypt') {
    return await Bun.password.hash(password, {
      algorithm: 'bcrypt',
      cost: options.cost ?? 10,
    })
  }

  return await Bun.password.hash(password, {
    algorithm: 'argon2id',
    memoryCost: options.memoryCost ?? 65536,
    timeCost: options.timeCost ?? 2,
  })
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof hash !== 'string' || hash.length === 0) {
    return false
  }
  try {
    return await Bun.password.verify(password, hash)
  } catch {
    return false
  }
}
