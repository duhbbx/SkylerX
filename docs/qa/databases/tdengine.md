# TDengine — manual QA

**Covers**: TDengine 3.x (信创时序数据库).
**Driver**: `packages/core-driver/src/dialects/tdengine.ts` (`@tdengine/websocket` npm).
**Wire**: WebSocket (HTTP upgrade), port 6041 default.

## Setup

- Branch / commit:
- OS:
- Server: `tdengine/tdengine` docker, port 6041 (WS adapter)
- Test DB: `qa_db`

## Connection

- [ ] WS host + port + user (default `root`) + password (default `taosdata`) → green toast with version
- [ ] `wss://` (TLS) — works with valid cert
- [ ] Wrong password → specific TDengine error code
- [ ] Wrong port (e.g. native 6030 instead of WS 6041) → ECONNREFUSED with hint
- [ ] Connection timeout reasonable
- [ ] Evidence:

## Database / schema

TDengine has only `database` level (no schemas).

```sql
CREATE DATABASE qa_db PRECISION 'ms' BUFFER 256 PAGESIZE 4 PAGES 256 KEEP 365;
USE qa_db;
SHOW DATABASES;
DROP DATABASE qa_db;
```

- [ ] CREATE with custom precision (ms / us / ns)
- [ ] CREATE with KEEP (days to retain data)
- [ ] Tree shows DBs
- [ ] Tree also shows separate groups for **stables** (super-tables) vs **regular tables** vs **sub-tables**

## Tables — TDengine model is unique

TDengine has 3 table types:
1. **Regular table** — flat schema, like other DBs
2. **Super-table (stable)** — schema + tag definitions; template for sub-tables
3. **Sub-table** — concrete instance of a stable, tags filled in

### Regular table
```sql
CREATE TABLE qa_reg (
  ts        TIMESTAMP,           -- MUST be first column, MUST be TIMESTAMP
  value     FLOAT,
  status    INT
);
```

- [ ] First column = TIMESTAMP, enforced
- [ ] Tree shows under regular tables

### Super-table (most common pattern)
```sql
CREATE STABLE meters (
  ts          TIMESTAMP,
  current     FLOAT,
  voltage     INT,
  phase       FLOAT
) TAGS (
  location    VARCHAR(64),
  group_id    INT
);
```

- [ ] STABLE created → tree shows in "Super-tables" group with tags shown
- [ ] DDL gen produces STABLE syntax (not just CREATE TABLE)
- [ ] Evidence:

### Sub-table (from super-table)
```sql
CREATE TABLE meter_001 USING meters TAGS ('NYC', 1);
CREATE TABLE meter_002 USING meters TAGS ('SF', 2);
```

- [ ] Sub-table created, inherits schema from stable
- [ ] Tags fixed at creation time
- [ ] Tree shows sub-tables grouped under their parent stable
- [ ] Sub-table can be queried directly: `SELECT * FROM meter_001`
- [ ] OR queried via stable for cross-sub-table: `SELECT * FROM meters WHERE location = 'NYC'`
- [ ] Evidence:

### ALTER STABLE / TABLE
- [ ] `ALTER STABLE meters ADD COLUMN power FLOAT` → propagates to all sub-tables
- [ ] `ALTER STABLE meters ADD TAG region VARCHAR(32)` → new tag, propagates
- [ ] `ALTER STABLE meters MODIFY COLUMN current FLOAT` → type change (limited; verify what's allowed)
- [ ] `ALTER STABLE meters DROP COLUMN status` → propagates
- [ ] Evidence:

### DROP / TRUNCATE
- [ ] `DROP STABLE meters` → drops all sub-tables too (cascading)
- [ ] `DROP TABLE meter_001` → sub-table only
- [ ] No native TRUNCATE — use `DELETE FROM …` or recreate
- [ ] Evidence:

## Indexes

- [ ] TDengine auto-builds index on timestamp + tags
- [ ] No CREATE INDEX statement in classical sense
- [ ] Verify app's UI does not let user attempt CREATE INDEX on TDengine (or fails gracefully if attempted)

## Views (TDengine 3.x+)

- [ ] `CREATE VIEW qa_v AS SELECT * FROM meters WHERE location = 'NYC'` (if supported in version)
- [ ] `DROP VIEW qa_v`

## Constraints

TDengine is lightweight on constraints:
- [ ] PRIMARY KEY (timestamp implicit) — duplicate timestamps overwrite
- [ ] NOT NULL — not enforced on regular columns (TDengine fills with NULL placeholder)
- [ ] No FOREIGN KEY
- [ ] No CHECK
- [ ] App / linter should warn user about absence

## Functions / Stored procedures / Triggers / Sequences

- TDengine has NO stored procedures.
- NO triggers.
- NO sequences.
- Heavy use of built-in functions (aggregation, interpolation, derivative, etc.) — relevant for queries.
- Skip these sections.

## Users · Roles · Grants

```sql
CREATE USER qa_user PASS 'StrongPass!2026';
GRANT READ ON qa_db.* TO qa_user;
GRANT WRITE ON qa_db.* TO qa_user;
SHOW USERS;
ALTER USER qa_user PASS 'NewPass!';
DROP USER qa_user;
```

- [ ] All execute
- [ ] User visible in `SHOW USERS`
- [ ] Privileges: READ, WRITE — per database
- [ ] Limited compared to PG / Oracle; verify UI doesn't expose unavailable grant types
- [ ] Evidence:

## DML / Query

### INSERT
- [ ] Single row: `INSERT INTO meter_001 VALUES (NOW, 10.3, 220, 0.31)`
- [ ] Multi-row batch: `INSERT INTO meter_001 VALUES (?, ?, ?, ?), (?, ?, ?, ?), …`
- [ ] Insert into multiple sub-tables: `INSERT INTO meter_001 VALUES (…) meter_002 VALUES (…)`
- [ ] Insert + auto-create sub-table: `INSERT INTO meter_003 USING meters TAGS ('LA', 3) VALUES (NOW, …)`
- [ ] Evidence:

### UPDATE / DELETE
- [ ] DELETE supported in 3.0+: `DELETE FROM meters WHERE ts < '2026-01-01'`
- [ ] UPDATE: limited in time-series model — typically re-insert with same timestamp overwrites
- [ ] Evidence:

### SELECT — time-series specific

```sql
-- Last value
SELECT LAST(*) FROM meters WHERE location = 'NYC';

-- Time-window aggregation (INTERVAL clause)
SELECT _wstart, COUNT(*), AVG(current)
FROM meters
WHERE ts > NOW - 1h AND location = 'NYC'
INTERVAL(10s)
SLIDING(5s)
FILL(NULL);

-- Top-N per group
SELECT TOP(current, 10) FROM meters;

-- Sample
SELECT SAMPLE(current, 100) FROM meters;

-- Interpolation
SELECT INTERP(current) FROM meters WHERE ts > NOW - 1h INTERVAL(1m) FILL(LINEAR);

-- DIFF / DERIVATIVE
SELECT DIFF(current) FROM meter_001;
SELECT DERIVATIVE(current, 1s, 0) FROM meter_001;

-- Histogram
SELECT HISTOGRAM(current, 'user_input', '[0,5,10,15,20]', 0) FROM meters;

-- Sliding cumulative
SELECT CSUM(current) FROM meter_001;
```

- [ ] All time-series functions work
- [ ] INTERVAL / SLIDING / FILL clauses parsed by app's editor without confusion
- [ ] Evidence per function type:

### Tag-based queries
- [ ] `SELECT * FROM meters WHERE location = 'NYC'` — tag filter, very fast
- [ ] `SELECT location, AVG(current) FROM meters GROUP BY location` — group by tag
- [ ] Evidence:

### JOIN
- [ ] Time-series JOIN: `SELECT * FROM meters a, meters b WHERE a.ts = b.ts AND a.location = 'NYC' AND b.location = 'SF'`
- [ ] LEFT JOIN with NULL-fill — supported in newer versions
- [ ] Evidence:

## Transactions

- TDengine does NOT support multi-statement transactions.
- INSERTs are atomic per batch.
- **Manual-commit mode must be DISABLED for TDengine connections** — verify
- Skip TX section

## Dialect-specific quirks

### Timestamp behaviors
- [ ] `NOW`, `NOW-1h`, `TODAY` — time literal shortcuts work
- [ ] Sub-second precision based on DB precision (ms / us / ns) at creation
- [ ] Insert with `NOW` automatically uses server time
- [ ] Insert with same timestamp as existing row → overwrites by default (configurable via `update` DB param)
- [ ] Evidence:

### Cache strategy
- [ ] `CACHEMODEL` parameter on STABLE: 'none' / 'last_row' / 'last_value' / 'both'
- [ ] LAST() function on cached stables is O(1)
- [ ] DDL gen captures cache options

### Compression
- [ ] Column-level codecs: `current FLOAT COMPRESS 'delta-i' LEVEL 'high'` (3.x)
- [ ] DDL gen preserves

### Cluster
- [ ] Multi-vnode setup — `SHOW VGROUPS`
- [ ] DNODE management via UI? — probably not, skip

### Stream processing
- [ ] `CREATE STREAM …` — TDengine has continuous query / stream processing
- [ ] Out of scope unless test env has

## Cross-platform

- [ ] WebSocket client is pure JS — works on all OS
- [ ] No native dependencies
- [ ] Native client option (port 6030) — out of scope (app uses WS only)
- [ ] Evidence:

## Known limitations

- Each sub-table = a separate "device" in IoT terminology — design assumes you know your devices
- Sub-table count up to millions per stable, but tree-rendering should paginate (verify)
- Tag values are fixed at sub-table creation; changing requires drop+recreate
- INSERT order must be roughly chronological — out-of-order inserts may be slow without `update` config
- TDengine 2.x and 3.x have different syntax in places; assume 3.x in this app
- Tree expansion of a stable with 100k+ sub-tables may overwhelm — verify pagination / search
