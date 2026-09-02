# Nuvix v2 — Bun-Native Rewrite Plan

> **Status**: EXECUTION — Phase 3 teams memberships and user projection complete
> **Scope**: Full rewrite of the Nuvix backend from NestJS/Fastify/Node to a
> Bun-native stack built on Elysia (`elysia@next`). This is a **rewrite**, not
> a mechanical migration.
> **Location**: Product implementation lives in `next/`. Root product code stays
> untouched and runnable as reference until the explicitly approved cutover.

---

## 0. Philosophy

**The old codebase is a REFERENCE, not a BLUEPRINT.**

| Old code tells us              | Old code does NOT tell us             |
| ------------------------------ | ------------------------------------- |
| What the product does          | How to structure folders/files        |
| What routes/features exist     | What to name functions or params      |
| Business rules & edge cases    | Which patterns to keep                |
| Where the hard-won logic lives | The API contract (we're designing v2) |

We are building the **next version**: APIs improve, structure improves,
architecture improves. Every structural decision is made fresh, optimized for
testability, readability, and Bun-native performance — never copied from the
old tree out of convenience.

---

## 1. Ground Rules

### ✅ What we FOLLOW

1. **Bun-native first.** Before any dependency, check Bun builtins:
   - `Bun.sql` / `SQL` — Postgres · `Bun.redis` — Redis
   - `Bun.password` — argon2id/bcrypt · `Bun.file` / `Bun.write` — files
   - `Bun.crypto` / `crypto.subtle` — HMAC, JWT, tokens, MD5 legacy
   - `Bun.spawn`, `Bun.sleep`, `Bun.env`, `bun test`
     File handling, hashing, HTTP, scheduling — all through Bun natives.
2. **Elysia idioms.** Lifecycle hooks (`onRequest/onParse/onBeforeHandle/
onError`), typed context via `derive`/`resolve`, `t` (TypeBox) schemas,
   plugin composition. No framework fighting.
3. **Contract-first per module.** Before porting a domain, write its v2 API
   contract (routes, schemas, errors) in `docs/api/<module>.md`, review it,
   then implement. Implementation without a reviewed contract doesn't start.
4. **Vertical slices.** One domain = one self-contained folder with co-located
   route + schema + service + tests (see §4).
5. **Structure as you go.** Never copy old file organization. Extract pure,
   testable functions; keep handlers thin; services own business logic.
6. **Pin exact versions** of `elysia@next` (beta) and plugins in `bun.lock`.
7. **Reference, don't trust.** When implementing business logic, read the old
   service code to learn the _rules_ (e.g. session expiry semantics, bucket
   permission inheritance), then implement cleanly in the new shape.

### ❌ What we DON'T follow

1. **Old tests are NOT truth.** AI-generated slop, outdated. Not ported, not
   trusted. New tests are written fresh against the v2 contracts.
2. **No NestJS patterns.** No DI container, decorators, modules,
   reflect-metadata, rxjs, class-validator/class-transformer.
3. **No Node compatibility shims.** Bun-only runtime (D8).
4. **No copying of naming.** Function names, param names, DTO names, file
   layouts from the old repo are not carried over unless genuinely good.
5. **Don't touch root monorepo.** It stays runnable as a live reference.

---

## 2. Locked Architecture Decisions

| #   | Decision                       | Choice                                                                                                                                                                                                                                                                                  | Notes                                                                                                         |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| D1  | Location                       | `next/` subfolder, new monorepo                                                                                                                                                                                                                                                         | Parallel dev; root deletable at cutover                                                                       |
| D2  | Framework                      | **Elysia `elysia@next` (2.0.0-beta.x)**                                                                                                                                                                                                                                                 | Bun-native, e2e type safety                                                                                   |
| D3  | Validation                     | Elysia built-in `t` (TypeBox)                                                                                                                                                                                                                                                           | Replaces class-validator/transformer                                                                          |
| D4  | Queues                         | BullMQ + Bun adapter (`createBunRedisClient(new RedisClient(...))`)                                                                                                                                                                                                                     | Revisit minimal custom queue later                                                                            |
| D5  | Passwords                      | `Bun.password` (argon2id/bcrypt)                                                                                                                                                                                                                                                        | Drops argon2+bcrypt pkgs                                                                                      |
| D6  | JWT                            | Hand-rolled HS256/HS512 on `crypto.subtle`                                                                                                                                                                                                                                              | Drops @nestjs/jwt                                                                                             |
| D7  | Monorepo                       | Plain Bun workspaces (no Turborepo)                                                                                                                                                                                                                                                     | Native tooling only                                                                                           |
| D8  | Runtime                        | **Bun-only**, Node dropped                                                                                                                                                                                                                                                              | Unlocks all native APIs                                                                                       |
| D9  | Templates                      | Keep Handlebars                                                                                                                                                                                                                                                                         | Template-syntax compat for users                                                                              |
| D10 | API docs                       | `@elysia/openapi` (official 2.x plugin, Scalar UI)                                                                                                                                                                                                                                      | Spec at `/v2/openapi/json`, Scalar UI at `/v2/openapi`. Needs a small Bun patch (Phase 1 notes)               |
| D11 | Nuvix infrastructure packages  | Bun/ESM-only sibling source checkouts linked from `@nuvix/server`: `file:../../../../database`, `file:../../../../pg-ts`, `file:../../../../cache`, `file:../../../../storage`, and `file:../../../../messaging`                                                                        | Build siblings before installing/validating `next`; see `docs/architecture/integrations.md`                   |
| D12 | `@nuvix/pg`                    | Use Bun-native `@nuvix/pg@2.0.0` from the `pg-ts` sibling checkout                                                                                                                                                                                                                      | Infrastructure-only PostgreSQL tenant capability; immutable builders and caller-owned Bun SQL                 |
| D13 | **API surface**                | **Full v2 API redesign**                                                                                                                                                                                                                                                                | Paths, payloads, pagination may all change; documented per-module first                                       |
| D14 | **Errors**                     | **New unified error format**                                                                                                                                                                                                                                                            | Consistent codes, structured details, correct HTTP statuses                                                   |
| D15 | **Code layout**                | Vertical slices (feature folders)                                                                                                                                                                                                                                                       | Co-located route/schema/service/test                                                                          |
| D16 | **File naming**                | Minimal suffixes                                                                                                                                                                                                                                                                        | `locale/service.ts`, not `locale.service.ts`                                                                  |
| D17 | **Tests**                      | `bun test`                                                                                                                                                                                                                                                                              | Zero-dep, native                                                                                              |
| D18 | **Workspace names**            | Simple internal names (`@nuvix/next-core`, `@nuvix/next-utils`, …)                                                                                                                                                                                                                      | Rename-friendly during rewrite                                                                                |
| D19 | **Web standards**              | RFC 9457 Problem Details (`application/problem+json`) for ALL errors; standard HTTP semantics, caching, status codes throughout                                                                                                                                                         | Elysia 2 has native `problem()` support — use it, don't invent an envelope                                    |
| D20 | **Multi-tenancy**              | First-class: **each tenant (project) gets its own database**; a public publishable key selects the project before tenant-local authentication                                                                                                                                           | Locator is not authorization; see §6b                                                                         |
| D21 | **Images**                     | `Bun.Image` replaces `sharp`; retain `@resvg/resvg-js` for SVG→PNG                                                                                                                                                                                                                      | Native raster formats plus the resolved SVG fallback                                                          |
| D22 | **Scheduling**                 | `Bun.cron` replaces `@nestjs/schedule` / cron loops                                                                                                                                                                                                                                     | OS-level scheduled jobs, built-in                                                                             |
| D23 | **Auth model**                 | Design auth module **token-ready**: short-lived access tokens (~1 min) + refresh tokens (Clerk-style) as target state; DB sessions may ship first but must not be baked into architecture                                                                                               | See resolved Open Question #6                                                                                 |
| D24 | **Tenant/project engine**      | PostgreSQL 18 only via deployable image `nuvix/postgres:18.1` ([source](https://github.com/nuvix-dev/postgres))                                                                                                                                                                         | Projects depend on PostgreSQL schemas/triggers; no SQLite tenant mode                                         |
| D25 | **Schema/collections**         | Free to redesign collection/schema model during rewrite                                                                                                                                                                                                                                 | Old schema is reference, not contract                                                                         |
| D26 | **API prefix**                 | `/v2`                                                                                                                                                                                                                                                                                   | All server routes mounted under `/v2`                                                                         |
| D27 | **Pagination**                 | Cursor-based primary; offset allowed where cursors impractical. Every list response carries a `meta` object                                                                                                                                                                             | Meta shape defined in `_conventions.md`                                                                       |
| D28 | **IDs**                        | Keep existing ID scheme — port the ID class from old lib                                                                                                                                                                                                                                | DB/tooling compat where it matters                                                                            |
| D29 | **Legacy compat**              | **Dropped.** Breaking release: no legacy data migration, no legacy password algo support (MD5 etc.), no legacy session/token survival across cutover                                                                                                                                    | Simplifies auth & schema work substantially                                                                   |
| D30 | **Test client**                | `@elysia/eden` `treaty` (2.0.0-beta.5, pinned) for ALL API tests — unit (against instance) and e2e (against URL). Fully typed paths/responses/errors generated from the Elysia instance                                                                                                 | Compile-time route safety; one client pattern everywhere; error bodies typed via `error.value`                |
| D31 | **TypeScript**                 | TypeScript 7.0.2 (Go-native compiler, stable). Verified: full workspace typechecks clean incl. Elysia generics; ~0.2s for the repo                                                                                                                                                      | Bun transpiles anyway — tsc is typecheck-only here, so native compiler is pure win; revisit if issues surface |
| D32 | **i18n scope & engine**        | Everything localized (errors, emails, SMS, locale data) via **ICU MessageFormat** (`intl-messageformat`) in `packages/i18n`; assets stay flat dot-key JSON at `assets/locale/translations/`                                                                                             | 73 locales migrated to ICU by script; see `docs/api/_i18n.md`                                                 |
| D33 | **Typed translation keys**     | `TranslationKey` union generated from `en.json` (`bun run generate:keys` in `packages/i18n`); unknown keys are compile errors                                                                                                                                                           | Per-key param-type inference dropped (ICU) — params are a plain record, verified by tests                     |
| D34 | **Locale resolution**          | `x-nuvix-locale` header > user pref (future hook) > `Accept-Language` (q-values) > `en`; exposed on context as `locale` via `'plugin'`-scoped derive; error `messageKey` translated at serialization time                                                                               | English `detail` always present as fallback; translation failures never mask the original error               |
| D35 | **GeoIP graceful degradation** | Bundled dbip `.mmdb`; missing asset → no-op provider (lookups `null`), `/v2/locale` serves unknown-IP shape, warn once at boot — never fails startup                                                                                                                                    | Full DNS-pinned SSRF guards + Redis-cached lookups deferred to hardening pass                                 |
| D36 | **Avatar caching**             | Static avatars/QR: `Cache-Control: public, max-age=86400, immutable`; favicon proxy: `max-age=3600` NOT immutable (remote content changes); favicon gets SSRF guard (http(s) only, private-host literals rejected, image/* content-type required) — v1 had no cache header and no guard | QR `Content-Disposition: inline` by default, `attachment` with `download=true`                                |
| D37 | **Package integration**        | One composition root; explicit DI through narrow interfaces; caller-scoped DB sessions; explicit system sessions; shared error translator, messaging gateway, and storage/cache factories                                                                                               | See `docs/architecture/integrations.md`; routes never construct or coordinate infrastructure                  |
| D38 | **Project locator**            | `x-nuvix-publishable-key`: `pk_test_` / `pk_live_` + canonical base64url(`v1:<projectId>`). Public and reversible, never authorization. Resolve project → tenant DB → tenant-local auth                                                                                                 | `x-nuvix-key` remains the distinct secret API-key header                                                      |
| D39 | **Platform database engine**   | PostgreSQL or SQLite through public `@nuvix/db`                                                                                                                                                                                                                                         | The control plane stores portable documents and does not require custom project PostgreSQL features           |

### Elysia 2 API notes (code against THESE from day one)

Elysia 2 is a complete rewrite with breaking changes. We never write Elysia-1-style code:

| Elysia 1.x                                                                         | Elysia 2 (`elysia@next`)                                                                     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `.get('/', handler, { body: t.Object({...}) })`                                    | `.get('/', { body: t.Object({...}) }, handler)` — **options BEFORE handler**                 |
| `onRequest / onParse / onBeforeHandle / onAfterHandle / onAfterResponse / onError` | `request / parse / beforeHandle / afterHandle / afterResponse / error` (`on` prefix dropped) |
| `resolve()` (ran at beforeHandle)                                                  | **removed** — `derive()` now runs at beforeHandle                                            |
| `.error('Code', Class)` + error dictionary                                         | `.error(MyErrorClass, handler)` — class-based, fully inferred                                |
| Custom error envelopes                                                             | RFC 9457 via `problem(status, {...})` + `application/problem+json`                           |
| `.ws()` always available                                                           | opt-in: `.use(websocket())` from `elysia/websocket`; generator handlers (`yield`) preferred  |
| guard/group additive schemas                                                       | default **override**; pass `schema: 'standalone'` explicitly when needed                     |
| `{ as: 'scoped' }`                                                                 | string scope form: `.guard('plugin', fn)` etc.                                               |
| JIT compile at request time                                                        | optional **AOT build plugin**: `import { aot } from 'elysia/plugin/aot/bun'` in `Bun.build`  |
| `@elysiajs/*` plugins                                                              | new official scope is **`@elysia`** for 2.x plugins (`@elysiajs` stays 1.x)                  |

Also useful: `defer(fn)` for post-response work (audit/stats side-effects),
per-field cookie schemas with signing, `Manifest.isCapturing()` to skip
long-running connections during AOT dry-run.

### Bun 1.4 natives we adopt

| Need                                   | Bun builtin                                   |
| -------------------------------------- | --------------------------------------------- |
| Image processing (avatars, thumbnails) | `Bun.Image` (D21)                             |
| Scheduled jobs                         | `Bun.cron` (D22)                              |
| Files/storage local driver             | `Bun.file`, `Bun.write`, `Bun.s3.*`           |
| Hashing/tokens/JWT                     | `Bun.crypto`, `crypto.subtle`, `Bun.password` |
| SQL / Redis                            | `Bun.sql`, `Bun.redis`                        |
| Tarballs/archives (backups, exports)   | `Bun.Archive`                                 |
| Config files                           | `Bun.JSON5`, TOML/YAML utils                  |

---

## 3. Dependency Migration Map

### Removed → replaced by Bun natives or Elysia

| Old                                                  | Replacement                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `@nestjs/*` (all ~10 pkgs)                           | Elysia core + plugins + our composition                                         |
| `fastify`, `@fastify/{cookie,multipart,static,view}` | Elysia built-ins/plugins                                                        |
| `class-validator`, `class-transformer`               | Elysia `t` schemas                                                              |
| `@nestjs/jwt`                                        | `packages/core/jwt.ts` on `crypto.subtle`                                       |
| `ioredis`                                            | `Bun.redis` (+ BullMQ Bun adapter for queues)                                   |
| `pg`                                                 | `Bun.sql` via new `@nuvix/db`; pg type-parser config deleted                    |
| `argon2`, `bcrypt`                                   | `Bun.password`                                                                  |
| `reflect-metadata`, `rxjs`                           | deleted                                                                         |
| `qs`, `path-to-regexp`                               | Elysia router/parsing                                                           |
| `@nestjs/schedule`                                   | `Bun.cron` (D22)                                                                |
| `@nestjs/event-emitter`                              | typed emitter on `EventTarget`                                                  |
| `sharp`                                              | `Bun.Image` (D21)                                                               |
| `otplib`                                             | evaluate at Auth phase: RFC-6238 TOTP on `crypto.subtle`, else keep temporarily |

### Kept (justified)

| Package                                                                        | Why                                                                           |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `handlebars`                                                                   | User template syntax compat (D9)                                              |
| `bullmq`                                                                       | Queue engine w/ Bun adapter (D4)                                              |
| `maxmind`                                                                      | GeoIP; no Bun native equivalent                                               |
| `@resvg/resvg-js`                                                              | SVG→PNG rendering — `Bun.Image` has no SVG support (pending Open Question #7) |
| `@nuvix/db`, `@nuvix/pg`, `@nuvix/cache`, `@nuvix/storage`, `@nuvix/messaging` | Local sibling source packages; integrated through D37 boundaries              |
| `@nuvix/audit`, `@nuvix/telemetry`                                             | Nuvix libraries retained; versions selected when their phases begin           |
| `elysia@next`, `@elysia/openapi`                                               | New foundation                                                                |

### Final migrated package contracts

| Package            | Integration contract                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nuvix/db`        | Infrastructure owns raw `Database` resources. Requests receive only role-scoped `Session` leases from `db.for(...roles)` and never receive `db.system()`. Generated types augment `Entities`. |
| `@nuvix/pg`        | Infrastructure binds an immutable PostgreSQL facade to the tenant-owned Bun `SQL`. Services receive narrow catalog capabilities; routes never receive SQL or the facade.                      |
| `@nuvix/cache`     | `Cache` is the application facade; `Memory`, `Redis`, and `None` are drivers. DB depends only on structural `CacheDriver` methods: `get`, `set`, `flushByTags`, `flush`.                      |
| `@nuvix/storage`   | `Local` keeps its positional root; cloud device constructors use options objects. A central `Storage` registry owns devices. `StorageError.code` drives translation.                          |
| `@nuvix/messaging` | Sends report every recipient's success/failure. `MessagingError.code` drives translation. `JWT.sign` is async for RS256/ES256 provider assertions; there is no `JWT.encode`.                  |

These dependencies resolve from the required sibling checkout layout through
the `file:` paths in `apps/server/package.json`. Package API stabilization does
not authorize new endpoints. See the integration architecture for the build,
refresh, and validation workflow.

---

## 4. Current Monorepo Structure (`next/`)

```
next/
├── MIGRATION.md                  ← this file
├── docs/
│   ├── architecture/             ← reusable integration and system designs
│   └── api/                      ← v2 API contracts, one file per module (reviewed BEFORE impl)
├── package.json                  ← bun workspaces: ["apps/*", "packages/*"]
├── bun.lock                      ← exact-pinned elysia@next + plugins
├── tsconfig.json                 ← strict, bundler resolution, bun-types
├── biome.json
├── apps/
│   └── server/
│       ├── src/                  ← app, context, infrastructure, plugins, slices
│       │   └── {avatars,database,locale,teams,users}/
│       └── test/                 ← unit, route, smoke, and opt-in integration tests
└── packages/
    ├── i18n/                     ← ICU translation loader and typed keys
    ├── utils/                    ← runtime configuration and shared utilities
    └── platform-db/              ← reserved for later platform-domain work
```

### Pipeline mapping (conceptual old → new)

| Concern                       | New home                                                     |
| ----------------------------- | ------------------------------------------------------------ |
| CORS / security headers       | global plugins in `app.ts`                                   |
| Project + tenant resolution   | `infrastructure/database-composition.ts` + request scope     |
| Auth (session/JWT/API key)    | `context/tenant-auth.ts` after tenant acquisition            |
| Rate limiting                 | `packages/core/ratelimit` on `Bun.redis`                     |
| Audit/stats/logs side-effects | `onAfterResponse` hooks → queues                             |
| Error handling                | shared package translator → `AppError` → single error plugin |
| Validation                    | `t` schemas inline per route                                 |
| Response shaping              | `mapResponse` / plain handler returns                        |

---

## 5. Execution Phases

> Each module follows the same loop:
> **design contract → review → implement → bun test → manual smoke vs old behavior**

### Phase 0 — Scaffolding

- [x] `next/` monorepo: workspaces, tsconfig, biome, env loader (`packages/utils/src/config.ts`, fail-fast validation)
- [x] Pin `elysia@next` exact version (**2.0.0-beta.6**); smoke-test boot + `/v2/health` ✅
- [x] Define **API conventions** in `docs/api/_conventions.md`: RFC 9457 problem+json errors (D19), pagination (D27), ID scheme (D28), versioning/prefix (D26), auth header names (see §7 Open Questions)
- [x] Port config module into `packages/utils`
- [x] Error classes + `problemErrors` plugin mapping `AppError` → RFC-9457 (tested)

**Elysia 2.0.0-beta.6 API notes** (verified against installed source, not docs):

- `.onError` does NOT exist — error handling is `.error(ErrorClass, handler)` or `.error('global'|'plugin'|'local', Class, handler)`
- Error handlers registered inside a plugin MUST use `'global'` scope or they silently don't propagate to the consuming instance
- Native RFC-9457 support: built-in `problem(status, detail)` helper; framework already emits problem+json for 404/validation/etc. Built-in errors: `NotFound`, `ParseError`, `ValidationError` (422), `InternalServerError`, all extending `ElysiaError` with `problemType`/`problemTitle`
- Bun 1.4 uses the isolated linker by default → workspace deps live under `<pkg>/node_modules`, not hoisted to root
- Route signature is options-before-handler: `.get(path, { response: t.Object({...}) }, handler)`

### Phase 1 — Core pipeline skeleton

- [x] Typed error classes + problem+json envelope (done early in Phase 0 — `apps/server/src/shared/errors.ts` + `plugins/errors.ts`)
- [x] Auth resolution primitives: JWT util (`utils/jwt.ts`, zero-dep HS256 on `crypto.subtle`), auth context (`context/auth.ts`: guest/session/jwt/apiKey union, pluggable DB-backed verifiers for later phases; precedence session > jwt > key > guest)
- [x] CORS (`plugins/cors.ts`, hand-rolled), security headers (`plugins/security.ts`), rate limiting (`plugins/rate-limit.ts`, pluggable `Store`; memory impl now, Redis drops in later) — all tested
- [x] Context chain: publishable-key project lookup → tenant acquisition →
      tenant-local auth → caller-scoped session, with live startup/shutdown
- [x] OpenAPI docs via `@elysia/openapi@2.0.0-beta.1` (D10) — spec at `/v2/openapi/json` (typed from `t` schemas), Scalar UI at `/v2/openapi`. **Requires a Bun patch** (`patches/@elysia+openapi@2.0.0-beta.1.patch`): the published bundle has broken relative `../node_modules/typebox` imports in its `gen` submodule; the patch stubs `Script` (only used by `fromTypes()`, which we don't use). Root `package.json` also carries `elysia` so the patched copy resolves it under Bun's isolated linker. Defaults differ from v1 plugin: spec path is `/openapi/json` (not `/openapi.json`), UI is Scalar (not Swagger).

**Phase 1 notes (verified against elysia 2.0.0-beta.6 source):**

- `onRequest` does NOT exist → the hook is `.request(fn)` (matches §2 table, but confirmed in practice: this is exactly why `@elysiajs/cors@1.x` crashes)
- `derive` inside a plugin needs explicit scope to cross `.use()` boundaries: `.derive('plugin', fn)`; local-scoped derive silently doesn't propagate (same class of bug as error handlers needing `'global'`)
- **Plugin factories MUST be invoked before `.use()`**: `.use(plugin(opts))` works, but `.use(plugin)` (bare function reference) silently drops the returned instance's `'global'`-scoped error handlers — requests fall through to default error handling. Mutator-style plugins (`fn(app)` that calls `.request()`/`.derive()` on the passed instance) are unaffected. Verified empirically against 2.0.0-beta.6
- **Route signature is `.get(path, hook, handler)`** — the schema/hook object comes BEFORE the handler (v1 Elysia had handler second). Passing `(path, handler, hook)` does not error: the hook object is treated as the handler and gets JSON-serialized as the response body (`{"query":{...}}`), and the real function is registered as a hook. Every route in a module silently returns its own schema. Caught via treaty 404/shape mismatches; verified with minimal repro
- **Returning a `Response` instance from a handler breaks when any hook object is present** — even `{}` — the Response gets stringified. Binary endpoints must return bytes (`Uint8Array`) and set `content-type` etc. via `set.headers` instead
- **`query`/`headers`/etc. in hooks must be a single TypeBox schema** (`t.Object({...})`); a plain object-of-schemas fails at route-compile time with "Elysia Validator support only TypeBox and Standard Schema" (500 on first request, not at registration)
- **Async derives MUST be awaited inside the derive fn**: `.derive('plugin', ({req}) => ({ locale: getTranslator(...) }))` leaves a bare `Promise` on context — first consumer crashes with `locale.format is not a function`. Latent until a route actually reads the value; use `.derive('plugin', async (...) => ({ locale: await ... }))`
- **Derives don't flow through TYPES across separate plugin instances**: `localeRoutes()` mounted after `localeContext()` sees `locale` at runtime but TS doesn't. Self-contained modules should own their derive (accept `LocaleContextOptions`, derive internally) for full inference
- **`context.ip` is not auto-populated** in beta.6 — resolve client IP manually: `x-forwarded-for` header first, else `server?.requestIP(request)?.address`
- **Eden treaty dynamic segments take the VALUE as property**: `client.v2.avatars.flags.us.get()`, NOT `.get({ params: { code: 'us' } })` (the latter sends the literal `:code` path)
- Async error handlers + returning `problem(status, {...})` from them work correctly (unwrapped to problem+json on both route and error handler paths)
- Async `derive` works fine (returns `MaybePromise`)
- No `Bun.JWT` API exists in Bun 1.4 → JWT stays hand-rolled HS256 on `crypto.subtle` (D6 confirmed)

### Phase 2 — First vertical slice: Locale + Avatars

- [x] i18n foundation (D32–D34): `packages/i18n` (loader/translator/resolver, 12 tests), ICU migration of all 73 locale files + round-trip tests, typed-key codegen, `context/locale.ts` derive, error `messageKey` plumbing in `AppError`/`problemErrors`. Contract: `docs/api/_i18n.md`
- [x] Write v2 contracts for both modules → review (approved; `docs/api/locale.md`, `docs/api/avatars.md`)
- [x] Implement Locale + Avatars (`apps/server/src/locale`, `apps/server/src/avatars`); Bun.Image replaces sharp (D21), resvg only for initials SVG→PNG, assets copied to `next/assets/{avatars,fonts,dbip}`. 25 module tests, treaty-based. **v1 bug fixed:** `eu` was always `false` in v1 (`euList` holds country codes but was checked against `continentCode`); v2 checks the country code
- [x] Smoke-test harness (`apps/server/test/smoke/`): declarative behavioral cases run against the REAL composed app via `app.handle()`; set `NUVIX_V1_BASE_URL` to also replay each case against a live old app and print a normalized parity report (informational — v2 assertions are the hard contract). 17 cases seeded for locale/avatars/errors

### Phase 3 — Data services

- [x] Contracts drafted for review: `docs/api/database.md` (schemas CRUD only — collections/documents require a separate reviewed contract), `docs/api/teams.md` (incl. invite/accept lifecycle), `docs/api/users.md` (**legacy hash-create endpoints dropped per D29** — md5/sha/phpass/scrypt variants not carried over)
- [x] Link and validate the five sibling source packages; repair the local
      `@nuvix/db` declaration export at its source/build boundary without a package
      patch, deep import, shim, generated-file edit, or `node_modules` edit
- [x] Implement the database foundation: canonical claim-to-role conversion,
      request-only `Session` leases, tenant registry lifecycle, resolved-connection
      resource construction, and safe package-error translation
- [x] Compose an injected platform connection-metadata resolver with the tenant
      registry and expose only safe project/session capabilities to requests plus
      owner-only shutdown
- [x] Define adapter-neutral platform project/target collections and compose the
      PostgreSQL/SQLite platform owner; platform credential bindings were removed
      because authentication is tenant-local
- [x] Finish publishable-key project lookup and PostgreSQL-only tenant-target
      resolution through the PostgreSQL/SQLite-portable platform registry
- [x] Reorder request composition: project → tenant → auth → caller session;
      one scope owns the tenant system-auth capability, caller session, and
      awaited lease release
- [x] Tenant auth verification foundation: mutually exclusive credential
      selection, HMAC-verified session/API-key bearer secrets, expiry/revocation,
      current user/membership claims, portable explicit auth schema; tenant JWTs
      fail closed until signing-key storage lands in Phase 4
- [x] Wire the composition owner into live-service startup and shutdown:
      injectable app factory, PostgreSQL/SQLite platform runtime, tenant owner,
      HTTP stop → tenant drain → platform close ordering, idempotent shutdown
- [x] Implement the reviewed database schema CRUD service and five routes
- [x] Teams core CRUD/preferences, including accepted owner membership creation
- [x] Users core identity/profile administration
- [x] Teams memberships and user membership projection; invitations and logs
      remain assigned to messaging/audit phases
- [ ] Users auth/session/MFA/targets/usage/logs/deletion remain assigned to
      their dedicated later phases
- [x] Complete the Phase 3 infrastructure/core-data live gate: PostgreSQL and
      real-file SQLite platform persistence each resolve two isolated PostgreSQL
      tenants through production request composition
- [x] Schemas CRUD slice — implemented on `@nuvix/pg@2.0.0`; collection,
      attribute, index, and document contracts remain separate

**Infrastructure/core-data gate verified 2026-08-30:**

| Platform persistence                | Project databases                                        | Verified request surface          |
| ----------------------------------- | -------------------------------------------------------- | --------------------------------- |
| PostgreSQL on `nuvix/postgres:18.1` | two isolated PostgreSQL tenants on `nuvix/postgres:18.1` | Schemas, Teams core, Users core   |
| real-file SQLite                    | two isolated PostgreSQL tenants on `nuvix/postgres:18.1` | same production-composed scenario |

The gate provisions base `@nuvix/db` metadata before platform collections or
tenant auth/team collections, then reopens the platform through the read-only
startup path. Platform collections are owner-only, tenant targets are
AES-256-GCM encrypted at rest, and tenant internals use reserved schema `core`
with namespace `nx`.

Real tenant-local API keys prove correct-tenant access, wrong-tenant rejection,
and scope failures. A verifier-backed user session also creates a team and owner
membership, which a `teams.write`-only key deletes without leaving an orphan.
Missing, corrupt, malformed, and unreachable targets return the same redacted
`503 project_unavailable`. Request completion awaits lease release, runtime close
drains tenants before the platform, and the live suite asserts no retained
PostgreSQL connections or SQLite files. Narrow regressions were fixed by granting
write-scope database roles only the document permissions needed for write
preconditions and aggregate cleanup, and by probing Bun SQL's lazy connection
during tenant acquisition so unreachable targets cannot be misclassified as auth
failures.

Teams membership administration and the Users membership projection were
verified live against `nuvix/postgres:18.1` on 2026-09-02: listing, retrieval,
role updates, and membership removal with atomic `total` decrement, projection
scoping, and team access revocation upon member eviction. Invitations, logs, and
the remaining auth/session/MFA surface stay deferred to their documented phases.

### Phase 4 — Account/Auth (highest risk)

- [ ] Contract first: sessions, MFA, recovery, OAuth2, JWT/API-key issuance
- [ ] Tenant JWT signing-key storage, strict JOSE/claims validation, issuance,
      and rotation (no process-global project JWT secret)
- [ ] Password hashing: bcrypt/argon2 only — legacy algos (MD5 etc.) NOT supported per D29
- [ ] MFA: decide otplib vs hand-rolled RFC-6238 (gate: validated against real factors)

### Phase 5 — Storage + Messaging + Webhooks

- [ ] Storage: buckets/files through centrally configured `@nuvix/storage` devices; uploads via Elysia `t.File`
- [ ] Messaging: shared `@nuvix/messaging` gateway for topics/subscribers/providers; Handlebars templates kept
- [ ] Webhooks

### Phase 6 — Async jobs

- [ ] BullMQ over Bun adapter: audits, batch, deletes, logs, mails, messaging, stats
- [ ] Cron scheduler on `Bun.cron`
- [ ] Typed event emitter

### Phase 7 — Platform app

- [ ] Platform slices (projects, keys, templates, auth-settings, metadata)
- [ ] pg-meta introspection over `Bun.sql`

### Phase 8 — Advanced PostgreSQL data layer (D12)

- [x] Integrate Bun-native `@nuvix/pg@2.0.0` with caller-owned tenant SQL
- [ ] Adapt advanced query, join, metadata, and log use cases to immutable builders
- [ ] Full API surface audit vs `docs/api/*`

### Phase 9 — Tests & cutover

- [ ] Complete fresh suite: unit (co-located) + integration + e2e (`bun test`)
- [ ] Perf baseline vs old app
- [ ] Docker/deploy artifacts for Bun-only runtime
- [ ] Delete root monorepo (**explicit approval gate**)

---

## 6. `@nuvix/pg` Integration Strategy

Old usage sites (reference only):

```
core.service.ts, schema.hook.ts, logs.queue.ts        ← DataSource creation/writes
pg-meta.service.ts                                     ← introspection
query/builder.ts, query/join-builder.ts               ← query building
schemas.service.ts (Raw SQL), database.service.ts     ← data services
platform metadata.service.ts                           ← platform
```

**Rules:**

- `@nuvix/pg@2.0.0` is a Bun/ESM-only sibling dependency at
  `file:../../../../pg-ts`; it requires Bun 1.4 and TypeScript 7 declarations.
- The tenant resource creates one Bun `SQL` owner, shares it with `@nuvix/db`
  and `@nuvix/pg`, and closes it exactly once. The close owner exists immediately
  after allocation, so later construction or readiness failure awaits rollback;
  cleanup failures remain owner-visible with project context while requests are
  redacted. Neither package owns a borrowed client.
- `@nuvix/pg` stays inside PostgreSQL tenant infrastructure. Routes receive
  narrow services, never SQL, the query facade, adapters, or lifecycle methods.
- Builders are immutable and new code uses explicit `.execute()` boundaries.
- Old mutable `DataSource`, `db.qb`, manual transaction, and AST code is
  reference material only and must be adapted rather than copied.

---

## 6b. Multi-Tenancy Architecture (D20)

The old system was _partially_ multi-tenant (schema separation, shared pools).
v2 makes tenancy **structural**:

```
                    ┌─────────────────────────────┐
                    │  platform app               │
                    │  creates projects/tenants,  │
                    │  provisions their DBs       │
                    └──────────┬──────────────────┘
                               │ provision + own connection metadata
        ┌──────────┬───────────┼───────────┬──────────┐
        ▼          ▼           ▼           ▼
   tenant DB A  tenant DB B  tenant DB C  …          ← one Postgres database
   (pg 18)      (pg 18)      (pg 18)                 per project, custom image
                                                     image: nuvix/postgres:18.1
                                                     source: nuvix-dev/postgres
        ▲          ▲           ▲
        └──────────┴───────────┘
                    │ publishable project locator
             ┌──────┴──────────────────┐
            │ server process owner    │
            └──────────┬──────────────┘
                       │ resolved connection → tenant registry → tenant resource
                       └ tenant-local auth → request `Session` lease
```

**Rules:**

1. **One database per tenant/project.** No shared-schema tenancy in v2.
2. An explicit **owner-only provisioning flow** initializes base `@nuvix/db`
   metadata before platform collections or tenant auth/team collections, then
   creates project records and stores encrypted connection metadata. API process
   startup only opens existing resources and performs lookups; it never mutates
   schemas or invokes provisioning implicitly.
3. The **server app never hardcodes tenants or derives connection metadata**.
   A public `x-nuvix-publishable-key` decodes to the public project ID and is
   only a locator. The process-owned boundary resolves the enabled project and
   owner-only PostgreSQL target before acquiring the tenant resource. The
   platform registry itself may use PostgreSQL or SQLite.
4. The tenant registry owns one raw database resource per project, deduplicates
   concurrent creation, and supports role-scoped request sessions. Requests see
   only project resolution plus session acquisition; metadata, raw resources,
   registry lifecycle controls, and privileged sessions remain owner-internal. Its
   `maxTenants` is an idle-resource cache target, not a hard cap on active
   tenants; in-use resources are never evicted to satisfy it.
5. Schema/collection model inside a tenant DB is **redesigned freely** (D25) —
   application internals use reserved schema `core`, namespace `nx`, and the
   `nuvix/postgres:18.1` image's auto-schema features as the foundation; consult
   the `nuvix-dev/postgres` source repository when designing.
6. Platform-side features that depend on provisioning (billing, quotas,
   region placement) are **explicitly out of scope for now** — interfaces are
   stubbed so they can be added later without rework.
7. The injected resolver → registry → tenant resource → request `Session` flow is
   implemented and verified through both live platform rows. Request leases
   release idempotently in `finally`; owner shutdown rejects later acquisition,
   drains active leases, closes tenant owners before platform persistence,
   exposes close failures, and owns retries.
8. Authentication happens only after tenant acquisition. Users, sessions, JWT
   trust material, memberships, scopes, and secret API keys are tenant-owned;
   platform persistence has no credential-binding collection.
9. The Phase 3 infrastructure/core-data integration gate is complete: both
   platform adapters resolve two isolated `nuvix/postgres:18.1` tenants and run
   Schemas, Teams core, and Users core routes with real tenant-local API keys.
   Phase 3 remains open for membership administration and projection.

---

## 7. Open Questions (decide before/at each gate)

Tracked here so nothing gets decided silently:

**Resolved:**

1. ✅ **API prefix** → `/v2` (D26)
2. ✅ **Pagination** → cursor-based primary, offset where impractical; all list responses carry `meta` (D27)
3. ✅ **IDs** → keep existing scheme; port the ID helper (wraps `@nuvix/db` ID) (D28)
4. ✅ **Legacy compat** → dropped entirely: no legacy data migration, no MD5/legacy password algos, no session survival across cutover (D29)
5. ✅ **SVG avatars** → keep `@resvg/resvg-js` for now; revisit a zero-dep custom SVG rasterizer later
6. ✅ **Auth at launch** → token-ready design (D23); final call on shipping tokens vs sessions at Phase 4 gate
7. ✅ **Project locator / auth headers** → `x-nuvix-publishable-key` selects a tenant; `x-nuvix-session`, `x-nuvix-jwt`, and secret `x-nuvix-key` authenticate inside it (D38)

**Still open:**

8. **TOTP** — hand-rolled RFC-6238 on `crypto.subtle` vs keep otplib. _(Phase 4)_
9. **Realtime/WebSocket** — Elysia 2's generator-based `.ws()`; in v2 core scope or post-v2? _(after Phase 3)_

---

## 8. Risk Register

| Risk                                   | Mitigation                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| `elysia@next` beta churn/bugs          | Pin exact; isolate framework glue in `app.ts`/plugins; track changelog between phases |
| BullMQ Bun adapter immaturity          | Thin queue interface; swap adapter only if broken                                     |
| Business-rule drift during redesign    | Contracts reviewed before impl; old service code read as reference for every rule     |
| Redesigned API breaks SDK expectations | Accept (v2); document breaking changes per module in `docs/api/`                      |
| Scope creep                            | No features beyond defined contracts until Phase 9                                    |

---

## 9. Definition of Done

- [ ] All v2 contracts in `docs/api/` implemented across both apps
- [ ] Zero imports of: `@nestjs/*`, `fastify*`, `class-validator`, `class-transformer`,
      `reflect-metadata`, `rxjs`, `ioredis`, `pg`, `argon2`, `bcrypt`
- [ ] Bun-only runtime; file/crypto/net operations use Bun natives
- [ ] Fresh `bun test` suite green (unit + integration + e2e)
- [ ] Every deferred route has an explicit reviewed contract or removal decision
- [ ] Root monorepo deleted after explicit final review
