/**
 * Central constants — referenced by name everywhere, never inline strings.
 * See docs/api/_conventions.md §6.
 */

export const HEADERS = {
  publishableKey: 'x-nuvix-publishable-key',
  session: 'x-nuvix-session',
  jwt: 'x-nuvix-jwt',
  apiKey: 'x-nuvix-key',
  mode: 'x-nuvix-mode',
  chunkId: 'x-nuvix-id',
  timestamp: 'x-nuvix-timestamp',
  signature: 'x-nuvix-signature',
  nonce: 'x-nuvix-nonce',
} as const

export const RATE_LIMIT_HEADERS = {
  limit: 'x-ratelimit-limit',
  remaining: 'x-ratelimit-remaining',
  reset: 'x-ratelimit-reset',
} as const
