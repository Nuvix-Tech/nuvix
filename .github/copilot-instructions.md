# Nuvix Copilot Workspace Instructions

## Purpose
This file primes Copilot/agent behavior for the **nuvix** monorepo (backend platform and SDKs). Follow the project conventions, keep responses concise, and use documentation links rather than copying large chunks.

## Key project facts
- Monorepo root: `apps/` + `libs/` + `docs/` + `configs/`
- API server: `apps/server`
- Platform services: `apps/platform`
- Shared logic: `libs/core`, `libs/pg-meta`, `libs/utils`
- Main language: TypeScript; testing with Vitest; linting with Biome.
- Local dev commands (from README):
  - `bun install`
  - `bun run dev`
  - `bun run test`
  - `bun run lint`

## Build/test commands (for agent task steps)
1. `bun install`
2. `bun run lint`
3. `bun run test`
4. `bun run test -- --run` (fast single-run as needed)
5. `bun run vitest --run --config apps/server/vitest.unit.config.ts` (for server unit tests)

> If a PR adds feature/bugfix code, include updated test coverage and run a local baseline:
> - `bun run test -- --watch` for interactive
> - `bun run test -- --run` for CI-style report.

## Architecture and conventions
- `apps/server/src`: API controllers, modules, services, route definitions
- `apps/platform/src`: platform tooling, metadata generator (`generate-metadata.ts`)
- `libs/pg-meta/src`: DB metadata, schema-helper utilities
- `libs/core/src`: shared guards, schemas, types, common helpers
- `apps/*/test`: e2e and unit tests; prefer naming `*.spec.ts`.

### Schema patterns
- Managed mode (auto CRUD + RLS)
- Document mode (JSON-style operations)
- Unmanaged mode (raw SQL)

### Coding style
- Prefer existing helpers, avoid duplicating business logic.
- Use `zod`/`io-ts`-style validation if present in the module.
- Keep new exports in library entrypoints where needed.

## How to use this agent instruction
- Always ask: "What is the specific task, and what user story or issue is being solved?"
- For feature work, identify relevant existing modules and nearby tests first.
- For bug fixes, reproduce steps using unit/integration tests, then code changes.
- Provide a short summary and test commands in your final response.

## Workspace doc links (don’t duplicate)
- README: `README.md`
- Contributing: `CONTRIBUTING.md`
- API docs: `docs/` and `docs/references/`

## “Link, don’t embed” principle
For high-detail behavior (auth rules, storage policies, messaging flows), prefer linking to docs/data sources above and adding concise notes. Avoid pasting full APIs or long docs into generated code comments.

## Optional advanced assistance
When the user asks for an automation workflow, consider suggesting or creating:
- `.github/instructions/**/*.instructions.md` for per-module style rules (database, storage, etc.)
- `.github/hooks/pre-commit` for auto-lint/test on CI
- `.github/agents/nuvix.agent.md` for repeated multi-step tasks like "add endpoint + tests + docs"
