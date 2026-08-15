# Log Ingestion and Query Service

High-throughput TypeScript service for ingesting, querying, aggregating, and retaining structured application logs.

The service is intentionally small and operationally focused:

- Fastify handles HTTP and route-level authentication.
- PostgreSQL is the source of truth.
- Binary PostgreSQL `COPY` is used for ingestion.
- One dedicated PostgreSQL client writes data.
- A four-connection read pool serves queries and retention work.
- The total PostgreSQL application connection budget is exactly five.
- Query and persistence code is separated from HTTP handlers.

## Contents

- [Setup Instructions](#setup-instructions)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
- [Architecture and Data Flow](#architecture-and-data-flow)
- [Schema Design](#schema-design)
- [Index Design](#index-design)
- [Attribute Storage Strategy](#attribute-storage-strategy)
- [Retention Strategy](#retention-strategy)
- [Authentication and Optional Features](#authentication-and-optional-features)
- [Load-Test Methodology](#load-test-methodology)
- [Measured Performance Results](#measured-performance-results)
- [Verification and CI](#verification-and-ci)
- [Known Limitations](#known-limitations)

## Setup Instructions

### Zero-Configuration Docker Run

The default development setup requires no `.env` file, seed script, or manual migration command:

```bash
docker compose up --build
```

The command creates PostgreSQL and the application, connects them through the internal Compose hostname `postgres`, waits for PostgreSQL health, applies migrations automatically, and starts the HTTP server on `http://localhost:8080`.

The development fallback database URL is internal:

```text
postgresql://logs_user:logs_password@postgres:5432/logs_db
```

This is a local development fallback, not an external database link. Runtime configuration accepts valid `postgres://` and `postgresql://` URLs; the Compose fallback simply points to the internal `postgres` service.

### Optional Environment File

`.env` is optional for the default development run. `.env.example` documents the available values and is safe to commit because it contains placeholders and local development defaults only. The real `.env` file is ignored by Git.

```powershell
Copy-Item .env.example .env
docker compose up --build
```

The PostgreSQL password and `DATABASE_URL` must match when a custom password is used. Never commit production credentials, API keys, or purge tokens.

### Stop and Reset

```bash
docker compose down
```

To remove the PostgreSQL volume and all stored logs:

```bash
docker compose down -v
```

The second command is destructive and is intended only for disposable development or benchmark data.

### Local Quality Commands

```bash
npm ci
npm test -- --runInBand
npx tsc --noEmit
npm run lint
npm run build
```

For local non-Docker execution, PostgreSQL must already be reachable using a valid PostgreSQL `DATABASE_URL`. Docker Compose is the supported zero-configuration path.

## Project Structure

```text
src/
  api/
    auth.ts                 Route authentication and failed-auth limiting
    handlers/               HTTP request/response adapters
    routes/                 Route registration and scope assignment
  db/
    config.ts               Shared PostgreSQL client configuration
    defaults.ts             Internal development database default
    migrate.ts              Startup migration runner
    migrations/             Committed SQL migrations
    pool.ts                 Four-connection read pool
    schema.ts               Drizzle schema and index declarations
    writer.ts               One dedicated PostgreSQL writer client
  repositories/             SQL construction and database access
    copy/                   Binary COPY encoding and retry boundary
  services/                 Validation, ingestion, queries, aggregation,
                            retention, and write coordination
  types/                    Shared TypeScript API and domain types
scripts/                    Load, seed, query, aggregate, and contract tools
tests/                      Unit and HTTP-level tests
docker-compose.yml          PostgreSQL and application containers
Dockerfile                  Build, migration, and startup sequence
drizzle.config.ts           Migration generation configuration
.github/workflows/ci.yml    Quality and authenticated contract CI
```

Drizzle is used for schema declarations and migration tooling. Runtime repositories use parameterized `pg` queries and Binary COPY directly, keeping the hot ingestion path explicit and efficient.

## API Documentation

All JSON responses use `Content-Type: application/json`.

### `GET /health`

Returns application readiness based on the dedicated writer connection.

```json
{
  "status": "ok"
}
```

The endpoint returns `200` when the writer is ready and `503` with `{ "status": "unavailable" }` otherwise. When authentication is enabled, it requires the configured API key.

### `POST /logs`

The body must contain a non-empty `logs` array:

```json
{
  "logs": [
    {
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": {
        "user_id": "42",
        "retry_count": 2,
        "card_present": false
      }
    }
  ]
}
```

| Field | Type and rules |
| --- | --- |
| `timestamp` | ISO datetime with timezone; at most five minutes in the future |
| `level` | `debug`, `info`, `warn`, or `error` |
| `service` | Non-empty string |
| `message` | Non-empty string |
| `attributes` | Optional flat object; values must be string, number, or boolean |

The database generates the unique `id`. The API represents it as a string because PostgreSQL uses `BIGINT`.

Successful response:

```json
{
  "accepted": 1,
  "rejected": []
}
```

Invalid items are reported by their original array index while valid items can still be persisted:

```json
{
  "accepted": 1,
  "rejected": [
    {
      "index": 1,
      "reason": "invalid level: 'critical'"
    }
  ]
}
```

An invalid body returns `400` and `{ "error": "Invalid request body" }`. A request in which every item is invalid also returns `400` with the `accepted` and `rejected` result.

### `GET /logs`

Returns logs in descending `(timestamp, id)` order using keyset pagination.

```bash
curl "http://localhost:8080/logs?service=checkout&level=error&limit=100"
```

Response:

```json
{
  "logs": [
    {
      "id": "123456",
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": {
        "user_id": "42"
      }
    }
  ],
  "next_cursor": "eyJ2IjoxLCJ0aW1lc3RhbXAiOi..."
}
```

`next_cursor` is `null` when no more rows exist.

Supported query parameters:

| Parameter | Meaning |
| --- | --- |
| `service` | Exact service match |
| `level` | Exact level match |
| `since` | Inclusive ISO timestamp lower bound |
| `until` | Exclusive ISO timestamp upper bound |
| `q` | Case-insensitive message substring search |
| `limit` | Number of rows; default `100`, maximum `1000` |
| `cursor` | Opaque cursor returned by the previous page |
| `attr.<key>` | Exact attribute value filter; repeated values are supported |

When both timestamps are provided, `until` must be greater than `since`. Cursors encode the last row's timestamp and ID and are validated before entering SQL.

### `GET /logs/aggregate`

Returns non-empty time buckets in ascending bucket-start order.

Required parameters:

| Parameter | Allowed values |
| --- | --- |
| `since` | ISO timestamp |
| `until` | ISO timestamp greater than `since` |
| `bucket` | `1m`, `5m`, `1h`, or `1d` |

Optional parameters are `group_by` (`service` or `level`), `service`, `level`, `q`, and `attr.<key>`.

```bash
curl "http://localhost:8080/logs/aggregate?since=2026-07-20T00:00:00Z&until=2026-07-21T00:00:00Z&bucket=1h&group_by=service"
```

Grouped response:

```json
{
  "buckets": [
    {
      "start": "2026-07-20T14:00:00.000Z",
      "group": "checkout",
      "count": 118
    },
    {
      "start": "2026-07-20T14:00:00.000Z",
      "group": "auth",
      "count": 42
    }
  ]
}
```

Without `group_by`, `group` is always `null`. Empty buckets are omitted. A valid range with no matching rows returns `{ "buckets": [] }`.

### `DELETE /logs`

This optional administrative route is registered only when `LOGS_PURGE_TOKEN` is configured. It truncates the `logs` table and restarts the identity sequence.

```bash
curl -X DELETE \
  -H "X-Logs-Purge-Token: <token>" \
  http://localhost:8080/logs
```

Success is `{ "truncated": true }`; missing or invalid tokens return `401 Unauthorized`.

### Error Responses

The real application error handler returns:

```json
{
  "error": "Detailed error message"
}
```

Invalid query parameters return `400 Bad Request`, including invalid dates, an invalid level, an invalid limit, an invalid cursor, unsupported parameters, or `until` before `since`.

Authentication errors use `401` for missing/invalid credentials, `403` for insufficient scope, and `429` for a failed-auth rate-limit hit with `Retry-After`.

## Architecture and Data Flow

### Ingestion Flow

```text
POST /logs
  -> body shape check
  -> per-log validation
  -> request batches of valid logs
  -> bounded WriteCoordinator
  -> coalescing up to 15,000 logs
  -> Binary COPY serialization
  -> dedicated PostgreSQL writer client
  -> resolve request promises after COPY succeeds
```

Invalid logs do not enter the coordinator. A COPY failure rejects every request whose logs were part of that COPY operation; those logs are not reported as accepted.

The coordinator applies backpressure through a maximum pending-log capacity of 30,000. Requests that do not fit wait in bounded capacity waiters rather than causing unbounded memory growth.

### Query Flow

```text
HTTP GET
  -> strict parameter parser
  -> typed query object
  -> repository builds parameterized SQL
  -> read pool query
  -> database rows mapped to API response types
```

Dynamic SQL identifiers are allow-listed. User-provided values are always SQL parameters; arbitrary SQL fragments are never accepted.

### Connection Model

```text
1 dedicated writer client
4-connection read pool
total application connections = 5
```

The writer is used by Binary COPY. `GET /logs`, `GET /logs/aggregate`, and retention queries use the read pool. The pool split is an internal invariant: one writer plus four readers, for exactly five application connections. It is not exposed as a runtime environment variable.

## Schema Design

The `logs` table is defined in `src/db/schema.ts` and the committed initial migration.

| Column | PostgreSQL type | Rules |
| --- | --- | --- |
| `id` | `bigint` | Primary key, generated identity |
| `timestamp` | `timestamptz` | Required |
| `level` | `text` | Required; check constraint allows `debug`, `info`, `warn`, `error` |
| `service` | `text` | Required |
| `message` | `text` | Required |
| `attributes` | `jsonb` | Required; defaults to `{}` |

The database generates a monotonically increasing unique ID. The API serializes it as a string to preserve the full PostgreSQL 64-bit range in JavaScript. The public contract requires a unique ID, not specifically a UUID.

Migrations are committed under `src/db/migrations`. The Dockerfile runs `node dist/src/db/migrate.js` before starting the application.

## Index Design

| Index | Query pattern |
| --- | --- |
| `logs_timestamp_id_idx (timestamp, id)` | Time ordering, keyset pagination, time-range scans |
| `logs_service_timestamp_id_idx (service, timestamp, id)` | Service plus time filtering and ordering |
| `logs_level_timestamp_id_idx (level, timestamp, id)` | Level plus time filtering and ordering |
| `logs_service_level_timestamp_idx (service, level, timestamp, id)` | Combined service/level/time filtering |
| `logs_attributes_gin_idx USING GIN (attributes)` | JSONB attribute candidate filtering |
| `logs_message_trgm_idx USING GIN (message gin_trgm_ops)` | Case-insensitive message substring search |

The aggregate query uses PostgreSQL `date_bin` for bucket calculation and orders by bucket start ascending. The optimized primary plan used an index-only scan, a small hash aggregate, no disk spill, and a small final sort.

No schema, index, or PostgreSQL configuration change is part of the current final benchmark result.

## Attribute Storage Strategy

Attributes are stored in one PostgreSQL `JSONB` column because log attributes are semi-structured and vary between services. The validator accepts only a flat object with scalar values:

```text
string | number | boolean
```

Nested objects, arrays, `null`, and other values are rejected. An omitted `attributes` field becomes `{}`.

For `attr.<key>=<value>` filters, the repository uses JSONB containment expressions so the GIN index can narrow candidates, recognizes string/numeric/boolean values, and then applies `attributes ->> key = value` for the API's exact string-comparison behavior.

There is no separate relational attribute table and no per-key migration requirement.

## Retention Strategy

Retention starts automatically with the application. Defaults are:

```text
retention age:       30 days
run interval:        1 hour
delete batch size:   1,000 rows
pause between batch: 25 ms
maximum batches/run: 100
```

Each batch selects the oldest expired IDs in timestamp and ID order, limits the selection, deletes by ID in the same statement, and pauses before the next full batch. This bounds transaction size and avoids one unbounded delete transaction.

A default run can delete at most 100,000 rows. Runs are single-flight, and shutdown stops the timer, requests the runner to stop, and waits for an active run to finish. Retention uses the read pool and is not a separate connection pool.

## Authentication and Optional Features

Authentication is disabled by default:

```text
AUTH_ENABLED=false
```

When enabled:

- `LOADGEN_API_KEY` is required at startup.
- The configured key has full `ingest` and `query` scope.
- `Authorization: Bearer <key>` and `X-API-Key: <key>` are accepted.
- Missing or invalid credentials return `401`.
- A credential without a required scope returns `403`.
- Ten failed authentication attempts per client IP within one minute are allowed; subsequent failures return `429` and `Retry-After`.
- When disabled, incoming authorization headers are ignored and do not reject requests.

The failed-auth limiter is in-memory and per application process. It is not a distributed or general request rate limiter.

The optional purge endpoint is enabled only when `LOGS_PURGE_TOKEN` is non-empty. Identical aggregate queries use a bounded 100-entry, five-second in-memory result cache. This keeps repeated aggregation from monopolizing the single PostgreSQL CPU while keeping cache staleness below the 20-second freshness requirement. The current project does not implement dashboard UI, webhook alerting, live-tail, rollup tables, a custom query language, multi-tenancy, compression, or a durable dead-letter queue.

## Configuration Variables

### Application Runtime Variables

| Variable | Default | Rules / purpose |
| --- | --- | --- |
| `DATABASE_URL` | Internal development URL | Production requires it explicitly; must use a `postgres://` or `postgresql://` URL |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `PORT` | `8080` | Integer from `1` to `65535` |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent` |
| `BODY_LIMIT_BYTES` | `10485760` | Maximum request body size; positive integer |
| `PG_CONNECTION_TIMEOUT_MS` | `5000` | PostgreSQL connection timeout |
| `PG_IDLE_TIMEOUT_MS` | `30000` | PostgreSQL idle client timeout; `0` is allowed |
| `INSERT_BATCH_SIZE` | `1000` | Per-request validation/persistence batch; `1` to `5000` |
| `COPY_SERIALIZE_CHUNK_SIZE` | `2000` | Binary COPY serialization chunk; `1` to `5000` |
| `RETENTION_DAYS` | `30` | Positive retention age in days |
| `LOGS_PURGE_TOKEN` | unset | Registers optional purge route when non-empty |
| `AUTH_ENABLED` | `false` | Enables route authentication when `true` |
| `LOADGEN_API_KEY` | unset | Required when `AUTH_ENABLED=true` |

### Docker Compose Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | `logs_password` | Local PostgreSQL password |
| `NODE_ENV` | `development` | Application environment |
| `DATABASE_URL` | Empty Compose value | Development runtime resolves the internal fallback |
| `AUTH_ENABLED` | `false` | Compose authentication toggle |
| `LOADGEN_API_KEY` | Empty | Compose API key value |

### Benchmark-Only Variables

| Variable | Default | Script |
| --- | --- | --- |
| `LOAD_TEST_RATE` | `15000` | `scripts/load-test.js` |
| `LOAD_TEST_DURATION` | `60` | `scripts/load-test.js` |
| `LOAD_TEST_BATCH_SIZE` | `1000` | `scripts/load-test.js` |
| `LOAD_TEST_MAX_IN_FLIGHT` | `30` | `scripts/load-test.js` |
| `LOAD_TEST_DRAIN_TIMEOUT_SECONDS` | `30` | `scripts/load-test.js` |
| `QUERY_SEED_COUNT` | `100000` | `scripts/seed-query-dataset.js` |
| `QUERY_SEED_BATCH_SIZE` | `1000` | `scripts/seed-query-dataset.js` |
| `QUERY_BENCHMARK_REQUESTS` | `30` | `scripts/query-benchmark.js` |
| `AGGREGATE_BENCHMARK_REQUESTS` | `5` | `scripts/aggregate-benchmark.js` |

Retention interval, delete batch size, pause, and maximum batches are currently code defaults rather than environment variables.

## Load-Test Methodology

### Official Acceptance Workload

The current official measurement used Docker Compose, the current working tree, one dedicated writer, four read connections, and the configured resource limits:

```text
starting rows:       exactly 1,000,000
POST duration:       60 seconds
POST target:         15,000 logs/sec
HTTP batch size:     1,000 logs/request
dispatch rate:       15 requests/sec
MAX_IN_FLIGHT:       30
primary aggregate:   last hour / 1-minute buckets
aggregate rate:      1 request/sec
aggregate duration:  60 requests
GET /logs:           not included
wide aggregate:      not included
additional shapes:   not included
```

The row count was verified directly with PostgreSQL before the run. The ingestion generator records sent, accepted, rejected, failed, skipped, throughput, completion throughput, and successful-request p50/p95/p99. The aggregate loop records request count, completions, failures, and p50/p95/p99.

No pool, schema, index, SQL, Docker resource, or PostgreSQL configuration change was made during the measurement.

### Reproducing the Workload

```bash
docker compose up -d --build
curl http://localhost:8080/health
docker exec logs_postgres psql -U logs_user -d logs_db -tAc "SELECT count(*) FROM logs;"
```

For a disposable database, seed one million rows:

```bash
QUERY_SEED_COUNT=1000000 node scripts/seed-query-dataset.js
```

Run the ingestion generator:

```bash
npm run load:test
```

With no override, this command targets the required `15,000 logs/sec`. The script itself
generates POST traffic only. The documented concurrent ceiling result also ran
the primary `last hour / 1m` aggregate at one request per second.

The packaged `benchmark:aggregate` script is a representative multi-shape benchmark and is not the official acceptance workload. The official primary aggregate must be run concurrently as a one-request-per-second `last hour / 1m` loop.

### Representative Benchmarks

```bash
npm run benchmark:query
npm run benchmark:aggregate
npm run benchmark:mixed
```

The query benchmark sends 30 samples per shape. The aggregate benchmark sends five samples per shape at one request per second. Five-sample p95/p99 values are directional, not stable production SLO measurements. The mixed benchmark includes representative GET traffic, primary aggregation, and occasional wide aggregation and is a stress/diagnostic workload.

### Resource Measurement

During the official run, Docker stats were sampled once per second:

```bash
docker stats --no-stream
```

Reported resource values are sampled peaks, not guaranteed instantaneous maxima between samples.

## Measured Performance Results

These results were measured against the current working tree using Docker Compose, one dedicated writer, four read connections, and the resource limits in the Compose file. The official baseline used one million starting rows; the higher-throughput ceiling benchmark started from a clean truncate and grew to 1.26 million rows.

### Official Acceptance Result

| Metric | Result |
| --- | ---: |
| Starting rows | 1,000,000 |
| Sent | 900,000 |
| Accepted | 900,000 |
| Rejected | 0 |
| Failed | 0 |
| Skipped batches | 0 |
| Throughput | 15,000 logs/sec |
| Completion throughput | 14,998 logs/sec |
| POST p50 | 51.85 ms |
| POST p95 | 230.95 ms |
| POST p99 | 876.54 ms |
| Aggregate requests | 60 |
| Aggregate completed | 60 |
| Aggregate failures | 0 |
| Primary aggregate p50 | 12.69 ms |
| Primary aggregate p95 | 23.13 ms |
| Primary aggregate p99 | 1,400.18 ms |

The load generator finished with `inFlight=0` and `drained=true`.

### Historical Clean-Start 21,000 Logs/Second Ceiling

This earlier controlled benchmark used a 4,000-log COPY target and is retained
as clean-start ceiling evidence, not as the official one-million-row acceptance
result for the current 15,000-log target. The database was truncated before each run. POST ingestion ran concurrently
with the primary `last hour / 1m` aggregate at one request per second. The
architecture remained one Binary COPY writer plus four read connections, for
five total application PostgreSQL connections. That experiment used
a 3ms coalescing delay, a 4,000-log COPY target, 2,000-log serialization chunks,
and a 20,000-value identity sequence cache.

| Metric | Result |
| --- | ---: |
| Starting rows | 0 after truncate |
| Target | 21,000 logs/sec |
| Duration | 60 seconds |
| HTTP batch size | 1,000 logs/request |
| MAX_IN_FLIGHT | 30 |
| Sent | 1,260,000 |
| Accepted | 1,260,000 |
| Rejected | 0 |
| Failed | 0 |
| Skipped batches | 0 |
| Throughput | 21,000 logs/sec |
| Completion throughput | 20,958–20,998 logs/sec |
| POST p50 | 73.14–74.40 ms |
| POST p95 | 282.99–310.82 ms |
| POST p99 | 408.95–520.68 ms |
| Aggregate requests/completed | 60 / 60 |
| Aggregate failures | 0 |
| Aggregate p50 | 3.85–4.29 ms |
| Aggregate p95 | 408.35–505.52 ms |
| Aggregate p99 | 574.20–640.64 ms |

Both repeated runs completed with `inFlight=0`, `drained=true`, zero rejected
logs, zero failed requests, and zero skipped batches. A separate fresh-Docker
verification also reached 21,000 logs/sec with no skipped work.

### Resource Result

Configured limits:

```text
Application: 0.5 CPU, 256 MB RAM
PostgreSQL:  1 CPU, 1 GB RAM
```

Observed one-second Docker stats peaks during the official run:

| Container | Peak CPU sample | Peak memory sample |
| --- | ---: | ---: |
| `logs_app` | 25.61% | 32.35 MiB |
| `logs_postgres` | 99.54% | 489.4 MiB |

### Representative Result

| Query | Samples | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| `GET /logs` combined filters | 30 | 256.61 ms | 403.66 ms | 2,901.81 ms |
| Aggregate last hour / 1m | 5 | 5.84 ms | 120.27 ms | 120.27 ms |
| Aggregate wide / 1d | 5 | 296.65 ms | 356.00 ms | 356.00 ms |
| Aggregate message search | 5 | 131.86 ms | 136.33 ms | 136.33 ms |

All 240 representative GET requests and all 55 representative aggregate requests completed successfully. The combined GET p99 includes a measured outlier. The aggregate values use only five samples per shape.

## Bottlenecks and Optimizations

### Bottlenecks Discovered

1. A shared five-connection pool allowed Binary COPY to occupy connections needed by reads, causing connection acquisition delay and poor read tail latency.
2. PostgreSQL CPU contention became the main resource signal during concurrent ingestion and reads. A healthy standalone query plan did not remove system-wide queueing.
3. PostgreSQL reached a 99.54% Docker CPU sample in the current official run while application CPU stayed much lower.
4. The primary aggregate plan itself was healthy: index-only scan, small hash aggregate, no disk spill, and a small final sort.
5. The combined representative `GET /logs` query has a high p99 outlier and deserves a larger-sample investigation before it is treated as an SLO failure.
6. Identity sequence `CACHE 1`, frequent insert-triggered vacuum/analyze work, and parallel aggregate workers created periodic latency cliffs even when average CPU looked acceptable.
7. A historical clean-start 21,000 logs/sec configuration passed two consecutive concurrent runs, but the official acceptance claim uses one million starting rows and 15,000 logs/sec.

### Optimizations Applied

- Binary PostgreSQL COPY instead of one SQL INSERT per log.
- One dedicated writer client plus a four-connection read pool; total application connections remain exactly five.
- Bounded write coordinator with a 15,000-log target batch, 30,000-log pending capacity, a 3ms flush delay, and request coalescing.
- Identity sequence caching in 20,000-value blocks to remove per-row sequence WAL/locking overhead; IDs remain unique but may contain gaps after restart.
- Append-only table maintenance thresholds that avoid repeated vacuum/analyze interruptions during sustained ingestion while preserving automatic maintenance for larger changes.
- Read sessions disable PostgreSQL parallel gather workers because the database container has one CPU; the primary aggregate became faster and stopped competing through extra workers.
- Bounded five-second aggregate result caching with failed-query eviction and in-flight request coalescing.
- Request promises resolve only after the COPY containing their logs succeeds.
- Keyset pagination using `(timestamp, id)` instead of offset pagination.
- Parameterized SQL values and allow-listed dynamic grouping columns.
- PostgreSQL `date_bin` aggregation with ascending bucket ordering and omitted empty buckets.
- B-tree indexes aligned with timestamp, service, level, and combined filters.
- GIN JSONB index and trigram message index for supported search patterns.
- Batched retention deletes with pauses and a per-run batch cap.
- Optional API-key authentication with constant-time comparison.
- Failed-auth rate limiting with `Retry-After`; successful ingestion requests are not rate-limited by this mechanism.

The rejected two-writer experiment is not part of the current architecture.

## Verification and CI

Local verification:

```bash
npm test -- --runInBand
npx tsc --noEmit
npm run lint
npm run build
docker compose config
```

GitHub Actions runs `npm ci`, ESLint, TypeScript type-checking, Jest, the production build, and the required contract smoke test in both authentication configurations.

The unauthenticated contract starts with `AUTH_ENABLED=false` and checks all four required endpoints without credentials. The authenticated contract starts with `AUTH_ENABLED=true` and a `LOADGEN_API_KEY`, checks that missing credentials return `401`, and checks that the seeded bearer key reaches all four endpoints.

The application image applies migrations automatically, so CI does not require a manual migration step before the contract smoke tests.

## Known Limitations

The current project does not implement:

- Dashboard or browser UI for viewing and filtering logs.
- Persistent operational metrics such as Prometheus `/metrics`.
- Alerting rules or webhook delivery.
- Live-tail through WebSocket or Server-Sent Events.
- Pre-aggregated rollup tables or a materialized rollup pipeline.
- A custom query language; filtering uses documented query parameters.
- Multi-tenancy or tenant-specific API-key data isolation. The configured key is global to the application.
- Storage compression or response compression.
- A durable dead-letter queue. Failed COPY requests are rejected and must be retried by the caller.
- A distributed or general request rate limiter. Rate limiting covers failed authentication attempts in one process only.
- Prometheus, OpenTelemetry, distributed tracing, pool-wait metrics, or long-term latency time series.
- Time partitioning. Retention is batch deletion and can still create table/index maintenance work.
- An explicit maximum aggregate bucket count beyond the requested range and bucket size.
- UUID IDs. The current public ID is a stringified PostgreSQL `BIGINT`.
- Identical aggregate responses can be up to five seconds stale because of the bounded in-memory cache. The cache is per process and is lost on restart.
- Identity values can skip up to a cached block after a crash or restart; API ordering and uniqueness do not depend on contiguous IDs.

Representative benchmarks use small samples and should not be used as production SLO evidence without longer, repeated runs.
