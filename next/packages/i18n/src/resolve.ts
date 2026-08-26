/**
 * Pure locale resolution — no framework or IO dependencies.
 *
 * Chain (D34): explicit header > user preference > Accept-Language > default.
 */

/** A single Accept-Language entry, e.g. `fr-CH, fr;q=0.9, en;q=0.8`. */
export function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      let q = 1
      for (const param of params) {
        const [name, value] = param.split('=')
        if (name?.trim() === 'q') {
          const parsed = Number(value)
          if (!Number.isNaN(parsed)) q = parsed
        }
      }
      return { tag: tag?.trim().toLowerCase() ?? '', q }
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag)
}

/**
 * Best-match a requested tag against available locales.
 * `fr-CH` matches exact `fr-CH`, then prefix `fr`, then the default.
 */
export function bestMatch(tag: string, available: string[]): string | null {
  const lower = tag.toLowerCase()
  if (available.includes(lower)) return lower

  const prefix = lower.split('-')[0]
  if (prefix && available.includes(prefix)) return prefix

  // e.g. available 'pt-pt' matched by request 'pt'
  const regional = available.find((code) => code.startsWith(`${prefix}-`))
  return regional ?? null
}

export interface ResolveInput {
  /** Value of `x-nuvix-locale`, if sent. */
  headerLocale?: string | null
  /** Authenticated user's preferred locale, when known. */
  userLocale?: string | null
  /** Raw `Accept-Language` header value. */
  acceptLanguage?: string | null
  /** Locale codes that have translation files. */
  available: string[]
  /** Last resort (default: `en`). */
  fallback?: string
}

export function resolveLocale(input: ResolveInput): string {
  const fallback = input.fallback ?? 'en'

  for (const candidate of [input.headerLocale, input.userLocale]) {
    if (!candidate) continue
    const match = bestMatch(candidate, input.available)
    if (match) return match
  }

  if (input.acceptLanguage) {
    for (const tag of parseAcceptLanguage(input.acceptLanguage)) {
      const match = bestMatch(tag, input.available)
      if (match) return match
    }
  }

  return fallback
}
