# Package Integration Architecture

> Status: PROPOSED — implement with Phase 3; packages use exact npm-published versions
> Scope: `@nuvix/db@1.0.0-alpha.2`, `@nuvix/cache@2.0.0`,
> `@nuvix/storage@2.0.0`, and `@nuvix/messaging@2.0.0`

One composition root owns package construction and lifecycle. Routes consume a
request scope; services receive only the operations their use case needs.

## Dependency flow

```text
app.ts (composition root)
  ├─ config → cache/storage/messaging factories
  ├─ tenant registry → Database per project
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

## Lifetimes and ownership

| Boundary                         | Lifetime                | Owner             |
| -------------------------------- | ----------------------- | ----------------- |
| Config and factories             | process                 | composition root  |
| Messaging adapters/gateway       | process                 | composition root  |
| Storage devices/registry         | process                 | storage factory   |
| Tenant `Database` + cache driver | tenant-handle lifetime  | tenant registry   |
| `Session`                        | request or internal job | request/job scope |

The tenant registry resolves the project before returning its pooled `Database`.
Creating a `Session` does not create a pool: it shares the owning database's
adapter and cache.

```ts
interface TenantDatabases {
  forProject(projectId: string): Promise<Database>;
}
```

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
  return db.for([...rolesFor(auth, project)]);
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

`rolesFor` is the only request-auth-to-package-role mapper. It emits canonical
`Role.toString()` values from verified user, team, scope, and project context.
Routes and services must not assemble role strings or call `db.for` themselves.
Generated collection typing is activated once through the generated `Entities`
module augmentation, not re-declared per service.

`db.system()` bypasses authorization and is never available in a request scope.
Only privileged internal jobs—bootstrap/migration, reconciliation, and trusted
queue maintenance—may request it, with an explicit reason at the job boundary.
Schema operations remain on `Database`; system sessions are only for privileged
document operations.

The internal-job boundary exposes `systemSession(reason: "bootstrap" | "migration" | "reconcile" | "maintenance")`.

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
- `apps/server/src/shared/errors.ts` — public application error definitions
- `apps/server/src/plugins/errors.ts` — problem+json serialization
