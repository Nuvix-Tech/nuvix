import { describe, expect, test } from 'bun:test'
import { treaty } from '@elysia/eden'
import { TranslationLoader } from '@nuvix/i18n'
import { Elysia } from 'elysia'
import { createGeoIP } from '../src/context/geoip'
import { localeContext } from '../src/context/locale'
import { localeRoutes } from '../src/locale/route'

/**
 * Locale module tests — real translation assets, stubbed GeoIP.
 * Contract: docs/api/locale.md
 */

const translationsDir = new URL('../../../assets/locale/translations', import.meta.url).pathname
const loader = new TranslationLoader(translationsDir)
const localeOptions = {
  loader,
  available: await loader.availableLocales(),
} as const

/** Deterministic geo stub. */
const geoStub = {
  lookup: (ip: string) => {
    if (ip === '1.2.3.4') return { countryCode: 'DE', continentCode: 'EU' }
    if (ip === '5.6.7.8') return { countryCode: 'BR', continentCode: 'SA' }
    if (ip === '9.9.9.9') return null
    return null
  },
}

const probe = new Elysia({ prefix: '/v2' })
  .use(localeContext(localeOptions))
  .use(localeRoutes(geoStub, localeOptions))

const client = treaty(probe)

describe('GET /v2/locale', () => {
  test('unknown IP → unknown-geo shape with localized fallback name', async () => {
    const { data, status } = await client.v2.locale.get({
      headers: { 'x-forwarded-for': '9.9.9.9' },
    })
    expect(status).toBe(200)
    expect(data).toMatchObject({
      ip: '9.9.9.9',
      countryCode: '--',
      country: 'Unknown',
      eu: false,
      currency: null,
    })
  })

  test('German IP → country name, EU flag', async () => {
    const { data, status } = await client.v2.locale.get({
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })
    expect(status).toBe(200)
    expect(data).toMatchObject({
      countryCode: 'DE',
      country: 'Germany',
      continentCode: 'EU',
      eu: true,
      // v1 data parity: only a few currencies carry `locations` (USD, ILS, INR, PLN…)
      currency: null,
    })
  })

  test('US IP resolves currency from locations map', async () => {
    const usGeo = {
      lookup: () => ({ countryCode: 'US', continentCode: 'NA' }),
    }
    const probeUs = new Elysia({ prefix: '/v2' })
      .use(localeContext(localeOptions))
      .use(localeRoutes(usGeo, localeOptions))
    const usClient = treaty(probeUs)
    const { data } = await usClient.v2.locale.get({
      headers: { 'x-forwarded-for': '8.8.8.8' },
    })
    expect(data?.currency).toBe('USD')
  })

  test('non-EU country → eu=false even though continent code contains EU letters', async () => {
    const { data } = await client.v2.locale.get({
      headers: { 'x-forwarded-for': '5.6.7.8' },
    })
    expect(data?.country).toBe('Brazil')
    expect(data?.eu).toBe(false)
  })

  test('localized names follow x-nuvix-locale header', async () => {
    const { data } = await client.v2.locale.get({
      headers: { 'x-forwarded-for': '1.2.3.4', 'x-nuvix-locale': 'de' },
    })
    expect(data?.country).toBe('Deutschland')
  })
})

describe('static reference lists', () => {
  test('countries: complete list, meta.total matches, sorted by localized name', async () => {
    const { data, status } = await client.v2.locale.countries.get()
    expect(status).toBe(200)
    expect(data!.meta.total).toBe(data!.data.length)
    expect(data!.data.length).toBeGreaterThan(190)
    const names = data!.data.map((c) => c.name)
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)
    expect(data!.data.find((c) => c.code === 'DE')?.name).toBe('Germany')
  })

  test('eu list: 27 members, all resolved names', async () => {
    const { data } = await client.v2.locale.countries.eu.get()
    expect(data!.meta.total).toBe(27)
    expect(data!.data.find((c) => c.code === 'DE')?.name).toBe('Germany')
  })

  test('continents resolve localized names', async () => {
    const { data } = await client.v2.locale.continents.get()
    expect(data!.meta.total).toBeGreaterThan(5)
    expect(data!.data.find((c) => c.code === 'EU')?.name).toBe('Europe')
  })

  test('phone codes: + prefix, translated names only', async () => {
    const { data } = await client.v2.locale.countries.phones.get()
    expect(data!.meta.total).toBe(data!.data.length)
    for (const entry of data!.data) {
      expect(entry.code.startsWith('+')).toBe(true)
      expect(entry.countryName.length).toBeGreaterThan(0)
    }
  })

  test('currencies and languages expose totals', async () => {
    const currencies = await client.v2.locale.currencies.get()
    const languages = await client.v2.locale.languages.get()
    const codes = await client.v2.locale.codes.get()
    expect(currencies.data!.meta.total).toBe(currencies.data!.data.length)
    expect(languages.data!.meta.total).toBeGreaterThan(100)
    expect(codes.data!.data.some((c) => c.code === 'en')).toBe(true)
  })
})

describe('createGeoIP graceful degradation', () => {
  test('missing mmdb → provider that always returns null', async () => {
    const geo = await createGeoIP('/tmp/opencode/does-not-exist.mmdb')
    expect(geo.lookup('1.2.3.4')).toBeNull()
  })

  test('bundled mmdb resolves public IP ranges', async () => {
    const geo = await createGeoIP()
    // 8.8.8.8 is Google DNS (US) — stable lookup target.
    const result = geo.lookup('8.8.8.8')
    expect(result?.countryCode).toBe('US')
  })
})
