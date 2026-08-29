# ADR 0002: Project Resolution Contract

**Date**: 2026-08-28
**Status**: Decided (project-first amendment 2026-08-29)
**Owner**: Nuvix Platform

## Context

Project-scoped `/v2` requests need a browser-safe tenant locator. Authentication
cannot run before the tenant is known because users, sessions, JWT trust
material, memberships, scopes, and API keys belong to the tenant database.
The locator therefore must select a project without acting as authorization.

## Decision

### Publishable-key contract

- Every project-scoped `/v2` request requires
  `x-nuvix-publishable-key`.
- Format: `pk_test_<payload>` or `pk_live_<payload>`. The payload is canonical,
  unpadded base64url of the ASCII string `v1:<public-project-id>`.
- `test` keys are accepted in development/test deployments; `live` keys are
  accepted in production. A mismatch is malformed input.
- The key is public, reversible, unsigned, and intentionally safe to ship in a
  browser. It contains no secret, role, scope, user identity, or authority.
- `x-nuvix-key` remains the distinct **secret API-key authentication** header.
- The decoded project ID—not the complete key—is used for platform lookup and
  tenant-registry identity. Raw publishable keys are not persisted.

### Resolution order

1. Strictly parse the publishable key and decode its public project ID.
2. Resolve an enabled project through the platform registry.
3. Resolve its owner-only tenant target and acquire the tenant database.
4. Verify session/JWT/secret API-key credentials **inside that tenant**.
5. Derive tenant-local claims and canonical database roles.
6. Run the handler with safe project/auth context and a caller-scoped session.

There is no platform credential-binding collection. A credential issued by
project B presented with project A's publishable key is looked up only in A and
fails authentication there; it cannot redirect selection to B. A publishable
key without another credential produces guest context and grants only what the
selected tenant's guest roles and route policy permit.

All platform and tenant persistence uses public `@nuvix/db` APIs. If the
portable security-critical lookup cannot run, the request fails closed; no
adapter-specific SQL fallback is allowed. Health and OpenAPI routes remain
unscoped and require no publishable key.

```http
GET /v2/database/schemas HTTP/1.1
Host: api.example.test
x-nuvix-publishable-key: pk_test_djE6cHJvamVjdF9kZW1v
```

This key decodes to `project_demo`. The request may resolve that tenant as a
guest, but the database schemas route then rejects it under its admin-only
policy. Guest-accessible routes instead proceed with canonical guest roles.

### Public errors

Responses follow the API's RFC 9457 `application/problem+json` convention.
Clients branch on `code`, not `detail`.

| Condition                                    | Status | Code                       |
| -------------------------------------------- | -----: | -------------------------- |
| Publishable-key header missing               |    400 | `publishable_key_required` |
| Prefix, environment, encoding, or ID invalid |    400 | `publishable_key_invalid`  |
| Decoded project unknown or disabled          |    404 | `project_not_found`        |
| Tenant target unavailable/corrupt            |    503 | `project_unavailable`      |

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
Invalid tenant-local credentials follow the auth contract and do not become a
project-resolution error. Public details and logs must not expose registry
state, tenant targets, raw keys, or credential lookup causes.

### Request capability boundary

Resolved request context may expose only the minimum safe public project data
and verified authorization claims needed by handlers. It must not expose:

- raw publishable keys or internal UUIDs;
- platform, connection, or encryption metadata;
- raw database clients or `Database.system()`;
- infrastructure adapters or registry controls;
- privileged database sessions.

### Phase exclusions

- No hostname, query-parameter, or custom-domain project routing.
- No project provisioning API or UI.
- No tenant creation or database CRUD routes as part of resolution.

## Why This Was Chosen

An explicit publishable key is predictable across local, self-hosted, proxy, and
managed deployments and can be safely embedded in frontend applications.
Project selection is separate from authorization because guest requests still
need tenant context. Tenant-local credential verification naturally prevents a
credential from selecting another tenant: selection is already complete before
authentication begins.

The error policy is balanced/private: clients receive actionable errors for
missing or malformed input and an explicit forbidden result for an authenticated
binding mismatch, while unknown and disabled states remain indistinguishable.
This limits project enumeration and lifecycle-state disclosure without reducing
the contract to an unhelpful single error.

## Alternatives Considered

| Alternative                                          | Benefit                  | Why rejected                                                                                                        |
| ---------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Send a bare project ID                               | Simple routing           | Misses an environment/version marker and has a weaker public SDK contract.                                          |
| Sign the publishable key                             | Detects tampering        | Adds secret rotation and false authority to a value that still must be treated as public input.                     |
| Infer project from an auth credential                | One header               | Reverses the required order and prevents guest tenant selection.                                                    |
| Store platform credential bindings                   | Central lookup           | Duplicates tenant auth state and makes authentication precede tenant selection.                                     |
| Use raw SQL for registry or binding lookups          | Direct control           | Bypasses the adapter-neutral `@nuvix/db` boundary and prevents the same resolution contract from running on SQLite. |
| Return distinct unknown and disabled errors          | Easier diagnosis         | Reveals project existence and operational state.                                                                    |
| Return one error for every resolution failure        | Maximum privacy          | Prevents clients from correcting missing or malformed input and obscures authenticated authorization failures.      |
| Resolve from hostname or custom domain               | Header-free client calls | Adds DNS, certificate, proxy, and domain-ownership concerns outside this phase.                                     |
| Expose registry or database capabilities to handlers | Flexible implementation  | Breaks least privilege and risks metadata or cross-tenant access.                                                   |

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
