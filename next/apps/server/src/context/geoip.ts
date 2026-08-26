import maxmind, { type CountryResponse } from 'maxmind'

/** Minimal geo result — everything else (names, EU flag, currency) derives from these codes. */
export interface GeoResult {
  countryCode?: string
  continentCode?: string
}

/**
 * GeoIP lookup abstraction.
 *
 * Backed by the bundled dbip-country-lite `.mmdb`. When the asset is missing
 * (or the path unset), returns a no-op provider whose lookups are always
 * `null` — `/v2/locale` then serves the unknown-IP shape instead of failing
 * startup (see docs/api/locale.md).
 */
export interface GeoIP {
  lookup(ip: string): GeoResult | null
}

const DEFAULT_MMDB = new URL(
  '../../../../assets/dbip/dbip-country-lite-2024-09.mmdb',
  import.meta.url,
).pathname

export async function createGeoIP(mmdbPath: string = DEFAULT_MMDB): Promise<GeoIP> {
  if (!(await Bun.file(mmdbPath).exists())) {
    console.warn(`[geoip] database not found at ${mmdbPath} — locale detection disabled`)
    return { lookup: () => null }
  }

  const reader = await maxmind.open<CountryResponse>(mmdbPath)
  return {
    lookup(ip: string): GeoResult | null {
      const record = reader.get(ip)
      if (!record) return null
      return {
        countryCode: record.country?.iso_code,
        continentCode: record.continent?.code,
      }
    },
  }
}
