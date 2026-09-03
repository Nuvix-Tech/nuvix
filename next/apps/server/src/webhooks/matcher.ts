const EVENT_PATTERN_REGEX_CACHE_LIMIT = 1000
const eventPatternRegexCache = new Map<string, RegExp>()

export function eventMatchesPattern(event: string, pattern: string): boolean {
  if (!pattern || !event) {
    return false
  }

  if (pattern === '*') {
    return true
  }

  if (pattern === event) {
    return true
  }

  let matcher = eventPatternRegexCache.get(pattern)
  if (!matcher) {
    if (pattern.length > 256) {
      return false
    }
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    matcher = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`)

    if (eventPatternRegexCache.size >= EVENT_PATTERN_REGEX_CACHE_LIMIT) {
      const oldest = eventPatternRegexCache.keys().next().value
      if (oldest !== undefined) {
        eventPatternRegexCache.delete(oldest)
      }
    }
    eventPatternRegexCache.set(pattern, matcher)
  }

  return matcher.test(event)
}

export function webhookSubscribesToEvent(events: readonly string[], event: string): boolean {
  return events.some((pattern) => eventMatchesPattern(event, pattern))
}
