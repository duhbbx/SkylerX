# Snowflake — manual QA

**Covers**: Snowflake (cloud DW).
**Driver**: `packages/core-driver/src/dialects/snowflake.ts` (`snowflake-sdk` npm).
**Wire**: HTTPS, requires account / warehouse / db / schema / role context.

## Setup

- Branch / commit:
- OS:
- Test account: <!-- e.g. abc12345.us-east-1 (region URL) -->
- Test warehouse: `QA_WH` (X-small for cheap)
- Test db / schema: `QA_DB.QA_S`
- Test role: `QA_ROLE`

## Connection

Snowflake auth = `account + user + password` (or key-pair / OAuth / SSO).

- [ ] Basic auth: account (e.g. `abc12345.us-east-1`) + user + password → green toast with version
- [ ] Account URL with region must match (e.g. `abc12345.snowflakecomputing.com`) — app accepts both
- [ ] **Warehouse** must be specified or default warehouse on user → if missing, query fails with "no warehouse available"
- [ ] **Database** + **Schema** can default at connect or be set later via `USE`
- [ ] **Role** can default or be set via `USE ROLE`
- [ ] Key-pair auth: private key path + passphrase → connects (verify on test account that supports)
- [ ] OAuth: token-based — out of scope unless test env supports
- [ ] Wrong password → 250001 with "Incorrect username or password"
- [ ] Wrong account → ENOTFOUND or 404 from snowflakecomputing.com
- [ ] Inactive warehouse: connect succeeds, first query auto-resumes WH
- [ ] Evidence:

## Database / schema

Snowflake hierarchy: account → database → schema → object.

- [ ] `CREATE WAREHOUSE QA_WH WITH WAREHOUSE_SIZE = 'XSMALL' AUTO_SUSPEND = 60`
- [ ] `USE WAREHOUSE QA_WH`
- [ ] `CREATE DATABASE QA_DB`
- [ ] `USE DATABASE QA_DB`
- [ ] `CREATE SCHEMA QA_S`
- [ ] `USE SCHEMA QA_S`
- [ ] Tree shows: account → databases → schemas → tables (warehouses in separate group)
- [ ] `DROP SCHEMA QA_S`, `DROP DATABASE QA_DB`, `DROP WAREHOUSE QA_WH`
- [ ] Evidence:

## Tables

```sql
CREATE OR REPLACE TABLE QA_DB.QA_S.QA_T (
  id           NUMBER(38,0) IDENTITY(1,1) PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(255) UNIQUE,
  age          NUMBER(3),
  salary       NUMBER(15,2),
  bio          TEXT,
  payload      VARIANT,           -- semi-structured (JSON)
  payload_obj  OBJECT,            -- key-value
  payload_arr  ARRAY,             -- ordered list
  bin_data     BINARY,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMP_TZ DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP_NTZ,
  birth_date   DATE,
  geo          GEOGRAPHY,
  geom         GEOMETRY
);
```

- [ ] Statement runs
- [ ] Tree expand → all types
- [ ] **VARIANT / OBJECT / ARRAY** — Snowflake's killer feature for semi-structured data
  - [ ] Insert JSON: `INSERT INTO QA_T (payload) SELECT PARSE_JSON('{"a":1,"b":[2,3]}')`
  - [ ] Grid shows JSON tree
  - [ ] Path access: `SELECT payload:a::INTEGER FROM QA_T` → 1
  - [ ] `FLATTEN(input => payload:b)` → expand array to rows
- [ ] IDENTITY column behaves
- [ ] Evidence:

### Identifier case
- [ ] **Default**: uppercase, unless quoted
- [ ] `"qa_t"` is different from `qa_t` (which becomes `QA_T`)
- [ ] App's safeIdent should NOT quote uppercase identifiers (regression-prone, similar to Oracle)
- [ ] Evidence:

### ALTER
- [ ] `ALTER TABLE QA_T ADD COLUMN phone VARCHAR(20)`
- [ ] `ALTER TABLE QA_T MODIFY COLUMN phone VARCHAR(50) NOT NULL`
- [ ] `ALTER TABLE QA_T DROP COLUMN phone`
- [ ] `ALTER TABLE QA_T RENAME COLUMN phone TO mobile`
- [ ] `ALTER TABLE QA_T RENAME TO QA_T_V2`
- [ ] Clustering key: `ALTER TABLE QA_T CLUSTER BY (event_date, id)`
- [ ] Evidence:

### DROP / TRUNCATE
- [ ] `TRUNCATE TABLE QA_T`
- [ ] `DROP TABLE QA_T`
- [ ] `UNDROP TABLE QA_T` (Time Travel — within retention period, default 1 day)
- [ ] `DROP TABLE QA_T PURGE` — skips Time Travel
- [ ] Evidence:

## Indexes / clustering

Snowflake uses **micro-partitions + clustering keys**, not traditional indexes.

- [ ] `ALTER TABLE QA_T CLUSTER BY (event_date, id)` — sets clustering
- [ ] `SYSTEM$CLUSTERING_INFORMATION('QA_T')` returns stats
- [ ] No CREATE INDEX statement — verify app's UI hides traditional index creation for Snowflake
- [ ] Search optimization: `ALTER TABLE QA_T ADD SEARCH OPTIMIZATION` (newer feature)
- [ ] Evidence:

## Views

- [ ] Regular view: `CREATE VIEW QA_V AS SELECT id, name FROM QA_T`
- [ ] Materialized view (requires Enterprise+): `CREATE MATERIALIZED VIEW QA_MV AS SELECT name, COUNT(*) FROM QA_T GROUP BY name`
- [ ] Secure view (hides definition from other roles): `CREATE SECURE VIEW QA_SV AS …`
- [ ] `DROP VIEW`, `DROP MATERIALIZED VIEW`
- [ ] Tree shows views distinctly

## Constraints

Snowflake supports constraint syntax but most are **declarative only** (not enforced) for performance:

- [ ] PRIMARY KEY — declared, NOT enforced
- [ ] FOREIGN KEY — declared, NOT enforced (no integrity guarantee)
- [ ] UNIQUE — declared, NOT enforced
- [ ] **NOT NULL** — IS enforced
- [ ] **CHECK** — IS enforced (newer versions)
- [ ] App / linter should warn user that PK / FK / UNIQUE are advisory only
- [ ] Evidence:

## Functions / Stored procedures

### SQL function
```sql
CREATE OR REPLACE FUNCTION QA_DOUBLE(X NUMBER) RETURNS NUMBER AS $$ X * 2 $$;
SELECT QA_DOUBLE(5);   -- 10
```

### JavaScript function
```sql
CREATE OR REPLACE FUNCTION qa_js(s VARCHAR) RETURNS VARCHAR LANGUAGE JAVASCRIPT AS
$$
  return S.toUpperCase();
$$;
SELECT qa_js('hello');
```

### Python function (anaconda)
- [ ] Verify Python UDF works if anaconda enabled on test account

### Procedure (stored)
```sql
CREATE OR REPLACE PROCEDURE QA_PROC(n VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL AS
$$
BEGIN
  INSERT INTO QA_T (name) VALUES (:n);
  RETURN 'ok';
END;
$$;
CALL QA_PROC('test');
```

- [ ] SQL procedure works
- [ ] JavaScript / Python procedures work (more limited use)
- [ ] Tree shows under Procedures
- [ ] Evidence:

## Triggers

- Snowflake has NO triggers (use streams + tasks for change capture).
- Skip section.

### Streams (CDC)
- [ ] `CREATE STREAM QA_STREAM ON TABLE QA_T`
- [ ] `INSERT INTO QA_T …` → stream captures
- [ ] `SELECT * FROM QA_STREAM` shows changes (INSERT / UPDATE / DELETE marker)
- [ ] Tree shows streams

### Tasks (scheduled)
- [ ] `CREATE TASK QA_TASK WAREHOUSE = QA_WH SCHEDULE = '1 MINUTE' AS INSERT INTO QA_LOG VALUES (CURRENT_TIMESTAMP)`
- [ ] `ALTER TASK QA_TASK RESUME`
- [ ] Tree shows tasks
- [ ] Status visible via `SHOW TASKS`

## Sequences

```sql
CREATE SEQUENCE QA_SEQ START 1000 INCREMENT 10;
SELECT QA_SEQ.NEXTVAL;
DROP SEQUENCE QA_SEQ;
```

- [ ] All work
- [ ] Tree shows sequences

## Users · Roles · Grants

Snowflake's auth model is **strictly role-based**.

```sql
CREATE USER QA_USER PASSWORD = 'StrongPass!2026' DEFAULT_ROLE = 'QA_ROLE';
CREATE ROLE QA_ROLE;
GRANT ROLE QA_ROLE TO USER QA_USER;
GRANT USAGE ON WAREHOUSE QA_WH TO ROLE QA_ROLE;
GRANT USAGE ON DATABASE QA_DB TO ROLE QA_ROLE;
GRANT USAGE ON SCHEMA QA_DB.QA_S TO ROLE QA_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA QA_DB.QA_S TO ROLE QA_ROLE;
GRANT SELECT ON FUTURE TABLES IN SCHEMA QA_DB.QA_S TO ROLE QA_ROLE;  -- future-proof
```

- [ ] All execute
- [ ] User can connect, must `USE ROLE QA_ROLE` (or default)
- [ ] **Role hierarchies**: `GRANT ROLE child TO ROLE parent` — parent inherits child's privs
- [ ] Role switching mid-session: `USE ROLE other_role` works
- [ ] System roles: `ACCOUNTADMIN` (highest), `SECURITYADMIN`, `USERADMIN`, `SYSADMIN`, `PUBLIC`
- [ ] **Snowflake's distinct concept**: cannot SELECT data without ROLE having SELECT on object — verify app gives specific error
- [ ] Future grants: `GRANT … ON FUTURE TABLES …` for new tables
- [ ] `DROP USER`, `DROP ROLE`
- [ ] Evidence:

## DML / Query

### INSERT
- [ ] Single, multi-row
- [ ] `INSERT INTO QA_T (col) SELECT …`
- [ ] `MERGE` for upsert
- [ ] `COPY INTO QA_T FROM @QA_STAGE` (from external stage)
- [ ] Evidence:

### UPDATE / DELETE
- [ ] `UPDATE QA_T SET … WHERE …`
- [ ] `DELETE FROM QA_T WHERE …`
- [ ] No `RETURNING` clause natively — use `INSERT … OVERWRITE` patterns

### SELECT — query shapes
- [ ] JOINs: INNER, LEFT, RIGHT, FULL, CROSS, NATURAL, LATERAL, ASOF
- [ ] CTE (recursive supported)
- [ ] Window functions
- [ ] `QUALIFY` clause (Snowflake / BigQuery dialect): `SELECT … QUALIFY ROW_NUMBER() OVER (PARTITION BY …) = 1`
- [ ] `FLATTEN(input => array_col)` — expand arrays
- [ ] `LATERAL FLATTEN` with VARIANT
- [ ] PIVOT / UNPIVOT
- [ ] `MATCH_RECOGNIZE` (row pattern matching)
- [ ] Time Travel: `SELECT * FROM QA_T AT (TIMESTAMP => '2026-01-01'::TIMESTAMP)`
- [ ] Time Travel offset: `AT (OFFSET => -60*5)` — 5 minutes ago
- [ ] Evidence:

### Semi-structured queries
- [ ] `SELECT payload:a, payload:b[0], payload:c::VARCHAR FROM QA_T`
- [ ] `WHERE PARSE_JSON(payload):k = 'v'`
- [ ] `FLATTEN(input => payload:tags) f` → unnest array to rows
- [ ] Evidence:

## Transactions

- [ ] `BEGIN`, `COMMIT`, `ROLLBACK` — supported
- [ ] DDL is transactional in Snowflake (since 2021)
- [ ] Default 4-hour lock timeout
- [ ] Evidence:

## Dialect-specific quirks

### Warehouse / compute lifecycle
- [ ] Warehouse auto-suspends after idle (default 10 min)
- [ ] First query after suspend auto-resumes (1-5s delay)
- [ ] App's first query should NOT timeout during warehouse resume; verify 30s grace

### Time Travel
- [ ] Default retention: 1 day for Standard, up to 90 days for Enterprise
- [ ] `UNDROP TABLE` works within retention window
- [ ] Tree shows recently dropped objects (with badge) for the retention period?

### Zero-copy clone
- [ ] `CREATE TABLE QA_T_CLONE CLONE QA_T` — instant copy, separate writes
- [ ] `CREATE DATABASE QA_DB_CLONE CLONE QA_DB AT (TIMESTAMP => …)`
- [ ] DDL gen handles CLONE references

### Stages (file storage)
- [ ] `CREATE STAGE QA_STAGE` — internal stage
- [ ] `PUT file:///tmp/data.csv @QA_STAGE` — upload (via SQL only; UI doesn't currently support)
- [ ] `LIST @QA_STAGE` → tree shows files
- [ ] `COPY INTO QA_T FROM @QA_STAGE PATTERN = '.*csv'` → bulk load
- [ ] Evidence:

### Pipes (continuous load)
- [ ] `CREATE PIPE QA_PIPE AS COPY INTO QA_T FROM @QA_STAGE` — auto-ingest from S3 events
- [ ] Out of scope unless test env supports

## Cost considerations (testing)

- [ ] Each query consumes warehouse credits — keep test warehouse X-Small
- [ ] AUTO_SUSPEND short (60s) during testing
- [ ] Drop warehouses after test session

## Cross-platform

- [ ] snowflake-sdk is pure JS — works on all OS
- [ ] SSL CA bundle bundled
- [ ] Evidence:

## Known limitations

- snowflake-sdk has a heavy startup cost — first connect ~3-5s
- No prepared statement reuse across connections
- VARIANT max size: 16MB; larger JSON fails
- Time Travel SELECT requires CONNECT to a snapshot — UI may not yet expose
- Key-pair auth requires PKCS#8-encoded private key
- OAuth flow not yet wired in the connection dialog
