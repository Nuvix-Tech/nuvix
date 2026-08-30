# ADR 0003: Process Resource Lifecycle

**Date**: 2026-08-28
**Status**: Decided (amended 2026-08-29)
**Owner**: Nuvix server platform

## Context

The v2 server needs a PostgreSQL-or-SQLite platform `@nuvix/db` resource and
PostgreSQL-only per-tenant resources, while tests need an application that
opens neither sockets nor databases. Feature code
must be able to run an operation with a role-scoped database session without
placing that session or its lease in global request context.

Elysia is pinned to `2.0.0-beta.6`; its lifecycle API differs from Elysia 1.x
and may change before a stable 2.x release.

## Decision

### Application factory

`createApp` accepts one project-request scope capability. That capability
decodes the publishable key, resolves the project, acquires its tenant, performs
tenant-local authentication, and creates the caller-scoped database session in
that order. It constructs framework routing only and performs no live resource
construction at module import.

Project and database context applies only to project-scoped `/v2` route groups.
`/v2/health`, `/v2/openapi`, and `/v2/openapi/json` remain unscoped and must not
invoke project or database dependencies.

```ts
const app = createApp({ withProjectRequest });
```

### Process ownership

The process entrypoint is the sole owner of:

- the selected internal platform adapter (`Adapter` or `SQLiteAdapter`),
  `Database`, cache, capability policy, and system `Session`;
- tenant database composition;
- the HTTP server; and
- `SIGINT` and `SIGTERM` registration.

Adapter selection is validated deployment configuration. Optional feature
availability is derived from common `$supportFor*` and `$limitFor*` values, not
from concrete adapter identity. Composition exposes only enabled narrow
operations; it does not expose the selected driver as request policy.

It composes live resources before calling `Bun.serve`. If HTTP startup fails, it
closes every resource already constructed without masking the startup failure.
Construction failure follows the same rule in reverse acquisition order.

The runtime boundary exposes only the app and an idempotent `close()` operation.
It never imports or invokes a v2-specific migration runner; internal collection
setup remains owned by the canonical platform setup flow.

### Ordered, idempotent shutdown

The first shutdown request creates one promise. Repeated calls and repeated
signals return that same promise and do not repeat stop or close operations.

Shutdown always attempts these stages in order:

1. Stop accepting new HTTP requests.
2. Await HTTP server termination and in-flight HTTP work.
3. Close tenant composition: reject acquisition, drain active request leases,
   then close tenant resources.
4. Close the selected internal platform adapter and cache resources.

```ts
shutdownPromise ??= settleInOrder([
  stopHttpIntake,
  awaitHttpTermination,
  closeTenantComposition,
  closePlatformDatabase,
]);
```

`settleInOrder` awaits each stage even when an earlier stage fails, then reports
a deterministic aggregate failure. Diagnostics identify the failed stage but
redact keys, connection URIs, ciphertext, resolver causes, and provider details.
Any shutdown failure sets a failing process exit status.

### Awaited database operation scope

Feature code uses one shared project-request scope. The scope first resolves the
public project locator, then acquires the tenant lease, verifies credentials
through a narrow tenant-owned auth capability, derives roles, and creates a
caller-scoped `Session`. Routes receive only safe project/auth values and the
scoped operation capability; raw credentials and privileged auth access do not
escape. The scope awaits idempotent release in `finally` before the response can
complete.

```ts
return withProjectRequest(headers, async ({ project, auth, session }) => {
  return service({ project, auth, documents: session });
});
```

The helper owns the complete lifecycle:

```ts
const locator = parsePublishableKey(headers);
const project = await projects.resolve(locator.projectId);
const lease = await tenantDatabases.acquire(project.id);
let operationError: unknown;

try {
  const auth = await tenantAuth.resolve(lease.database, headers);
  const session = lease.database.for(...rolesFor(auth, project));
  return await operation({ project, auth, session });
} catch (error) {
  operationError = error;
  throw error;
} finally {
  try {
    await lease.release();
  } catch (cleanupError) {
    if (operationError)
      throw new AggregateError([operationError, cleanupError]);
    throw cleanupError;
  }
}
```

Repeated release calls share the lease's release promise and preserve the same
cleanup failure. If the operation and release both fail, the aggregate preserves
them in operation-then-cleanup order. Routes and services do not acquire,
release, or retain leases themselves; the callback receives only the
operation-scoped `Session` or a narrower `Pick<Session>`.

Elysia `defer` is not used for database lease cleanup. It runs after response
completion, so cleanup failure cannot participate reliably in the response
failure and a lease can remain active after the request has appeared complete.
This would also make process shutdown wait on work no longer represented by an
active response. Reserve `defer` for non-critical post-response work, such as
best-effort audit or statistics side effects.

### Capability confinement

| Boundary           | Exposed capability                                               |
| ------------------ | ---------------------------------------------------------------- |
| App factory        | One project-request scope                                        |
| Request callback   | Safe project/auth + role-scoped `Session` or narrower capability |
| Runtime owner      | App and idempotent `close()`                                     |
| Process entrypoint | HTTP server and signal handling                                  |

Feature code never receives the lease, its `release`, raw publishable/auth keys,
plaintext or encrypted connection metadata, internal UUIDs, raw database
clients, resolver causes, registry controls, adapters, raw `Database`, or either
the platform or tenant privileged session. Keeping these values behind the
project-request scope prevents routes and services from widening authorization,
changing lifecycle state, retaining a session beyond one operation, or
bypassing tenant isolation.

## Rationale

- Explicit injection keeps the app deterministic and testable without live
  PostgreSQL, SQLite, or sockets.
- Platform composition supports PostgreSQL or SQLite. Tenant composition is
  intentionally PostgreSQL-only because projects use the custom image.
- Capability policy disables or rejects optional unsupported behavior without
  concrete adapter checks or silent fallback.
- One process owner makes startup rollback and shutdown ordering unambiguous.
- One awaited operation scope centralizes acquisition and release, prevents a
  session from escaping, and makes cleanup part of request completion.
- Narrow capabilities enforce least privilege structurally instead of relying
  on route discipline.
- Stopping intake before draining leases prevents new work from racing resource
  closure; closing the internal platform database last keeps metadata access
  available while tenant owners drain.

## Alternatives considered

| Alternative                                   | Benefit                      | Why rejected                                                                                                                                     |
| --------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Construct resources at module import          | Less startup wiring          | Imports gain hidden side effects, tests open live resources, and ownership and failure cleanup become ambiguous.                                 |
| Expose raw infrastructure in request context  | Maximum route flexibility    | Routes could inspect secrets, call `Database.system()`, or mutate registry and shutdown state.                                                   |
| Pre-acquire a session into request context    | Simple handler access        | Every scoped request holds a lease even when unused, and the session can escape the operation that owns its cleanup.                             |
| Release with Elysia `defer`                   | Central post-response hook   | The response completes before release, so cleanup failures cannot be composed with operation failures and shutdown accounting becomes ambiguous. |
| Handle leases directly in each route          | Explicit local control       | Every route must reproduce acquisition, `finally`, idempotency, and dual-failure behavior.                                                       |
| Add v2-specific migrations during API startup | Convenient deployment        | Forks canonical internal collection setup, gives runtime code schema authority, and permits replica races.                                       |
| Branch on concrete adapter identity           | Easy feature switches        | Couples policy to known drivers; common capability and limit fields describe actual support and extend to future adapters.                       |
| Copy Elysia 1.x lifecycle APIs                | Existing examples are common | Elysia 2 renamed and changed lifecycle registration; 1.x hooks can silently provide the wrong scope or behavior.                                 |

## Elysia 2 beta caveats

- Use APIs verified against the pinned `elysia@2.0.0-beta.6`, including
  `derive('plugin', ...)` and v2 lifecycle names without the `on` prefix. Do not
  infer behavior from stable 1.x examples.
- Do not make database correctness depend on beta post-response hook behavior.
  The operation-scope promise settles only after release settles.
- Use `defer` only for non-critical post-response work whose failure cannot
  change the response and does not hold a process-drained resource.
- Verify plugin propagation scope and operation completion with deterministic
  tests; beta type acceptance alone is not proof that hooks run at the required
  scope.
- Keep framework-specific lifecycle glue inside the app/request plugins. The
  process owner and resource owners remain framework-independent.
- Pin Elysia versions. Review release notes and lifecycle tests before every
  beta upgrade.

## Impact and exclusions

**Positive**: tests can inject fakes; either platform adapter shares the same
lifecycle with PostgreSQL tenants; resource authority is auditable; cleanup and
shutdown failures remain observable.

**Trade-off**: composition and failure aggregation require more explicit code.

This decision does not add hostname or custom-domain routing, v2-specific
migrations, external KMS integration, project provisioning API/UI, tenant
creation, or database CRUD routes. Health and OpenAPI remain outside project scope. Logs and public
errors never include encryption keys, connection URIs, SQLite filenames,
ciphertext, concrete driver causes, or resolver causes. Optional unsupported
features return stable documented results and do not weaken core behavior.

## Revisit triggers

Revisit this decision when any of the following occurs:

- Elysia 2 reaches stable or changes `derive`, plugin scope, or shutdown
  semantics.
- Elysia provides a stable, awaited pre-response finalizer that preserves
  operation and cleanup failures; reevaluate the helper implementation without
  weakening its ownership guarantees.
- Bun changes HTTP stop/drain behavior.
- The service runs multiple listeners or background workers requiring a shared
  lifecycle coordinator.
- Graceful-shutdown deadlines require forced cancellation after bounded drain.
- A request needs a new infrastructure operation that cannot be represented by
  a narrow capability.
- The internal platform database must close before tenant resources; such a
  change requires proof that tenant draining no longer depends on platform
  metadata.

## Related

- [`../integrations.md`](../integrations.md)
- [`../../api/_conventions.md`](../../api/_conventions.md)
