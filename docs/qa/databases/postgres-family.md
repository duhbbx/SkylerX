# PostgreSQL family — manual QA

**Covers**: PostgreSQL, KingbaseES (人大金仓), CockroachDB, Greenplum, openGauss, H2 (PG-server mode).
**Driver**: `packages/core-driver/src/dialects/postgres.ts` (pg / node-postgres, pure JS).
**Wire**: PostgreSQL protocol (port 5432 default).

> Amazon Redshift also uses pg wire — see [`redshift.md`](./redshift.md) for cluster-specific quirks.

## Setup

- Branch / commit:
- OS:
- Server: <!-- e.g. PG 16, Kingbase V9, CockroachDB 24, Greenplum 7, openGauss 6, H2 2 -->
- Test DB / schema: `qa_db` / `qa_schema`

## Connection

- [ ] Plain TCP host + port + user + password → green toast, version
- [ ] Default DB specified → tree expands to that DB
- [ ] SSL mode `require` → connects with TLS
- [ ] SSL mode `verify-full` with wrong CA → fails with TLS error
- [ ] Unix socket (PG): host = `/var/run/postgresql` → connects
- [ ] Wrong password → 28P01 with specific message
- [ ] Wrong host → ETIMEDOUT or ECONNREFUSED < 10s
- [ ] `application_name` parameter set → visible in `pg_stat_activity`
- [ ] Search path: `?search_path=qa_schema,public` → applied
- [ ] Evidence:

## Database / schema

### Database
- [ ] `CREATE DATABASE qa_db OWNER qa_owner ENCODING 'UTF8' LC_COLLATE 'C'`
- [ ] `\l` (psql) / tree → `qa_db` appears
- [ ] Cannot create object inside until reconnected to qa_db
- [ ] `DROP DATABASE qa_db` from another DB connection (cannot drop current)
- [ ] Evidence:

### Schema
- [ ] `CREATE SCHEMA qa_schema AUTHORIZATION qa_owner`
- [ ] `SET search_path TO qa_schema, public` → unqualified table names resolve to qa_schema
- [ ] Tree shows schemas as separate group under each DB
- [ ] `DROP SCHEMA qa_schema CASCADE`
- [ ] Evidence:

## Tables

### CREATE TABLE — type coverage

```sql
CREATE TABLE qa_schema.qa_t (
  id            BIGSERIAL PRIMARY KEY,
  uuid          UUID DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  email         CITEXT UNIQUE,        -- case-insensitive (citext extension)
  age           SMALLINT CHECK (age >= 0),
  salary        NUMERIC(15,2),
  bio           TEXT,
  payload       JSONB,
  tags          TEXT[],               -- array
  ip_addr       INET,
  mac_addr      MACADDR,
  ts_range      TSRANGE,
  search        TSVECTOR,
  bytes_val     BYTEA,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ
);
```

- [ ] Statement runs (after ensuring `citext` extension)
- [ ] Expand table → all PG-specific types render correctly in tree
- [ ] Insert + select roundtrip: each type preserves value
- [ ] Evidence: paste sample row

### Inheritance
- [ ] `CREATE TABLE qa_child () INHERITS (qa_t)` → child has all parent cols
- [ ] INSERT into child → visible in `SELECT * FROM qa_t` (parent sees children)
- [ ] `ONLY` clause: `SELECT * FROM ONLY qa_t` → excludes child rows

### Partitioning (PG 10+)
- [ ] `CREATE TABLE qa_p (id INT, ts TIMESTAMPTZ) PARTITION BY RANGE (ts)`
- [ ] `CREATE TABLE qa_p_2026 PARTITION OF qa_p FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')`
- [ ] INSERT routes to correct partition
- [ ] Tree shows partitions under parent

### ALTER TABLE
- [ ] `ALTER TABLE qa_t ADD COLUMN phone VARCHAR(20)`
- [ ] `ALTER TABLE qa_t ALTER COLUMN phone TYPE TEXT`
- [ ] `ALTER TABLE qa_t RENAME COLUMN phone TO mobile`
- [ ] `ALTER TABLE qa_t DROP COLUMN mobile`
- [ ] `ALTER TABLE qa_t RENAME TO qa_t_v2`

### DROP / TRUNCATE
- [ ] `TRUNCATE TABLE qa_t` (does NOT reset identity unless RESTART IDENTITY)
- [ ] `TRUNCATE qa_t RESTART IDENTITY CASCADE`
- [ ] `DROP TABLE qa_t CASCADE`

## Indexes

- [ ] B-tree (default): `CREATE INDEX idx_n ON qa_t(name)`
- [ ] GIN on JSONB: `CREATE INDEX idx_payload ON qa_t USING gin(payload)`
- [ ] GIN on TSVECTOR (FTS): `CREATE INDEX idx_search ON qa_t USING gin(search)`
- [ ] GiST: `CREATE INDEX idx_ts_range ON qa_t USING gist(ts_range)`
- [ ] BRIN (for big append-only): `CREATE INDEX idx_created_brin ON qa_t USING brin(created_at)`
- [ ] HASH: `CREATE INDEX idx_status_hash ON qa_t USING hash(status)`
- [ ] Partial: `CREATE INDEX idx_active ON qa_t(name) WHERE is_active`
- [ ] Expression: `CREATE INDEX idx_lower_email ON qa_t(LOWER(email))`
- [ ] UNIQUE constraint via index
- [ ] Concurrent build: `CREATE INDEX CONCURRENTLY idx_c ON qa_t(name)` — does NOT block writes
- [ ] `DROP INDEX CONCURRENTLY idx_c`
- [ ] Evidence:

## Views

### Regular view
- [ ] `CREATE VIEW qa_v AS SELECT id, name FROM qa_t WHERE is_active`
- [ ] `SELECT * FROM qa_v`
- [ ] Updatable view: rules / triggers required for non-trivial views
- [ ] `CREATE OR REPLACE VIEW qa_v AS …`
- [ ] `DROP VIEW qa_v`

### Materialized view
- [ ] `CREATE MATERIALIZED VIEW qa_mv AS SELECT … FROM qa_t`
- [ ] `REFRESH MATERIALIZED VIEW qa_mv`
- [ ] `REFRESH MATERIALIZED VIEW CONCURRENTLY qa_mv` (requires UNIQUE index)
- [ ] `DROP MATERIALIZED VIEW qa_mv`
- [ ] Tree shows MV under its own group

## Constraints

- [ ] PRIMARY KEY → duplicate INSERT fails with 23505
- [ ] UNIQUE — same
- [ ] NOT NULL — fails with 23502
- [ ] CHECK violations → 23514 with constraint name
- [ ] DEFAULT applied on INSERT omitting column
- [ ] EXCLUDE constraint: `EXCLUDE USING gist (ts_range WITH &&)` → overlapping ranges rejected
- [ ] FK: `ON DELETE CASCADE / SET NULL / RESTRICT` all behave per spec
- [ ] DEFERRABLE INITIALLY DEFERRED FK → checked at COMMIT only
- [ ] Evidence:

## Functions / Stored procedures

### Function (PL/pgSQL)
```sql
CREATE OR REPLACE FUNCTION qa_double(x INT) RETURNS INT
LANGUAGE plpgsql AS $$
BEGIN RETURN x * 2; END;
$$;
```
- [ ] Created — callable via `SELECT qa_double(5)` → 10
- [ ] Dollar-quoted body NOT split by app's statement parser
- [ ] DDL gen → produces valid recreate

### Function (SQL)
- [ ] `CREATE FUNCTION qa_inc(x INT) RETURNS INT LANGUAGE SQL AS 'SELECT $1 + 1'`
- [ ] Works

### Procedure (PG 11+)
- [ ] `CREATE PROCEDURE qa_proc(n TEXT) LANGUAGE plpgsql AS $$ BEGIN INSERT INTO qa_t(name) VALUES (n); END; $$`
- [ ] `CALL qa_proc('test')` works
- [ ] Procedure can COMMIT / ROLLBACK internally (vs functions cannot)

## Triggers

```sql
CREATE OR REPLACE FUNCTION qa_set_updated() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
CREATE TRIGGER qa_t_updated BEFORE UPDATE ON qa_t
FOR EACH ROW EXECUTE FUNCTION qa_set_updated();
```

- [ ] Trigger created → fires on UPDATE (verify by updating and checking updated_at)
- [ ] BEFORE / AFTER × INSERT / UPDATE / DELETE / TRUNCATE all work
- [ ] Statement-level vs row-level both supported
- [ ] `DROP TRIGGER qa_t_updated ON qa_t`

## Sequences

```sql
CREATE SEQUENCE qa_seq START WITH 1000 INCREMENT BY 10 CACHE 50;
SELECT nextval('qa_seq');  -- 1000
SELECT currval('qa_seq');  -- 1000
SELECT nextval('qa_seq');  -- 1010
ALTER SEQUENCE qa_seq RESTART WITH 5000;
DROP SEQUENCE qa_seq;
```

- [ ] All commands work
- [ ] Tree shows sequences under Sequences group
- [ ] SERIAL / BIGSERIAL auto-creates a sequence; verify it's visible

## Users · Roles · Grants

PG uses unified ROLEs (a USER is a role with LOGIN).

```sql
CREATE ROLE qa_admin;
CREATE ROLE qa_user WITH LOGIN PASSWORD 'StrongPass!2026';
GRANT qa_admin TO qa_user;
GRANT CONNECT ON DATABASE qa_db TO qa_admin;
GRANT USAGE ON SCHEMA qa_schema TO qa_admin;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA qa_schema TO qa_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA qa_schema GRANT SELECT ON TABLES TO qa_admin;
```

- [ ] All execute → role visible in `\du` (psql) / tree
- [ ] Connect as qa_user → can SELECT from qa_t (via inherited qa_admin)
- [ ] `SET ROLE qa_admin` → privileges switch
- [ ] `RESET ROLE` → back to login role
- [ ] `REVOKE …`, `DROP OWNED BY qa_user`, `DROP ROLE qa_user`
- [ ] Row-level security: `ALTER TABLE qa_t ENABLE ROW LEVEL SECURITY; CREATE POLICY p ON qa_t USING (owner = current_user)` → SELECT filtered
- [ ] Evidence:

## DML / Query

### INSERT
- [ ] Single + multi-row INSERT
- [ ] INSERT … RETURNING * (PG-specific, very common)
- [ ] INSERT … ON CONFLICT DO NOTHING / DO UPDATE (upsert)
- [ ] INSERT … SELECT
- [ ] COPY FROM stdin (if exposed in UI / verify via psql equivalent)

### UPDATE / DELETE
- [ ] `UPDATE qa_t SET … FROM other WHERE qa_t.id = other.id RETURNING *`
- [ ] `DELETE FROM qa_t USING other WHERE qa_t.id = other.id RETURNING *`

### SELECT — query shapes
- [ ] JOIN: INNER, LEFT, RIGHT, FULL OUTER, CROSS, LATERAL
- [ ] Subquery: scalar, IN, EXISTS, correlated
- [ ] CTE: `WITH cte AS (SELECT …) SELECT * FROM cte`
- [ ] Recursive CTE: ancestor / tree traversal
- [ ] Window functions: ROW_NUMBER(), DENSE_RANK(), LAG/LEAD, frame `ROWS BETWEEN`
- [ ] GROUPING SETS / ROLLUP / CUBE
- [ ] FILTER clause: `COUNT(*) FILTER (WHERE x > 0)`
- [ ] UNION / INTERSECT / EXCEPT
- [ ] LIMIT … OFFSET …
- [ ] DISTINCT ON: `SELECT DISTINCT ON (group_key) … ORDER BY …`
- [ ] Evidence:

### Type-specific queries
- [ ] Array: `WHERE 'a' = ANY(tags)` / `WHERE tags @> '{a,b}'`
- [ ] JSONB: `WHERE payload @> '{"k":"v"}'` / `WHERE payload->>'k' = 'v'` / `jsonb_path_query`
- [ ] Range: `WHERE ts_range && tstzrange('2026-01-01', '2026-02-01')`
- [ ] Full-text: `WHERE search @@ to_tsquery('english','term')` with ranking
- [ ] INET: `WHERE ip_addr << '10.0.0.0/8'`
- [ ] UUID generation: `gen_random_uuid()` (pgcrypto) or built-in
- [ ] Evidence:

## Transactions

- [ ] Transactional DDL (CREATE / ALTER inside BEGIN works) — verify ROLLBACK undoes CREATE TABLE
- [ ] Savepoints: `SAVEPOINT sp1; ROLLBACK TO sp1`
- [ ] Isolation levels: READ COMMITTED (default), REPEATABLE READ, SERIALIZABLE
- [ ] SELECT FOR UPDATE / SHARE locks
- [ ] After error in TX, must ROLLBACK before issuing more SQL (`ERROR: current transaction is aborted`)

## Dialect-specific quirks

### PostgreSQL
- [ ] Extensions: `CREATE EXTENSION IF NOT EXISTS pgcrypto`, `pg_stat_statements`, `pg_trgm`, `vector`, `postgis` (if installed)
- [ ] `\copy` vs `COPY`: app uses `COPY … FROM STDIN` for import? verify
- [ ] LISTEN / NOTIFY: `NOTIFY chan, 'msg'` — if UI exposes, verify
- [ ] Logical replication slots (`pg_replication_slots`) visible in DBA panel?

### KingbaseES (人大金仓)
- [ ] System catalogs may be `SYS_` prefixed; verify metadata tree handles both `pg_` and `SYS_`
- [ ] Oracle-compat mode: `DUAL` table works (`SELECT 1 FROM DUAL`)
- [ ] Identifier case: matches PG (lower by default unless quoted)
- [ ] Built-in functions like `NVL`, `DECODE` available

### openGauss
- [ ] Compatibility mode: `A` (Oracle) / `B` (MySQL) — DDL gen respects
- [ ] `WITH (orientation = column)` for columnar tables — DDL preserved

### CockroachDB
- [ ] AUTO_INCREMENT replaced by `SERIAL` (UUID under the hood)
- [ ] `SHOW RANGES FROM TABLE qa_t` works for shard inspection
- [ ] Distributed `EXPLAIN ANALYZE` shows multi-node breakdown
- [ ] Some PG syntax not supported (no inheritance, limited triggers)

### Greenplum
- [ ] Distribution column required: `DISTRIBUTED BY (id)` clause in DDL
- [ ] Append-optimized tables: `WITH (appendonly=true)`
- [ ] Resource queues: `SHOW resource_queue` for active queue

### openGauss
- [ ] Replication: dual-machine HA setup primary/standby visible
- [ ] Compress storage option `WITH (compression='ZSTD')`

### H2 (PG-server mode)
- [ ] H2 running with `-pg` flag → port 5435 typically
- [ ] Limited type set vs full PG (no INET, no JSONB native, no array)
- [ ] `INFORMATION_SCHEMA` works; PG-specific `pg_catalog` may NOT be queryable
- [ ] Treat as PG-compat subset, not full

## Known limitations

- pg driver does NOT use prepared statements by default — app uses `pg-types` for type parsing
- LISTEN / NOTIFY runs on a long-lived connection — if UI exposes, must use dedicated connection
- COPY-based import for large CSVs requires server file access — for client-side import we use INSERT batches
- JSONB column with 1MB+ values may slow down `EXPLAIN ANALYZE` rendering
- KingbaseES / openGauss may have license-restricted features (e.g. some encrypted column types) — don't assume parity with upstream PG
