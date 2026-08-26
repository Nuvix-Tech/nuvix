# Environment Variables — Nuvix v2

> Copy these into a local `.env` file (never committed). Generate secrets with
> `openssl rand -hex 32`.

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

| Variable           | Required | Description                                                          |
| ------------------ | -------- | -------------------------------------------------------------------- |
| `NUVIX_JWT_SECRET` | yes      | Secret used to sign JWTs/tokens. **Set a real value in production.** |

## Storage

| Variable                | Required | Default             | Description        |
| ----------------------- | -------- | ------------------- | ------------------ |
| `NUVIX_STORAGE_UPLOADS` | no       | `./storage/uploads` | Local uploads root |
