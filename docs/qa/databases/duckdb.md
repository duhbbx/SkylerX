# DuckDB — manual QA

**Covers**: DuckDB (in-process OLAP, file-based or in-memory).
**Driver**: `packages/core-driver/src/dialects/duckdb.ts` (`duckdb` npm, **native** module).
**Wire**: None — file-based, in-process.

## Setup

- Branch / commit:
- OS:
- Test file: `/tmp/qa.duckdb`

## Native module load

- [ ] Fresh install lazy-loads `duckdb` without crash
- [ ] Prebuilt binary for current platform exists OR builds from source
- [ ] Bundle includes the C++ extension binaries
- [ ] Evidence:

## Connection

- [ ] File path → opens (creates if missing with toggle)
- [ ] `:memory:` → ephemeral
- [ ] Wrong path / unwritable → specific error
- [ ] Evidence:

## Database / schema

DuckDB supports multiple **catalogs** (attached DBs) and schemas.

- [ ] `ATTACH '/tmp/qa2.duckdb' AS qa2`
- [ ] Cross-catalog query: `SELECT * FROM qa2.main.t`
- [ ] `CREATE SCHEMA qa_s`
- [ ] Tree shows catalogs → schemas → tables
- [ ] Default schema = `main`
- [ ] Evidence:

## Tables

DuckDB has rich types including nested (LIST, STRUCT, MAP) and decimal arithmetic.

```sql
CREATE TABLE qa_t (
  id           BIGINT PRIMARY KEY,
  name         VARCHAR NOT NULL,
  email        VARCHAR UNIQUE,
  age          INTEGER,
  salary       DECIMAL(15,2),
  bio          TEXT,
  payload      JSON,
  bin_data     BLOB,
  is_active    BOOLEAN DEFAULT TRUE,
  tags         VARCHAR[],             -- list / array
  address      STRUCT(street VARCHAR, city VARCHAR, zip VARCHAR),
  scores       MAP(VARCHAR, INTEGER),
  ts_range     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  birth_date   DATE,
  uuid         UUID
);
```

- [ ] Statement runs
- [ ] Tree expand → all types render (especially nested)
- [ ] LIST / STRUCT / MAP columns:
  - [ ] Grid shows nested data with expand-button
  - [ ] Click cell → JSON-tree viewer
  - [ ] No crash on heavily nested
- [ ] DECIMAL preserves precision (no float drift)
- [ ] Evidence:

### Identifier case
- [ ] Default case-insensitive (lowercase storage internally)
- [ ] Quoted preserves case

### ALTER / DROP / TRUNCATE
- [ ] `ALTER TABLE qa_t ADD COLUMN phone VARCHAR`
- [ ] `ALTER TABLE qa_t DROP COLUMN phone`
- [ ] `ALTER TABLE qa_t RENAME phone TO mobile`
- [ ] `ALTER TABLE qa_t ALTER phone TYPE TEXT USING phone::TEXT`
- [ ] `DROP TABLE qa_t`
- [ ] No native `TRUNCATE` — verify behavior on app's "Empty table" action

## Indexes

DuckDB is columnar; indexes have limited role.

- [ ] B-tree-like: `CREATE INDEX qa_idx ON qa_t(name)`
- [ ] UNIQUE indexes enforce
- [ ] Mostly relies on min/max statistics per row group instead of indexes
- [ ] `DROP INDEX qa_idx`
- [ ] Evidence:

## Views

- [ ] `CREATE VIEW qa_v AS SELECT id, name FROM qa_t`
- [ ] `CREATE OR REPLACE VIEW` — works
- [ ] Views are read-only (no UPDATE through view)
- [ ] Tree shows views

## Constraints

- [ ] PK, UNIQUE, NOT NULL, CHECK all enforced
- [ ] FK supported (DuckDB 0.10+) — verify CASCADE / SET NULL / RESTRICT
- [ ] Evidence:

## Functions / Stored procedures

- DuckDB has NO stored procedures.
- Built-in functions: 100s for analytics (window, aggregation, list, struct, JSON, regex, math, date, geo)
- User-defined functions via Python / C++ extension — out of scope for app
- Skip section.

## Triggers

- DuckDB has NO triggers.
- Skip section.

## Sequences

```sql
CREATE SEQUENCE qa_seq START 1000 INCREMENT 10;
SELECT NEXTVAL('qa_seq');
ALTER SEQUENCE qa_seq RESTART 5000;
DROP SEQUENCE qa_seq;
```

- [ ] All work
- [ ] Tree shows sequences

## Users · Roles · Grants

- DuckDB has NO built-in user / role system (single-process embedded DB).
- Skip this section.

## DML / Query

### INSERT
- [ ] Single, multi-row
- [ ] `INSERT OR IGNORE`
- [ ] `INSERT OR REPLACE`
- [ ] `INSERT ... ON CONFLICT(col) DO UPDATE` (upsert)
- [ ] `INSERT ... RETURNING *`
- [ ] Mass load: `COPY qa_t FROM '/tmp/data.csv' (DELIMITER ',', HEADER)`
- [ ] Mass load Parquet: `COPY qa_t FROM '/tmp/data.parquet'`
- [ ] Evidence:

### UPDATE / DELETE
- [ ] Standard syntax
- [ ] `UPDATE ... RETURNING *`
- [ ] Evidence:

### SELECT — query shapes

DuckDB's claim to fame is OLAP / analytical queries. Verify:

- [ ] JOIN: INNER, LEFT, RIGHT, FULL OUTER, CROSS, LATERAL, SEMI, ANTI, ASOF
- [ ] CTE: `WITH …` (recursive supported)
- [ ] Window functions: full SQL standard set
- [ ] GROUPING SETS / ROLLUP / CUBE
- [ ] PIVOT / UNPIVOT (DuckDB-specific syntax)
- [ ] FILTER clause: `COUNT(*) FILTER (WHERE x > 0)`
- [ ] LIMIT … OFFSET … (or `LIMIT 10 BY 1` for sample)
- [ ] `USING SAMPLE 10%` — sampling clause
- [ ] UNION / INTERSECT / EXCEPT (with BY NAME for column-name matching)
- [ ] Evidence:

### Type-specific
- [ ] LIST: `WHERE 'a' IN tags`, `WHERE len(tags) > 0`, `WHERE tags[1] = 'x'`
- [ ] STRUCT: `WHERE address.city = 'NYC'`
- [ ] MAP: `WHERE scores['math'] > 90`
- [ ] JSON: `WHERE payload->>'k' = 'v'`, `json_extract(payload, '$.k')`
- [ ] Date: `WHERE created_at > NOW() - INTERVAL 7 DAY`
- [ ] Geo (with spatial extension): `WHERE ST_Within(geom, polygon)`
- [ ] Evidence:

### Reading external files in queries (DuckDB superpower)
- [ ] `SELECT * FROM read_csv_auto('/tmp/data.csv')` → reads CSV inline
- [ ] `SELECT * FROM read_parquet('/tmp/*.parquet')` → wildcards work
- [ ] `SELECT * FROM 'https://…/data.parquet'` → remote URL (if `httpfs` extension)
- [ ] `INSTALL httpfs; LOAD httpfs;` works
- [ ] `INSTALL spatial; LOAD spatial;` works
- [ ] Evidence:

## Transactions

- [ ] `BEGIN TRANSACTION`, `COMMIT`, `ROLLBACK` — supported
- [ ] Single-writer model (similar to SQLite WAL)
- [ ] Savepoints supported
- [ ] DDL transactional (CREATE TABLE inside BEGIN can be ROLLBACK'd)
- [ ] Evidence:

## Dialect-specific quirks

### Vectorized execution
- [ ] Very fast on `SELECT COUNT(*), AVG(...)` over millions of rows — verify the grid loads first chunk fast
- [ ] Column projection: `SELECT id, name FROM big_table` — only those columns scanned

### Read-only DBs
- [ ] Open with `mode=READ_ONLY` → INSERT fails with specific error
- [ ] Useful for sharing one file across multiple processes

### Pandas / Arrow integration
- [ ] DuckDB can read Python pandas dataframes — out of scope for app

### Extensions
- [ ] List extensions: `SELECT * FROM duckdb_extensions()`
- [ ] Built-in / autoloaded: `json`, `parquet`, `icu`
- [ ] On-demand: `INSTALL spatial; LOAD spatial;`
- [ ] Persistence of installed extensions: stays installed across connections in same data dir
- [ ] Verify app does NOT silently fail when an unload extension is referenced

## Cross-platform

- [ ] Prebuilt for macOS arm64 / x64, Windows x64, Linux x64
- [ ] Windows ARM64 and Linux ARM64 — verify build
- [ ] Native binary size: ~50MB — verify acceptable
- [ ] Evidence:

## Known limitations

- Single writer at a time (like SQLite); concurrent writers from different processes → conflict
- Memory-heavy queries on small machines → OOM possible; DuckDB respects `memory_limit` PRAGMA
- No FOREIGN KEY enforcement in older DuckDB (<0.10); verify version
- HTTPFS / S3 extension needs credentials passed in URL or env vars — app should expose UI eventually
- DELETE leaves "deleted" rows in storage until vacuum; database file grows until `VACUUM`
