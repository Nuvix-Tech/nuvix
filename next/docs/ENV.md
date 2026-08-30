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

| Variable                         | Required        | Default               | Description                                    |
| -------------------------------- | --------------- | --------------------- | ---------------------------------------------- |
| `NUVIX_INTERNAL_DATABASE_DRIVER` | no              | See below             | `postgresql` or `sqlite`                       |
| `NUVIX_INTERNAL_DATABASE_URL`    | PostgreSQL only | —                     | PostgreSQL connection string for platform data |
| `NUVIX_INTERNAL_DATABASE_FILE`   | no, for SQLite  | `./data/nuvix.sqlite` | SQLite database filename                       |

When the driver is omitted, Nuvix selects PostgreSQL if
`NUVIX_INTERNAL_DATABASE_URL` is set and SQLite otherwise. A minimal instance
therefore needs no PostgreSQL service. Both modes use `@nuvix/db`; optional
features are enabled from adapter capabilities and may be unavailable on
SQLite.

Use a real SQLite file whenever provisioning and runtime open separate adapter
instances. An in-memory database cannot survive that close/reopen boundary. The
live integration fixture therefore creates a unique real file under
`/tmp/opencode`, reopens it through production composition, and removes the
database plus journal/WAL files during teardown.

## Tenant databases

Every project database is PostgreSQL 18 provisioned from the exact
`nuvix/postgres:18.1` image. Its source repository is `nuvix-dev/postgres`.
Tenant targets use the image's `nuvix_admin` schema-administration role and are
platform-owned connection metadata unrelated to
`NUVIX_INTERNAL_DATABASE_DRIVER`. SQLite is supported for the platform/control
plane only.

`NUVIX_LIVE_POSTGRES=1` is test-only and selects the Docker-backed integration
suite. From `next/`, run:

```bash
bun run test:integration:live
```

The command starts collision-isolated containers with `--pull=never`. Both
tenant databases and the PostgreSQL platform matrix row use exactly
`nuvix/postgres:18.1`; missing Docker, image, or readiness is a failure.
Ordinary `bun test` does not start Docker resources.

## Redis

| Variable          | Required | Description                            |
| ----------------- | -------- | -------------------------------------- |
| `NUVIX_REDIS_URL` | yes      | Redis connection string (queues/cache) |

## Security

| Variable                             | Required | Description                                               |
| ------------------------------------ | -------- | --------------------------------------------------------- |
| `NUVIX_TENANT_TARGET_ENCRYPTION_KEY` | yes      | Canonical unpadded base64url encoding of exactly 32 bytes |

Generate a key without committing its output:

```bash
bun -e 'const key = crypto.getRandomValues(new Uint8Array(32)); console.log(Buffer.from(key).toString("base64url"))'
```

The key configures AES-256-GCM filters used to write and read tenant target
documents. Provisioning and runtime must use the same key. Targets are stored as
authenticated `ntt1.<base64url>` ciphertext; malformed keys fail startup and
decode failures become redacted `503 project_unavailable` responses.

Project-facing JWT trust material is tenant-owned and is not configured through
a process-global secret. Tenant signing-key provisioning and rotation are part
of the Phase 4 auth slice.

## Storage

| Variable                | Required | Default             | Description        |
| ----------------------- | -------- | ------------------- | ------------------ |
| `NUVIX_STORAGE_UPLOADS` | no       | `./storage/uploads` | Local uploads root |
