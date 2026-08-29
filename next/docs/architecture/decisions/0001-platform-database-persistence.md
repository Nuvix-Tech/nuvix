# ADR 0001: Adapter-Neutral Platform Persistence

> Status: Decided (amended 2026-08-29)
> Date: 2026-08-28
> Owner: Platform

## Context

Nuvix must support both a full PostgreSQL deployment and a minimal SQLite
deployment. Most platform and tenant behavior is portable, while a small set of
features depends on capabilities that not every database adapter provides.

An earlier implementation introduced raw Bun SQL repositories, a PostgreSQL-only
platform schema, bespoke SQL migrations, and a one-to-one connection table. A
later correction required the exact legacy `projects`, `memberships`, `keys`,
and `projects.database` layout. Both approaches are too restrictive: the first
bypasses `@nuvix/db`, and the second prevents the v2 platform from evolving its
collection model.

Subtask 16 remains completed history, but its requirement to reuse the exact
legacy collection structure is superseded by this amendment.

## Decision

Every platform and tenant persistence path uses the public `@nuvix/db` APIs,
including `Adapter` or `SQLiteAdapter`, `Database`, `Session`, `Doc`, and
`Query`. Application repositories never receive a Bun SQL client, author SQL,
or branch into a direct database-driver path.

The process owner selects and configures an adapter from validated deployment
configuration:

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

### Portable feature contract

The portable application baseline must run against PostgreSQL `Adapter` and
`SQLiteAdapter`. Optional behavior is enabled from common adapter capability
and limit fields, such as `$supportForFulltextIndex`, `$supportForUpdateLock`,
`$supportForIndexArray`, `$supportForJSONOverlaps`, `$supportForTimeouts`,
`$supportForBatchOperations`, and `$limitFor*` values.

Feature policy checks capabilities, not concrete adapter identity. Code must
not use `instanceof SQLiteAdapter`, adapter names, URL schemes, or equivalent
dialect checks to decide whether an application feature is available.

When a required capability is absent, optional routes or controls are disabled
or return a stable unsupported-feature result. They must not silently weaken
authorization, isolation, durability, or validation. Ordinary document CRUD,
project resolution, tenant-target resolution, tenant-local authentication, and
request-scoped sessions remain available on the portable baseline.

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
- Schema and document operations go through `@nuvix/db`; application code does
  not issue raw SQL or maintain a parallel persistence path.

## Rationale

- `@nuvix/db` provides one document and schema contract over PostgreSQL and
  SQLite while keeping dialect details in adapters.
- A minimal installation can avoid a PostgreSQL service without losing the
  portable Nuvix core.
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

Platform contracts, collection definitions, indexes, and required queries must
fit the portable capability baseline. Cross-adapter tests run the same contract
against real PostgreSQL and SQLite fixtures. Tests also verify stable disabled
or unsupported behavior for optional features.

Deployment configuration selects the platform adapter and may select a
different adapter per tenant. Resource ownership and request capability shape
do not change with the selected adapter. Legacy data import and PostgreSQL-only
enhancements remain explicit compatibility or optional-feature work.

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
