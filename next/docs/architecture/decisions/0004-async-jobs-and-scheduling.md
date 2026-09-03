# ADR 0004: Async Jobs, Event Bus, and Scheduling

## Context

In Nuvix v1, background work relied on `@nestjs/schedule` for periodic cron loops,
NestJS `@Processor` / `@nestjs/bullmq` decorators for queue workers, and ad-hoc
event handling. In Nuvix v2 (Bun-native rewrite, D22, D4), we adopt:
1. **`Bun.cron` native scheduling**: Replaces external cron loops and `@nestjs/schedule`
   with zero dependencies and direct process lifecycle integration (`stop()`, `ref()`, `unref()`).
2. **In-process Typed Event Bus**: Standardized asynchronous decoupling between domain
   mutations (e.g. `users.create`, `storage.objects.upload`) and listeners (webhooks,
   metrics, cascade workers) with wildcard matching and ReDoS protection.
3. **Batch Queues**: Resilient, memory-bounded, time-interval-flushed batch buffers
   for high-throughput audit logging, API access logging with automatic sensitive key redaction,
   and usage metrics aggregation.
4. **Async Cascade Workers**: Asynchronous cleanup for heavy cascade operations
   (deleting storage objects in a bucket, purging user sessions/memberships, session pruning).

## Decision

### 1. Typed Event Bus (`events/bus.ts`)
- `EventBus` provides `emit(event, payload)` and `on(pattern, listener)`.
- Wildcard subscriptions (`*`, `users.*`, `storage.buckets.*`) use size-bounded
  RegExp caching to prevent memory leaks and ReDoS.
- Event handlers are executed asynchronously with error isolation: a failure in
  one listener never crashes the caller or prevents other listeners from executing.

### 2. Cron Scheduler (`scheduler/cron.ts`, D22)
- Built directly on Bun 1.4's native `Bun.cron(schedule, callback)`.
- Implements `CronScheduler` with job registration, status listing, manual triggers,
  and clean teardown via `stop()`.
- Standard scheduled jobs:
  - `sessions.prune`: Runs hourly to clean expired sessions.
  - `schedules.dispatch`: Runs every minute to trigger scheduled tasks.
  - `audits.prune`: Runs daily to enforce audit retention limits.
  - `stats.rollup`: Runs hourly to aggregate usage metrics.

### 3. Batch Buffering Architecture (`queues/batch.ts`)
- `BatchQueue<T>` provides bounded queuing:
  - Buffer flushes when reaching `batchSize` or after `batchIntervalMs` idle.
  - Lifecycle hook `flush()` runs on application graceful shutdown.
  - Failure to persist preserves the buffer (or reports backpressure) without unhandled rejection.
- Implementations:
  - `AuditsBatchQueue`: Buffers and writes audit records to tenant audit tables.
  - `ApiLogsBatchQueue`: Buffers HTTP access logs, redacting sensitive keys (`token`, `secret`, `authorization`, `x-nuvix-*`).
  - `StatsBatchQueue`: Aggregates metrics (hourly/daily) before atomic upsert.

### 4. Background Deletes Worker (`queues/deletes.ts`)
- Handles asynchronous deletion of buckets, cascade document cleanups, and expired target prunings.
