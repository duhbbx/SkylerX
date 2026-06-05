# Manual QA Checklists

Hand-runnable test cases for SkylerX. These cover what unit tests can't reach: real database connectivity, UI behavior across platforms, IPC round-trips, cross-locale text fit, native module loading.

> Looking for **unit tests**? See `packages/**/src/**/*.test.ts` (Vitest). CI runs them on every push.
> Looking for **automated UI tests**? Planned (Playwright) in roadmap Q4.

## When to run what

| Trigger | Run |
|---|---|
| Opening a PR that touches a driver / feature | The matching feature checklist(s) below — paste into PR body's "Manual test" section |
| Cutting a release / RC | [`RELEASE_SMOKE.md`](./RELEASE_SMOKE.md) end-to-end on each shipped platform |
| Adding a new driver | [`driver-matrix.md`](./driver-matrix.md) → add a row + run minimum-connectivity battery |
| Adding a new dialect to an existing family | Append to family table in `driver-matrix.md` |
| User-reported regression | Find the relevant checklist, add a new check for the regression case, re-run |

## Index

### Top-level
- [`RELEASE_SMOKE.md`](./RELEASE_SMOKE.md) — pre-release smoke, ~15 min, all features touched briefly
- [`driver-matrix.md`](./driver-matrix.md) — per-dialect connectivity + CRUD + metadata battery (breadth check)

### Per-feature (`features/`) — depth check, one file per major feature area
- [`connections.md`](./features/connections.md) — new / edit / test / delete / duplicate / prod-flag / encryption
- [`nav-tree.md`](./features/nav-tree.md) — object-type coverage per dialect, multi-select / bulk ops, copy-connection-info, exclude-system, move-to-group, visible-DBs config, IME-safe prompts
- [`sql-editor.md`](./features/sql-editor.md) — Monaco, run, format, AI inline completion, params, snippets, multi-tab
- [`result-grid.md`](./features/result-grid.md) — virtual scroll, edit, JSON/BLOB viewer, sparkline, filter, sort, ask-AI on error
- [`transactions.md`](./features/transactions.md) — manual-commit mode, session lifecycle, BEGIN/COMMIT/ROLLBACK
- [`query-history.md`](./features/query-history.md) — history, tags, pin, search, delete
- [`schema-tools.md`](./features/schema-tools.md) — DDL generation, schema diff, mock data v1, Oracle → DM wizard
- [`explain-and-dba.md`](./features/explain-and-dba.md) — EXPLAIN visualizer, slow-query sparkline, health check, SQL linter
- [`ai-features.md`](./features/ai-features.md) — chat, error-Ask-AI, toolboxes, multi-provider, settings persistence
- [`nosql-channels.md`](./features/nosql-channels.md) — MongoDB, Redis, Elasticsearch specifics
- [`import-export.md`](./features/import-export.md) — CSV / Excel / JSON / SQL / Parquet / Markdown
- [`type-rendering.md`](./features/type-rendering.md) — cross-dialect value rendering (TINYINT(1)/JSONB/UUID/smallint/custom types), identifier case, IPv6/SSH-password, clipboard import
- [`multi-window-i18n.md`](./features/multi-window-i18n.md) — multi-window, 7-locale switch, RTL safety
- [`auto-update.md`](./features/auto-update.md) — check, download, install, GitHub / OSS-CN channel switch
- [`safety.md`](./features/safety.md) — prod-flag confirm, dangerous-SQL guard, settings encryption, audit log

### Per-database (`databases/`) — depth check, one file per dialect family

Object DDL, users / roles / grants, dialect-specific query semantics, regression bait.
See [`databases/README.md`](./databases/README.md) for the full index.

**Relational families** (shared driver = one file per family):
- [`databases/mysql-family.md`](./databases/mysql-family.md) — MySQL · MariaDB · OceanBase (MySQL mode) · TiDB
- [`databases/doris-starrocks.md`](./databases/doris-starrocks.md) — Apache Doris · StarRocks
- [`databases/postgres-family.md`](./databases/postgres-family.md) — PostgreSQL · KingbaseES · CockroachDB · Greenplum · openGauss · H2 (PG-server)
- [`databases/redshift.md`](./databases/redshift.md) — Amazon Redshift (PG-wire + cloud DW quirks)

**Standalone SQL** (one file per dialect):
- [`databases/sqlserver.md`](./databases/sqlserver.md) · [`oracle.md`](./databases/oracle.md) · [`dm.md`](./databases/dm.md) · [`sqlite.md`](./databases/sqlite.md) · [`duckdb.md`](./databases/duckdb.md) · [`clickhouse.md`](./databases/clickhouse.md) · [`snowflake.md`](./databases/snowflake.md) · [`tdengine.md`](./databases/tdengine.md)

**NoSQL** (one file per dialect, all use `executeCommand` channel):
- [`databases/mongodb.md`](./databases/mongodb.md) · [`redis.md`](./databases/redis.md) · [`elasticsearch.md`](./databases/elasticsearch.md)

## How to use a checklist in a PR

1. Find the file(s) covering what you changed
2. Copy the relevant section(s) into your PR description's "Manual test" block
3. Run them, tick `[x]`, attach screenshot / SQL log / recording as **Evidence**
4. Reviewer reruns ≥2 random items (PR template prompts them)

## How to use a checklist for a release

1. Open a new "🚦 Release Smoke" issue (template at [`.github/ISSUE_TEMPLATE/50_release_smoke.yml`](../../.github/ISSUE_TEMPLATE/50_release_smoke.yml))
2. Edit the issue body, tick as you go
3. For per-driver coverage, run the rows in `driver-matrix.md` against the candidates listed in the release scope
4. Close the issue only when every item is ✅ or accepted

## Adding a new checklist

- For a new feature → new file under `features/`, follow the template at the top of any existing file
- For a new driver → add a row to `driver-matrix.md` (breadth) AND a deep file under `databases/` (depth, follow the section structure in `databases/README.md`)
- For a new dialect inside an existing family → append a column / row to the family file under `databases/`
- Always update this `README.md` index AND `databases/README.md` index when adding a file

## Stats

As of writing:

- 1 top-level smoke + 1 driver matrix
- 13 per-feature checklists
- 16 per-database checklists (covering 22 dialects across 13 driver implementations + 3 NoSQL channels)
- Combined: ~6000 lines, ~1000 ticked checkboxes — read what you need, not all of it at once
