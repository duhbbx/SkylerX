# Amazon Redshift — manual QA

**Covers**: Amazon Redshift (PG-wire compatible cloud DW).
**Driver**: `packages/core-driver/src/dialects/postgres.ts` (pg / node-postgres, shared with PG family).
**Wire**: PostgreSQL protocol (port 5439 default for Redshift).

> Redshift uses PG wire but the SQL surface diverges (no triggers, limited DDL, distribution / sort keys). Run [`postgres-family.md`](./postgres-family.md) for shared bits; this file covers Redshift-specific behavior.

## Setup

- Branch / commit:
- OS:
- Cluster (test env, not prod): <!-- name + region -->
- Test DB / schema: `qa_db.qa_s`

## Connection

- [ ] Endpoint (e.g. `mycluster.abc.us-east-1.redshift.amazonaws.com`) + 5439 + user + password → connects
- [ ] IAM auth: temp credentials via `GetClusterCredentials` — out of scope unless test env supports
- [ ] SSL required by default; `sslmode=verify-full` works with AWS CA
- [ ] Wrong cred → 28P01
- [ ] First connect to cold cluster may take 30s+ — verify no premature timeout
- [ ] Evidence:

## Database / schema

- [ ] `CREATE DATABASE qa_db` (Redshift Serverless: workgroup-based)
- [ ] `CREATE SCHEMA qa_s AUTHORIZATION qa_owner`
- [ ] Tree shows DBs and schemas (including system: `pg_catalog`, `information_schema`, `pg_internal`)
- [ ] `DROP SCHEMA qa_s`
- [ ] Evidence:

## Tables

### CREATE TABLE — Redshift specifics

```sql
CREATE TABLE qa_s.qa_t (
  id           BIGINT IDENTITY(1,1) PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(255),
  age          SMALLINT,
  salary       DECIMAL(15,2),
  bio          VARCHAR(MAX),           -- Redshift uses VARCHAR(MAX), no TEXT keyword
  payload      SUPER,                  -- semi-structured (JSON-like)
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT GETDATE(),
  updated_at   TIMESTAMPTZ,
  birth_date   DATE
)
DISTSTYLE KEY DISTKEY (id)
SORTKEY (created_at);
```

- [ ] Statement runs
- [ ] Tree shows DISTSTYLE / DISTKEY / SORTKEY in metadata
- [ ] DDL gen captures distribution + sort
- [ ] Evidence:

### Distribution styles
- [ ] `DISTSTYLE AUTO` (default for new tables) — system chooses
- [ ] `DISTSTYLE KEY DISTKEY(col)` — hash-distributed
- [ ] `DISTSTYLE EVEN` — round-robin
- [ ] `DISTSTYLE ALL` — full copy on each node (good for small dim tables)

### Sort keys
- [ ] `SORTKEY (col)` — compound sort
- [ ] `INTERLEAVED SORTKEY (col1, col2)` — equal weight on multi-column queries
- [ ] `AUTO SORTKEY` — system chooses

### Identifier case
- [ ] Default: lowercase (PG behavior)
- [ ] Quoted preserves case
- [ ] `set enable_case_sensitive_identifier = true` for case-sensitive (rare)

### ALTER (limited)
- [ ] `ALTER TABLE qa_t ADD COLUMN phone VARCHAR(20)`
- [ ] `ALTER TABLE qa_t DROP COLUMN phone`
- [ ] `ALTER TABLE qa_t RENAME COLUMN phone TO mobile`
- [ ] `ALTER TABLE qa_t ALTER COLUMN phone TYPE VARCHAR(50)` — limited; sometimes requires CREATE NEW + COPY
- [ ] `ALTER TABLE qa_t ALTER DISTKEY id` (newer) / `ALTER DISTSTYLE …`
- [ ] `ALTER TABLE qa_t ALTER COMPOUND SORTKEY (col1, col2)`
- [ ] Evidence:

### DROP / TRUNCATE
- [ ] `TRUNCATE TABLE qa_t` — fast, no rollback
- [ ] `DROP TABLE qa_t CASCADE`

## Indexes

- Redshift does NOT support secondary indexes (uses sort/dist instead).
- [ ] Verify CREATE INDEX is rejected with clear error
- [ ] App's UI should NOT show "Add Index" action for Redshift tables (or fail gracefully)

## Views

- [ ] `CREATE VIEW qa_v AS SELECT id, name FROM qa_t`
- [ ] Materialized view: `CREATE MATERIALIZED VIEW qa_mv AS SELECT … FROM qa_t WITH NO SCHEMA BINDING`
- [ ] `REFRESH MATERIALIZED VIEW qa_mv`
- [ ] Auto-MV: `BACKUP YES AUTO REFRESH YES`
- [ ] Tree shows views
- [ ] Evidence:

## Constraints

Redshift accepts the syntax but does NOT enforce most:
- [ ] PRIMARY KEY — declared, NOT enforced
- [ ] FOREIGN KEY — declared, NOT enforced (advisory for query planner only)
- [ ] UNIQUE — declared, NOT enforced
- [ ] NOT NULL — IS enforced
- [ ] Linter should warn user

## Functions / Stored procedures

### Function
```sql
CREATE OR REPLACE FUNCTION qa_double(x INT) RETURNS INT IMMUTABLE AS $$ SELECT x * 2 $$ LANGUAGE SQL;
```

### Stored procedure (PL/pgSQL)
```sql
CREATE OR REPLACE PROCEDURE qa_proc(n VARCHAR) LANGUAGE plpgsql AS $$
BEGIN INSERT INTO qa_t(name) VALUES (n); END;
$$;
CALL qa_proc('test');
```

- [ ] Both work
- [ ] Tree shows under functions / procedures

## Triggers

- Redshift has NO triggers.
- Skip section.

## Sequences

- [ ] `CREATE SEQUENCE seq_x START 1000` — supported
- [ ] `nextval('seq_x')` works
- [ ] IDENTITY column auto-creates internal sequence

## Users · Roles · Grants

```sql
CREATE USER qa_user PASSWORD 'StrongPass!2026';
GRANT CONNECT ON DATABASE qa_db TO qa_user;
GRANT USAGE ON SCHEMA qa_s TO qa_user;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA qa_s TO qa_user;

CREATE ROLE qa_role;
GRANT SELECT ON qa_s.qa_t TO ROLE qa_role;
GRANT ROLE qa_role TO qa_user;
```

- [ ] All execute
- [ ] User visible in `pg_user`, role in `svv_roles`
- [ ] Redshift-specific predefined roles: `sys:user`, `sys:dba`, `sys:operator`
- [ ] `REVOKE`, `DROP USER`, `DROP ROLE`
- [ ] Evidence:

## DML / Query

### INSERT
- [ ] Single, multi-row
- [ ] **COPY** (bulk load from S3 — primary bulk method): `COPY qa_t FROM 's3://bucket/data.csv' IAM_ROLE '…' DELIMITER ',' IGNOREHEADER 1`
- [ ] **UNLOAD** (bulk export to S3): `UNLOAD ('SELECT * FROM qa_t') TO 's3://bucket/output' IAM_ROLE '…' PARQUET`
- [ ] `INSERT … SELECT` (intra-cluster)
- [ ] Avoid single-row INSERT for big loads — verify app warns

### UPDATE / DELETE
- [ ] Standard syntax
- [ ] No `RETURNING` clause (PG has it; Redshift does NOT) — verify error message specific

### SELECT — query shapes
- [ ] JOIN: INNER, LEFT, RIGHT, FULL, CROSS
- [ ] CTE: `WITH …`
- [ ] Recursive CTE: supported
- [ ] Window functions: full set
- [ ] PIVOT / UNPIVOT (newer)
- [ ] LIMIT … OFFSET …
- [ ] UNION / INTERSECT / EXCEPT (use MINUS as alias for EXCEPT)
- [ ] `SAMPLE` — probabilistic sampling
- [ ] `EXPLAIN VERBOSE` — shows query plan with distribution info
- [ ] Evidence:

### SUPER type (semi-structured)
- [ ] Insert JSON: `INSERT INTO qa_t (payload) VALUES (JSON_PARSE('{"a":1,"b":[2,3]}'))`
- [ ] Path access: `SELECT payload.a, payload.b[0] FROM qa_t`
- [ ] `WHERE payload.a = 1` — dot-path filter
- [ ] PartiQL syntax for nested data
- [ ] Evidence:

## Transactions

- [ ] `BEGIN`, `COMMIT`, `ROLLBACK` — supported
- [ ] DDL transactional (mostly; some commands implicit commit)
- [ ] Savepoints: not fully supported — verify
- [ ] Isolation: SERIALIZABLE (Redshift default, MVCC-based)
- [ ] After error in TX, must ROLLBACK

## Dialect-specific quirks

### Workload management (WLM)
- [ ] `SET query_group = 'qa_group'` — assigns query to a WLM queue
- [ ] Queue config via `SYSTEM CATALOG_*` views
- [ ] Out of UI scope, but DBA panel may show

### Spectrum (external tables on S3)
- [ ] `CREATE EXTERNAL SCHEMA spectrum FROM DATA CATALOG DATABASE 'glue_db' …` (Glue / Athena integration)
- [ ] `CREATE EXTERNAL TABLE …` against Parquet on S3
- [ ] Tree shows external schemas separately
- [ ] Evidence:

### Concurrency scaling
- [ ] When cluster busy, queries auto-redirect to scaling cluster — verify timing reasonable

### Snapshots
- [ ] Manual snapshots via `CREATE SNAPSHOT …` — via AWS console, not in app

### Auto-tuning
- [ ] Redshift auto-optimizes sort keys, distribution, statistics — verify it doesn't conflict with manual ALTER

### `VACUUM`, `ANALYZE`
- [ ] `VACUUM qa_t` reclaims space; `VACUUM REINDEX` for interleaved sort
- [ ] `ANALYZE qa_t` updates stats — important for plan quality
- [ ] Could expose in DBA panel

## Cost considerations (testing)

- [ ] Each query against Redshift consumes node hours — keep test cluster small (RA3 single-node)
- [ ] Consider Redshift Serverless for cheaper test
- [ ] Pause cluster when not testing (manual via console)

## Cross-platform

- [ ] pg driver pure JS, works on all OS
- [ ] AWS CA bundled with Node — verify SSL verify-full works without manual CA install
- [ ] Evidence:

## Known limitations

- COPY from S3 requires IAM role + bucket policy — app cannot manage this end-to-end
- UNLOAD writes to S3, not local — app's "Export" should use COPY-to-pipe or SELECT + client-side
- VARCHAR(MAX) is up to 65535 bytes (NOT unbounded like PG's TEXT)
- SUPER column max size: 16MB
- IDENTITY column has gaps (not strictly +1 increments)
- No FOREIGN KEY enforcement — common surprise for PG users
- No `RETURNING` clause — common surprise for PG users
- Materialized views with `WITH NO SCHEMA BINDING` allow late-binding (table schema can change without breaking MV)
- IAM auth flow (temp credentials) requires AWS SDK; app currently supports password auth only
