# ADR 0001: Platform Database Persistence

> Status: Decided
> Date: 2026-08-28
> Owner: Platform

## Context

Nuvix assigns one PostgreSQL database to each project. The server must resolve a
project to its tenant database without hardcoding connection values or exposing
platform infrastructure to requests.

Connection URIs are high-impact secrets. Platform persistence therefore needs
an independently protected storage boundary, rotation support, least-privilege
database access, and predictable schema changes. This phase needs those controls
without introducing a key-management service or a provisioning product.

## Decision

The PostgreSQL 18 platform database configured by
`NUVIX_INTERNAL_DATABASE_URL` stores project records and their tenant connection
metadata.

Each project has at most one connection-metadata row in a separate privileged
table:

```text
project (id) 1 ─── 0..1 project_connection
                       ├─ project_id (unique foreign key)
                       ├─ key_version
                       ├─ nonce
                       └─ ciphertext (encrypted PostgreSQL URI + GCM tag)
```

The persistence boundary must:

1. Encrypt each normalized PostgreSQL URI with AES-256-GCM.
2. Generate a fresh, cryptographically random 12-byte nonce for every
   encryption. Nonces are stored with ciphertext and never reused with a key.
3. Bind ciphertext to the stable project identity as additional authenticated
   data (AAD). Moving a row to another project must make decryption fail.
4. Select keys through the [authoritative environment contract](../../ENV.md):
   `NUVIX_PLATFORM_ENCRYPTION_PRIMARY_KEY_ID` names the active write key, and
   `NUVIX_PLATFORM_ENCRYPTION_KEYS` is a JSON object mapping key IDs to
   base64-encoded, exactly 32-byte AES keys. JSON member order has no meaning.
   Reads select the row's stored `key_version`; they never try every key.
5. Treat an unknown key version or authentication/tag failure as unavailable
   metadata. It must fail closed without plaintext fallback or trying unrelated
   keys.
6. Return only a normalized connection value to process-owned tenant
   composition. Requests never receive the row, URI, cipher fields, keyring, SQL
   client, or resolver controls.

Platform schema changes use versioned, forward-only SQL migrations run only by
an explicit Bun CLI. API startup never applies migrations. Migration credentials
may mutate schema; normal API runtime credentials must not require schema
mutation privileges.

### Keyring validation and rotation

Both keyring variables are required in every environment that uses platform
connection metadata. Before accepting traffic, startup must fail if:

- either variable is missing or empty;
- `NUVIX_PLATFORM_ENCRYPTION_KEYS` is not a JSON object with at least one
  entry, contains a duplicate or empty key ID, or contains a non-string value;
- any value is not valid base64 that decodes to exactly 32 bytes; or
- the primary key ID does not exactly match an entry in the keyring.

There is no default key, implicit first key, plaintext fallback, or attempt to
continue with a partially valid keyring. A configuration error may name the
variable and violated rule, but must not include either variable's value, a key,
decoded bytes, or derived secret material.

Rotation is additive before it is subtractive:

1. Add the new key under a new ID while retaining every referenced old key.
2. Set `NUVIX_PLATFORM_ENCRYPTION_PRIMARY_KEY_ID` to the new ID and deploy.
   New writes use it; old rows remain decryptable by their stored key version.
3. Re-encrypt old rows through a controlled operation.
4. Remove an old key only after no persisted row references its ID.

Removing a referenced key makes those rows unavailable and is an operator
error; decryption must fail closed rather than trying another key.

## Why this is best now

- **Limits exposure:** separating the privileged one-to-one row keeps routine
  project reads and future serialization paths away from connection secrets.
- **Detects substitution and tampering:** AES-GCM authenticates the value, while
  project AAD prevents valid ciphertext from being reassigned across projects.
- **Supports rotation without a new service:** key versions permit staged
  re-encryption using deployment-managed environment secrets.
- **Makes write selection deterministic:** a separate primary key ID is
  explicit across JSON parsers and deployment tools; object order never decides
  which key encrypts new data.
- **Rejects unsafe partial configuration:** validating the complete keyring
  before readiness prevents latent failures and accidental use of malformed or
  short AES keys.
- **Keeps startup deterministic:** explicit migrations separate deploy-time
  schema authority from serving traffic and allow least-privileged runtime
  credentials.
- **Fits the current boundary:** the existing resolver-to-registry flow can
  consume one connection value without gaining provisioning or key-management
  responsibilities.

## Rejected alternatives

| Alternative                                      | Benefit                                   | Why rejected now                                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store plaintext URIs                             | Simplest reads and debugging              | A platform database read or backup would immediately disclose tenant credentials.                                                                                           |
| Store connection fields on the project row       | Fewer joins                               | Broadens secret access to ordinary project queries and increases accidental serialization risk.                                                                             |
| Use an external KMS                              | Central key policy and audit capabilities | Adds an operational dependency, availability path, and integration scope before current deployment needs justify it. The versioned envelope leaves room to adopt one later. |
| Run migrations during API startup                | Convenient local boot                     | Gives runtime credentials DDL authority, couples availability to migration success, and risks concurrent startup races.                                                     |
| Use reversible encryption without authentication | Smaller envelope                          | Cannot reliably detect ciphertext modification or project substitution.                                                                                                     |

## Security invariants

- Plaintext URIs and encryption keys exist only inside the privileged persistence
  and process-composition path; they are never returned by an API or request
  capability.
- Logs, metrics, and public errors never include plaintext URIs, ciphertext,
  nonces, either keyring environment value, keys, decoded or derived key
  material, key versions tied to a record, or resolver/decryption causes.
- Encryption keys are 256-bit secrets supplied through environment
  configuration; they are never stored in the platform database or source.
- Every encryption uses a new random 12-byte nonce and the stable project
  identity as AAD.
- Missing keys, malformed envelopes, and failed GCM authentication fail closed.
  They do not fall back to plaintext, another project, or an arbitrary key.
- Database access follows least privilege: request code has no platform SQL
  capability, API runtime credentials have only required data privileges, and
  schema mutation is reserved for the migration CLI.
- Deleting or disabling a project must not make its connection metadata
  available through another project; lifecycle and final deletion behavior is a
  future provisioning decision.

## Consequences

### Positive

- Database-level tenant isolation remains compatible with safe, lazy connection
  resolution.
- Backups do not contain plaintext tenant URIs.
- Key rotation can preserve reads while records are deliberately re-encrypted.
- Failed tamper checks stop connection attempts before tenant resources are
  created.

### Negative

- Reads require a privileged lookup and authenticated decryption.
- Operators must retain every key version still referenced by stored rows.
- Losing a referenced key makes its connection metadata unrecoverable.
- Forward-only migrations require explicit deployment ordering and operational
  discipline.

### Risks and controls

| Risk                                   | Control                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Nonce reuse                            | Generate a fresh random 12-byte nonce for every write.                           |
| Partial key rotation                   | Store `key_version`; keep old keys until no rows reference them.                 |
| Ambiguous active key                   | Select it only by `NUVIX_PLATFORM_ENCRYPTION_PRIMARY_KEY_ID`; ignore JSON order. |
| Invalid keyring configuration          | Validate the full contract and fail before accepting traffic.                    |
| Ciphertext or row substitution         | Authenticate with AES-GCM and project identity as AAD.                           |
| Secret leakage during failure handling | Redact values and underlying resolver/decryption causes.                         |
| Schema drift                           | Run the explicit migration CLI before deploying code that requires a new schema. |

## Scope and non-goals

This decision covers platform persistence for project-to-database connection
metadata, encryption, key-version selection, and migration ownership. It does
not add:

- hostname or custom-domain project routing;
- an external KMS;
- startup migrations;
- a project provisioning API or UI;
- tenant creation or database lifecycle automation;
- database CRUD or other feature routes;
- billing, quotas, or region placement; or
- a final project-deletion and secret-destruction workflow.

## Revisit triggers

Reconsider this decision when:

- compliance or deployment policy requires centralized KMS/HSM custody,
  per-key audit logs, or automatic key revocation;
- environment key distribution becomes unsafe or operationally unmanageable;
- connection metadata needs multiple active credentials, regions, replicas, or
  providers per project, invalidating the one-to-one model;
- rotation volume requires an automated re-encryption service;
- provisioning and deletion workflows define stronger lifecycle guarantees; or
- migration frequency or fleet size requires a dedicated migration coordinator.

Any replacement must preserve authenticated encryption, project binding,
request capability isolation, redacted failures, and least-privileged runtime
credentials.

## Related

- [`../integrations.md`](../integrations.md) — request and tenant composition boundaries
- [`../../ENV.md`](../../ENV.md) — platform database environment contract
- [`../../../MIGRATION.md`](../../../MIGRATION.md) — rewrite and multi-tenancy decisions
