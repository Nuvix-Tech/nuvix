# ADR 0001: Adapter-Neutral Platform Persistence

> Status: Decided (amended 2026-08-30)
> Date: 2026-08-28
> Owner: Platform

## Context

The platform/control plane supports PostgreSQL or SQLite because it stores
portable project and target documents through `@nuvix/db`. Project databases
are different: every tenant uses the `nuvix/postgres:18.1` image from the
`nuvix-dev/postgres` source repository and depends on its schema, trigger, and
metadata features.

An earlier implementation introduced raw Bun SQL repositories, a PostgreSQL-only
platform schema, bespoke SQL migrations, and a one-to-one connection table. A
later correction required the exact legacy `projects`, `memberships`, `keys`,
and `projects.database` layout. Both approaches are too restrictive: the first
bypasses `@nuvix/db`, and the second prevents the v2 platform from evolving its
collection model.

Subtask 16 remains completed history, but its requirement to reuse the exact
legacy collection structure is superseded by this amendment.

## Decision

Platform and document persistence use public `@nuvix/db` APIs. Platform
composition may select `Adapter` or `SQLiteAdapter`; tenant composition always
constructs the PostgreSQL `Adapter`. Custom-image schema catalog and DDL work
uses `@nuvix/pg` behind a narrow infrastructure capability. Routes and general
application repositories never receive Bun SQL or author SQL directly.

The process owner selects and configures the **platform** adapter from validated
deployment configuration:

```ts
const adapter =
  config.driver === "sqlite"
    ? new SQLiteAdapter(config.filename)
    : new Adapter(config.connection);

const database = new Database(adapter.setMeta(metadata), cache, { filters });
```

The concrete constructor remains inside composition. Platform repository
capabilities receive a narrow privileged `Session` created by
`database.system()` and use document operations with `Query` to resolve only
safe project state and owner-only tenant targets. Authentication records do not
exist in platform persistence: users, sessions, JWT trust material, memberships,
scopes, and secret API keys are tenant-owned and are read only after tenant
selection. Request code receives only safe project identity, normalized auth,
and role-scoped tenant operations.

The v2 platform may define an adapter-neutral collection structure suited to
its contracts. The legacy `projects`, `memberships`, `keys`, and filtered
`projects.database` definitions are compatibility inputs and implementation
examples, not mandatory architecture. A migration or compatibility layer may
map legacy documents into the new contracts through `@nuvix/db` APIs.

Collection creation and evolution use public `@nuvix/db` schema operations.
The adapters may generate dialect-specific SQL internally; Nuvix application
packages do not own raw SQL repositories, dialect-specific platform tables, or
bespoke SQL migration runners.

### Platform portability and tenant contract

Platform project/target storage runs against PostgreSQL `Adapter` or
`SQLiteAdapter`. Optional platform behavior is enabled from common adapter
capabilities and limits. Tenant targets are strictly PostgreSQL URLs;
SQLite-shaped tenant records fail closed before resource construction.

Feature policy checks capabilities, not concrete adapter identity. Code must
not use `instanceof SQLiteAdapter`, adapter names, URL schemes, or equivalent
dialect checks to decide whether an application feature is available.

When a required capability is absent, optional routes or controls are disabled
or return a stable unsupported-feature result. They must not silently weaken
authorization, isolation, durability, or validation. Platform project and
target resolution remain portable; tenant auth and feature operations run on
the custom PostgreSQL project database.

## Security invariants

- Request code never receives the platform `Database`, system `Session`,
  adapter, connection or target metadata, filters, or resolver controls.
- Tenant target secrets are decoded only inside process-owned composition and
  only for the lifetime required to construct the tenant resource.
- Logs and public errors never include target metadata, credentials, internal
  sequences, concrete driver causes, or repository/filter causes.
- Unknown, disabled, malformed, unsupported, or inaccessible data fails closed.
- Capability gating never bypasses a security check; required security features
  must be portable or the affected operation must be unavailable.
- Document operations and metadata administration go through `@nuvix/db`.
  Custom-image schema catalog/DDL operations use an infrastructure-owned
  `@nuvix/pg` capability; route and business-service code does not receive SQL.

## Rationale

- `@nuvix/db` keeps platform storage portable across PostgreSQL and SQLite.
- A control-plane-only installation can avoid a platform PostgreSQL service.
  Serving a project still requires its PostgreSQL tenant.
- Capability-based policy describes what an adapter can do and continues to
  work when more adapters are added.
- A v2-specific collection model can evolve without coupling persistence to one
  dialect or freezing the legacy model indefinitely.
- Narrow sessions retain authorization, query validation, caching, casting,
  filters, and least-privilege boundaries.

## Rejected and superseded alternatives

| Alternative                                           | Why not used                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Raw Bun SQL repositories                              | Bypass `@nuvix/db` and couple application persistence to a driver and dialect.                                    |
| PostgreSQL-only platform schema and migrations        | Prevent a minimal SQLite installation and create a parallel persistence plane.                                    |
| Mandate the exact legacy collection layout            | Prevents v2 model evolution; legacy structures are compatibility inputs instead.                                  |
| Gate features by adapter class or driver name         | Couples policy to known implementations rather than actual capabilities.                                          |
| Emulate every unsupported feature in application code | Increases correctness risk; optional features should be predictably unavailable when safe parity is not possible. |
| Expose `Database.system()` to requests                | Allows authorization bypass and cross-project platform access.                                                    |

## Consequences

Platform contracts and lookups run against PostgreSQL and SQLite fixtures.
Tenant auth and project features run against the custom PostgreSQL image. The
supported matrix is PostgreSQL-platform/PostgreSQL-tenant and
SQLite-platform/PostgreSQL-tenant.

Deployment configuration selects the platform adapter. Tenant provisioning
always records a PostgreSQL target; there is no tenant adapter choice. Resource
ownership and request capability shape remain unchanged.

## Scope and non-goals

This decision does not require feature parity for capabilities an adapter does
not provide, add hostname routing, project provisioning, tenant creation,
database CRUD routes, or a new application-owned SQL migration system. Health
and OpenAPI routes remain unscoped.

## Related

- [`0002-project-resolution-contract.md`](0002-project-resolution-contract.md)
- [`0003-process-resource-lifecycle.md`](0003-process-resource-lifecycle.md)
- [`../integrations.md`](../integrations.md)
- [`../../../MIGRATION.md`](../../../MIGRATION.md)
