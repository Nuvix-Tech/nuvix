# v2 Contract — Database (Schemas)

> Status: IMPLEMENTED + LIVE COMPOSED MATRIX VERIFIED — schema CRUD routes,
> service, catalog, and document bootstrap complete
> Depends on: `_conventions.md` (D19, D26–D28),
> `../architecture/integrations.md`, `@nuvix/db@1.0.0-alpha.2`,
> `@nuvix/pg@2.0.0`
> Old code (reference only): root `apps/server/src/database/`

Schema lifecycle management for the three schema modes (**document**,
**managed**, **unmanaged**). This contract covers **schemas CRUD only**.
Collection, attribute, and document endpoints require a separate reviewed
contract and remain out of scope; package stabilization does not add them here.

This API operates on the project's PostgreSQL 18 database provisioned from the
`nuvix/postgres:18.1` image (source repository: `nuvix-dev/postgres`). There is
no SQLite project-database variant; SQLite support applies only to the
platform/control-plane registry.

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

The released image implements `system.create_schema` as an upsert and may
change an existing schema's type. The service must therefore perform an
explicit existence check and return `schema_already_exists` before invoking it.

Errors:

`code` is the machine-readable contract (see `_conventions.md` §3):

| Status | Type                | Code                    | When               |
| ------ | ------------------- | ----------------------- | ------------------ |
| 409    | `/errors/conflict`  | `schema_already_exists` | name already taken |
| 404    | `/errors/not-found` | `schema_not_found`      | unknown schema     |
| 422    | validation          | —                       | bad name / type    |

### `PATCH /v2/database/schemas/:name`

Body: `{ description? }` (setting it to `null` clears the description).
Returns the updated schema object. `404 /errors/not-found` if missing.

### `DELETE /v2/database/schemas/:name`

`204 No Content`. Drops the schema; the `system.cleanup_schema` DDL trigger
removes the registry row and dependent objects. Deleting a nonexistent
schema → `404 /errors/not-found`.

---

## SQL Data Plane (Tables & Rows)

Direct table access for `managed` and `unmanaged` schemas via `@nuvix/pg`.

| Method | Path                                                 | Purpose                      | Scope                 |
| ------ | ---------------------------------------------------- | ---------------------------- | --------------------- |
| GET    | `/v2/database/schemas/:name/tables/:table`           | Query table rows with filter | `schemas.tables.read` |
| GET    | `/v2/database/schemas/:name/tables/:table/count`     | Count rows matching filter   | `schemas.tables.read` |
| GET    | `/v2/database/schemas/:name/tables/:table/:rowId`    | Get single row by primary ID | `schemas.tables.read` |
| POST   | `/v2/database/schemas/:name/tables/:table`           | Insert row(s)                | `schemas.tables.write`|
| PATCH  | `/v2/database/schemas/:name/tables/:table/:rowId`    | Update row by primary ID     | `schemas.tables.write`|
| PATCH  | `/v2/database/schemas/:name/tables/:table`           | Update rows matching filter  | `schemas.tables.write`|
| DELETE | `/v2/database/schemas/:name/tables/:table/:rowId`    | Delete row by primary ID     | `schemas.tables.write`|
| DELETE | `/v2/database/schemas/:name/tables/:table`           | Delete rows matching filter  | `schemas.tables.write`|

---

## Document Data Plane (Collections, Attributes, Indexes, Documents)

NoSQL-style DBaaS collection management and document CRUD for `document` schemas via `@nuvix/db`.

### Collections
| Method | Path                                                           | Purpose                 | Scope               |
| ------ | -------------------------------------------------------------- | ----------------------- | ------------------- |
| GET    | `/v2/database/schemas/:name/collections`                       | List collections        | `collections.read`  |
| POST   | `/v2/database/schemas/:name/collections`                       | Create collection       | `collections.write` |
| GET    | `/v2/database/schemas/:name/collections/:collectionId`         | Get collection details  | `collections.read`  |
| PUT    | `/v2/database/schemas/:name/collections/:collectionId`         | Update collection       | `collections.write` |
| DELETE | `/v2/database/schemas/:name/collections/:collectionId`         | Delete collection       | `collections.write` |

### Attributes & Indexes
| Method | Path                                                                          | Purpose            | Scope               |
| ------ | ----------------------------------------------------------------------------- | ------------------ | ------------------- |
| GET    | `/v2/database/schemas/:name/collections/:collectionId/attributes`              | List attributes    | `collections.read`  |
| POST   | `/v2/database/schemas/:name/collections/:collectionId/attributes`              | Create attribute   | `collections.write` |
| DELETE | `/v2/database/schemas/:name/collections/:collectionId/attributes/:attributeId`| Delete attribute   | `collections.write` |
| GET    | `/v2/database/schemas/:name/collections/:collectionId/indexes`                 | List indexes       | `collections.read`  |
| POST   | `/v2/database/schemas/:name/collections/:collectionId/indexes`                 | Create index       | `collections.write` |
| DELETE | `/v2/database/schemas/:name/collections/:collectionId/indexes/:indexId`        | Delete index       | `collections.write` |

### Documents
| Method | Path                                                                          | Purpose            | Scope               |
| ------ | ----------------------------------------------------------------------------- | ------------------ | ------------------- |
| GET    | `/v2/database/schemas/:name/collections/:collectionId/documents`               | List documents     | `documents.read`    |
| POST   | `/v2/database/schemas/:name/collections/:collectionId/documents`               | Create document    | `documents.write`   |
| GET    | `/v2/database/schemas/:name/collections/:collectionId/documents/:documentId`  | Get document       | `documents.read`    |
| PATCH  | `/v2/database/schemas/:name/collections/:collectionId/documents/:documentId`  | Update document    | `documents.write`   |
| DELETE | `/v2/database/schemas/:name/collections/:collectionId/documents/:documentId`  | Delete document    | `documents.write`   |

---

## v1 → v2 deviations

1. **Envelope**: `{ data, meta: { total } }` replaces v1's `{ data, total }`.
2. **Error format**: RFC-9457 problem+json replaces legacy `Exception`
   codes — with stable `code` values:
   `schema_already_exists`, `schema_not_found`, `collection_not_found`,
   `collection_already_exists`, `attribute_not_found`, `attribute_already_exists`,
   `index_not_found`, `index_already_exists`, `document_not_found`, `row_not_found`.
3. **Unified REST Routing**: All database routes are neatly nested under
   `/v2/database/schemas/:name/` for both SQL tables/rows and Document collections/documents.

## Implementation notes

- Resolve the tenant schema catalog and `Database` through the central
  composition root. `@nuvix/pg` owns catalog queries and fixed custom-image SQL;
  `@nuvix/db` owns document metadata administration. Never call document CRUD
  on the admin `Database`.
- Keep metadata collection creation on the `Database` admin plane. If bootstrap
  also needs to insert seed documents, its privileged boundary obtains an
  explicit `db.system()` session that is never exposed to the request scope.
  Caller-owned document work uses `db.for(...roles)`.
- Inject only the schema operations this service needs. Keep Elysia and package
  construction outside the service. Routes must not receive Bun `SQL`, the
  PostgreSQL facade, adapters, or privileged database sessions.
- Activate generated collection typing once through `Entities` module
  augmentation when document contracts are added.
- Route layer owns auth posture + scopes via hook objects; binary-free JSON
  responses can use typed handlers directly.
- Translate package failures through the shared package-error translator; this
  contract's `schema_*` codes remain the public API.
- The fake-backed route suite covers transport/auth behavior. The opt-in live
  suite covers schema CRUD, reserved exclusion, document metadata bootstrap,
  and bootstrap-failure cleanup on PostgreSQL 18.

## Live composed verification

From `next/`, run the explicitly selected integration suite:

```bash
bun run test:integration:live
```

The same production composition is verified with PostgreSQL platform persistence
and with a real-file SQLite platform. Each row resolves two isolated tenant
databases on exactly `nuvix/postgres:18.1` and exercises all five schema routes
with real tenant-local API keys. Coverage includes reserved-schema exclusion,
same-name tenant isolation, document metadata bootstrap, duplicate/missing
errors, wrong-tenant credentials, deficient scopes, and redacted unavailable
targets.

The helper uses daemon-assigned loopback ports, an actual `pg_isready` probe,
and idempotent cleanup. A missing Docker daemon, local image, or readiness signal
fails the selected suite. Ordinary `bun test` does not claim this live coverage.
