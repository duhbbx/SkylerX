# ClickHouse — manual QA

**Covers**: ClickHouse Cloud + self-hosted, 22.x – 24.x.
**Driver**: `packages/core-driver/src/dialects/clickhouse.ts` (`@clickhouse/client` npm).
**Wire**: HTTP / HTTPS, port 8123 default (or 9000 for native, app uses HTTP).

## Setup

- Branch / commit:
- OS:
- Server: <!-- e.g. clickhouse/clickhouse-server docker, port 8123 -->
- Test DB: `qa_db`

## Connection

- [ ] HTTP host + port + user + password → green toast with version
- [ ] HTTPS (TLS) — works with valid cert
- [ ] HTTPS self-signed — `verify=false` option, fallback works
- [ ] Default DB set → tree expands to it
- [ ] Wrong password → 516 with auth context
- [ ] Wrong host → ECONNREFUSED / ETIMEDOUT < 10s
- [ ] `clickhouse-keeper` / cluster URLs (load-balanced) — verify connect works
- [ ] Evidence:

## Database / schema

- [ ] `CREATE DATABASE qa_db`
- [ ] `CREATE DATABASE qa_db ENGINE = Atomic` (default, supports atomic rename)
- [ ] `CREATE DATABASE qa_replicated ENGINE = Replicated('zk_path', 'shard', 'replica')` (for replicated setups)
- [ ] Tree shows DBs; `system` and `INFORMATION_SCHEMA` separately
- [ ] `DROP DATABASE qa_db`
- [ ] Evidence:

## Tables

ClickHouse mandates an `ENGINE` clause. MergeTree is the canonical engine for analytics.

```sql
CREATE TABLE qa_db.qa_t (
  id           UInt64,
  event_date   Date,
  name         String,
  email        Nullable(String),
  age          UInt8,
  salary       Decimal(15,2),
  bio          String,
  payload      String,           -- JSON stored as string; or use JSON type (experimental)
  is_active    UInt8,
  tags         Array(String),
  metadata     Map(String, String),
  created_at   DateTime64(3, 'UTC'),
  updated_at   DateTime64(3, 'UTC')
) ENGINE = MergeTree()
ORDER BY (id, event_date)
PARTITION BY toYYYYMM(event_date)
SETTINGS index_granularity = 8192;
```

- [ ] Statement runs
- [ ] Tree expand → all types correct, including Nullable wrappers
- [ ] Engine + ORDER BY visible in table metadata
- [ ] Evidence:

### Other engines worth checking
- [ ] `ReplicatedMergeTree('zk', 'replica')` — replicated table
- [ ] `ReplacingMergeTree(version)` — dedup by version on merge
- [ ] `SummingMergeTree(metrics)` — pre-aggregation
- [ ] `AggregatingMergeTree`
- [ ] `Memory` engine — RAM-only, lost on restart
- [ ] `Log`, `TinyLog` — small/simple use
- [ ] `Distributed(cluster, db, table)` — sharding wrapper
- [ ] Each engine: tree shows engine in metadata; DDL gen produces valid recreate

### ALTER
- [ ] `ALTER TABLE qa_t ADD COLUMN phone String`
- [ ] `ALTER TABLE qa_t MODIFY COLUMN phone String DEFAULT ''`
- [ ] `ALTER TABLE qa_t DROP COLUMN phone`
- [ ] `ALTER TABLE qa_t RENAME COLUMN phone TO mobile`
- [ ] `ALTER TABLE qa_t MODIFY ORDER BY (id, event_date, age)` (newer versions)
- [ ] `RENAME TABLE qa_t TO qa_t_v2` (cross-db with Atomic engine)
- [ ] Evidence:

### TRUNCATE / DROP
- [ ] `TRUNCATE TABLE qa_t`
- [ ] `DROP TABLE qa_t SYNC` (force immediate delete vs queued)
- [ ] `DETACH TABLE` then `ATTACH TABLE` for maintenance

## Indexes / projections

- [ ] Primary key index implicit from ORDER BY (skip indexes)
- [ ] Secondary index: `ALTER TABLE qa_t ADD INDEX qa_idx_email email TYPE bloom_filter GRANULARITY 1`
- [ ] Indexes: `set`, `minmax`, `ngrambf_v1`, `tokenbf_v1`, `bloom_filter`
- [ ] Projections (pre-aggregated views): `ALTER TABLE qa_t ADD PROJECTION p1 (SELECT name, count() GROUP BY name)`
- [ ] `ALTER TABLE qa_t MATERIALIZE PROJECTION p1` to build
- [ ] Materialized views (separate from MV in PG sense): `CREATE MATERIALIZED VIEW qa_mv TO qa_t AS SELECT … FROM source`
- [ ] Evidence:

## Views

- [ ] Regular view: `CREATE VIEW qa_v AS SELECT id, name FROM qa_t`
- [ ] Materialized view: see above (CH's MV is more like a trigger that fills another table)
- [ ] Live view (experimental): `CREATE LIVE VIEW`
- [ ] Tree shows views distinctly

## Constraints

ClickHouse constraints are **assertions** checked on INSERT, not relational integrity.

- [ ] `CREATE TABLE … CONSTRAINT chk_age CHECK age >= 0` — INSERT with negative age fails
- [ ] **No FOREIGN KEY** — verify UI doesn't let user define one; if they try, server rejects with clear error
- [ ] **No UNIQUE constraint** in classical sense (use ReplacingMergeTree if needed)
- [ ] Evidence:

## Functions / Stored procedures

- ClickHouse has NO stored procedures.
- Has 1000+ built-in functions (string, array, date, geo, ML, encoding).
- User-defined functions (UDF) via SQL: `CREATE FUNCTION qa_double AS (x) -> x * 2`
- Executable UDF (external command) — out of scope.
- [ ] UDF SQL syntax works
- [ ] Tree shows UDFs

## Triggers

- ClickHouse has NO triggers.
- Materialized views act as "INSERT triggers" — when source gets new data, MV fills.
- Skip section.

## Sequences

- ClickHouse has NO sequences.
- Use `generateUUIDv4()`, `now64()`, or external service for unique IDs.
- Skip section.

## Users · Roles · Grants (SQL-driven, 22.3+)

```sql
CREATE USER qa_user IDENTIFIED WITH plaintext_password BY 'Pass!2026';
CREATE ROLE qa_role;
GRANT SELECT, INSERT ON qa_db.qa_t TO qa_role;
GRANT qa_role TO qa_user;
SET ROLE qa_role;
```

- [ ] All execute
- [ ] User visible in `system.users`
- [ ] Row policies: `CREATE ROW POLICY pol1 ON qa_db.qa_t USING age >= 18 TO qa_user`
- [ ] Settings profiles: `CREATE SETTINGS PROFILE …`
- [ ] Quotas: `CREATE QUOTA … FOR INTERVAL 1 HOUR …`
- [ ] `DROP USER`, `DROP ROLE`
- [ ] Evidence:

## DML / Query

### INSERT
- [ ] Single row, multi-row
- [ ] `INSERT INTO qa_t FORMAT JSONEachRow` with body — verify the FORMAT directive is sent correctly
- [ ] `INSERT INTO qa_t SELECT … FROM source` (cross-table)
- [ ] Bulk INSERT — must be wrapped in single insert (each separate INSERT becomes a part to merge)
- [ ] App should batch single-row INSERTs into one statement to avoid part explosion
- [ ] Evidence:

### UPDATE / DELETE (ClickHouse mutations)

ClickHouse UPDATE / DELETE are ASYNCHRONOUS "mutations" — they don't return affected rows immediately.

```sql
ALTER TABLE qa_t UPDATE name = 'X' WHERE id = 1;     -- mutation
ALTER TABLE qa_t DELETE WHERE event_date < '2025-01-01';
```

- [ ] UPDATE syntax = `ALTER TABLE … UPDATE … WHERE …`
- [ ] DELETE syntax = `ALTER TABLE … DELETE WHERE …`
- [ ] After mutation, `system.mutations` table shows progress
- [ ] App's result toast should clarify "mutation queued, may not be visible immediately"
- [ ] Modern lightweight DELETE (22.8+): `DELETE FROM qa_t WHERE …` (still eventual)
- [ ] Evidence:

### SELECT — query shapes
- [ ] JOIN: INNER, LEFT, RIGHT, FULL, CROSS, ASOF, SEMI, ANTI (ClickHouse has many)
- [ ] Subqueries (correlated supported in newer CH)
- [ ] CTE: `WITH …`
- [ ] Window functions
- [ ] GROUP BY + HAVING
- [ ] LIMIT … OFFSET … BY (per-group LIMIT)
- [ ] `LIMIT 10 BY name` — top 10 per name
- [ ] UNION ALL only (no UNION distinct historically; verify if added)
- [ ] `WITH FILL` clause for gap-filling
- [ ] Array functions: `arrayMap`, `arrayFilter`, `arrayReduce`, `arrayJoin` (UNNEST)
- [ ] JSON: `JSONExtractString`, `JSONExtractInt`, `simpleJSONExtract*`
- [ ] FORMAT clause: `SELECT … FORMAT JSON` / `FORMAT TabSeparated`
- [ ] FINAL keyword for ReplacingMergeTree: `SELECT * FROM qa_t FINAL`
- [ ] SAMPLE: `SELECT … FROM qa_t SAMPLE 0.1`
- [ ] Evidence:

### Engine-specific
- [ ] ReplacingMergeTree: insert duplicate ID with newer version → after merge / FINAL, only newest visible
- [ ] SummingMergeTree: insert multiple rows same key → after merge, summed
- [ ] AggregatingMergeTree with aggregate functions: AggregateFunction(sum, Int64)

## Transactions

- ClickHouse does NOT support multi-statement transactions.
- Single INSERT is atomic per part.
- **Manual-commit mode UI must be DISABLED for ClickHouse connections** — verify
- If exposed, server returns clear error
- Skip TX section in scope checks

## Dialect-specific quirks

### Settings (per-query overrides)
- [ ] `SELECT … SETTINGS max_threads=1` — works
- [ ] App's slow-query analyzer should NOT enable expensive settings by default

### Distributed queries
- [ ] On `Distributed(cluster, db, table)` table → query auto-fanned to shards
- [ ] `system.clusters` view shows topology
- [ ] EXPLAIN over distributed → per-shard plan visible

### Async inserts
- [ ] `INSERT INTO qa_t SETTINGS async_insert=1, wait_for_async_insert=1 VALUES …` — batches small inserts server-side
- [ ] App documentation should mention for high-throughput use

### Compression
- [ ] Each column can have codec: `name String CODEC(ZSTD(3))`
- [ ] DDL gen captures codecs

### TTL
- [ ] `TTL event_date + INTERVAL 30 DAY DELETE` clause on table — old rows auto-deleted
- [ ] Tree shows TTL in metadata

## Cross-platform

- [ ] @clickhouse/client is pure JS, no native — runs identically on all OS
- [ ] Compression handlers (lz4, zstd) work
- [ ] Evidence:

## Known limitations

- No FK, no UNIQUE, no traditional ACID — by design (analytical workload)
- Mutations are eventual — UPDATE/DELETE finish asynchronously
- Manual-commit mode unavailable
- Async inserts use a buffer; if server crashes, in-flight data may be lost (verify by killing CH mid-insert)
- Settings page should expose `async_insert` toggle eventually
- Cluster setups need ZooKeeper / ClickHouse Keeper — out of scope for app's responsibility
