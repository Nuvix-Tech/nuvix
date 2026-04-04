import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const env = {
  get: (key: string, fallback = ''): string => process.env[key] ?? fallback,

  getRequired: (key: string): string | undefined => process.env[key],

  bool: (key: string, fallback = false): boolean => {
    const val = process.env[key]?.toLowerCase()
    if (val === undefined) return fallback
    return val === 'true' || val === '1' || val === 'yes'
  },

  int: (key: string, fallback: number): number => {
    const val = process.env[key]
    if (!val) return fallback
    const parsed = Number.parseInt(val, 10)
    return Number.isNaN(parsed) ? fallback : parsed
  },

  list: (key: string, fallback: string[] = []): string[] => {
    const val = process.env[key]
    if (!val) return fallback
    return val
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  },

  is: (key: string, value: string): boolean => process.env[key] === value,

  isNot: (key: string, value: string): boolean => process.env[key] !== value,
}

/**
 *  Generates a MD5 hash of the given input string
 *  @param input - The input string to hash
 *  @returns The MD5 hash as a hexadecimal string
 */
export const createMd5Hash = (input: string): string => {
  return crypto.createHash('md5').update(input).digest('hex')
}

/**
 * FNV-1a 128-bit hash function implementation in TypeScript
 */
export function fnv1a128(str: string): string {
  let hash = BigInt('0x6c62272e07bb014262b821756295c58d') // 128-bit offset basis
  const prime = BigInt('0x0000000001000000000000000000013B') // 128-bit prime

  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i))
    hash = (hash * prime) & ((BigInt(1) << BigInt(128)) - BigInt(1)) // 128-bit overflow
  }

  // Return as fixed 32-char hex string
  return hash.toString(16).padStart(32, '0')
}

/**
 * Finds the project root directory by traversing up the directory tree
 * until a package.json file is found
 * @returns Absolute path to the project root directory
 * @throws Error if project root directory cannot be found
 */
export function findProjectRoot(): string {
  if (env.isNot('NODE_ENV', 'production')) {
    return path.join(process.cwd(), '../../')
  }
  try {
    // Start from current file's directory
    let currentDir: string
    if (import.meta.url) {
      currentDir = path.dirname(fileURLToPath(import.meta.url))
    } else {
      currentDir = __dirname
    }
    const maxDepth = 10 // Prevent infinite loops
    let depth = 0

    while (currentDir !== '/' && depth < maxDepth) {
      const packageJsonPath = path.join(currentDir, 'package.json')

      if (fs.existsSync(packageJsonPath)) {
        return currentDir
      }

      const parentDir = path.dirname(currentDir)
      // Check if we've reached the top (when dirname doesn't change the path anymore)
      if (parentDir === currentDir) {
        break
      }

      currentDir = parentDir
      depth++
    }

    // Fallback to current working directory if not found
    console.warn('Could not find package.json, falling back to process.cwd()')
    return process.cwd()
  } catch (error) {
    console.error('Error finding project root:', error)
    throw new Error('Failed to determine project root directory')
  }
}

export const parseNumber = (
  value: string | undefined,
  defaultValue: number,
) => {
  if (!value) {
    return defaultValue
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? defaultValue : parsed
}

export const parseBoolean = (
  value: string | undefined,
  defaultValue: boolean,
) => {
  if (!value) {
    return defaultValue
  }
  return value.toLowerCase() === 'true'
}
