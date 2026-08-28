# Package Integration Architecture

> Status: DATABASE FOUNDATION IMPLEMENTED — composition and feature slices pending
> Scope: sibling `@nuvix/db`, `@nuvix/cache`, `@nuvix/storage`, and
> `@nuvix/messaging` source packages

One composition root owns package construction and lifecycle. Routes consume a
request scope; services receive only the operations their use case needs.

## Dependency flow

```text
app.ts (composition root)
  ├─ config → cache/storage/messaging factories
  ├─ resolved connection → tenant registry → Database per project
  ├─ auth role mapper → caller-scoped Session per request
  └─ package error translator → AppError → problem+json
             │
             ▼
route → service(narrow dependencies) → package adapter → package
```

Rules:

- Construct infrastructure only in the composition root or its factories.
- Routes validate HTTP input and call one service; they never coordinate
  database, cache, storage, or messaging clients.
- Do not add wrappers that only rename package methods. A boundary must narrow
  capabilities, normalize results, select a provider/device, or translate errors.
- All four packages are Bun/ESM-only. Keep package versions and source selection
  outside feature modules.

## Project database ownership

The platform owns one PostgreSQL database and its connection metadata per
project. The server consumes only an already-resolved, normalized PostgreSQL
connection value; `createTenantDatabaseResource(connectionString)` validates
that value and constructs the adapter, cache driver, and `Database`.

Platform metadata lookup and composition of that resolver with the tenant
registry are deferred. This foundation does not define HTTP routes, a schema
registry, hardcoded tenant URLs, or new environment contracts.

## Lifetimes and ownership

| Boundary                          | Lifetime                 | Owner            |
| --------------------------------- | ------------------------ | ---------------- |
| Config and factories              | process                  | composition root |
| Messaging adapters/gateway        | process                  | composition root |
| Storage devices/registry          | process                  | storage factory  |
| Tenant adapter, cache, `Database` | tenant-resource lifetime | tenant registry  |
| Role-scoped `Session` lease       | request lifetime         | request scope    |
| System `Session`                  | internal-job lifetime    | internal job     |

The registry does not resolve platform metadata. Its injected `create(projectId)`
dependency receives that responsibility at the future composition boundary and
passes the resolved connection value to the resource factory. Creating a
`Session` does not create a pool: it shares the owning database's adapter and
cache.

```ts
interface RequestDatabaseSessionLease {
  readonly session: Session;
  release(): Promise<void>;
}
```

Request code sees this lease, not the underlying `Database`, adapter, cache,
connection value, or registry lifecycle controls. Every acquisition must release
in `finally`.

### Tenant registry semantics

- Concurrent acquisition for one project deduplicates resource creation; a
  failed creation is removed so a later acquisition can retry.
- Active leases reserve resources before construction completes. In-use or
  constructing resources are never evicted.
- Invalidation rejects new acquisition immediately and closes after active
  leases drain. A failed close remains available for a later invalidation retry.
- `maxTenants` is a target for cached **idle** resources, not a hard cap on
  active tenants. Eligible idle resources are evicted least-recently-used, with
  project ID as the deterministic tie-breaker.
- `sweep()` and `closeAll()` attempt every eligible close and reject with ordered
  aggregate failures. Detached cleanup reports each failure through
  `onCloseError` because no caller can await it.
- Shutdown permanently rejects acquisition, waits for active leases, and then
  closes every resource. A failed `closeAll()` may be called again to retry
  failed closes.

The cache factory constructs `Memory`, `Redis`, or `None` from configuration.
It passes the structural four-method `CacheDriver` directly to `Database` and
wraps it in `Cache` only where application cache operations need the facade.
Feature modules never construct cache adapters.

The storage factory uses a positional root for `Local` and options objects for
the cloud devices, registers devices once with `Storage.setDevice`, and injects
this narrow resolver:

```ts
type FileDevice = Pick<
  Device,
  "read" | "write" | "delete" | "stat" | "presign"
>;
interface StorageDevices {
  get(name: string): FileDevice;
}
```

## Caller-scoped database sessions

`Database` is the admin/schema plane. Every document read or write uses an
immutable `Session` from `db.for(...roles)`.

```ts
type RoleMapper = (
  auth: AuthContext,
  project: ProjectContext,
) => readonly string[];

function requestSession(
  db: Database,
  auth: AuthContext,
  project: ProjectContext,
) {
  return db.for(...rolesFor(auth, project));
}

type TeamDocuments = Pick<
  Session,
  | "find"
  | "getDocument"
  | "createDocument"
  | "updateDocument"
  | "deleteDocument"
>;
```

`rolesFor` is the only request-auth-to-package-role mapper. It uses the public
`@nuvix/db` entry point and canonical `Role`, `RoleName`, and `UserDimension`
APIs. It emits `any` plus the applicable guest, user, verification, team, team
membership-role, and label roles. One confirmed team membership may contribute
multiple roles; duplicate claims are deduplicated and output is deterministic.
Every untrusted user ID, team ID, membership role, and label must be non-empty,
NFC-normalized, and limited to letters, marks, numbers, `.`, `_`, or `-` before
serialization. Invalid or cross-project claims fail closed as forbidden.
Routes and services must not assemble role strings or call `db.for` themselves.
Generated collection typing is activated once through the generated `Entities`
module augmentation, not re-declared per service.

`Database.system()` bypasses authorization and is never available in a request
scope. Request code must not call it or receive a raw `Database` from which it
could be called.
Only privileged internal jobs—bootstrap/migration, reconciliation, and trusted
queue maintenance—may request it, with an explicit reason at the job boundary.
Schema operations remain on `Database`; system sessions are only for privileged
document operations.

The future internal-job boundary may expose an explicitly audited system-session
capability. Its final API and composition are not part of this foundation.

## Service injection

Services receive shared gateways when composed. Request-scoped document
capabilities are passed explicitly and narrowed with `Pick<Session>`:

```ts
const teams = createTeamService({
  documents: requestScope.session as TeamDocuments,
  messaging,
});
```

## Messaging gateway

Teams, users, and auth share one gateway. It selects the configured adapter,
constructs `Email`/`SMS`/`Push`, and normalizes the package's result for every
recipient; partial delivery is not collapsed into a single boolean.

```ts
import type { SendResult } from "@nuvix/messaging";

type DeliveryResult = SendResult["results"][number];

interface MessageRequest {
  channel: "email" | "sms" | "push";
  recipients: readonly string[];
  payload: unknown;
}

interface DeliveryReport {
  deliveredTo: number;
  results: readonly DeliveryResult[];
}

interface MessagingGateway {
  send(message: MessageRequest): Promise<DeliveryReport>;
}
```

`DeliveryResult` is derived from the package's exported `SendResult`; the
package does not export the detail type separately. The gateway flattens any
adapter batch map into one report while preserving every recipient outcome.

Thrown `MessagingError`s go through the shared package-error translator.
Provider error text is retained for logs, not exposed as public problem detail.
The package `JWT.sign` API is asynchronous and only supports provider assertions
(`RS256`/`ES256`); Nuvix access JWTs continue to use the core HS256/HS512 helper.

## Package-error translation

One translator is used by every package adapter. It returns a typed `AppError`;
the existing global error plugin alone serializes RFC-9457 responses.

```ts
type PackageErrorTranslator = (
  error: unknown,
  context: { operation: string; publicCode?: string },
) => AppError;
```

| Package signal                              | Public class                   | Code source               |
| ------------------------------------------- | ------------------------------ | ------------------------- |
| DB authorization/not-found/conflict classes | forbidden/not-found/conflict   | operation map             |
| `StorageError.code`                         | bad-request/not-found/internal | explicit code map         |
| `MessagingErrorCode`                        | bad-request/internal           | explicit code map         |
| cache validation/unsupported classes        | bad-request/internal           | explicit class map        |
| unknown error                               | internal                       | no package detail exposed |

The operation map supplies contract codes such as `team_not_found`; package
class names, uppercase codes, provider responses, and raw messages are never
public API. Missing mappings fail closed as `/errors/internal` and are logged.

## Sibling package workflow

The relative `file:` paths are resolved from `next/apps/server/package.json`, so
the checkout layout is required:

```text
/home/ubuntu/
├── cache/
├── database/
├── messaging/
├── storage/
└── nuvix/
    └── next/
```

Install and build package dependencies before installing `next`. Build cache
first because it supplies the database cache contract:

```bash
cd /home/ubuntu/cache && bun install --frozen-lockfile && bun run build
cd /home/ubuntu/database && bun install --frozen-lockfile && bun run build
cd /home/ubuntu/storage && bun install --frozen-lockfile && bun run build
cd /home/ubuntu/messaging && bun install --frozen-lockfile && bun run build
cd /home/ubuntu/nuvix/next && bun install
```

Source edits are visible through the local links, but package exports point at
generated `dist` files. Rebuild each changed sibling. Re-run ordinary
`bun install` in `next` only when a sibling manifest or dependency graph changes,
commit the resulting `bun.lock`, and then verify the frozen install:

```bash
cd /home/ubuntu/database && bun run build
cd /home/ubuntu/nuvix/next && bun install
cd /home/ubuntu/nuvix/next && bun install --frozen-lockfile
```

The local database repository fixes its public declaration boundary in source
and build configuration: `src/index.ts` exports `Session`, and the clean build
emits and alias-rewrites `dist/index.d.ts` at the path declared by `package.json`.
Do not use an `@nuvix/db` `patchedDependencies` entry, patch artifact, deep
import, declaration shim, generated `dist` edit, or `node_modules` edit. The
unrelated Elysia OpenAPI patch remains valid.

Validate each sibling and the consumer workspace:

```bash
cd /home/ubuntu/cache && bun run typecheck && bun test
cd /home/ubuntu/database && bun run typecheck
cd /home/ubuntu/database && bun test tests/doc.test.ts tests/auth.test.ts tests/generate-types.test.ts
cd /home/ubuntu/storage && bun run typecheck && bun test
cd /home/ubuntu/messaging && bun run typecheck && bun test

cd /home/ubuntu/nuvix/next
bun install --frozen-lockfile
bun test apps/server/test/database-roles.test.ts \
  apps/server/test/tenant-databases.test.ts \
  apps/server/test/request-database-sessions.test.ts \
  apps/server/test/tenant-database-resource.test.ts \
  apps/server/test/package-errors.test.ts
bun run lint
bun run typecheck
bun test
```

## Testing seams

- **Unit:** inject fakes for each `Pick<Session>`, `MessagingGateway`, and
  `StorageDevices`; no Elysia app or package client is required.
- **Contract:** table-test every error mapping, role mapping, per-recipient
  messaging outcome, and storage device selection.
- **Integration:** verify caller sessions enforce permissions, transactions keep
  the same auth context, cache drivers satisfy the DB contract, and configured
  storage devices resolve.

## Related

- [`../api/_conventions.md`](../api/_conventions.md) — public errors and auth conventions
- [`../../MIGRATION.md`](../../MIGRATION.md) — rewrite decisions and phases

## Codebase references

- `apps/server/src/app.ts` — current application composition point
- `apps/server/src/context/auth.ts` — typed request authentication context
- `apps/server/src/context/database-roles.ts` — canonical request role conversion
- `apps/server/src/infrastructure/request-database-sessions.ts` — request capability boundary
- `apps/server/src/infrastructure/tenant-database-resource.ts` — resolved-connection resource
- `apps/server/src/infrastructure/tenant-databases.ts` — tenant registry and lifecycle
- `apps/server/src/infrastructure/package-errors.ts` — safe package-error translation
- `apps/server/src/shared/errors.ts` — public application error definitions
- `apps/server/src/plugins/errors.ts` — problem+json serialization
