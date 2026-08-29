# Environment Variables — Nuvix v2

> Copy these into a local `.env` file (never committed). Generate each secret
> with the command documented for its contract.

## App

| Variable     | Required | Default       | Description                             |
| ------------ | -------- | ------------- | --------------------------------------- |
| `NUVIX_ENV`  | yes      | `development` | `development` \| `production` \| `test` |
| `NUVIX_PORT` | yes      | `4000`        | HTTP listen port                        |
| `NUVIX_HOST` | yes      | `0.0.0.0`     | HTTP bind address                       |

## Internal (platform) database

| Variable                      | Required | Description                                         |
| ----------------------------- | -------- | --------------------------------------------------- |
| `NUVIX_INTERNAL_DATABASE_URL` | yes      | PostgreSQL 18 connection string for platform tables |

## Redis

| Variable          | Required | Description                            |
| ----------------- | -------- | -------------------------------------- |
| `NUVIX_REDIS_URL` | yes      | Redis connection string (queues/cache) |

## Security

| Variable                                   | Required | Description                                                              |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------ |
| `NUVIX_JWT_SECRET`                         | yes      | Secret used to sign JWTs/tokens. **Set a real value in production.**     |
| `NUVIX_PLATFORM_ENCRYPTION_PRIMARY_KEY_ID` | yes      | Key ID used to encrypt new platform connection metadata.                 |
| `NUVIX_PLATFORM_ENCRYPTION_KEYS`           | yes      | JSON object mapping key IDs to base64-encoded, exactly 32-byte AES keys. |

### Platform encryption keyring

`NUVIX_PLATFORM_ENCRYPTION_PRIMARY_KEY_ID` selects the active write key by an
exact key-ID match. `NUVIX_PLATFORM_ENCRYPTION_KEYS` contains all active and
historical decryption keys. JSON member order is ignored.

Generate a local keyring without printing the key:

```bash
primary_id="local-2026-08"
key="$(openssl rand -base64 32)"
export NUVIX_PLATFORM_ENCRYPTION_PRIMARY_KEY_ID="$primary_id"
export NUVIX_PLATFORM_ENCRYPTION_KEYS="$(printf '{\"%s\":\"%s\"}' "$primary_id" "$key")"
unset key
```

The service validates the complete contract before accepting traffic. Startup
fails when:

- either variable is missing or empty;
- the keyring is not a JSON object with at least one entry;
- a key ID is empty or duplicated, or a value is not a string;
- a value is invalid base64 or does not decode to exactly 32 bytes; or
- the primary key ID is absent from the keyring.

There are no default keys or partial-keyring fallbacks. Errors may identify the
variable and failed rule, but logs, traces, telemetry, diagnostics, and exception
messages must never contain either raw environment value, encoded or decoded
keys, key fingerprints, or derived secret material.

Rotate keys without interrupting reads:

1. Add a newly generated key under a new ID; retain referenced old keys.
2. Change `NUVIX_PLATFORM_ENCRYPTION_PRIMARY_KEY_ID` to the new ID and deploy.
3. Re-encrypt rows through the controlled rotation operation.
4. Remove an old key only after no persisted row references that ID.

New writes use only the primary key. Reads use the key ID stored with each row
and never try unrelated keys. Removing a referenced key makes the affected
metadata unavailable.

See [ADR 0001](architecture/decisions/0001-platform-database-persistence.md) for
the persistence, encryption, and fail-closed rationale.

## Storage

| Variable                | Required | Default             | Description        |
| ----------------------- | -------- | ------------------- | ------------------ |
| `NUVIX_STORAGE_UPLOADS` | no       | `./storage/uploads` | Local uploads root |
