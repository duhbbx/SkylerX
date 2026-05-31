# Apache Doris / StarRocks — manual QA

**Covers**: Apache Doris 2.x, StarRocks 3.x (both real-time OLAP, MySQL wire compatible).
**Driver**: `packages/core-driver/src/dialects/mysql.ts` (mysql2, shared with MySQL family).
**Wire**: MySQL protocol, port 9030 (Doris FE) / 9030 (StarRocks FE) default.

> They share much syntax but differ on:
> - **Doris**: DISTRIBUTED BY (HASH/RANDOM), partition by RANGE/LIST, Unique / Aggregate / Duplicate keys models
> - **StarRocks**: similar models, with newer Primary Key model, no Unique model name

## Setup

- Branch / commit:
- OS:
- Server (specify which): <!-- Doris 2.x / StarRocks 3.x -->
- Test DB: `qa_db`

## Connection

- [ ] MySQL protocol — uses port 9030 (FE) not 3306
- [ ] User + password + host + port → connects
- [ ] Wrong port (e.g. BE port 8060) → ETIMEDOUT or specific error
- [ ] Cluster setup: multiple FE nodes; can connect to any, will route
- [ ] Wrong credentials → MySQL-protocol auth error
- [ ] Evidence:

## Database / schema

- [ ] `CREATE DATABASE qa_db` (no `CHARACTER SET` clause; defaults to UTF-8)
- [ ] `USE qa_db`
- [ ] Tree shows DBs
- [ ] `DROP DATABASE qa_db`

## Tables — key models

### Aggregate model (Doris)
```sql
CREATE TABLE qa_agg (
  user_id     BIGINT,
  date        DATE,
  city        VARCHAR(50),
  age         INT REPLACE,
  pv          BIGINT SUM,
  uv          BIGINT MAX,
  last_visit  DATETIME REPLACE
)
ENGINE=OLAP
AGGREGATE KEY(user_id, date, city)
DISTRIBUTED BY HASH(user_id) BUCKETS 10;
```

### Unique model (Doris / StarRocks Primary Key)
```sql
CREATE TABLE qa_unique (
  user_id     BIGINT,
  username    VARCHAR(64),
  email       VARCHAR(255),
  updated_at  DATETIME
)
ENGINE=OLAP
UNIQUE KEY(user_id)             -- Doris
-- PRIMARY KEY(user_id)         -- StarRocks
DISTRIBUTED BY HASH(user_id) BUCKETS 10;
```

### Duplicate model (raw data, no dedup)
```sql
CREATE TABLE qa_dup (
  ts          DATETIME,
  event       VARCHAR(50),
  user_id     BIGINT,
  payload     VARCHAR(500)
)
ENGINE=OLAP
DUPLICATE KEY(ts, event)
DISTRIBUTED BY HASH(user_id) BUCKETS 10
PARTITION BY RANGE(ts) (
  PARTITION p2026 VALUES LESS THAN ('2027-01-01')
);
```

For each model:
- [ ] Table creates successfully
- [ ] Tree shows model type (Aggregate / Unique / Duplicate / Primary)
- [ ] DDL gen produces the full ENGINE / KEY / DISTRIBUTED clause
- [ ] Evidence:

### Type coverage
- [ ] BIGINT, INT, SMALLINT, TINYINT
- [ ] DECIMAL(precision, scale) — for money
- [ ] VARCHAR, STRING (large text)
- [ ] DATE, DATETIME
- [ ] BOOLEAN
- [ ] BITMAP (for count-distinct, hyperloglog use)
- [ ] HLL (HyperLogLog)
- [ ] ARRAY<T>, MAP<K,V>, STRUCT — newer versions
- [ ] JSON (StarRocks 2.5+)
- [ ] Evidence:

### ALTER (schema change)
- [ ] `ALTER TABLE qa_t ADD COLUMN phone VARCHAR(20)` → async schema change
- [ ] `SHOW ALTER TABLE COLUMN` → progress
- [ ] `ALTER TABLE qa_t DROP COLUMN phone`
- [ ] `ALTER TABLE qa_t MODIFY COLUMN phone VARCHAR(50)`
- [ ] `ALTER TABLE qa_t RENAME COLUMN old TO new`
- [ ] Some schema changes require materialized view rebuild; verify app warns user

### DROP / TRUNCATE
- [ ] `TRUNCATE TABLE qa_t`
- [ ] `DROP TABLE qa_t` (FORCE if needed; recycle bin in newer versions)
- [ ] Recover from recycle: `RECOVER TABLE qa_t` (Doris 2.0+)

### Partitions
- [ ] RANGE: `PARTITION BY RANGE(date)`
- [ ] LIST: `PARTITION BY LIST(city)`
- [ ] Dynamic partition: `PROPERTIES ("dynamic_partition.enable" = "true", ...)`
- [ ] `ALTER TABLE qa_t ADD PARTITION p202602 VALUES LESS THAN …`
- [ ] `ALTER TABLE qa_t DROP PARTITION p2025` 
- [ ] Tree shows partitions under table
- [ ] Evidence:

## Indexes

- [ ] BloomFilter index: `CREATE INDEX bf_idx ON qa_t(user_id) USING BLOOMFILTER`
- [ ] Bitmap index (Doris): `CREATE INDEX bitmap_idx ON qa_t(status) USING BITMAP`
- [ ] Inverted index for full-text (newer Doris): `CREATE INDEX inv_idx ON qa_t(bio) USING INVERTED PROPERTIES('parser'='english')`
- [ ] `DROP INDEX bf_idx ON qa_t`
- [ ] Evidence:

## Materialized views

Doris / StarRocks have powerful MV support (different syntax than PG).

```sql
CREATE MATERIALIZED VIEW qa_mv AS
SELECT user_id, date, SUM(pv) AS total_pv
FROM qa_agg
GROUP BY user_id, date;
```

- [ ] Sync MV: built from base; query optimizer rewrites queries to use MV
- [ ] Async MV (StarRocks): refresh on schedule
- [ ] `SHOW ALTER TABLE MATERIALIZED VIEW` → progress
- [ ] `DROP MATERIALIZED VIEW qa_mv ON qa_agg`

## Views

- [ ] Standard `CREATE VIEW qa_v AS SELECT …` works
- [ ] Tree shows views

## Constraints

- [ ] No PRIMARY KEY enforcement in Aggregate / Duplicate models
- [ ] Unique / Primary Key model DOES enforce uniqueness on key columns
- [ ] No FK
- [ ] No CHECK (older versions); newer Doris has CHECK
- [ ] App / linter should warn user

## Functions / Procedures

- [ ] Standard SQL functions: aggregate, string, date, JSON
- [ ] StarRocks Stored Procedures (3.x+): `CREATE PROCEDURE …` — supported
- [ ] Doris: NO procedures historically; verify version
- [ ] User-defined functions (UDF) via Java JAR — out of scope
- [ ] Evidence:

## Triggers / Sequences

- Doris / StarRocks have NO triggers, NO sequences.
- Use `UUID()` or external for unique IDs.
- Skip sections.

## Users · Roles · Grants

```sql
CREATE USER 'qa_user' IDENTIFIED BY 'StrongPass!2026';
GRANT SELECT, LOAD ON qa_db.qa_t TO 'qa_user';
SHOW GRANTS FOR 'qa_user';
CREATE ROLE qa_role;
GRANT qa_role TO 'qa_user';
DROP USER 'qa_user';
```

- [ ] User created
- [ ] Privileges: NODE / GRANT / SELECT / LOAD / ALTER / CREATE / DROP / USAGE_PRIV
- [ ] Resource group (Doris): `CREATE RESOURCE GROUP …` to limit query resources
- [ ] Authentication plugins: MySQL native, LDAP (configurable)
- [ ] Evidence:

## DML / Query

### INSERT (analytical, batched)
- [ ] `INSERT INTO qa_t VALUES (…), (…)` — but each separate INSERT creates a tablet — verify batching
- [ ] `INSERT INTO qa_t SELECT … FROM source`
- [ ] **Stream Load** (HTTP-based bulk import): typically out of UI scope; if exposed, verify
- [ ] **Routine Load** (Kafka consumer): `CREATE ROUTINE LOAD qa_load ON qa_t …` — out of UI scope
- [ ] **Broker Load** (HDFS / S3): SQL command, verify works if env supports
- [ ] Evidence:

### UPDATE / DELETE
- [ ] UPDATE only supported on Unique / Primary Key model
- [ ] DELETE: `DELETE FROM qa_t PARTITION p2026 WHERE …`
- [ ] DELETE async; status via `SHOW DELETE`
- [ ] Evidence:

### SELECT
- [ ] Standard SELECT, JOIN, GROUP BY, ORDER BY, LIMIT
- [ ] **Bitmap intersection**: `bitmap_intersect`, `bitmap_union`, `bitmap_count` — count-distinct fast
- [ ] **HLL**: `hll_union_agg`, `hll_cardinality`
- [ ] Window functions
- [ ] CTE
- [ ] Lateral view + EXPLODE for ARRAY columns
- [ ] EXPLAIN: shows tablet-level plan
- [ ] EXPLAIN VERBOSE for full breakdown
- [ ] Profile: `SET enable_profile=true; <query>; SHOW LAST QUERY PROFILE` (advanced)
- [ ] Evidence:

## Transactions

- [ ] Not transactional in the classical sense (each load is atomic)
- [ ] StarRocks 2.5+ has STREAM LOAD with transaction wrapper
- [ ] Manual-commit mode: probably DISABLE in UI
- [ ] Skip TX section

## Dialect-specific quirks

### Distribution + bucketing
- [ ] DISTRIBUTED BY HASH(col) BUCKETS N — must pick a good distribution key
- [ ] DISTRIBUTED BY RANDOM — auto-shards
- [ ] Bucket count tuning: too few → hot spot; too many → small tablets

### Compression
- [ ] Storage compression: `PROPERTIES("compression"="LZ4")` or ZSTD

### Storage tiers (Doris cold/hot)
- [ ] Hot tier on SSD, cold on HDD/S3
- [ ] `ALTER TABLE qa_t SET ("storage_cooldown_ttl"="30d")` — auto-migrate after 30 days

### Backend (BE) node management
- [ ] `SHOW BACKENDS` → list of compute nodes
- [ ] Tree may show cluster topology in DBA panel?

### Sync vs async schema changes
- [ ] Lightweight changes (add column with no default) are sync
- [ ] Heavy changes (modify column type) are async with progress tracking

### Resource isolation
- [ ] Resource groups (Doris) / Workload group (StarRocks) for per-tenant resource caps

## Cross-platform

- [ ] Driver pure JS — works on all OS
- [ ] Evidence:

## Known limitations

- Mutation latency: UPDATE / DELETE may take seconds to be visible (vs OLTP DBs)
- Schema change for production-grade tables can take minutes — UI should show progress
- StarRocks Primary Key model uses memory; large key columns can OOM the BE
- No SELECT for cross-cluster queries — must federate at app level
- Loading data: HTTP-based Stream Load is the recommended path, but client-side INSERT is OK for small batches
- BITMAP / HLL types: app's grid should not try to render as text — show specialized viewer
