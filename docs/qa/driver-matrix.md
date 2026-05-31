# Driver matrix

Per-dialect connectivity + CRUD + metadata battery. Run when:

- Adding / upgrading a driver
- Tagging a release (subset matching shipped scope)
- A driver-related bug ships and you need a regression baseline

> **Evidence policy**: a tick **must** be accompanied by either the actual SQL output (paste in PR / issue) or a screenshot of the result grid. A bare `[x]` does not count.

## Test environments

Suggested per-family local stacks:

| Family | Recommended local env |
|---|---|
| **MySQL family** | MySQL 8.0 + MariaDB 11 via Docker, OceanBase 4.3 docker-ce, TiDB Playground, Doris docker-compose, StarRocks all-in-one |
| **PostgreSQL family** | PostgreSQL 16, KingbaseES V9 (eval), CockroachDB single-node, Greenplum docker, openGauss docker, H2 in PG-server mode |
| **SQL Server** | Azure SQL Edge (mac/Linux) or full SQL Server 2022 on Win |
| **Oracle** | Oracle XE 21c in docker (`gvenzl/oracle-xe`) |
| **DM** | DM8 trial container |
| **SQLite / DuckDB / H2** | Local file in `/tmp/test.{db,duckdb,h2.db}` |
| **ClickHouse** | `clickhouse/clickhouse-server` docker |
| **Snowflake** | Personal trial account (28-day free) |
| **Redshift** | Skip locally, run on staging cluster only |
| **TDengine** | `tdengine/tdengine` docker, websocket port 6041 |
| **MongoDB / Redis / Elasticsearch** | Stock docker images |

## Common SQL battery (run against every SQL dialect)

| # | Test | Expected | Evidence shape |
|---|---|---|---|
| 1 | Click "Test connection" with correct credentials | Green toast, server version shown | screenshot |
| 2 | Wrong password | Red toast with **specific** error code (not "Unknown") | screenshot |
| 3 | Wrong host (timeout) | Red toast within 10s, message includes timeout | screenshot |
| 4 | Save, close, reopen app | Connection still present, fields preserved | screenshot |
| 5 | Tree: expand connection → see databases / schemas | Tree shows expected list | screenshot |
| 6 | Tree: expand a schema → see tables | List matches `SHOW TABLES` (or equivalent) | SQL output |
| 7 | Tree: expand a table → columns + indexes + FKs | Metadata correct vs `DESCRIBE` | SQL output |
| 8 | Run `SELECT 1` (or dialect equivalent) | Returns 1 row, 1 col | screenshot |
| 9 | Run `CREATE TABLE qa_t (id INT PRIMARY KEY, n VARCHAR(50))` (dialect-translated) | Tree shows new table after refresh | screenshot |
| 10 | `INSERT INTO qa_t VALUES (1,'one'),(2,'two')` | Affected rows = 2 | SQL output |
| 11 | `SELECT * FROM qa_t ORDER BY id` | 2 rows, correct values | screenshot |
| 12 | `UPDATE qa_t SET n='ONE' WHERE id=1` | 1 row affected | SQL output |
| 13 | Edit a cell in result grid → commit | DB actually updated (re-query proves it) | screenshot |
| 14 | `DELETE FROM qa_t WHERE id=2` | 1 row affected, re-query shows 1 row | SQL output |
| 15 | Manual-commit BEGIN → INSERT → ROLLBACK | After rollback, row count unchanged | SQL output |
| 16 | Manual-commit BEGIN → INSERT → COMMIT | After commit, row count +1 | SQL output |
| 17 | `DROP TABLE qa_t` | Tree refreshes, table gone | screenshot |
| 18 | Cancel a long-running query (e.g. `SELECT SLEEP(30)` or equivalent) | Stops within ~1s, "cancelled" toast | screenshot |
| 19 | EXPLAIN a simple SELECT | Visualizer renders a tree | screenshot |
| 20 | Open second window, run separate query | Both windows execute independently | screenshot |
| 21 | Right-click table → Generate DDL | DDL appears in editor, syntactically valid | SQL output |
| 22 | Disconnect → reconnect from menu | Tree reloads, no leftover state | screenshot |

## Per-dialect run-status table

Mark per driver. Use the "Notes / failures" column to link issues.

### MySQL family (mysql2)

| Dialect | Version tested | Test 1-8 | Test 9-17 | Test 18-22 | Notes / failures |
|---|---|:---:|:---:|:---:|---|
| MySQL | 8.0.x | | | | |
| MariaDB | 11.x | | | | |
| OceanBase | 4.3 MySQL mode | | | | |
| OceanBase Oracle tenant | 4.3 Oracle mode | | | | run via Oracle driver, not MySQL |
| TiDB | 7.5+ | | | | |
| Doris | 2.x | | | | INSERT may need `;`-only batch mode |
| StarRocks | 3.x | | | | |
| GBase | 8s | | | | optional |

### PostgreSQL family (pg)

| Dialect | Version tested | Test 1-8 | Test 9-17 | Test 18-22 | Notes / failures |
|---|---|:---:|:---:|:---:|---|
| PostgreSQL | 16 | | | | |
| KingbaseES (人大金仓) | V9 | | | | check SYS_ prefixed catalogs |
| CockroachDB | 24.x | | | | UPDATE without WHERE flagged by linter |
| Greenplum | 7.x | | | | distribution policy column |
| openGauss | 6.0 | | | | |
| H2 (PG-server mode) | 2.x | | | | local file mode in `/tmp` |
| Redshift | current | | | | run against staging cluster only |

### Standalone SQL

| Driver | Version | Battery 1-22 | Notes |
|---|---|:---:|---|
| **SQL Server** (mssql) | 2022 / Azure SQL Edge | | check `bigint` round-trip, `datetimeoffset` display |
| **Oracle** (oracledb, thin) | 21c XE | | confirm thin mode loads w/o Instant Client; SYSDBA role |
| **DM** (dmdb, native) | DM8 | | native module loads on current Electron ABI |
| **SQLite** (better-sqlite3) | file mode | | force-kill safety (synchronous writes) |
| **DuckDB** (duckdb) | file mode | | bigint, list, struct column display |
| **ClickHouse** (@clickhouse/client) | 24.x | | Engine = MergeTree in CREATE |
| **Snowflake** (snowflake-sdk) | trial | | warehouse / role / db setup before connecting |
| **TDengine** (websocket) | 3.x | | port 6041; supertable expand in tree |

## NoSQL channel battery (executeCommand)

NoSQL drivers don't run SQL. They use a separate IPC channel — `executeCommand(connId, payload)` — with payload shape per dialect.

### MongoDB

| # | Command | Expected | Evidence |
|---|---|---|---|
| 1 | Test connection | server version + replica-set status if applicable | screenshot |
| 2 | List databases | tree shows DBs | screenshot |
| 3 | List collections in a DB | tree expands collections | screenshot |
| 4 | `db.coll.find({}).limit(10)` | result grid shows BSON, ObjectId rendered | screenshot |
| 5 | `db.coll.insertOne({...})` | inserted id returned | output |
| 6 | `db.coll.updateOne(...)` | matched + modified count returned | output |
| 7 | `db.coll.deleteOne(...)` | deleted count returned | output |
| 8 | Dot-path filter (`{'a.b.c': 1}`) | works correctly | output |
| 9 | Aggregation pipeline | result rendered, $match/$group execute | screenshot |
| 10 | Disconnect / reconnect | clean reload | screenshot |

### Redis

| # | Command | Expected | Evidence |
|---|---|---|---|
| 1 | Test connection | INFO returned, server version shown | screenshot |
| 2 | List databases (0-15) | tree shows DB count | screenshot |
| 3 | `SCAN 0 MATCH * COUNT 100` | viewer paginates keys (no `KEYS *`) | screenshot |
| 4 | `SET k v` then `GET k` | round-trip | output |
| 5 | List operations (LPUSH, LRANGE) | list viewer renders | screenshot |
| 6 | Hash operations (HSET, HGETALL) | hash viewer renders | screenshot |
| 7 | Stream operations (XADD, XRANGE) | stream viewer renders | screenshot |
| 8 | Bitmap / HLL / Geo viewers | each renders sample data | screenshot |
| 9 | `DEL k` | key gone after refresh | screenshot |
| 10 | Disconnect / reconnect | clean reload | screenshot |

### Elasticsearch

| # | Command | Expected | Evidence |
|---|---|---|---|
| 1 | Test connection | cluster name + version | screenshot |
| 2 | List indices | tree shows indices | screenshot |
| 3 | `GET /_cat/indices?v` | table rendered | screenshot |
| 4 | `GET /index/_search { "query": ... }` | hits rendered in grid | screenshot |
| 5 | `POST /index/_doc { ... }` | created id returned | output |
| 6 | Update by query | matched / updated counts | output |
| 7 | Delete by id | success status | output |
| 8 | Index template / mapping view | mapping JSON renders | screenshot |
| 9 | Aggregations | aggregation result rendered | screenshot |
| 10 | Disconnect / reconnect | clean reload | screenshot |

## Dialect-specific quirks (regression bait)

Things that **historically broke** — explicitly recheck.

| Dialect | Quirk | Why it bites |
|---|---|---|
| **OceanBase Oracle tenant** | No `VERSION()` function | Use `SELECT 1 FROM DUAL` for probe; version via `v$version` |
| **Oracle** | thin mode lazy-loads `oracledb` | Won't fail until first connection; never preload |
| **Oracle / DM** | identifiers case-sensitive when quoted | `"test"` ≠ `TEST`; check both |
| **Oracle** | Default tablespace quota = 0 for new user | `ALTER USER X QUOTA UNLIMITED ON USERS` after CREATE |
| **DM** | dmdb is native; needs `electron-rebuild` per Electron version | Test that npm install + rebuild works on all 3 OS |
| **MySQL** | `SET sql_mode='ONLY_FULL_GROUP_BY'` breaks loose GROUP BY | Linter should flag |
| **SQL Server** | `bigint` > Number.MAX_SAFE_INTEGER | grid shows as string with annotation |
| **PG** | `bytea` rendering | hex prefix `\x...` should NOT be re-escaped |
| **ClickHouse** | INSERT requires `FORMAT` directive for big batches | Grid edit → single-row INSERT, no FORMAT needed |
| **Snowflake** | Identifiers default UPPERCASE unless quoted | match case behavior with Oracle |
| **Doris / StarRocks** | No `SHOW DATABASES LIKE` semantics on some versions | metadata fallback path |
| **SQLite** | `PRAGMA foreign_keys = ON` must be set per connection | check FK constraints actually enforce |
| **DuckDB** | LIST / STRUCT columns | grid viewer must not crash on nested |
| **TDengine** | super tables vs sub-tables | tree must distinguish, not flat |
| **MongoDB** | `_id` is ObjectId, not string | round-trip must preserve type |
| **Redis** | Binary-safe values | viewer must render hex for non-UTF8 bytes |
| **Elasticsearch** | Mappings vs templates | both should be browsable |

## Cross-platform per-driver

For each driver, verify the connection works on each OS you ship to.

| Driver | macOS arm64 | macOS Intel | Windows x64 | Windows ARM64 | Linux x64 | Linux ARM64 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| MySQL family | | | | | | |
| PostgreSQL family | | | | | | |
| SQL Server | | | | | | |
| Oracle (thin) | | | | | | |
| DM | | | | | | needs native rebuild matrix |
| SQLite | | | | | | native, watch for ABI mismatch |
| DuckDB | | | | | | |
| ClickHouse | | | | | | |
| Snowflake | | | | | | |
| TDengine | | | | | | |
| MongoDB | | | | | | |
| Redis | | | | | | |
| Elasticsearch | | | | | | |
