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

## Redis

| Variable          | Required | Description                            |
| ----------------- | -------- | -------------------------------------- |
| `NUVIX_REDIS_URL` | yes      | Redis connection string (queues/cache) |

## Security

| Variable           | Required | Description                                                          |
| ------------------ | -------- | -------------------------------------------------------------------- |
| `NUVIX_JWT_SECRET` | yes      | Secret used to sign JWTs/tokens. **Set a real value in production.** |

## Storage

| Variable                | Required | Default             | Description        |
| ----------------------- | -------- | ------------------- | ------------------ |
| `NUVIX_STORAGE_UPLOADS` | no       | `./storage/uploads` | Local uploads root |
