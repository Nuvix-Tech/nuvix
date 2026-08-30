# v2 Contract — Teams

> Status: PARTIALLY IMPLEMENTED — core team CRUD + preferences; memberships/logs deferred
> Depends on: `_conventions.md` (D19, D26–D28), `_i18n.md`,
> `../architecture/integrations.md`, `@nuvix/db@1.0.0-alpha.2`,
> `@nuvix/messaging@2.0.0`
> Old code (reference only): root `apps/server/src/teams/`

Team management plus the membership invite/accept lifecycle. Teams and
memberships live in `@nuvix/db` collections inside the project's document
schema. Core team CRUD and preferences are implemented; the membership and log
sections below remain deferred to their named dependencies.

## Auth posture

Full auth: admin sessions, API keys (`KEY`), user sessions (`SESSION`), and
JWTs — same union as v1. Scopes: `teams.read`, `teams.write`.

---

## Endpoints — Teams

| Method | Path                      | Purpose                | Scope       |
| ------ | ------------------------- | ---------------------- | ----------- |
| POST   | `/v2/teams`               | Create team            | teams.write |
| GET    | `/v2/teams`               | List teams (paginated) | teams.read  |
| GET    | `/v2/teams/:teamId`       | Get team               | teams.read  |
| PUT    | `/v2/teams/:teamId`       | Update name            | teams.write |
| DELETE | `/v2/teams/:teamId`       | Delete team            | teams.write |
| GET    | `/v2/teams/:teamId/prefs` | Get prefs              | teams.read  |
| PUT    | `/v2/teams/:teamId/prefs` | Replace prefs          | teams.write |
| GET    | `/v2/teams/:teamId/logs`  | Audit logs for team    | teams.read  |

### Team object

```json
{
  "$id": "team_abc123",
  "name": "Design",
  "total": 3,
  "prefs": { "theme": "dark" },
  "$createdAt": "2026-08-26T10:00:00.000Z",
  "$updatedAt": "2026-08-26T10:00:00.000Z"
}
```

- `POST /v2/teams` body: `{ name, roles? }`. `roles` (array of strings,
  max `limits.arrayParamsSize`, each ≤32 chars) are assigned to the
  **creating user**, defaulting to `["owner"]`.
- `PUT /v2/teams/:teamId` body: `{ name }` (**deviation**: v1 accepted
  optional `roles` here too but only ever applied them at create time —
  dropped; use memberships to change roles).
- Prefs: arbitrary JSON object, replaced wholesale by `PUT` (v1 parity).
- Logs: standard list envelope + D27 pagination (`limit`/`offset` in meta).

## Endpoints — Memberships

> Deferred: public membership endpoints require the Users projection, invite
> secret/status contract, and messaging gateway. Core team creation already
> creates an accepted owner membership transactionally for session creators.

Nested under `/v2/teams/:teamId/memberships`:

| Method | Path                                                 | Purpose               |
| ------ | ---------------------------------------------------- | --------------------- |
| POST   | `/v2/teams/:teamId/memberships`                      | Invite member         |
| GET    | `/v2/teams/:teamId/memberships`                      | List memberships      |
| GET    | `/v2/teams/:teamId/memberships/:membershipId`        | Get membership        |
| PATCH  | `/v2/teams/:teamId/memberships/:membershipId`        | Update roles          |
| PATCH  | `/v2/teams/:teamId/memberships/:membershipId/status` | Accept/decline invite |
| DELETE | `/v2/teams/:teamId/memberships/:membershipId`        | Remove member         |

### Membership object

```json
{
  "$id": "memb_xyz789",
  "userId": "user_001",
  "userName": "Ada Lovelace",
  "email": "ada@example.com",
  "roles": ["owner"],
  "status": "invited",
  "invited": "2026-08-26T10:00:00.000Z",
  "joined": null,
  "confirmUrl": "https://console.example.com/invite?teamId=…&membershipId=…&userId=…&secret=…&expiry=…"
}
```

The **`secret` is never returned** by the API (v1 `sensitiveFields`) — it
only travels inside the emailed/SMS'd `confirmUrl`.

### Invite lifecycle (preserved from v1)

1. **Invite** — `POST memberships` with exactly one of `email` / `userId` /
   `phone`, plus `roles[]` and a required `url` (base of the confirmation
   link). Server generates a secret, stores its **hash**, appends
   `secret`+`expiry` to `url`, and dispatches the invitation through the
   messaging module. Membership starts as `status: "invited"`.
2. **Accept/decline** — invitee opens `confirmUrl`; frontend calls
   `PATCH …/status` with `{ userId, secret }` (secret ≤256 chars). Server
   verifies hash, transitions to `"accepted"` (or removes on decline), and —
   for email invites that don't have a session yet — creates an
   **INVITES-type session** so the flow completes without a separate login.
   Only INVITES sessions may call this endpoint pre-auth.
3. **Roles change** — `PATCH membership` with `{ roles[] }` (auth'd members
   with `teams.write`).
4. **Remove** — `DELETE membership`.

Errors (`type` = coarse class, `code` = what SDKs branch on):

| Status | Type                   | Code                         |
| ------ | ---------------------- | ---------------------------- |
| 404    | `/errors/not-found`    | `team_not_found`             |
| 404    | `/errors/not-found`    | `membership_not_found`       |
| 409    | `/errors/conflict`     | `team_invite_already_exists` |
| 401    | `/errors/unauthorized` | `invalid_invite_secret`      |
| 403    | `/errors/forbidden`    | — (wrong session type)       |

---

## v1 → v2 deviations

1. **Envelope**: `{ data, meta: { total, limit, offset } }` everywhere,
   including logs (v1 flat `{data,total}`).
2. **Error format**: problem+json with stable `code`s mirroring i18n keys
   `errors.teams.*`: `team_not_found`, `membership_not_found`,
   `team_invite_already_exists`, `invalid_invite_secret`, … added at
   implementation.
3. **`PUT /v2/teams/:teamId` drops `roles`** (see above — dead parameter).
4. **Audit events** (`membership.create`, etc.) move to the shared audit
   pipeline when it lands; log _shape_ stays compatible.

## Implementation notes

- The request context maps verified auth to roles once and provides a
  caller-scoped `db.for(...roles)` session. Team services receive only their
  required `Session` methods; routes never create sessions or package clients.
- Use the shared messaging gateway for email/SMS invites. It preserves
  `@nuvix/messaging` per-recipient success/failure results and translates typed
  package errors centrally.
- Secret hashing must reuse the same helper as auth tokens (v1:
  `Auth.hash`) — single source of truth for comparison logic.
- Map DB not-found/conflict failures through the shared translator to the
  existing `team_*` and `membership_*` public codes.
- Smoke cases (no live DB): guest gets `403` on all endpoints; malformed
  create bodies get `422`. Full lifecycle cases need integration fixtures.

## Open questions for review

1. Confirm dropping `roles` from team update (deviation #3).
2. Should decline remove the membership or set `status: "declined"`?
   v1 removes it — proposed keeping removal.
