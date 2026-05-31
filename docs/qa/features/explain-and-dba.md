# EXPLAIN + DBA Tools — manual QA

Covers: EXPLAIN visualizer, slow-query sparkline, health check v1, SQL linter (production checks).

> Run when changing: `packages/ui/src/explain/*`, `packages/ui/src/slow-query.ts`, `packages/ui/src/health-check.ts`, `packages/ui/src/sql-linter.ts`.

## Setup

- Branch / commit:
- OS:
- Active connection with a populated test schema (e.g. sakila on MySQL, dvdrental on PG)

## EXPLAIN visualizer

### Per-dialect parse + render

For each dialect, run an `EXPLAIN <select>` against a join query:

| Dialect | EXPLAIN parses? | Visualizer renders? | Notes |
|---|:---:|:---:|---|
| MySQL | [ ] | [ ] | `EXPLAIN FORMAT=TREE`, then JSON for analyze |
| PostgreSQL | [ ] | [ ] | `EXPLAIN (FORMAT JSON, ANALYZE)` |
| Oracle | [ ] | [ ] | `EXPLAIN PLAN FOR` + `SELECT * FROM TABLE(dbms_xplan.display())` auto-stitched |
| DM | [ ] | [ ] | as Oracle |
| SQL Server | [ ] | [ ] | `SET SHOWPLAN_XML ON` |
| ClickHouse | [ ] | [ ] | `EXPLAIN PLAN` |
| TiDB | [ ] | [ ] | as MySQL |
| OceanBase MySQL | [ ] | [ ] | as MySQL |
| OceanBase Oracle | [ ] | [ ] | as Oracle |

Evidence per dialect: screenshot of visualizer tree + estimated rows.

### Estimated vs actual rows

- [ ] Run with ANALYZE (where supported) → tree shows both **estimated** and **actual** rows per node
- [ ] When estimate is off by >10x from actual → node highlighted yellow
- [ ] When estimate is off by >100x → node highlighted red
- [ ] Click node → detail panel with cost / rows / loops
- [ ] Evidence:

### Slow operator highlight

- [ ] Run an EXPLAIN ANALYZE on a query with a known full-table scan → "Seq Scan" / "ALL" node highlighted
- [ ] Hover → tooltip explains "full scan, consider index on X.Y"
- [ ] Evidence:

### Export / copy plan

- [ ] Click "Copy as text" → plain text tree copied
- [ ] Click "Export PNG" → image saved
- [ ] Click "Copy as JSON" → raw EXPLAIN JSON copied
- [ ] Evidence:

## Slow-query sparkline

### Capture
- [ ] Run several queries with varying duration → toolbar / status bar shows sparkline of last N queries
- [ ] Hover → tooltip with execution time, SQL preview
- [ ] Click a slow point → opens that query in editor
- [ ] Evidence:

### Threshold marker
- [ ] Set "slow threshold" in settings (e.g. 1000ms)
- [ ] Sparkline shows red marker for executions >threshold
- [ ] Evidence:

### Per-connection vs global
- [ ] Sparkline can be filtered to current connection only or all connections
- [ ] Toggle works, state persists
- [ ] Evidence:

## Health check v1

- [ ] DBA panel → "Run health check" → progress bar → report
- [ ] Report includes (at minimum):
  - [ ] Tables without primary key
  - [ ] Tables without indexes (and row count > threshold)
  - [ ] Duplicate / overlapping indexes
  - [ ] Auto-increment column approaching INT range (warn at 80% capacity)
  - [ ] Unused indexes (if dialect tracks usage stats, e.g. PG `pg_stat_user_indexes`)
- [ ] Each finding has severity (info / warning / error) and a suggested fix
- [ ] Click finding → opens the relevant table in tree / editor
- [ ] Evidence: paste report summary

### Per-dialect
- [ ] MySQL — runs without errors against `information_schema`
- [ ] PG — uses `pg_stat_*` views
- [ ] Oracle — uses `DBA_*` views (requires DBA role) — degrades gracefully if not granted
- [ ] DM — as Oracle
- [ ] SQL Server — uses `sys.dm_*` views
- [ ] Evidence:

## SQL Linter (production safety checks)

### Lint rules to verify

| Rule | Example SQL | Expected | Status |
|---|---|---|:---:|
| `SELECT *` warning | `SELECT * FROM users` | yellow underline + tooltip | [ ] |
| `UPDATE` without `WHERE` | `UPDATE users SET active=0` | red underline + tooltip | [ ] |
| `DELETE` without `WHERE` | `DELETE FROM users` | red underline + tooltip | [ ] |
| `TRUNCATE` | `TRUNCATE TABLE users` | red underline (irreversible) | [ ] |
| `DROP TABLE/DATABASE` | `DROP TABLE users` | red underline | [ ] |
| Cartesian JOIN (no ON) | `SELECT * FROM a, b` | yellow underline | [ ] |
| Implicit type coercion | `WHERE id = 'abc'` (id is INT) | info underline | [ ] |
| Old-style outer join `(+)` (Oracle) | `WHERE a.id = b.id(+)` | info | [ ] |
| `SELECT TOP` without ORDER BY (SQL Server) | `SELECT TOP 10 FROM t` | warning | [ ] |
| `LIMIT` without ORDER BY (PG / MySQL) | `SELECT * FROM t LIMIT 10` | info (non-deterministic order) | [ ] |

### Disable / re-enable rules
- [ ] Settings → "Linter rules" → toggle off "SELECT *" → editor no longer underlines
- [ ] Re-enable → re-underlines without reload
- [ ] Evidence:

### Disable per query
- [ ] Add `-- skylerx:disable-next-line select-star` before a SELECT * → no warning for that line only
- [ ] Evidence:

## Production-flag interaction

- [ ] On prod-flagged connection, running `DELETE FROM ...` with no WHERE → BOTH linter warning AND red modal demanding type-to-confirm
- [ ] On non-prod → only linter warning, no modal
- [ ] Evidence:

## Cross-platform

- [ ] EXPLAIN visualizer renders identically on all 3 OS
- [ ] Sparkline tooltips position correctly on Windows ARM64 (regression on this one before)
- [ ] Evidence:

## Known limitations

- Health check v1 reports max 50 findings; large schemas can have more — v2 will paginate
- EXPLAIN for very wide queries (>20 joins) may render slowly; OK to ship
- Some dialects (Doris / StarRocks) have less rich EXPLAIN output — fewer node types displayed
