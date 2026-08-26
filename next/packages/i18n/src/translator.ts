import IntlMessageFormat from 'intl-messageformat'
import type { MessageParams } from './types'

interface TranslatorTables {
  /** Messages for the requested locale (may be empty). */
  primary: Record<string, string>
  /** Messages for the fallback locale; null when same as primary or missing. */
  fallback: Record<string, string> | null
}

/**
 * Formats ICU messages for one locale with fallback to a default (usually `en`).
 *
 * - Create via `createTranslator` (async — primes translation tables).
 * - Messages are compiled once per `(locale, key)` and cached forever.
 * - A missing key falls back to the fallback locale, then to the key itself.
 *   `format` never throws for missing translations.
 * - Malformed ICU messages throw at format time — they indicate broken
 *   translation files and should surface in tests/CI.
 */
export class Translator {
  readonly locale: string
  readonly fallback: string

  readonly #tables: TranslatorTables
  readonly #compiled = new Map<string, IntlMessageFormat>()

  constructor(locale: string, fallback: string, tables: TranslatorTables) {
    this.locale = locale
    this.fallback = fallback
    this.#tables = tables
  }

  /** Format the message at `key`, interpolating ICU `params`. */
  format(key: string, params?: MessageParams): string {
    const message = this.raw(key)
    if (message === null) return key

    const cacheKey = `${this.locale} ${key}`
    let compiled = this.#compiled.get(cacheKey)

    try {
      compiled ??= new IntlMessageFormat(message, this.locale)
      this.#compiled.set(cacheKey, compiled)
      return compiled.format(params ?? {}) as string
    } catch (error) {
      throw new Error(
        `i18n: failed to format "${key}" (${this.locale}): ${error instanceof Error ? error.message : error}`,
      )
    }
  }

  /** Raw message lookup without formatting; null when missing everywhere. */
  raw(key: string): string | null {
    return this.#tables.primary[key] ?? this.#tables.fallback?.[key] ?? null
  }
}
