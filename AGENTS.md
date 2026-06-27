# Nuvix — AI Agent Development Guide

## Project Overview

**Nuvix** is an open-source Backend-as-a-Service (BaaS) platform that provides developers with a complete set of tools to build and deploy applications quickly. It offers database management, authentication, storage, messaging, and multi-tenancy out of the box.

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js 20+, Bun 1.3.10+ |
| **Framework** | NestJS 11.x with Fastify adapter |
| **Language** | TypeScript 5.9+ (ESM, strict mode) |
| **Database** | PostgreSQL (with RLS) |
| **Cache/Queue** | Redis + BullMQ |
| **Storage** | S3-compatible object storage |
| **Monorepo** | Turborepo + Bun workspaces |
| **Linter** | Biome 2.4.x |
| **Test** | Vitest (unit + e2e) |

---

## Architecture

### Monorepo Structure

```text
nuvix/
├── apps/
│   ├── server/          # Main API server (port 4000)
│   └── platform/        # Admin/tenant management (port 4100)
├── libs/
│   ├── core/            # Shared NestJS module (hooks, guards, helpers)
│   ├── pg-meta/         # PostgreSQL metadata utilities
│   └── utils/           # Shared utilities, types, query builder
├── scripts/             # Build scripts, codegen
├── docker-compose.yml   # Local development services
└── turbo.json           # Turborepo configuration
```

### Package Dependencies

```text
@nuvix/server      → @nuvix/core, @nuvix/utils
@nuvix/platform    → @nuvix/core, @nuvix/pg-meta, @nuvix/utils
@nuvix/core        → @nuvix/db, @nuvix/pg, external deps
@nuvix/utils       → standalone utility library
@nuvix/pg-meta     → PostgreSQL introspection
```

### Request Pipeline (Server)

```text
CORS → Auth → API → Audit → Stats → (Logs) → Controller
```

Middleware chain configured in `apps/server/src/app.module.ts`:
1. **CorsHook** — CORS headers, origin validation
2. **AuthHook** — Session/JWT verification, user context
3. **ApiHook** — Request parsing, permission checks
4. **AuditHook** — Audit trail logging (flows to BullMQ queue)
5. **StatsHook** — Request metrics
6. **LogsHook** — Optional detailed API logging (configurable)

---

## Development Workflow

### Prerequisites

```bash
# Install Bun if not already installed
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Start local services (PostgreSQL, Redis, MinIO/S3)
docker compose up -d
```

### Core Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server (both apps with hot reload) |
| `bun run build` | Build all packages |
| `bun run start` | Start production build |
| `bun run lint` | Run Biome linter (check mode) |
| `bun run format` | Auto-format with Biome |
| `bun run typecheck` | TypeScript check (all packages) |
| `bun run test` | Run full test suite (resets test DB first) |
| `bun run test:unit` | Unit tests only |
| `bun run test:e2e` | E2E tests only |

### Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Essential for local dev
NUVIX_API_PORT=4000
NUVIX_DATABASE_URL=postgresql://nuvix:nuvix@localhost:5432/nuvix
NUVIX_REDIS_URL=redis://localhost:6379
NUVIX_JWT_SECRET=<min-32-char-secret>
NUVIX_ENCRYPTION_KEY=<min-32-char-key>
```

**Note:** The application validates that `JWT_SECRET` and `ENCRYPTION_KEY` are at least 32 characters in production mode.

---

## Coding Style & Conventions

### TypeScript Configuration

- **Module System:** ESNext, bundler resolution
- **Strictness:** `strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`
- **Decorators:** `experimentalDecorators`, `emitDecoratorMetadata` enabled
- **Paths:** `@nuvix/*` aliases for libs, `@/server/*`, `@/platform/*` for apps

### Biome Rules (Key Highlights)

```json
{
  "indentWidth": 2,
  "indentStyle": "space",
  "lineWidth": 80,
  "semicolons": "asNeeded",
  "quoteStyle": "single",
  "trailingCommas": "all"
}
```

**Important lint rules:**
- `noParameterAssign` — Don't reassign function parameters (use local variable)
- `noExplicitAny` — Warn level (avoid `any`, use proper types)
- `noAssignInExpressions` — No assignments inside expressions
- `useBlockStatements` — Use braces for all control structures

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `AuthHook`, `SchemasService` |
| Functions | camelCase | `sanitizeIdentifier`, `handleQuery` |
| Interfaces | PascalCase | `NuvixRequest`, `RestContext` |
| Types | PascalCase | `PermissionType`, `SchemaType` |
| Constants | ALL_CAPS | `DEFAULT_ALGO`, `MAX_DIM` |
| Files | kebab-case | `auth.helper.ts`, `schemas.service.ts` |
| DTOs | PascalCase + DTO suffix | `InsertQueryDTO`, `PermissionsDTO` |

### Error Handling

Use the custom `Exception` class from `@nuvix/core/extend/exception`:

```typescript
import { Exception } from '@nuvix/core/extend/exception'

// Throw with predefined error codes
throw new Exception(Exception.INVALID_PARAMS, 'Invalid table name')
throw new Exception(Exception.GENERAL_BAD_REQUEST, 'Permission denied')

// Common error types:
// - Exception.INVALID_PARAMS
// - Exception.GENERAL_BAD_REQUEST
// - Exception.GENERAL_UNAUTHORIZED
// - Exception.GENERAL_NOT_FOUND
// - Exception.GENERAL_INTERNAL_ERROR
```

**Never** use plain `Error` or `throw new Error()` — always use the typed `Exception` class for consistent error responses.

### Logging

Use NestJS `Logger` with context:

```typescript
import { Logger } from '@nestjs/common'

private readonly logger = new Logger(MyService.name)

this.logger.log('Info message', 'Context')
this.logger.warn('Warning', 'Context')
this.logger.error('Error message', error.stack, 'Context')
this.logger.debug('Debug info', 'Context')  // Only in dev mode
this.logger.verbose('Verbose', 'Context')
```

---

## Key Patterns

### Hooks (Request Middleware)

Hooks are NestJS middleware classes that implement the `Hook` interface:

```typescript
import { Hook } from '@nuvix/core/server/hooks/interface'

@Injectable()
export class AuthHook implements Hook {
  async onRequest(req: NuvixRequest, reply: NuvixRes): Promise<void> {
    // Extract session, validate JWT, set user context
    // Use req.context to pass data to downstream hooks
  }
}
```

**Existing hooks:** `CorsHook`, `AuthHook`, `ApiHook`, `AuditHook`, `StatsHook`, `LogsHook`

### Guards (Authorization)

Guards enforce permissions at the controller level:

```typescript
import { UseGuards } from '@nestjs/common'
import { SchemaGuard } from '@nuvix/core/resolvers'

@Controller('schemas/:schemaId')
@UseGuards(SchemaGuard)  // Validates schema access permissions
export class SchemasController {
  // ...
}
```

**Key guard:** `SchemaGuard` — checks user has access to the schema before allowing request through.

### Decorators

Common decorators from `@nuvix/core/decorators`:

```typescript
import { 
  AuthType, 
  CurrentSchemaType, 
  Namespace,
  Get, 
  Post, 
  Delete,
  Patch,
  Put
} from '@nuvix/core'

@Controller('users')
@Namespace('users')  // Audit namespace
@AuthType(AuthType.JWT)  // Require JWT auth
@CurrentSchemaType([SchemaType.Managed, SchemaType.Unmanaged])
export class UsersController {
  @Get(':id')
  async getUser(@Param('id') id: string) { ... }
}
```

### Services (Business Logic)

Services are injectable NestJS providers:

```typescript
import { Injectable } from '@nestjs/common'
import { CoreService } from '@nuvix/core/core.service'

@Injectable()
export class MyService {
  constructor(
    private readonly coreService: CoreService,
    private readonly db: Database,
  ) {}

  async doSomething(userId: string) {
    // Use CoreService for common ops
    // Use Database for direct DB access
  }
}
```

### DTOs & Validation

Use `class-validator` decorators for request validation:

```typescript
import { IsString, IsOptional, IsObject } from 'class-validator'

export class CreateUserDTO {
  @IsString()
  name: string

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>
}
```

### Database Access

Nuvix uses a custom Document-based ORM (`@nuvix/db`):

```typescript
import { Database, Doc } from '@nuvix/db'

// Get database instance
const db = coreService.getDatabase()

// Create document
const user = new Doc({ name: 'Alice', email: 'alice@example.com' })
await db.createDocument('users', user)

// Query
const found = await db.getDocument('users', userId)

// Update
found.set('name', 'Alice Updated')
await db.updateDocument('users', userId, found)

// Delete
await db.deleteDocument('users', userId)
```

**Important:** The `Authorization` helper controls RLS:

```typescript
import { Authorization } from '@nuvix/db'

// Skip RLS checks (use sparingly!)
const doc = await Authorization.skip(() => 
  db.getDocument('users', userId)
)

// Set default authorization status
Authorization.setDefaultStatus(false)  // Deny by default (recommended)
Authorization.setDefaultStatus(true)   // Allow by default (risky)
```

### Async Local Storage

Authorization context uses ALS for request-scoped data:

```typescript
// Enabled in main.ts
Authorization.enableAsyncLocalStorage()

// Now guards/hooks can access per-request context without propagation
```

---

## Testing

### Test Structure

```text
apps/server/tests/
├── integration/      # E2E tests hitting real API
│   ├── account/
│   ├── users/
│   └── schemas/
├── unit/            # Unit tests for services
└── helpers/         # Test utilities
```

### Running Tests

```bash
# Full test suite (resets test DB)
bun run test

# Unit tests only
bun run test:unit

# E2E tests only
bun run test:e2e

# With coverage
bun run test:cov

# Watch mode
bun run test:watch
```

### Writing Tests

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module'

describe('UserService', () => {
  let app: INestApplication
  let service: UserService

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    await app.init()
    service = app.get(UserService)
  })

  it('should create user', async () => {
    const user = await service.create({ name: 'Test' })
    expect(user.name).toBe('Test')
  })

  afterAll(async () => {
    await app.close()
  })
})
```

---

## Common Pitfalls

### 1. `Authorization.skip()` Misuse

**⚠️ Risk:**
```typescript
const doc = await Authorization.skip(() => db.getDocument('sensitive', id))
```

This bypasses RLS entirely. Only use when:
- You've already validated user permissions manually
- The operation is system-level (not user-triggered)
- You're in a trusted context (internal jobs, migrations)

### 2. Node.js Import Protocol

Biome requires `node:` prefix for built-in modules:

**❌ Wrong:**
```typescript
import path from 'path'
import fs from 'fs/promises'
```

**✅ Correct:**
```typescript
import path from 'node:path'
import fs from 'node:fs/promises'
```

### 3. Parameter Reassignment

Biome forbids reassigning function parameters:

**❌ Wrong:**
```typescript
async deleteUser(id: string) {
  if (id === 'current') {
    id = session.getUserId()  // Lint error
  }
}
```

**✅ Correct:**
```typescript
async deleteUser(id: string) {
  const effectiveId = id === 'current' ? session.getUserId() : id
  // use effectiveId
}
```

### 4. Using `any` Type

Biome warns on `any` — use proper types:

**❌ Wrong:**
```typescript
function process(data: any) { ... }
```

**✅ Correct:**
```typescript
function process(data: unknown) { ... }
// or
function process<T>(data: T) { ... }
```

---

## File Organization

### Controllers
Location: `apps/<app>/src/<domain>/<name>.controller.ts`
- Define routes, DTOs, guards
- Delegate to services
- No business logic

### Services
Location: `apps/<app>/src/<domain>/<name>.service.ts`
- Business logic
- Database operations
- External API calls

### Hooks
Location: `libs/core/src/resolvers/hooks/<name>.hook.ts`
- Request middleware
- Modify `req.context`
- Run before controllers

### Guards
Location: `libs/core/src/resolvers/guards/<name>.guard.ts`
- Authorization checks
- Throw on failure
- Run after hooks

### Helpers
Location: `libs/core/src/helpers/<name>.helper.ts`
- Static utility methods
- No dependencies on NestJS DI
- Reusable across apps

### DTOs
Location: `apps/<app>/src/<domain>/DTO/<name>.dto.ts`
- Request validation
- class-validator decorators
- Match API contract

---

## Quick Reference

### Add a new endpoint

1. Create controller method with decorator (`@Get`, `@Post`, etc.)
2. Add DTO for request validation
3. Create/update service method
4. Add guard if needed (`@UseGuards`)
5. Test with `bun run test:e2e`

### Debug a request

1. Enable verbose logging: `NUVIX_DEBUG=true`
2. Check `AuditHook` output for request flow
3. Use `req.context` to trace data through hooks
4. Check PostgreSQL logs for RLS issues

### Add a new hook

1. Implement `Hook` interface in `libs/core/src/resolvers/hooks/`
2. Register in `AppModule.configure()` middleware chain
3. Add tests for hook behavior

### Fix a security issue

1. Search for pattern: `search_files(pattern='...')`
2. Apply fix with `patch`
3. Run `bun run typecheck` + `bun run lint`
4. Commit with descriptive message

---

## Resources

- **Docs:** None (self-documenting codebase)
- **Issues:** https://github.com/nuvix-dev/nuvix/issues

---

## When in Doubt

1. **Search first:** `search_files(pattern='example')`
2. **Check existing implementations:** Look at similar controllers/services
3. **Run typecheck:** `bun run typecheck` catches most issues
4. **Test:** Write a test before/after your change
5. **Ask:** Flag ambiguous patterns before implementing