import type { Elysia } from 'elysia'

/**
 * Security headers applied to every response.
 * Deliberately minimal — Nuvix serves an API, not HTML.
 */
export function securityHeaders(app: Elysia) {
  return app.request(({ set }) => {
    set.headers['x-content-type-options'] = 'nosniff'
    set.headers['x-frame-options'] = 'DENY'
    set.headers['referrer-policy'] = 'no-referrer'
    set.headers['x-xss-protection'] = '0' // modern guidance: disabled, rely on CSP
    set.headers['cross-origin-resource-policy'] = 'same-site'
  })
}
