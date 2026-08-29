# ADR 0002: Project Resolution Contract

**Date**: 2026-08-28
**Status**: Decided
**Owner**: Nuvix Platform

## Context

Project-scoped `/v2` requests need an explicit tenant locator without trusting
client input as authorization. Public failures must help legitimate clients fix
requests while avoiding project-state disclosure.

## Decision

### Resolution contract

- Every project-scoped `/v2` request requires the `x-nuvix-project` header.
- The header contains the public project identifier. It is an untrusted locator,
  not proof of access.
- The server resolves the project from the platform registry. When an
  authenticated credential is present, it independently verifies that the
  credential is bound to that project.
- Upstream authentication establishes that a session, JWT subject, or API key
  is authentic. It does not establish project access. The platform registry
  separately records current bindings in the least-privilege
  `project_credential_bindings` relation and matches the authenticated identity
  to the requested project's internal key without exposing that key.
- The session boundary is exactly
  `verifySession(rawSessionToken) -> { sessionId, userId } | null`:
  `rawSessionToken` is secret verifier input only, `sessionId` is the stable,
  non-secret canonical session-record ID, and `userId` is the authenticated
  user ID. Only the two returned identities may enter `AuthContext` or a
  project-binding lookup. The raw header token must never be persisted in
  `project_credential_bindings`, retained in request context, included in SQL
  text, or sent as a project repository query parameter.
- A binding is valid only while both the project and binding are enabled, the
  binding has not been revoked, and its optional expiry is still in the future.
  Session bindings additionally match their authenticated user subject; API-key
  bindings additionally match their authenticated mode. JWT binding uses the
  verified user subject and does not trust an optional session claim as project
  authority.
- A guest with a valid locator may resolve safe metadata for an enabled project.
  For authenticated callers, resolution additionally requires a valid
  credential-to-project binding.
- Resolution selects project context; it does not authorize the route. Downstream
  route policy and canonical database roles, including guest roles, determine
  what the caller may access.
- Health and OpenAPI routes are not project-scoped and do not require the header.

```http
GET /v2/database/schemas HTTP/1.1
Host: api.example.test
x-nuvix-project: project_demo
```

This guest request may resolve `project_demo`, but the database schemas route
then rejects it under its admin-only authorization policy. Guest-accessible
routes instead proceed with canonical guest database roles. For authenticated
requests, the resolver must check the credential binding separately; matching
client-supplied values cannot substitute for that verification.

### Public errors

Responses follow the API's RFC 9457 `application/problem+json` convention.
Clients branch on `code`, not `detail`.

| Condition                                         | Status | Code                |
| ------------------------------------------------- | -----: | ------------------- |
| Header missing                                    |    400 | `project_required`  |
| Header malformed                                  |    400 | `project_invalid`   |
| Project unknown or disabled                       |    404 | `project_not_found` |
| Authenticated credential bound to another project |    403 | `project_forbidden` |

```json
{
  "type": "/errors/not-found",
  "code": "project_not_found",
  "title": "Not Found",
  "status": 404,
  "detail": "Project not found"
}
```

Unknown and disabled projects intentionally produce the same public response.
`project_forbidden` is limited to an authenticated credential-to-project
mismatch; guest denial by a protected route uses that route's authorization
error instead.
Public details and logs must not expose resolver causes, registry state, or
credential-binding data.

### Request capability boundary

Resolved request context may expose only the minimum safe public project data
and verified authorization claims needed by handlers. It must not expose:

- internal UUIDs;
- platform, connection, or encryption metadata;
- SQL clients or `Database.system()`;
- infrastructure adapters or registry controls;
- privileged database sessions.

### Phase exclusions

- No hostname or custom-domain project routing.
- No project provisioning API or UI.
- No tenant creation or database CRUD routes as part of resolution.

## Why This Was Chosen

An explicit header is predictable across local, self-hosted, proxy, and managed
deployments. Project selection is separate from authorization because guest
requests still need tenant context, while each route defines whether guests may
act. Canonical guest database roles preserve data-layer enforcement after a
guest resolves an enabled project. For authenticated callers, independent
binding verification prevents a valid credential from selecting another tenant
merely by changing the locator.

The error policy is balanced/private: clients receive actionable errors for
missing or malformed input and an explicit forbidden result for an authenticated
binding mismatch, while unknown and disabled states remain indistinguishable.
This limits project enumeration and lifecycle-state disclosure without reducing
the contract to an unhelpful single error.

## Alternatives Considered

| Alternative                                          | Benefit                  | Why rejected                                                                                                                                  |
| ---------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Trust the project header                             | Simple routing           | Treats attacker-controlled input as authorization.                                                                                            |
| Trust a project claim without a separate lookup      | Fewer checks             | Cannot independently confirm current binding or disabled state.                                                                               |
| Separate binding table per credential type           | Type-specific columns    | Duplicates lifecycle policy and makes repository/schema drift more likely. A constrained common relation keeps one auditable lookup contract. |
| Return distinct unknown and disabled errors          | Easier diagnosis         | Reveals project existence and operational state.                                                                                              |
| Return one error for every resolution failure        | Maximum privacy          | Prevents clients from correcting missing or malformed input and obscures authenticated authorization failures.                                |
| Resolve from hostname or custom domain               | Header-free client calls | Adds DNS, certificate, proxy, and domain-ownership concerns outside this phase.                                                               |
| Expose registry or database capabilities to handlers | Flexible implementation  | Breaks least privilege and risks metadata or cross-tenant access.                                                                             |

## Impact

- **Positive**: deterministic tenant selection, guest-compatible project
  context, explicit authorization checks, stable client error handling, and
  reduced project enumeration.
- **Negative**: every project-scoped client must send the header, and each
  request requires registry resolution; authenticated requests also require
  binding verification.
- **Risk**: inconsistent route classification could bypass resolution; all new
  `/v2` routes must explicitly be project-scoped or listed as unscoped.

## Revisit Triggers

Revisit this decision if:

- verified custom-domain routing becomes a product requirement;
- a trusted gateway can provide a cryptographically authenticated project
  locator with equivalent binding guarantees;
- privacy or threat-model changes require collapsing the 403 and 404 outcomes;
- measured resolution cost requires safe caching with prompt disablement and
  credential-revocation behavior; or
- additional unscoped route classes are introduced.

## Related

- [API conventions](../../api/_conventions.md)
- [Database schemas API contract](../../api/database.md)
