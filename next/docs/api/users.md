# v2 Contract — Users

> Status: PARTIALLY IMPLEMENTED — credentialless core identity/profile administration
> Depends on: `_conventions.md` (D19, D26–D28), `_i18n.md`, D29 (password
> hashing policy), `../architecture/integrations.md`,
> `@nuvix/db@1.0.0-alpha.2`, `@nuvix/messaging@2.0.0`
> Old code (reference only): root `apps/server/src/users/`

User administration: lifecycle, profile fields, prefs/labels/status,
identities, password-hash imports, tokens/JWTs, sessions, MFA factors and
recovery codes, push targets. Admin-facing surface (the end-user "account"
surface lives in the future auth contract).

Implemented first slice: create/list/get plus name, email, phone, preferences,
labels, and status mutations. It is API-key-only (`users.read` / `users.write`)
until a trusted administrative session claim exists. Passwords, hash imports,
identities, tokens/JWTs, sessions, MFA, targets, usage, logs, deletion, and user
membership projection remain deferred. Preferences replace the stored object;
they do not merge.

## Auth posture

The implemented first slice is API-key-only. Keys require `users.read` or
`users.write`; mode does not grant authority. Guest, ordinary session, and JWT
contexts receive `403`. A trusted administrative-session claim may be added in
Phase 4 without changing route/service boundaries.

---

## Endpoints — Core

| Method | Path                            | Purpose                             |
| ------ | ------------------------------- | ----------------------------------- |
| POST   | `/v2/users`                     | Create credentialless user profile  |
| POST   | `/v2/users/argon2`              | Deferred to Phase 4                 |
| POST   | `/v2/users/bcrypt`              | Deferred to Phase 4                 |
| GET    | `/v2/users`                     | List users (portable exact filters) |
| GET    | `/v2/users/usage`               | Deferred to stats phase             |
| GET    | `/v2/users/:userId`             | Get user                            |
| PATCH  | `/v2/users/:userId/name`        | Update name                         |
| PATCH  | `/v2/users/:userId/password`    | Deferred to Phase 4                 |
| PATCH  | `/v2/users/:userId/email`       | Update email                        |
| PATCH  | `/v2/users/:userId/phone`       | Update phone                        |
| GET    | `/v2/users/:userId/prefs`       | Get prefs                           |
| PATCH  | `/v2/users/:userId/prefs`       | Replace prefs                       |
| PUT    | `/v2/users/:userId/labels`      | Replace labels                      |
| PATCH  | `/v2/users/:userId/status`      | Activate/block                      |
| GET    | `/v2/users/:userId/memberships` | Deferred                            |
| GET    | `/v2/users/:userId/logs`        | Deferred                            |

### Legacy hash variants — REMOVED (D29)

v1's `POST /users/md5 | sha | phpass | scrypt | scrypt-modified` are **not
carried over**. Per D29 only bcrypt/argon2 are supported for verification;
importing legacy hashes would create accounts that can never re-verify
cleanly. SDKs calling these paths get `404 problem+json` like any unknown
route. Migration path for legacy installs: bulk-reset flows, not hash
imports.

### Create user

Implemented body: `{ userId?, email?, phone?, name? }`. At least one of
`userId`, `email`, or `phone` is required. Omitted/`"unique()"` IDs are
generated; emails are lowercased; phones use E.164. Password/hash fields are
rejected by validation and land only with Phase 4 credential storage.

### Status

`PATCH status` body: `{ status: boolean }` → maps to v1's active/blocked
duality. Blocked users fail session validation at the auth layer.

## Endpoints — Identities & Tokens & JWTs

| Method | Path                               | Purpose                |
| ------ | ---------------------------------- | ---------------------- |
| GET    | `/v2/users/identities`             | List OAuth identities  |
| DELETE | `/v2/users/identities/:identityId` | Delete identity        |
| POST   | `/v2/users/:userId/tokens`         | Create magic-URL token |
| POST   | `/v2/users/:userId/jwts`           | Issue JWT for user     |

Token creation returns a `secret` that gets embedded into the provided
`url` (same confirm-link pattern as team invites) and dispatched via
messaging.

## Endpoints — Sessions (`/v2/users/:userId/sessions`)

| Method | Path                    | Purpose                |
| ------ | ----------------------- | ---------------------- |
| GET    | `…/sessions`            | List user sessions     |
| POST   | `…/sessions`            | Create session (admin) |
| DELETE | `…/sessions`            | Delete all sessions    |
| DELETE | `…/sessions/:sessionId` | Delete one session     |

## Endpoints — MFA (`/v2/users/:userId/mfa`)

| Method | Path                         | Purpose                       |
| ------ | ---------------------------- | ----------------------------- |
| PATCH  | `…/mfa`                      | Enable/disable MFA            |
| GET    | `…/mfa/factors`              | List enrolled factors         |
| GET    | `…/mfa/recovery-codes`       | View remaining recovery codes |
| PATCH  | `…/mfa/recovery-codes`       | Regenerate codes              |
| PUT    | `…/mfa/recovery-codes`       | Replace codes                 |
| DELETE | `…/mfa/authenticators/:type` | Remove authenticator          |

Implementation gate (from roadmap): otplib vs hand-rolled RFC-6238 decided
before this slice lands; contract shape is independent of that choice.

## Endpoints — Targets (`/v2/users/:userId/targets`)

Push/notification targets. Standard CRUD:

`POST` / `GET` / `GET :targetId` / `PATCH :targetId` / `DELETE :targetId`.
Body: `{ targetId?, providerType, identifier }`.

---

## v1 → v2 deviations

1. **Legacy hash create endpoints removed** (D29) — see above.
2. **Envelope**: `{ data, meta: { total, limit, offset } }`; list queries
   use the shared cursor/offset conventions from `_conventions.md`.
3. **Error format**: problem+json with stable `code`s mirroring i18n keys
   `errors.users.*`: `user_not_found`, `user_email_exists`,
   `identity_not_found`, … — restoring v1's `USER_NOT_FOUND`-style
   specificity that clients can branch on.
4. **Sensitive-field stripping** becomes explicit response serialization
   (`password`, `hashOptions`, token/session secrets) instead of interceptor
   magic.
5. **Usage endpoint**: kept for parity but flagged as likely console-only —
   candidate to move behind the console namespace later.

## Implementation notes

- Resolve the tenant database centrally, map request auth to roles once, and
  inject only the caller-scoped `Session` methods needed for user,
  identity, target, and session documents. Routes do not call `Database`
  document methods or create package clients.
- Magic-link delivery uses the shared messaging gateway so every recipient's
  result is retained and typed messaging failures use the common translator.
- User JWT issuance remains on Nuvix's HS256/HS512 core helper.
  `@nuvix/messaging` exposes asynchronous `JWT.sign` for RS256/ES256 provider
  assertions and has no `JWT.encode`; it is not the access-token issuer.
- Map DB/messaging failures through the shared translator to the existing
  stable `user_*`/`identity_*` contract codes.
- Password update must invalidate other sessions (parity with v1 behavior)
  and re-hash with current default cost params.
- Smoke cases without DB: guest 403s, 422 validation shapes, removed-route
  404s (`/v2/users/md5` etc.).

## Deferred decisions

1. `GET /v2/users/usage` waits for the shared stats pipeline.
2. Preferences use replacement semantics, matching the actual v1 service.
3. Passwords/hash imports, identities, JWTs, sessions, MFA, targets, logs,
   deletion, and user membership projection remain outside this first slice.
