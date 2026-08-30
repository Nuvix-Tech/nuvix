# Nuvix v2 Migration Guide

## Mission

Continue the Bun-native v2 rewrite in `next/`. Own implementation, tests, and
migration documentation together. Make routine implementation decisions
autonomously: do not pause for naming, file layout, refactoring, test fixes,
error mapping, or selection of the next documented slice.

After a logical slice passes validation, commit it, push `v2-rewrite`, update
the migration records, and continue to the next unblocked slice. Ask the user
only for a genuinely new product decision, a change to a locked architecture
decision, unavailable credentials/infrastructure, or destructive legacy
cutover.

## Repository boundaries

- `next/**` is the active v2 workspace.
- Root `apps/**`, `libs/**`, tests, and configuration are legacy behavior
  references. Do not copy their NestJS architecture or modify them during the
  rewrite.
- Never delete the legacy root before the explicit Phase 9 approval gate.
- Preserve unrelated worktree changes. Never reset, clean, or broadly stage.
- `.tmp/**` and `thoughts/**` are scratch/history, not authoritative project
  status and not commit targets.
- `/home/ubuntu/{cache,database,pg-ts,storage,messaging}` are independent
  sibling repositories. Change one only when a defect belongs there; validate,
  commit, and push it separately before updating Nuvix.

## Read before implementing a slice

1. `next/MIGRATION.md`
2. `next/docs/api/_conventions.md`
3. `next/docs/architecture/integrations.md`
4. Relevant ADRs in `next/docs/architecture/decisions/`
5. The relevant contract in `next/docs/api/`
6. Adjacent v2 source and tests
7. Legacy root code only for behavior, business rules, and edge cases

Current user instructions and amended decisions override stale prose. When
committed code and tests prove documentation is stale, correct it in the same
slice instead of asking permission or creating another status document.

## Slice workflow

1. Reconcile the contract and current implementation status.
2. Read legacy behavior where needed; redesign rather than mechanically port.
3. Implement through small, narrow, injected capabilities.
4. Add unit, route, composition, and live integration coverage as applicable.
5. Update the API contract, architecture notes, and `MIGRATION.md`.
6. Run focused checks while iterating, then the relevant full quality gate.
7. Review the exact diff, stage only owned files, commit, push, and continue.

## Non-negotiable architecture

- Bun-only runtime, plain Bun workspaces, TypeScript 7, and pinned Elysia 2.
- Contract-first vertical slices using TypeBox and Eden `treaty` API tests.
- RFC 9457 problem details with stable snake_case `code` values.
- Request order: publishable key → platform project → PostgreSQL tenant →
  tenant-local auth → canonical roles → caller-scoped `Session` → handler.
- `x-nuvix-publishable-key` selects a project; it never authorizes access.
  `x-nuvix-key` is the distinct tenant-local secret API-key credential.
- Platform persistence supports PostgreSQL or SQLite through public
  `@nuvix/db` APIs. Tenant databases are PostgreSQL 18 only, using
  `nuvix/postgres:18.1` (source repository: `nuvix-dev/postgres`).
- One tenant resource owns one Bun `SQL`, shares it with `@nuvix/db` and
  `@nuvix/pg`, and closes it exactly once.
- Routes never receive SQL, adapters, raw `Database`, target metadata,
  registry controls, lifecycle controls, or `Database.system()`.
- `Database.system()` is limited to explicit trusted bootstrap, migration,
  reconciliation, and maintenance boundaries.
- Routes validate transport input and call a service. Services own business
  rules and receive narrow dependencies. Infrastructure construction belongs
  in composition.
- Legacy data, password hashes, sessions, and tokens are intentionally not
  compatible unless a later explicit decision says otherwise.
- Never add package patches, deep imports, declaration shims, generated-file
  edits, or `node_modules` edits. The existing Elysia OpenAPI patch is the only
  approved exception.

## Sibling packages

Follow `next/docs/architecture/integrations.md`. Build a changed sibling before
validating `next`. Run `bun install` in `next` when a sibling manifest or
dependency graph changes, commit `next/bun.lock`, and verify the frozen install.

## Validation

Use focused tests during implementation. Before completing a substantial
slice, run from `next/`:

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun test
```

Also run `git diff --check` and inspect `git status --short`. Use scoped Biome
formatting; never format unrelated files. Live tenant behavior must be tested
against exactly `nuvix/postgres:18.1` and must not be simulated while reported
as integration coverage.

## Git

- Work on `v2-rewrite` for routine migration work.
- Stage exact paths, normally `next/**` plus this guide when it changes.
- Use atomic Conventional Commits and push each validated logical slice.
- Never force-push or rewrite shared history.
- Commit sibling-package fixes in their own repositories first.

## Ask the user only when

- changing a locked Dxx decision or accepted ADR;
- introducing materially new or breaking public behavior not answered by a
  contract or reference behavior;
- deleting/cutting over the legacy root;
- credentials, access, or external infrastructure are unavailable; or
- a sibling package needs an incompatible public API change rather than a
  clear bug fix.

When blocked, record the exact blocker and continue another independent,
documented slice when safe.
