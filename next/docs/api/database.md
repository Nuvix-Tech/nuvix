# v2 Contract — Database (Schemas)

> Status: PROPOSED — review before implementation
> Depends on: `_conventions.md` (D19, D26–D28), `@nuvix/db` (user-owned, in progress)
> Old code (reference only): root `apps/server/src/database/`

Schema lifecycle management for the three schema modes (**document**,
**managed**, **unmanaged**). This contract covers **schemas CRUD only** —
collection/attribute/document endpoints are a separate contract gated on the
new `@nuvix/db` package and are explicitly out of scope here.

## Auth posture

Admin-only: `AuthType.ADMIN` sessions and API keys (`KEY`) are accepted;
regular user sessions are rejected with `403 /errors/forbidden`. Scopes:
`schemas.read`, `schemas.write`. This matches v1 exactly.

---

## Endpoints

| Method | Path                         | Purpose                       | Scope         |
| ------ | ---------------------------- | ----------------------------- | ------------- |
| GET    | `/v2/database/schemas`       | List schemas, optional filter | schemas.read  |
| POST   | `/v2/database/schemas`       | Create schema                 | schemas.write |
| GET    | `/v2/database/schemas/:name` | Get one schema                | schemas.read  |
| PATCH  | `/v2/database/schemas/:name` | Update description            | schemas.write |
| DELETE | `/v2/database/schemas/:name` | Drop schema (+ all tables)    | schemas.write |

Schemas are identified by their **name** (no generated IDs — D28 does not
apply). The path parameter is the schema name.

### Schema object

```json
{
  "name": "appdata",
  "description": "Application data",
  "type": "managed"
}
```

| Field         | Type           | Notes                                          |
| ------------- | -------------- | ---------------------------------------------- |
| `name`        | string         | `^[a-z][a-z0-9_]{0,254}$` (same pattern as v1) |
| `description` | string \| null | Optional, max 255 chars                        |
| `type`        | enum           | `document` \| `managed` \| `unmanaged`         |

### `GET /v2/database/schemas`

Query: `type` (optional enum filter).

Response — list envelope per D27 (**deviation from v1's flat `{data,total}`**):

```json
{
  "data": [{ "name": "appdata", "description": null, "type": "managed" }],
  "meta": { "total": 1 }
}
```

System schemas (reserved names in `system.schemas`) are always excluded.

### `POST /v2/database/schemas`

Body: `{ name, description?, type }`.

Behavior by type (preserved from v1):

- **managed / unmanaged** — calls `system.create_schema(name, type,
description)`; PostgreSQL DDL triggers handle policy scaffolding for
  managed mode.
- **document** — additionally seeds the metadata collections required by
  `@nuvix/db` inside the new schema. If seeding fails mid-way, the
  `schemas` registry row is deleted again (rollback to avoid inconsistency)
  and the original error surfaces.

Errors:

`code` is the machine-readable contract (see `_conventions.md` §3):

| Status | Type               | Code                    | When                        |
| ------ | ------------------ | ----------------------- | --------------------------- |
| 409    | `/errors/conflict` | `schema_already_exists` | name already taken          |
| 404    | `/errors/not-found` | `schema_not_found`     | unknown schema              |
| 422    | validation         | —                       | bad name / type             |

### `PATCH /v2/database/schemas/:name`

Body: `{ description? }` (setting it to `null` clears the description).
Returns the updated schema object. `404 /errors/not-found` if missing.

### `DELETE /v2/database/schemas/:name`

`204 No Content`. Drops the schema; the `system.cleanup_schema` DDL trigger
removes the registry row and dependent objects. Deleting a nonexistent
schema → `404 /errors/not-found`.

---

## v1 → v2 deviations

1. **Envelope**: `{ data, meta: { total } }` replaces v1's `{ data, total }`.
2. **Error format**: RFC-9457 problem+json replaces legacy `Exception`
   codes — but the *specificity* returns as the stable `code` field:
   `schema_already_exists`, `schema_not_found` (matching i18n keys
   `errors.database.schemaExists` / `.schemaNotFound`). English `detail`
   remains the fallback; translations never mask it.
3. **Out of scope (deferred)**: collections, attributes, indexes, documents
   endpoints — separate contract once `@nuvix/db` API surface stabilizes.
   Tracked as Phase 3 work; do not implement stubs.

## Implementation notes

- Service stays pure: query the `system.schemas` registry via the project
  pool; no Elysia types inside the service layer (same split as avatars).
- Route layer owns auth posture + scopes via hook objects; binary-free JSON
  responses can use typed handlers directly.
- Smoke cases to add: create/list/get/patch/delete round-trip requires a live
  Postgres — keep harness cases limited to auth-posture rejections (403 for
  guest) until integration fixtures exist.
