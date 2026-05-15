# Nuvix Rust Rewrite - Strategy & Porting Plan

## Goal
Rewrite the entire Nuvix TypeScript monorepo into a high-performance Rust workspace. The new implementation will preserve the exact same API routes, JSON request/response formats, headers, and behavior as the current NestJS application.

## Stack
- **Workspace**: Cargo Workspace (`crates/` and `apps/`)
- **Web Framework**: Axum
- **Async Runtime**: Tokio
- **Serialization**: Serde, serde_json
- **Database**: SQLx (PostgreSQL) or similar suitable Rust ORM / query builder
- **Error Handling**: thiserror, anyhow

## Strategy: Module by Module Porting

The current TS monorepo consists of:
- `apps/server`: Core API server
- External libraries currently mapped in `libs/` or via npm:
  - `@nuvix/db` -> `crates/database`
  - `@nuvix/storage` -> `crates/storage`
  - `@nuvix/messaging` -> `crates/messaging`
  - `@nuvix/cache` -> `crates/cache`
  - `@nuvix/audit` -> `crates/audit`
  - Core & Utils -> `crates/nuvix-core`, `crates/utils`

### Porting Phases

**Phase 1: Workspace Initialization (Complete)**
- Scaffold the Cargo Workspace (`rust-backend/`).
- Initialize empty crates for the server and all external libraries.
- Define `PORTING.md`.

**Phase 2: Core Setup & Shared Libraries**
- Port `utils` and `nuvix-core`: Setup error types, basic types, configuration structs.
- Implement basic `database` crate: Setup connection pooling with SQLx.
- Create the Axum application router in `apps/server` with core middlewares (Auth, Context, Error mapping).
- Port health check and basic root endpoints.

**Phase 3: Module by Module (Iterative)**
For each domain module (Account, Users, Teams, Avatars, Schemas, etc.):
1. Identify TS routes, DTOs, and Services.
2. Port DTOs to Rust structs with `serde` and `validator` rules.
3. Port Services (business logic).
4. Integrate with `crates/*` libraries (e.g. Audit, Cache) as needed.
5. Create Axum handlers and map them in the router.
6. Verify request/response formats match the NestJS app exactly.

**Phase 4: External Library Integration**
As modules are ported, fill in the specific functionality of the external libraries:
- `crates/database`: Specific repository methods or generic query builders.
- `crates/storage`: S3/Local driver ports.
- `crates/messaging`: Email/SMS integration.

**Phase 5: Final Review & Polish**
- Ensure all endpoints are covered.
- Pre-commit checks & Formatting (rustfmt, clippy).
- Documentation updates.
