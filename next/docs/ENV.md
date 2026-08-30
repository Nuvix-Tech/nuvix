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

| Variable                         | Required        | Default               | Description                                       |
| -------------------------------- | --------------- | --------------------- | ------------------------------------------------- |
| `NUVIX_INTERNAL_DATABASE_DRIVER` | no              | See below             | `postgresql` or `sqlite`                          |
| `NUVIX_INTERNAL_DATABASE_URL`    | PostgreSQL only | —                     | PostgreSQL connection string for platform data    |
| `NUVIX_INTERNAL_DATABASE_FILE`   | no, for SQLite  | `./data/nuvix.sqlite` | SQLite database filename; `:memory:` is for tests |

When the driver is omitted, Nuvix selects PostgreSQL if
`NUVIX_INTERNAL_DATABASE_URL` is set and SQLite otherwise. A minimal instance
therefore needs no PostgreSQL service. Both modes use `@nuvix/db`; optional
features are enabled from adapter capabilities and may be unavailable on
SQLite.

## Tenant databases

Every project database is PostgreSQL 18 provisioned from the
`nuvix/postgres:18.1` image. Its source repository is `nuvix-dev/postgres`.
Tenant targets use the image's `nuvix_admin` schema-administration role and are
platform-owned connection metadata unrelated to
`NUVIX_INTERNAL_DATABASE_DRIVER`. SQLite is supported for the platform/control
plane only.

`NUVIX_SCHEMA_TEST_URL` is test-only. Set it to a `nuvix_admin` connection when
running `apps/server/test/integration/schema-crud.test.ts`; without it, that live
suite is skipped.

## Redis

| Variable          | Required | Description                            |
| ----------------- | -------- | -------------------------------------- |
| `NUVIX_REDIS_URL` | yes      | Redis connection string (queues/cache) |

## Security

Project-facing JWT trust material is tenant-owned and is not configured through
a process-global secret. Tenant signing-key provisioning and rotation are part
of the Phase 4 auth slice.

## Storage

| Variable                | Required | Default             | Description        |
| ----------------------- | -------- | ------------------- | ------------------ |
| `NUVIX_STORAGE_UPLOADS` | no       | `./storage/uploads` | Local uploads root |
