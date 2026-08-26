import type { TranslationFile } from './types'

/**
 * Loads and caches translation files.
 *
 * Translations are static at runtime: each locale file is read once via
 * `Bun.file` and cached forever. The directory is injected so tests can use
 * fixtures and the server can point at its assets path.
 */
export class TranslationLoader {
  readonly #dir: string
  readonly #cache = new Map<string, TranslationFile>()

  constructor(dir: string) {
    this.#dir = dir.replace(/\/$/, '')
  }

  /** Locale codes that have a translation file on disk (e.g. `['en', 'de', …]`). */
  async availableLocales(): Promise<string[]> {
    const glob = new Bun.Glob('*.json')
    const codes: string[] = []
    for await (const file of glob.scan(this.#dir)) {
      codes.push(file.replace(/\.json$/, ''))
    }
    return codes.sort()
  }

  /** Returns the translation table for a locale, or null when absent. */
  async load(locale: string): Promise<TranslationFile | null> {
    const cached = this.#cache.get(locale)
    if (cached) return cached

    const file = Bun.file(`${this.#dir}/${locale}.json`)
    if (!(await file.exists())) return null

    const parsed = (await file.json()) as TranslationFile
    this.#cache.set(locale, parsed)
    return parsed
  }
}
