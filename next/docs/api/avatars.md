# v2 Contract — Avatars

> Status: IMPLEMENTED — `apps/server/src/avatars/{service,route}.ts`
> Depends on: `_conventions.md`, `_i18n.md` (D32–D34), MIGRATION.md D21
> Old code (reference only): root `apps/server/src/avatars/`

Image generation/proxy endpoints. All responses are **binary PNG** with
immutable caching. Guest-accessible within project context; scope
`avatars.read` reserved for future API-key enforcement, not checked initially.

## Image pipeline (D21)

| Concern              | v1                    | v2                                  |
| -------------------- | --------------------- | ----------------------------------- |
| Raster resize/encode | `sharp` (lazy import) | `Bun.Image`                         |
| SVG → PNG            | `@resvg/resvg-js`     | `@resvg/resvg-js` (kept — D21 note) |
| QR encoding          | `qrcode` pkg          | `qrcode` pkg (no Bun native)        |

All generated images are PNG (`image/png`). No format negotiation in v2.

---

## Endpoints

| Method | Path                             | Purpose                |
| ------ | -------------------------------- | ---------------------- |
| GET    | `/v2/avatars/credit-cards/:code` | Credit card brand icon |
| GET    | `/v2/avatars/browsers/:code`     | Browser logo           |
| GET    | `/v2/avatars/flags/:code`        | Country flag           |
| GET    | `/v2/avatars/initials`           | Initials avatar        |
| GET    | `/v2/avatars/favicon`            | Site favicon proxy     |
| GET    | `/v2/avatars/qr`                 | QR code                |

### Common query params (credit-cards / browsers / flags)

| Param     | Type    | Default | Range  |
| --------- | ------- | ------- | ------ |
| `width`   | integer | 100     | 1–2000 |
| `height`  | integer | 100     | 1–2000 |
| `quality` | integer | 90      | 0–100  |

Response: `200` `image/png`,
`Cache-Control: public, max-age=86400, immutable`.

Unknown `code` → `404` problem+json:

```json
{
  "type": "/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Unknown avatar code: xx",
  "messageKey": "errors.avatars.unknownCode"
}
```

(`messageKey` translated per request locale per D34; English `detail` is the
fallback. New `errors.avatars.*` keys added to `en.json`.)

### `GET /v2/avatars/initials`

| Param        | Type    | Default | Notes                                              |
| ------------ | ------- | ------- | -------------------------------------------------- |
| `name`       | string  | —       | initials drawn from this name                      |
| `width`      | integer | 500     | 1–2000                                             |
| `height`     | integer | 500     | 1–2000                                             |
| `background` | string  | random  | hex color or CSS color name; sanitized server-side |
| `circle`     | boolean | false   | circular crop                                      |

Server renders an SVG template → resvg → PNG. Empty/missing `name` falls back
to `"NA"` initials (v1 parity — correction: an earlier draft claimed a blank
tile; v1 actually renders "NA").

### `GET /v2/avatars/favicon`

| Param | Type   | Notes                       |
| ----- | ------ | --------------------------- |
| `url` | string | required, must be valid URL |

Proxies/fetches the site's favicon and returns it as PNG.
**Change from v1:** response gets `Cache-Control: public, max-age=3600`
(1 hour, NOT immutable — remote favicons change; v1 sent no cache header at
all, which forced re-fetches on every load).

Upstream fetch failure → `404` problem+json (`/errors/not-found`, messageKey
`errors.avatars.faviconUnavailable`). SSRF guard: only `http(s)` schemes;
private-IP literal hosts rejected (new hardening; v1 had none).

### `GET /v2/avatars/qr`

| Param      | Type    | Default | Range                 |
| ---------- | ------- | ------- | --------------------- |
| `text`     | string  | —       | required, 1–512 chars |
| `size`     | integer | 400     | 1–1000                |
| `margin`   | integer | 1       | 0–10                  |
| `download` | boolean | false   |                       |

`download=true` sets `Content-Disposition: attachment; filename="qr.png"`,
otherwise `inline`.

## Validation errors

All param violations return Elysia's built-in `422` problem+json with
`errors[]` populated (`_conventions.md` §3). Route schemas are declared with
`t` so OpenAPI docs stay accurate.

## Implementation notes

- Vertical slice: `apps/server/src/avatars/{route,schema,service}.ts` +
  co-located tests (D15/D16).
- Static assets (card/browser/flag SVGs) port from old config into
  `apps/server/src/avatars/assets/`.
- Service functions return `{ body: Buffer | Uint8Array, contentType, headers }`;
  route layer converts to `Response`. Keeps image logic testable without HTTP.
- Cache headers set via explicit `headers` on the Response — not Elysia
  `.header()` chains — so they survive error-handler rewrites.
