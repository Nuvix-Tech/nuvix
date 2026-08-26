import { type AnySchema, Elysia, t } from 'elysia'
import type { GeoIP } from '../context/geoip'
import { getTranslator, type LocaleContextOptions } from '../context/locale'
import {
  continents,
  countries,
  currencies,
  euList,
  languages,
  localeCodes,
  phoneCodes,
} from './data'

/**
 * Locale module — static reference data + GeoIP detection.
 * Contract: docs/api/locale.md
 *
 * NOTE: complete static lists with `meta.total` only — no pagination params
 * (D27 deviation, justified in the contract).
 *
 * NOTE (elysia 2.0.0-beta.6): route signature is `.get(path, hook, handler)` —
 * the schema/hook object comes BEFORE the handler.
 */

const UNKNOWN = '--'

const Country = t.Object({
  name: t.String(),
  code: t.String({ description: 'ISO 3166-1 alpha-2', examples: ['DE'] }),
})

const ListEnvelope = <const T extends AnySchema>(item: T) =>
  t.Object({ data: t.Array(item), meta: t.Object({ total: t.Number() }) })

/**
 * Localized country/continent name via ICU-safe format(); falls back to the
 * raw code when no translation exists (existence checked via raw()).
 */
function localizedName(
  locale: { format(key: string): string; raw(key: string): string | null },
  key: string,
  fallback: string,
) {
  return locale.raw(key) === null ? fallback : locale.format(key)
}

export function localeRoutes(geoip: GeoIP, i18n: LocaleContextOptions) {
  return (
    new Elysia({ name: 'locale-routes' })
      // Self-contained derive so handlers get fully-typed `locale` (derives from
      // OTHER plugin instances don't flow through types across .use()).
      .derive('plugin', async ({ request }) => ({
        locale: await getTranslator(request.headers, i18n),
      }))
      .get(
        '/locale',
        {
          response: t.Object({
            ip: t.String(),
            countryCode: t.String(),
            country: t.String(),
            continent: t.String(),
            continentCode: t.String(),
            eu: t.Boolean(),
            currency: t.Union([t.String(), t.Null()]),
          }),
          detail: { summary: 'Get user locale', tags: ['locale'] },
        },
        ({ locale, request, server }) => {
          // Proxy-aware client IP: forwarded header wins, else socket address.
          const ip =
            request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            server?.requestIP(request)?.address ||
            ''
          const unknownName = locale.format('locale.country.unknown')
          const result = {
            ip,
            countryCode: UNKNOWN,
            country: unknownName,
            continent: unknownName,
            continentCode: UNKNOWN,
            eu: false,
            currency: null as string | null,
          }

          const geo = geoip.lookup(ip)
          if (!geo) return result

          result.countryCode = geo.countryCode ?? UNKNOWN
          result.continentCode = geo.continentCode ?? UNKNOWN

          // v1 bug fix: EU membership is determined by COUNTRY code, not continent.
          result.eu = !!geo.countryCode && euList.includes(geo.countryCode)

          if (geo.countryCode) {
            result.country = localizedName(
              locale,
              `countries.${geo.countryCode.toLowerCase()}`,
              geo.countryCode,
            )
            result.currency =
              currencies.find((c) => c.code && c.locations.includes(geo.countryCode!.toUpperCase()))
                ?.code ?? null
          }
          if (geo.continentCode) {
            result.continent = localizedName(
              locale,
              `continents.${geo.continentCode.toLowerCase()}`,
              geo.continentCode,
            )
          }

          return result
        },
      )
      .get(
        '/locale/codes',
        {
          response: ListEnvelope(t.Object({ code: t.String() })),
          detail: { summary: 'List locale codes', tags: ['locale'] },
        },
        () => ({
          data: localeCodes.map((entry) => ({ code: entry.code })),
          meta: { total: localeCodes.length },
        }),
      )
      .get(
        '/locale/countries',
        {
          response: ListEnvelope(Country),
          detail: { summary: 'List countries', tags: ['locale'] },
        },
        ({ locale }) => {
          const data = countries
            .map((code) => ({
              name: localizedName(locale, `countries.${code.toLowerCase()}`, code),
              code,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
          return { data, meta: { total: data.length } }
        },
      )
      .get(
        '/locale/countries/eu',
        {
          response: ListEnvelope(Country),
          detail: { summary: 'List EU countries', tags: ['locale'] },
        },
        ({ locale }) => {
          const data = euList
            .map((code) => ({
              name: localizedName(locale, `countries.${code.toLowerCase()}`, code),
              code,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
          return { data, meta: { total: data.length } }
        },
      )
      .get(
        '/locale/countries/phones',
        {
          response: ListEnvelope(
            t.Object({
              code: t.String({ examples: ['+49'] }),
              countryCode: t.String(),
              countryName: t.String(),
            }),
          ),
          detail: { summary: 'List countries phone codes', tags: ['locale'] },
        },
        ({ locale }) => {
          const data = Object.entries(phoneCodes)
            .sort(([a], [b]) => a.localeCompare(b))
            .flatMap(([code, phone]) => {
              const key = `countries.${code.toLowerCase()}`
              // v1 parity: skip entries without a translation (stable output).
              if (locale.raw(key) === null) return []
              return [
                {
                  code: `+${phone}`,
                  countryCode: code,
                  countryName: locale.format(key),
                },
              ]
            })
          return { data, meta: { total: data.length } }
        },
      )
      .get(
        '/locale/continents',
        {
          response: ListEnvelope(Country),
          detail: { summary: 'List continents', tags: ['locale'] },
        },
        ({ locale }) => {
          const data = continents
            .map((code) => ({
              name: localizedName(locale, `continents.${code.toLowerCase()}`, code),
              code,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
          return { data, meta: { total: data.length } }
        },
      )
      .get(
        '/locale/currencies',
        {
          response: ListEnvelope(t.Object({}, { additionalProperties: true })),
          detail: { summary: 'List currencies', tags: ['locale'] },
        },
        () => ({ data: currencies, meta: { total: currencies.length } }),
      )
      .get(
        '/locale/languages',
        {
          response: ListEnvelope(t.Object({}, { additionalProperties: true })),
          detail: { summary: 'List languages', tags: ['locale'] },
        },
        () => ({ data: languages, meta: { total: languages.length } }),
      )
  )
}
