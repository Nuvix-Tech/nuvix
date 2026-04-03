import * as fs from 'node:fs'
import { configuration } from '@nuvix/utils'
import type {
  ParamsFor,
  RequiresParams,
  TranslationKey,
} from '../i18n/translation-keys.generated'

type TranslationFile = Record<string, string | { _: string; params?: any }>

// Cache for loaded translations
const translationCache = new Map<string, TranslationFile>()

// Block tag handlers for {{#tag}}...{{/tag}}
type BlockHandler = (content: string) => string

const defaultBlockHandlers: Record<string, BlockHandler> = {
  b: content => `<strong>${content}</strong>`,
  i: content => `<em>${content}</em>`,
  code: content => `<code>${content}</code>`,
  u: content => `<u>${content}</u>`,
}

export interface TranslatorConfig {
  locale?: string
  fallbackLocale?: string
  timezone?: string
  throwOnMissing?: boolean
  blockHandlers?: Record<string, BlockHandler>
}

type KeysWithoutParams = {
  [K in TranslationKey]: RequiresParams<K> extends false ? K : never
}[TranslationKey]

type KeysWithParams = {
  [K in TranslationKey]: RequiresParams<K> extends true ? K : never
}[TranslationKey]

export class LocaleTranslator {
  private readonly translations: TranslationFile
  private readonly fallbackTranslations: TranslationFile | null
  private readonly blockHandlers: Record<string, BlockHandler>
  private readonly config: Required<TranslatorConfig>

  readonly locale: string
  readonly fallbackLocale: string

  constructor(config: TranslatorConfig = {}) {
    this.locale = config.locale ?? 'en'
    this.fallbackLocale = config.fallbackLocale ?? 'en'

    this.config = {
      locale: this.locale,
      fallbackLocale: this.fallbackLocale,
      timezone: config.timezone ?? 'UTC',
      throwOnMissing: config.throwOnMissing ?? false,
      blockHandlers: config.blockHandlers ?? {},
    }

    this.blockHandlers = {
      ...defaultBlockHandlers,
      ...this.config.blockHandlers,
    }

    this.translations = this.loadTranslations(this.locale)
    this.fallbackTranslations =
      this.locale !== this.fallbackLocale
        ? this.loadTranslations(this.fallbackLocale)
        : null
  }

  /**
   * Get translation without params (for keys that don't need any)
   */
  get<K extends KeysWithoutParams>(key: K): string

  /**
   * Get translation with required params (autocomplete & type-checked)
   */
  get<K extends KeysWithParams>(key: K, params: ParamsFor<K>): string

  /**
   * Implementation
   */
  get<K extends TranslationKey>(key: K, params?: ParamsFor<K>): string {
    const template = this.resolveTemplate(key)

    if (template === undefined) {
      if (this.config.throwOnMissing) {
        throw new Error(
          `Missing translation: "${key}" (locale: ${this.locale})`,
        )
      }
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[i18n] Missing key: "${key}"`)
      }
      return key
    }

    if (!params || Object.keys(params).length === 0) {
      return this.processBlocks(template, {})
    }

    return this.interpolate(template, params as Record<string, unknown>)
  }

  /**
   * Shorter alias for get
   */
  t = this.get.bind(this) as typeof this.get

  /**
   * Check if a translation key exists
   */
  has(key: string): key is TranslationKey {
    return (
      key in this.translations ||
      (this.fallbackTranslations !== null && key in this.fallbackTranslations)
    )
  }

  /**
   * Get raw template without interpolation
   */
  getRaw<K extends TranslationKey>(key: K): string | undefined {
    return this.resolveTemplate(key)
  }

  /**
   * Get all keys matching a prefix
   */
  keysWithPrefix(prefix: string): TranslationKey[] {
    const keys = new Set<string>()

    for (const key of Object.keys(this.translations)) {
      if (key.startsWith(prefix)) keys.add(key)
    }

    if (this.fallbackTranslations) {
      for (const key of Object.keys(this.fallbackTranslations)) {
        if (key.startsWith(prefix)) keys.add(key)
      }
    }

    return Array.from(keys) as TranslationKey[]
  }

  // ─────────────────────────────────────────────────────────────
  // Internal implementation
  // ─────────────────────────────────────────────────────────────

  private resolveTemplate(key: string): string | undefined {
    const primary = this.translations[key]
    const fallback = this.fallbackTranslations?.[key]

    const value = primary ?? fallback

    if (value === undefined) return undefined

    return typeof value === 'string' ? value : value._
  }

  private interpolate(
    template: string,
    params: Record<string, unknown>,
  ): string {
    // 1. Process block tags first
    let result = this.processBlocks(template, params)

    // 2. Replace mustache variables: {{variable}}
    result = result.replace(/\{\{(?![#/])(\w+)\}\}/g, (match, key) => {
      if (key in params) {
        return this.formatValue(params[key])
      }
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[i18n] Missing param: "${key}" in template`)
      }
      return match
    })

    // 3. Replace sprintf positional: %s
    let positionalIndex = 0
    result = result.replace(/%s/g, () => {
      const value = params[String(positionalIndex)]
      positionalIndex++
      return value !== undefined ? this.formatValue(value) : '%s'
    })

    return result
  }

  private processBlocks(
    template: string,
    params: Record<string, unknown>,
  ): string {
    // Match {{#tag}}content{{/tag}} with support for nesting
    const blockRegex = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g

    return template.replace(blockRegex, (_, tag, content) => {
      // Recursively interpolate content inside blocks
      const interpolatedContent = this.interpolate(content, params)

      // Apply block handler if available
      const handler = this.blockHandlers[tag]
      return handler ? handler(interpolatedContent) : interpolatedContent
    })
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return String(value)
    if (value instanceof Date) {
      return new Intl.DateTimeFormat(this.locale, {
        timeZone: this.config.timezone,
      }).format(value)
    }
    return String(value)
  }

  private loadTranslations(locale: string): TranslationFile {
    const cached = translationCache.get(locale)
    if (cached) return cached

    const filePath = configuration.assets.resolve(
      'locale',
      'translations',
      `${locale}.json`,
    )

    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const translations = JSON.parse(content) as TranslationFile
      translationCache.set(locale, translations)
      return translations
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Translation file not found: ${locale}.json`)
      }
      throw new Error(`Failed to load translations for "${locale}": ${err}`)
    }
  }

  static preload(locales: string[]): void {
    for (const locale of locales) {
      new LocaleTranslator({ locale })
    }
  }

  static clearCache(): void {
    translationCache.clear()
  }
}

export const localeTranslatorInstance = new LocaleTranslator()
