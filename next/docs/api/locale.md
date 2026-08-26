# v2 Contract — Locale

> Status: IMPLEMENTED — `apps/server/src/locale/route.ts`
> Depends on: `_conventions.md`, `_i18n.md` (D32–D34)
> Old code (reference only): root `apps/server/src/locale/`

Static reference data + request-locale detection. No database, no auth
requirement — every endpoint is guest-accessible within project context.
Scope name `locale.read` is reserved for future API-key enforcement but is
NOT checked in v2 initial implementation.

---

## Endpoints

| Method | Path                          | Purpose                          |
| ------ | ----------------------------- | -------------------------------- |
| GET    | `/v2/locale`                  | Detect caller's locale via GeoIP |
| GET    | `/v2/locale/codes`            | All supported locale codes       |
| GET    | `/v2/locale/countries`        | Countries, localized names       |
| GET    | `/v2/locale/countries/eu`     | EU member countries              |
| GET    | `/v2/locale/countries/phones` | Country calling codes            |
| GET    | `/v2/locale/continents`       | Continents, localized names      |
| GET    | `/v2/locale/currencies`       | World currencies                 |
| GET    | `/v2/locale/languages`        | World languages                  |

## Pagination deviation (D27 justification)

All list endpoints return **complete static lists**:

```json
{ "data": [ ... ], "meta": { "total": 249 } }
```

No `limit`/`cursor`/`offset` params are accepted. Justification: these are
build-time-static datasets (~250 items max). Cursor pagination adds zero value;
a default `limit=25` would silently truncate reference data clients expect in
full. `meta.total` is kept so the response still satisfies the envelope rule.

## Responses

### `GET /v2/locale`

GeoIP lookup on the caller IP (maxmind, same DB as v1), names resolved through
the request's Translator (`locale.format()` — ICU-safe, D34 resolution order).

```json
{
  "ip": "203.0.113.7",
  "countryCode": "DE",
  "country": "Germany",
  "continent": "Europe",
  "continentCode": "EU",
  "eu": true,
  "currency": "EUR"
}
```

Unknown/unresolvable IP: `countryCode: "--"`, `continentCode: "--"`,
`country`/`continent` = localized `locale.country.unknown` string,
`currency: null`. Never errors.

### List shapes

| Endpoint           | Item shape                                                                          |
| ------------------ | ----------------------------------------------------------------------------------- |
| `codes`            | `{ "code": "de" }`                                                                  |
| `countries`        | `{ "name": "Germany", "code": "DE" }`                                               |
| `countries/eu`     | same as countries                                                                   |
| `countries/phones` | `{ "code": "+49", "countryCode": "DE", "countryName": "Germany" }`                  |
| `continents`       | `{ "name": "Europe", "code": "EU" }`                                                |
| `currencies`       | `{ "code": "EUR", ... }` (carry over v1 currency objects verbatim)                  |
| `languages`        | `{ "code": "de", "name": "German", ... }` (carry over v1 language objects verbatim) |

Sorting: localized-name `localeCompare` for countries/EU/continents (same as
v1); phones sorted by country code; currencies/languages in source order.

### Localization rules (changes from v1)

- Names come from `Translator.format(key)` instead of raw lookup — apostrophes
  and ICU syntax in translations render correctly (v1's `getRaw` could leak
  escape sequences post-ICU migration).
- Missing translation for a country/continent falls back to the **English
  name** (ISO-code-keyed assets guarantee an `en` entry); never an empty string.
- `countries/phones` skips entries whose country has no translation — carried
  over from v1 behavior, kept for output stability.

## Errors

Standard problem+json (`_conventions.md` §3). This module defines no custom
error types; only framework-level 404/422 can occur.

## Implementation notes

- Data sources port from old `@nuvix/core/config` (`countries`, `euList`,
  `phoneCodes`, `continents`, `currencies`, `languages`, `localeCodes`) into
  `apps/server/src/locale/data.ts` — plain TS constants, no runtime IO.
- GeoIP: maxmind Reader wired via a small provider in app composition; lazy
  singleton. If the `.mmdb` asset is absent at boot, `/v2/locale` returns the
  unknown-IP shape (log once) rather than failing startup.
- Handler layer is thin glue over `context/locale.ts`'s derived `locale`.
