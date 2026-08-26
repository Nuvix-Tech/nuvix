# Nuvix v2 — API Conventions

> Single source of truth for every v2 module contract. Contracts that violate
> this document are bugs. Decisions referenced as Dxx live in `MIGRATION.md`.

---

## 1. Versioning & Prefix (D26)

- All server routes mount under **`/v2`**: `https://<host>/v2/<module>/<resource>`
- The prefix is set once on the root Elysia instance; modules never repeat it.
- Breaking changes within v2 are not allowed — a break means `/v3`.

## 2. JSON Conventions

| Concern      | Convention                                        |
| ------------ | ------------------------------------------------- |
| Field names  | `camelCase`                                       |
| Timestamps   | ISO-8601 UTC strings (`2026-08-26T04:30:10.000Z`) |
| IDs          | Strings, see §5                                   |
| Empty values | omit optional fields rather than sending `null`   |
| Enums        | lowercase kebab strings (`"managed"`, `"email"`)  |

## 3. Errors — RFC 9457 problem+json (D19)

Every non-2xx response is `application/problem+json`:

```json
{
  "type": "/errors/conflict",
  "code": "user_email_exists",
  "title": "Conflict",
  "status": 409,
  "detail": "A user with this email already exists",
  "instance": "A user with this email already exists"
}
```

Two-layer error identity (Stripe-style):

- **`type`** — coarse class. Generic middleware, retry/backoff, and auth-flow
  logic key off this (or off `status`). Only the handful of classes below exist.
- **`code`** — stable, flat, snake_case machine code (`user_not_found`,
  `schema_already_exists`, …). **This is the public contract**: SDKs and the
  console branch on it. Rules: additive changes only; never parse `detail`;
  every domain-specific failure gets one (generic helpers may omit it).

| Field    | Always? | Meaning                                              |
| -------- | ------- | ---------------------------------------------------- |
| `type`   | yes     | Coarse problem class URI (`/errors/*`)               |
| `code`   | opt     | Stable machine code — what clients branch on         |
| `title`  | yes     | Short human summary (HTTP reason)                    |
| `status` | yes     | Mirrors the HTTP status code                         |
| `detail` | opt     | Human explanation for THIS occurrence                |
| `errors` | opt     | Array of `{ field?, message }` for validation errors |

Codes are registered in `apps/server/src/shared/errors.ts` (single source of
truth); a generated error catalog page ships with the docs so each code is
discoverable without reading source.

### Error type registry

| `type`                 | Status | Thrown as           |
| ---------------------- | ------ | ------------------- |
| `/errors/bad-request`  | 400    | `BadRequestError`   |
| `/errors/unauthorized` | 401    | `UnauthorizedError` |
| `/errors/forbidden`    | 403    | `ForbiddenError`    |
| `/errors/not-found`    | 404    | `NotFoundError`     |
| `/errors/conflict`     | 409    | `ConflictError`     |
| `/errors/internal`     | 500    | (never leaked)      |

Framework-native errors (route-not-found, body parse, schema validation) also
emit problem+json via Elysia 2 built-ins. Validation failures use status 422
with `errors[]` populated.

**Rule:** services throw typed `AppError`s from
`apps/server/src/shared/errors.ts`; they never format HTTP responses.

## 4. Pagination (D27)

Every list endpoint returns an envelope with a `meta` object:

```json
{
  "data": [ ... ],
  "meta": {
    "total": 1234,
    "limit": 25,
    "nextCursor": "b3JkZXJfMTIzNA",
    "prevCursor": null
  }
}
```

### Cursor-based (primary)

- Request: `?limit=25&cursor=b3JkZXJfMTIzNA`
- `cursor` is **opaque** — clients never inspect or construct it. Base64url of
  an internal anchor (sort key + row id), stable per sort order.
- `nextCursor: null` ⇒ end of results. `prevCursor` present when a cursor page
  has a known predecessor.
- Default sort: creation time descending, tie-broken by id (stable pagination).

### Offset-based (only where cursors are impractical)

Allowed for small/admin datasets or when the client needs random access:

- Request: `?limit=25&offset=50`
- Meta becomes `{ total, limit, offset }`.
- Justification must be noted in the module contract.

### Rules

- `limit` default **25**, max **100** (endpoints may lower, never raise).
- `total` is always included unless counting is prohibitively expensive; if
  omitted, the contract must say so.
- Old v1 shape (`{ data, total }`) is gone — `total` lives in `meta`.

## 5. IDs (D28)

- Existing ID scheme is kept for DB/tooling compatibility.
- The ID helper (wrapping `@nuvix/db`'s) ports unchanged:
  - `ID.unique(padding = 7)` — generated ids
  - `ID.custom(id)` — caller-supplied ids
  - `ID.auto(id)` — accepts `'unique()'`, short strings → unique, long → custom
- IDs appear in paths as `:userId`, `:schemaId`, … and in bodies as `id`.
- `'unique()'` remains the accepted magic string on create endpoints.

## 6. Authentication Headers

Current inventory carried over from v1 (rename decision pending — Open
Question #9, resolved at Phase 1 contract review):

| Header              | Purpose                        |
| ------------------- | ------------------------------ |
| `x-nuvix-session`   | user session token             |
| `x-nuvix-jwt`       | short-lived JWT                |
| `x-nuvix-key`       | API key (project / console)    |
| `x-nuvix-mode`      | `admin` / `console` mode flag  |
| `x-nuvix-id`        | chunked-upload continuation id |
| `x-nuvix-timestamp` | webhook signature timestamp    |
| `x-nuvix-signature` | webhook signature              |
| `x-nuvix-nonce`     | webhook signature nonce        |

**Contract rule:** auth modules reference these by name from a single
constants module — no inline header strings in route handlers.

## 7. Testing Convention (D30)

All API tests use Eden `treaty`:

```ts
// unit/integration — against the instance (no port needed)
const client = treaty(app);
const { data, error } = await client.v2.users.list.get();

// e2e — against a running server
const client = treaty("http://localhost:4000");
```

- Paths are compile-time checked; a renamed route breaks tests at `tsc`, not runtime.
- Assert error responses through `error.status` and `error.value` (the parsed
  problem+json body).
