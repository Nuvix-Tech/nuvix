/**
 * Declarative behavioral-parity cases for the smoke harness.
 *
 * Each case describes one request against the real v2 app plus the
 * *behavioral* outcome we promise (status, content-type class, cache
 * semantics, envelope shape). This is intentionally NOT a byte-diff:
 * v2 envelopes differ from v1 by design (see docs/api/_conventions.md).
 *
 * When NUVIX_V1_BASE_URL is set, the runner also fetches the same route
 * from the live old app (path defaults to swapping /v2 -> /v1) and prints
 * a normalized diff report. That comparison is informational; the v2
 * assertions below are the hard contract.
 */
export interface ParityCase {
  name: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>

  /** Expected response status */
  status: number
  /** Response content-type must start with this value */
  contentType?: string
  /** Exact Cache-Control header value */
  cacheControl?: string
  /** Exact Content-Disposition header value */
  contentDisposition?: string

  /** Top-level JSON keys must equal this set exactly */
  jsonKeys?: string[]
  /** Exact problem+json `type` field */
  problemType?: string
  /** Envelope checks for list endpoints ({ data, meta.total }) */
  envelope?: {
    /** meta.total === data.length */
    totalEqualsData?: boolean
    /** every item in data has exactly these keys */
    dataKeys?: string[]
    /** meta.total >= this */
    totalMin?: number
  }
  /** Custom JSON assertion; return an error message or null */
  assertJson?: (json: Record<string, unknown>) => string | null

  /**
   * Old-app path for the informational v1 comparison.
   * Defaults to `path` with the /v2 prefix swapped to /v1.
   * Set to null to skip the comparison for this case.
   */
  v1Path?: string | null
}

const xff = (ip: string) => ({ 'x-forwarded-for': ip })

export const cases: ParityCase[] = [
  // ── Health ────────────────────────────────────────────────────────────
  {
    name: 'health returns ok envelope',
    path: '/v2/health',
    status: 200,
    jsonKeys: ['status', 'version', 'uptime'],
    assertJson: (j) => (j.status === 'ok' ? null : `expected status ok, got ${j.status}`),
  },

  // ── Locale ────────────────────────────────────────────────────────────
  {
    name: 'locale detects country from forwarded IP',
    path: '/v2/locale',
    headers: xff('8.8.8.8'),
    status: 200,
    jsonKeys: ['ip', 'countryCode', 'country', 'continent', 'continentCode', 'eu', 'currency'],
    assertJson: (j) =>
      j.countryCode !== 'US'
        ? `expected US for 8.8.8.8, got ${j.countryCode}`
        : j.currency !== 'USD'
          ? `expected USD currency for US, got ${j.currency}`
          : null,
  },
  {
    name: 'locale codes lists all dial codes',
    path: '/v2/locale/codes',
    status: 200,
    envelope: { totalEqualsData: true },
  },
  {
    name: 'locale countries is complete and name-sorted',
    path: '/v2/locale/countries',
    status: 200,
    envelope: {
      totalEqualsData: true,
      dataKeys: ['name', 'code'],
      totalMin: 190,
    },
    assertJson: (j) => {
      const names = (j.data as Array<{ name: string }>).map((c) => c.name)
      const sorted = [...names].sort((a, b) => a.localeCompare(b))
      return JSON.stringify(names) === JSON.stringify(sorted)
        ? null
        : 'countries not sorted by name'
    },
  },
  {
    name: 'locale EU list has all member states',
    path: '/v2/locale/countries/eu',
    status: 200,
    envelope: { totalEqualsData: true, totalMin: 27 },
  },
  {
    name: 'locale phone codes are E.164-prefixed',
    path: '/v2/locale/countries/phones',
    status: 200,
    envelope: { totalEqualsData: true },
    assertJson: (j) =>
      (j.data as Array<{ code: string }>).every((c) => c.code.startsWith('+'))
        ? null
        : 'found phone code without + prefix',
  },
  {
    name: 'locale continents lists seven continents',
    path: '/v2/locale/continents',
    status: 200,
    envelope: { totalEqualsData: true },
    assertJson: (j) =>
      (j.meta as { total: number }).total >= 7 ? null : 'fewer than 7 continents',
  },
  {
    name: 'locale currencies lists world currencies',
    path: '/v2/locale/currencies',
    status: 200,
    envelope: { totalEqualsData: true },
  },
  {
    name: 'locale languages lists ISO languages',
    path: '/v2/locale/languages',
    status: 200,
    envelope: { totalEqualsData: true, totalMin: 100 },
  },

  // ── Avatars ───────────────────────────────────────────────────────────
  {
    name: 'flag avatar renders PNG with immutable caching',
    path: '/v2/avatars/flags/de',
    query: { width: '32', height: '32' },
    status: 200,
    contentType: 'image/png',
    cacheControl: 'public, max-age=86400, immutable',
  },
  {
    name: 'browser avatar renders PNG',
    path: '/v2/avatars/browsers/chrome',
    status: 200,
    contentType: 'image/png',
    cacheControl: 'public, max-age=86400, immutable',
  },
  {
    name: 'credit-card avatar renders PNG',
    path: '/v2/avatars/credit-cards/visa',
    status: 200,
    contentType: 'image/png',
    cacheControl: 'public, max-age=86400, immutable',
  },
  {
    name: 'initials avatar renders PNG for names',
    path: '/v2/avatars/initials',
    query: { name: 'Ada Lovelace' },
    status: 200,
    contentType: 'image/png',
    cacheControl: 'public, max-age=86400, immutable',
  },
  {
    name: 'QR avatar renders PNG served inline',
    path: '/v2/avatars/qr',
    query: { text: 'hello nuvix' },
    status: 200,
    contentType: 'image/png',
    contentDisposition: 'inline',
  },
  {
    name: 'favicon proxy rejects private hosts (SSRF guard)',
    path: '/v2/avatars/favicon',
    query: { url: 'http://127.0.0.1/x.png' },
    status: 404,
    contentType: 'application/problem+json',
    problemType: '/errors/not-found',
  },
  {
    name: 'unknown flag code returns problem+json 404',
    path: '/v2/avatars/flags/nope',
    status: 404,
    contentType: 'application/problem+json',
    problemType: '/errors/not-found',
  },

  // ── Error semantics ───────────────────────────────────────────────────
  {
    name: 'unknown route returns RFC-9457 problem+json',
    path: '/v2/does-not-exist',
    status: 404,
    contentType: 'application/problem+json',
    // Elysia's built-in unmatched-route handler emits the bare slug
    // (no /errors/ prefix) — distinct from our AppError types.
    problemType: 'not-found',
  },
]
