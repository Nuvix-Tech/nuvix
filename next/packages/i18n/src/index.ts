import type { TranslationLoader } from './loader'
import { Translator } from './translator'

export { TranslationLoader } from './loader'
export { parseAcceptLanguage, resolveLocale } from './resolve'
export { Translator } from './translator'
export type { MessageParams, TranslationFile } from './types'

/**
 * Build a ready-to-use `Translator`, priming the translation tables for the
 * requested locale (and the fallback when different). Safe to call per
 * request: file reads and ICU compiles are cached.
 */
export async function createTranslator(options: {
  loader: TranslationLoader
  locale: string
  fallback?: string
}): Promise<Translator> {
  const { loader, locale } = options
  const fallback = options.fallback ?? 'en'

  const primary = (await loader.load(locale)) ?? {}
  const fallbackTable = fallback !== locale ? ((await loader.load(fallback)) ?? null) : null

  return new Translator(locale, fallback, { primary, fallback: fallbackTable })
}
