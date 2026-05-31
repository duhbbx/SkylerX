# Per-Database Manual QA

Deep test cases for each supported database / family. Covers what `driver-matrix.md` skips: object DDL, users / roles / grants, dialect-specific query semantics, edge cases unique to that engine.

> Use [`../driver-matrix.md`](../driver-matrix.md) for the **breadth** check (every dialect, basic connectivity + CRUD).
> Use the files here for the **depth** check (every object type, every grant, every query shape on one dialect).

## How to use

1. Pick the file for the database you're testing
2. Paste the relevant section(s) into your PR's "Manual test" block
3. Tick + attach evidence (SQL log, screenshot, or grid output)
4. Failures → file an issue, link back from the checklist

## Files

### SQL — relational families

| File | Dialects covered | When to run |
|---|---|---|
| [`mysql-family.md`](./mysql-family.md) | MySQL · MariaDB · OceanBase (MySQL) · TiDB | Any change touching mysql2 dialect or `dialects/mysql.ts` |
| [`doris-starrocks.md`](./doris-starrocks.md) | Apache Doris · StarRocks | Doris/StarRocks-specific work (uses MySQL wire but distinct DDL) |
| [`postgres-family.md`](./postgres-family.md) | PostgreSQL · KingbaseES · CockroachDB · Greenplum · openGauss · H2 (PG-server mode) | Any change touching pg dialect or `dialects/postgres.ts` |
| [`redshift.md`](./redshift.md) | Amazon Redshift | Cloud DW changes; uses pg driver with cluster-specific quirks |

### SQL — standalone

| File | Dialect | When to run |
|---|---|---|
| [`sqlserver.md`](./sqlserver.md) | SQL Server · Azure SQL | mssql driver changes |
| [`oracle.md`](./oracle.md) | Oracle · OceanBase (Oracle tenant) | oracledb thin mode, PL/SQL, system views |
| [`dm.md`](./dm.md) | DM 达梦 | dmdb native module, DM-specific catalogs |
| [`sqlite.md`](./sqlite.md) | SQLite | File-based, simple model |
| [`duckdb.md`](./duckdb.md) | DuckDB | OLAP file-based, LIST / STRUCT types |
| [`clickhouse.md`](./clickhouse.md) | ClickHouse | Columnar, no TX, MergeTree variants |
| [`snowflake.md`](./snowflake.md) | Snowflake | Cloud DW, warehouse / role / db hierarchy |
| [`tdengine.md`](./tdengine.md) | TDengine | 信创 time-series, super-table / sub-table |

### NoSQL

| File | Channel | When to run |
|---|---|---|
| [`mongodb.md`](./mongodb.md) | executeCommand → MongoDB | mongo driver / UI |
| [`redis.md`](./redis.md) | executeCommand → Redis | redis driver / UI |
| [`elasticsearch.md`](./elasticsearch.md) | executeCommand → ES | es driver / UI |

## Template

For a new dialect, copy this skeleton:

```markdown
# <Name> — manual QA

## Overview
- Wire protocol / driver / official docs link

## Connection
## Database / schema
## Tables
## Indexes
## Views
## Constraints
## Functions / Stored procedures
## Triggers
## Sequences / identity
## Users · Roles · Grants
## DML / Query
## Transactions
## Dialect-specific quirks
## Known limitations
```

Sections that don't apply to a given engine should say "Not supported by this dialect" rather than be deleted — keeps the structure scannable across files.
