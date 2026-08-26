import {
  createTranslator,
  resolveLocale,
  type TranslationLoader,
  type Translator,
} from '@nuvix/i18n'
import { Elysia } from 'elysia'

export interface LocaleContextOptions {
  loader: TranslationLoader
  /** Cached list of available locale codes. */
  available: string[]
  fallback?: string
}

/**
 * Resolves the request locale (D34) and builds a Translator.
 * Pure helper so the error handler can localize without the derive chain.
 */
export async function getTranslator(
  headers: Headers,
  options: LocaleContextOptions,
): Promise<Translator> {
  const locale = resolveLocale({
    // TODO(phase 3+): authenticated user preference once DB-backed auth lands.
    headerLocale: headers.get('x-nuvix-locale'),
    acceptLanguage: headers.get('accept-language'),
    available: options.available,
    fallback: options.fallback,
  })

  return createTranslator({
    loader: options.loader,
    locale,
    fallback: options.fallback,
  })
}

/**
 * Exposes the resolved request locale on context as `locale`
 * (a `Translator`; `locale.locale` is the code string).
 *
 * NOTE: `'plugin'` scope required — local-scoped derive does not cross
 * `.use()` boundaries (see MIGRATION.md Phase 1 notes).
 */
export function localeContext(options: LocaleContextOptions) {
  return new Elysia({ name: 'locale-context' }).derive('plugin', async ({ request }) => ({
    // getTranslator is async — MUST await here or context.locale is a bare
    // Promise (latent bug caught by the first route that consumed `locale`).
    locale: await getTranslator(request.headers, options),
  }))
}
