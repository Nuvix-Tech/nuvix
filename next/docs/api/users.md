# v2 Contract — Users

> Status: PROPOSED — review before implementation
> Depends on: `_conventions.md` (D19, D26–D28), `_i18n.md`, D29 (password
> hashing policy), `@nuvix/db`
> Old code (reference only): root `apps/server/src/users/`

User administration: lifecycle, profile fields, prefs/labels/status,
identities, password-hash imports, tokens/JWTs, sessions, MFA factors and
recovery codes, push targets. Admin-facing surface (the end-user "account"
surface lives in the future auth contract).

## Auth posture

Admin/key/session/JWT union like teams; most write endpoints are admin/key
only in practice via `users.write`. Scopes: `users.read`, `users.write`.

---

## Endpoints — Core

| Method | Path                            | Purpose                            |
| ------ | ------------------------------- | ---------------------------------- |
| POST   | `/v2/users`                     | Create user (server-side hashing)  |
| POST   | `/v2/users/argon2`              | Create user with pre-hashed Argon2 |
| POST   | `/v2/users/bcrypt`              | Create user with pre-hashed bcrypt |
| GET    | `/v2/users`                     | List users (queries + search)      |
| GET    | `/v2/users/usage`               | Aggregate usage stats              |
| GET    | `/v2/users/:userId`             | Get user                           |
| PATCH  | `/v2/users/:userId/name`        | Update name                        |
| PATCH  | `/v2/users/:userId/password`    | Update password                    |
| PATCH  | `/v2/users/:userId/email`       | Update email                       |
| PATCH  | `/v2/users/:userId/phone`       | Update phone                       |
| GET    | `/v2/users/:userId/prefs`       | Get prefs                          |
| PATCH  | `/v2/users/:userId/prefs`       | Merge prefs                        |
| PUT    | `/v2/users/:userId/labels`      | Replace labels                     |
| PATCH  | `/v2/users/:userId/status`      | Activate/block                     |
| GET    | `/v2/users/:userId/memberships` | Teams the user belongs to          |
| GET    | `/v2/users/:userId/logs`        | Audit logs                         |

### Legacy hash variants — REMOVED (D29)

v1's `POST /users/md5 | sha | phpass | scrypt | scrypt-modified` are **not
carried over**. Per D29 only bcrypt/argon2 are supported for verification;
importing legacy hashes would create accounts that can never re-verify
cleanly. SDKs calling these paths get `404 problem+json` like any unknown
route. Migration path for legacy installs: bulk-reset flows, not hash
imports.

### Create user

Body (`POST /v2/users`): `{ userId?, email?, phone?, password?, name? }` —
all optional except one identifier is required in practice. Server hashes
`password` with the project default (bcrypt). The argon2/bcrypt variants
accept an already-hashed `password` (+ `hashOptions` where applicable) so
plaintext never crosses the wire during migrations.

`password` and `hashOptions` are sensitive fields — never echoed back.

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
3. **Error format**: problem+json; i18n keys `errors.users.*`
   (`userNotFound`, `emailExists`, `identityNotFound`, …).
4. **Sensitive-field stripping** becomes explicit response serialization
   (`password`, `hashOptions`, token/session secrets) instead of interceptor
   magic.
5. **Usage endpoint**: kept for parity but flagged as likely console-only —
   candidate to move behind the console namespace later.

## Implementation notes

- Depends on `@nuvix/db` for user docs + identities/targets collections.
- Password update must invalidate other sessions (parity with v1 behavior)
  and re-hash with current default cost params.
- Smoke cases without DB: guest 403s, 422 validation shapes, removed-route
  404s (`/v2/users/md5` etc.).

## Open questions for review

1. Keep `GET /v2/users/usage` in v2 or defer with DEFERRED_ROUTES?
2. `PATCH prefs` merge semantics vs `PUT` replace — v1 uses PATCH-as-merge;
   proposed keeping merge for parity.
