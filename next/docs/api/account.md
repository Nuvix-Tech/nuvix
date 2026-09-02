# v2 Contract — Account & Authentication

> Status: PHASE 4 CORE IMPLEMENTED & VERIFIED LIVE — Registration, email password sessions, profile management, and revocation verified live against nuvix/postgres:18.1
> Depends on: `_conventions.md` (D19, D26–D28), `_i18n.md`, D5 (`Bun.password`),
> D6 (`crypto.subtle` JWT), D23 (token-ready), D29 (legacy algos dropped),
> D38 (`x-nuvix-publishable-key`), `../architecture/integrations.md`, `@nuvix/db`
> Old code (reference only): root `apps/server/src/account/`

The Account and Authentication API covers end-user identity lifecycle,
credential registration, email/password sessions, session listing/revocation,
profile management, and administrative user session control.

---

## 1. Auth Posture & Header Conventions

| Route category | Auth required | Required headers | Authority |
| -------------- | ------------- | ---------------- | --------- |
| Registration / Login | None (Public) | `x-nuvix-publishable-key` | Project locator only (D38) |
| Account Operations | Session / JWT | `x-nuvix-publishable-key`, `x-nuvix-session` (or `x-nuvix-jwt`) | Caller-scoped user identity (`Role.user(userId)`) |
| Admin User Sessions | API Key | `x-nuvix-publishable-key`, `x-nuvix-key` | Scope-gated (`users.read` / `users.write`) |

The publishable key selects the tenant PostgreSQL database; authentication is
strictly tenant-local. Unauthenticated routes reject missing or invalid publishable
keys with `400` / `503`. Authenticated account routes require valid session/JWT
claims matching an active, unblocked user (`status: true`).

---

## 2. Password Hashing & Security Policy (D5, D29)

- Passwords use **`Bun.password`** with `argon2id` by default:
  - Memory cost: 65536 KiB, time cost: 2, parallelism: 1.
  - `bcrypt` is supported for administrative imports (`POST /v2/users/bcrypt`).
- **Legacy algorithms are dropped** (D29): MD5, SHA-1, SHA-256, PHPass, and Scrypt
  are not carried over. Legacy import endpoints return `404 /errors/not-found`.
- Password min length: 8 characters, max length: 256 characters.

---

## 3. Session Materialization & Verifier Storage

- Session tokens follow the canonical v2 format:
  `ses_v1.<encodedId>.<encodedSecret>`
- The tenant database stores **salted HMAC-SHA256 verifiers** only:
  - `secretDigest`: 32-byte HMAC digest of `nuvix:session:v1\0<secret>`, Base64URL-encoded
  - `secretSalt`: 32 cryptographically random bytes, Base64URL-encoded
  - `expiresAt`: ISO timestamp (default: 30 days from creation)
  - `revokedAt`: null while active, ISO timestamp when revoked/logged out
- Plaintext session bearer tokens are returned **only once** upon creation.

---

## 4. Endpoints — Account (`/v2/account`)

| Method | Path | Purpose | Auth |
| ------ | ---- | ------- | ---- |
| POST | `/v2/account` | Register new user account | Public (`x-nuvix-publishable-key`) |
| GET | `/v2/account` | Get authenticated user profile | Session / JWT |
| DELETE | `/v2/account` | Delete current account & cascade | Session |
| PATCH | `/v2/account/name` | Update user display name | Session / JWT |
| PATCH | `/v2/account/password` | Update user password | Session |
| PATCH | `/v2/account/email` | Update user email | Session |
| GET | `/v2/account/prefs` | Get user preferences | Session / JWT |
| PATCH | `/v2/account/prefs` | Replace user preferences | Session / JWT |

### `POST /v2/account` (Registration)

- **Headers**: `x-nuvix-publishable-key`
- **Request Body**:
  ```json
  {
    "userId": "unique()",
    "email": "user@example.com",
    "password": "super-secure-password",
    "name": "Jane Doe"
  }
  ```
  `userId` and `name` are optional.
- **Response** (`201 Created`): `UserResponse` (same model as `/v2/users/:userId`).
- **Errors**:
  - `409 /errors/conflict` with `code: "user_email_exists"`
  - `409 /errors/conflict` with `code: "user_already_exists"`
  - `422 /errors/validation` on invalid email or short password

### `GET /v2/account`

- **Response** (`200 OK`): `UserResponse` of the current authenticated user.
- **Errors**: `401 /errors/unauthorized` if missing, expired, or invalid credential.

### `PATCH /v2/account/password`

- **Request Body**:
  ```json
  {
    "password": "new-super-secure-password",
    "oldPassword": "previous-password"
  }
  ```
- **Behavior**: Verifies `oldPassword` against stored hash. Upon update, creates a
  new password hash, updates `passwordUpdate` timestamp, and revokes all other
  sessions for this user.
- **Response** (`200 OK`): `UserResponse`.
- **Errors**: `401 /errors/unauthorized` with `code: "invalid_credentials"` if `oldPassword` is incorrect.

---

## 5. Endpoints — Account Sessions (`/v2/account/sessions`)

| Method | Path | Purpose | Auth |
| ------ | ---- | ------- | ---- |
| POST | `/v2/account/sessions/email` | Login with email and password | Public (`x-nuvix-publishable-key`) |
| GET | `/v2/account/sessions` | List active sessions for current user | Session / JWT |
| GET | `/v2/account/sessions/:sessionId` | Get specific session details | Session / JWT |
| DELETE | `/v2/account/sessions/current` | Logout current session | Session |
| DELETE | `/v2/account/sessions/:sessionId` | Revoke a specific session | Session |
| DELETE | `/v2/account/sessions` | Revoke all sessions for current user | Session |

### Session Object

```json
{
  "$id": "session_abc123",
  "userId": "user_xyz789",
  "token": "ses_v1.dGVzdA.abcdef...",
  "expiresAt": "2026-10-02T12:00:00.000Z",
  "$createdAt": "2026-09-02T12:00:00.000Z",
  "$updatedAt": "2026-09-02T12:00:00.000Z"
}
```
*Note: `token` is included only in `POST` creation responses; list and get endpoints omit it.*

### `POST /v2/account/sessions/email` (Login)

- **Headers**: `x-nuvix-publishable-key`
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "super-secure-password"
  }
  ```
- **Response** (`201 Created`): `SessionResponse` (including `token`).
- **Errors**:
  - `401 /errors/unauthorized` with `code: "invalid_credentials"` if user not found,
    password incorrect, or user account is disabled (`status: false`).

---

## 6. Endpoints — Admin User Sessions (`/v2/users/:userId/sessions`)

| Method | Path | Purpose | Scope |
| ------ | ---- | ------- | ----- |
| GET | `/v2/users/:userId/sessions` | List user sessions | `users.read` |
| POST | `/v2/users/:userId/sessions` | Create session for user (impersonation/admin) | `users.write` |
| DELETE | `/v2/users/:userId/sessions` | Revoke all user sessions | `users.write` |
| DELETE | `/v2/users/:userId/sessions/:sessionId` | Revoke specific user session | `users.write` |

---

## 7. Error Code Registry

| Status | Type | Code | Meaning |
| ------ | ---- | ---- | ------- |
| 401 | `/errors/unauthorized` | `invalid_credentials` | Email/password mismatch or blocked user |
| 401 | `/errors/unauthorized` | `credential_invalid` | Expired, revoked, or malformed session token |
| 404 | `/errors/not-found` | `user_not_found` | User ID does not exist |
| 404 | `/errors/not-found` | `session_not_found` | Session ID does not exist or does not belong to user |
| 409 | `/errors/conflict` | `user_email_exists` | Email already registered |
| 409 | `/errors/conflict` | `user_already_exists` | User ID already in use |
| 403 | `/errors/forbidden` | `user_blocked` | User status is false |
