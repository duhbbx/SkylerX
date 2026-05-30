# Advanced Features

This chapter covers the **power-user (DBA / data engineer / backend dev)** features. They live in right-click menus, the `⌘K` command palette, or deeper toolbar drawers — you won't hit them in everyday SELECTs, but they save serious time when:

- Trying to see whether an execution plan uses indexes, and which node is slowest
- Wanting to infer what indexes to build from historical SQL
- Wanting to see a table's column distribution / NULL ratio / whether types are oversized
- Cleaning duplicates / back-filling defaults / restoring from soft-delete
- Searching the whole database for a value's occurrences
- Building queries by drag-pick instead of typing SQL
- Managing Doris/StarRocks partitions / ClickHouse parts / MySQL binlog / PG extensions
- Migrating a whole Oracle DB to DM

The sections follow "look → change → search → build → migrate".

## 1. EXPLAIN visualizer — PlanPanel

Anyone who writes SQL has read EXPLAIN, but raw text is hard. SkylerX attaches a **Plan panel** next to QueryPane that renders EXPLAIN as a tree + summary.

### Trigger

| Entry | Action |
|---|---|
| QueryPane toolbar `📊 Plan` | EXPLAIN current SQL (doesn't actually run) |
| `⌘⇧E` / Ctrl+Shift+E | Same |
| `▶ Analyze` next to `📊 Plan` | EXPLAIN ANALYZE (**actually runs** — careful with DML) |

Backend goes through `plan.ts → planQuery(dialect, sql, { analyze })`:

| Dialect | Statement |
|---|---|
| PostgreSQL / Kingbase | `EXPLAIN (FORMAT JSON) <sql>` / `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <sql>` |
| MySQL / MariaDB / OceanBase | `EXPLAIN FORMAT=TREE <sql>` / `EXPLAIN ANALYZE <sql>` (MySQL 8.0.18+) |
| Other | Fall back to tabular EXPLAIN (plain `<pre>`) |

### Node tree rendering

PG's JSON Plan is parsed with `parsePgPlan` into a `PlanNode` tree, then `flattenPlan` flattens it to `{node, depth}` for rendering. Each node shows:

- **Label**: `Seq Scan` / `Index Scan` / `Hash Join` ...
- **Detail**: `on users` / `using users_pk` / `inner join`
- **Cost bar**: width = `cost / maxCost * 60px`, green-to-red gradient
- **Numbers**: `cost 1234.56 · est 1000 · act 1234 · 12.3ms` (act / ms only with ANALYZE)

### Slow-node coloring

PlanPanel marks the "expensive 1/3" nodes red:

```ts
function isSlow(node) {
  return node.cost >= maxCost.value * 0.33 && maxCost.value > 0
}
```

Red background + red label — **the eye spots what to optimize instantly** without comparing cost numbers row by row.

### Estimated vs actual skew

`estimateSkew(node)` computes `max(est, act) / min(est, act)`. ≥ 10× signals **stale optimizer stats** (a typical tell); a yellow side bar appears on the node and a `⚠ 24×` badge at the end. The summary bar also calls out the worst node:

```ts
let skewWorst = null
for (const r of arr) {
  const sk = estimateSkew(r.node)
  if (sk == null) continue
  if (!skewWorst || sk > skewWorst.skew) skewWorst = { node: r.node, skew: sk }
}
```

When you see this badge, it's usually time to `ANALYZE table` or refresh `pg_statistic`.

### Summary bar

Top of the panel:

| Field | Meaning |
|---|---|
| `Total Cost` | Cost of the heaviest node (root cumulative) |
| `Actual ms` | With EXPLAIN ANALYZE: per-node actual time summed |
| `Heaviest` | Name of the highest-cost node |
| `Skew` | Worst est-vs-actual node + multiplier |

---

## 2. Index recommender — IndexRecommender

`⌘K → Index recommender` or right-click a DB node in NavTree `🔧 Recommend indexes`.

### Inputs and outputs

| Input | Source |
|---|---|
| Historical SQL patterns | `client.connections.history(connId, 1000)` (latest 1000) |
| Existing indexes | MySQL `information_schema.STATISTICS` / PG `pg_index + pg_class` |

Output: `IndexHint[]` — each with table name, columns, score, reasoning, and a ready-to-run `CREATE INDEX` DDL.

### Inference algorithm (`index-recommender.ts`)

No SQL parser (expensive and dialect-divergent); uses **regex heuristics** to extract WHERE / JOIN / ORDER BY / GROUP BY:

1. **Aggregate history**: identical SQL text rolls into one row with `count` + `totalMs`
2. **Filter**: keep only `SELECT` / `WITH`, skip DML/DDL
3. **Parse aliases**: `parseTableAliases(sql)` extracts `tbl [AS] alias` from FROM/JOIN into a Map
4. **Scan four clause types**, each hit weighted:

| Clause | Base score | Notes |
|---|---|---|
| `WHERE col = ?` / `LIKE` / `IN` / `IS NULL` / `BETWEEN` | 5 | Strong signal |
| `JOIN ON a.col = b.col` | 3 | Both sides scored |
| `ORDER BY col` | 2 | Sorted index helps |
| `GROUP BY col` | 2 | Same |

5. **Time weighting**: per-SQL `count × min(perMs/avgMs, MAX_TIME_MULTIPLIER=5)` — prevents one or two slow SQLs from swamping the table
6. **Multi-table SQL** requires aliases for bare columns; **single-table** SQL accepts bare columns
7. **Filter existing indexes**: `isCovered(table, cols, known)` — if any existing index's prefix fully covers the suggested column list, skip
8. **Compound suggestions**: for each table, pair the top 3 columns to suggest two-column indexes

### DDL generation

```ts
function buildDdl(table, columns, dialect) {
  const idxName = `idx_${sanitize(table)}_${cols.map(sanitize).join('_')}`.slice(0, 60)
  return `CREATE INDEX ${quoteIdent(idxName)} ON ${quoteIdent(table)}(${cols.map(quoteIdent).join(', ')});`
}
```

MySQL uses backticks; PG uses double quotes.

### UI flow

Open the dialog and `run()` fires: scan → candidate list (sorted by `scoreEstimate` desc). Per row:

- `[Adopt]` → `emit('runSql', h.ddl)` pushes DDL to QueryPane (you review then run)
- `[Copy all]` copies every candidate DDL to clipboard
- `[Rescan]` reruns the flow

Supported on MySQL family / PG family; others show "not supported".

---

## 3. Data inspector — DataInspector

Table right-click `🔬 Data inspector`. One dialog, 5 tabs — covers the "see data health + one-click maintenance" DBA core actions. **Designed to NOT run SQL in parallel** (don't want to overwhelm prod): only the active tab fetches data.

### Tab 1: column sampling (A3)

Pick a column; one SQL computes all stats:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(col) AS non_null,
  COUNT(DISTINCT col) AS distinct_cnt,
  MIN(col) AS min_val,
  MAX(col) AS max_val
FROM <table>
```

Then a top-10:

```sql
SELECT col AS value, COUNT(*) AS cnt
FROM <table> GROUP BY col ORDER BY cnt DESC LIMIT 10
```

Cards show stats + top-N. High NULL rate / tiny distinct (probably a status code) / outliers stand out at a glance.

### Tab 2: whole-table profile (B6)

One big SELECT computes `COUNT(col)` + `COUNT(DISTINCT col)` for every column:

```sql
SELECT COUNT(*) AS total,
       COUNT(`a`) AS nn_a, COUNT(DISTINCT `a`) AS dc_a,
       COUNT(`b`) AS nn_b, COUNT(DISTINCT `b`) AS dc_b,
       ...
FROM <table>
```

Output: `column | type | NULL% | DISTINCT/total`. NULL% > 50 turns yellow — "this column may not be in use".

### Tab 3: constraint scan (B5)

Lists columns declared `IS_NULLABLE = 'NO'`, then runs `SELECT COUNT(*) WHERE col IS NULL` on each. > 0 = **constraint violation** (usually NOT NULL was added later but dirty data wasn't cleaned).

### Tab 4: type optimization suggestions (B9)

Per-column type-shrink suggestions:

| Current type | Check | Suggestion |
|---|---|---|
| `VARCHAR(255)` | `MAX(CHAR_LENGTH(col))` actual max | `VARCHAR(max(32, ceil(maxlen*1.5)))`, if declared > maxlen*4 and gap > 50 |
| `BIGINT` | `MAX(ABS(col))` | If < 2³¹-1 → `INT` |
| `INT` | Same | If < 32767 → `SMALLINT` |

Each suggestion includes a reason (`actual max is 20, declared 255 — wasting 235 bytes`).

### Tab 5: table maintenance (B10)

Per-dialect one-click buttons:

| Dialect | Buttons |
|---|---|
| MySQL family | `ANALYZE TABLE` / `OPTIMIZE TABLE` / `CHECK TABLE` |
| PG family | `ANALYZE` / `VACUUM FULL` / `VACUUM` / `REINDEX TABLE` |

Each requires confirmation (VACUUM FULL locks the table).

---

## 4. Data fixup — DataFixup

Table right-click `🩹 Data fixup`. Three tabs sharing the same "input → generate SQL → review → execute" skeleton. **Does not auto-commit** — pushes the generated SQL to QueryPane as a draft for you to inspect.

### Tab 1: duplicate row detection (B3)

Pick a few columns as **business key** (`email + tenant_id`); first GROUP BY to see duplicates:

```sql
SELECT col1, col2, COUNT(*) AS cnt
FROM <table>
GROUP BY col1, col2 HAVING COUNT(*) > 1
ORDER BY cnt DESC LIMIT 100
```

If confirmed, click `Generate cleanup SQL` for a `ROW_NUMBER()` window-delete (PG variant), with a MySQL self-join alternative in the comments:

```sql
-- Keep ROW_NUMBER() = 1 per group, delete the rest
DELETE FROM <table>
WHERE (col1, col2, ctid) IN (
  SELECT col1, col2, ctid FROM (
    SELECT col1, col2, ctid,
           ROW_NUMBER() OVER (PARTITION BY col1, col2 ORDER BY ctid) AS rn
    FROM <table>
  ) sub WHERE sub.rn > 1
);
```

### Tab 2: NULL back-fill (B4)

Pick a column + strategy:

| Strategy | Generated SET expression |
|---|---|
| `literal` | `'<user-typed value>'` |
| `avg` | `(SELECT AVG(col) FROM <table>)` |
| `min` / `max` | `(SELECT MIN/MAX(col) FROM <table>)` |
| `most_common` | `(SELECT col GROUP BY col ORDER BY COUNT(*) DESC LIMIT 1)` |

Final SQL: `UPDATE <table> SET col = <expr> WHERE col IS NULL;` — with a comment "do a SELECT COUNT first to see the impact".

### Tab 3: soft-delete restore (B8)

Heuristic search for soft-delete columns (`deleted_at` / `is_deleted` / `deleted`). Generates the right "revive" statement per type:

| Column name | Generates |
|---|---|
| `is_deleted` / `*_flag` | `UPDATE ... SET col = FALSE WHERE col = TRUE` |
| `deleted_at` / other timestamp | `UPDATE ... SET col = NULL WHERE col IS NOT NULL` |

Optional "extra WHERE" (`AND user_id = 42`) limits scope — avoids reviving every soft-deleted row at once.

---

## 5. Cross-table value search — SearchValueDialog

`⌘K → Cross-table search` or right-click a result cell `🔎 Find this value elsewhere` (the latter prefills the value).

### Workflow

1. **Fetch "searchable" text columns** (`information_schema.columns`):
   - MySQL: `varchar / char / text / tinytext / mediumtext / longtext / json`
   - PG: `character varying / character / text / json / jsonb`
2. **Group by table**: each table gets a `SELECT * FROM t WHERE col1 LIKE :v OR col2 LIKE :v ... LIMIT 50`
3. **Parallel run** (max 6 concurrent to protect the pool)
4. **Progress bar** + hit list

### Performance edge

Large DBs can have thousands of columns. Use `table_prefix` to narrow the scope (`user_*`). `matchMode` can be `contains` / `exact`:

- `contains` → `LIKE '%v%'` (slow but complete)
- `exact` → `= 'v'` (fast, good for ID lookup)

`maxPerTable` caps hits per table at 50 — prevents a wide table from blowing memory.

### Example

Investigating "why is user `alice@x.com` getting these pushes":

1. ⌘K → Cross-table search
2. Value `alice@x.com`, mode `exact`
3. Scan everything; sees `users(email)` + `subscription(email)` + `mail_logs(to_addr)` all contain it → locked the data flow

---

## 6. Row history — RowHistoryDialog

Right-click a row in the result grid `⏱ View history`.

### Heuristic shadow-table discovery

Given a PK (`{id: 42}`), auto-scan `information_schema.tables` for candidates:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE '<base>_%'
   OR table_name = 'audit_<base>'
   OR table_name = '<base>_history'
```

Pick from the `<datalist>` dropdown or type your own.

### Fetch history

Filter by PK, sort by `changed_at / updated_at / created_at / version / revision` desc:

```sql
SELECT * FROM <shadowTable>
WHERE id = 42
ORDER BY changed_at, updated_at, created_at, version, revision DESC
LIMIT 200
```

Each row is a version; column headers are the shadow table's columns; string fields truncated to 80 chars.

---

## 7. Visual query builder — VisualQueryDialog

`⌘K → Visual query` or right-click DB node `🎨 Visual build`.

**MVP doesn't do a drag canvas** — sticks with a sturdier "list + cards" layout that's actually usable, not just a demo.

### Layout

| Area | Content |
|---|---|
| Left | All tables in the DB + search + checkboxes |
| Middle | Checked tables expand into cards; each column has a checkbox (checked → SELECT; unchecked → shown only) |
| Top | WHERE / ORDER BY inputs + `LIMIT` |
| Bottom | Live-generated SQL + `Open as new query tab` |

### Auto JOIN

When two tables are checked, auto-detect "FK-looking" columns and emit `INNER JOIN`:

```ts
// inferConventionalFks
const m = /^(.+?)_id$|^(.+?)Id$/.exec(col.name)
// user_id → users.id  /  category_id → categories.id
```

Target candidates: `<base>` as-is + simple plural (`user → users`, `category → categories`). If no FK path → `CROSS JOIN` (with a visual hint about efficiency).

### SQL generation

```sql
SELECT users.id AS users_id, users.name AS users_name,
       orders.id AS orders_id, orders.amount AS orders_amount
FROM users
  INNER JOIN orders ON users.id = orders.user_id
WHERE amount > 100
ORDER BY users.id DESC
LIMIT 200
```

Columns aliased as `<table>_<col>` to avoid name collisions across tables.

---

## 8. MPP partition management — MppPartitionDialog

For Doris / StarRocks (MySQL-wire). DB node right-click `🗂 Partitions`.

### Fields

Runs `SHOW PARTITIONS FROM <db>.<tbl>`; shows:

| Field | Meaning |
|---|---|
| `PartitionId` / `PartitionName` | Partition meta |
| `State` | NORMAL etc. |
| `PartitionKey` / `Range` | Partition column + range |
| `DistributionKey` / `Buckets` | Bucket key + count |
| `ReplicationNum` | Replicas |
| `StorageMedium` | HDD / SSD |
| `CooldownTime` | Cooldown (HDD demotion) |
| `DataSize` | Partition size (auto KB/MB/GB) |

### Actions

| Button | Action |
|---|---|
| `+ Add partition` | Dialog for the `ADD PARTITION ...` clause; auto-prefixes `ALTER TABLE <db>.<tbl>` |
| Per-row `DROP` | Confirm → `ALTER TABLE <db>.<tbl> DROP PARTITION <name>` |
| `🔄 Refresh` | Re-runs SHOW PARTITIONS |

---

## 9. Dialect-specific advanced panels

### 9.1 MysqlAdvancedDialog

For MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks. 3 tabs:

| Tab | SQLs used |
|---|---|
| **Binlog** | `SHOW MASTER STATUS` + `SHOW BINARY LOGS` + (after selecting a file) `SHOW BINLOG EVENTS IN '<file>' LIMIT N` |
| **Replication status** | `SHOW REPLICA STATUS` (8.0+) preferred; fall back to `SHOW SLAVE STATUS` (MariaDB / older) |
| **Variables / Status** | `SHOW GLOBAL VARIABLES` / `SHOW GLOBAL STATUS`, filterable; Variables also support `SET GLOBAL k = v` |

### 9.2 PgAdvancedDialog

For PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift. 3 tabs:

| Tab | Source |
|---|---|
| **Extensions** | `pg_available_extensions`; one-click `CREATE EXTENSION IF NOT EXISTS "<name>" WITH SCHEMA "<schema>"` / `DROP EXTENSION` |
| **Publications / Subscriptions** | `pg_publication` + `pg_publication_tables` + `pg_subscription` (logical replication management) |
| **Slots** | `pg_replication_slots` (slot_name / plugin / slot_type / active / restart_lsn / confirmed_flush_lsn / wal_status); supports `DROP_REPLICATION_SLOT` |

### 9.3 ClickHouseAdvancedDialog

4 tabs, all reading `system.*`, mostly read-only:

| Tab | Source | Use |
|---|---|---|
| **Partitions** | `system.parts` (active only) | View `rows / bytes_on_disk / data_compressed_bytes / marks / min_date / max_date / level`; supports `DROP / DETACH / ATTACH PARTITION` |
| **Mutation** | `system.mutations` | View `is_done / command / parts_to_do / latest_failed_part / latest_fail_reason` |
| **Replicas** | `system.replicas` | View `is_leader / queue_size / inserts_in_queue / merges_in_queue / total_replicas / active_replicas / zookeeper_path` |
| **Table metadata** | `system.tables` | View `engine / total_rows / total_bytes / partition_key / sorting_key / primary_key / sampling_key / storage_policy` |

Each tab has a `database / table` filter at the top — essential for large clusters.

---

## 10. Oracle → DM migration wizard

A common Chinese-compliance contractor scenario: move a customer's Oracle DB to DM. `⌘K → Oracle → DM migration` opens the wizard.

### 5 steps

| Step | Action |
|---|---|
| 1. **Pick connections** | Filter saved connections by `dialect == Oracle` / `dialect == DM`; pick source + target |
| 2. **Pick objects** | Pull source `tables / views / sequences / procedures`; all selected by default, group / individual toggles |
| 3. **Preview** | Per object: `DBMS_METADATA.GET_DDL` for source DDL → `translateDdl()` → show warnings + allow edits |
| 4. **Execute** | Per object: `client.connections.execute(dstConnId, ddl)`; errors collected, doesn't stop |
| 5. **Report** | Markdown summary of success / failure / warnings; copyable / saveable |

### Translation rules (`oracleToDm.ts`)

**Type mapping** (`TYPE_MAP`):

| Oracle | DM | Notes |
|---|---|---|
| `VARCHAR2` | `VARCHAR` | — |
| `NVARCHAR2` | `NVARCHAR` | — |
| `NUMBER` | `NUMERIC` | DM accepts NUMBER too, but NUMERIC is more standard |
| `CLOB` / `NCLOB` / `BLOB` | Kept | — |
| `DATE` | `DATE` | ⚠ Oracle has h:m:s; DM doesn't |
| `TIMESTAMP` | `TIMESTAMP` | — |
| `RAW` / `LONG RAW` | `VARBINARY` | — |
| `LONG` | `CLOB` | Oracle deprecated |
| `BINARY_FLOAT` / `BINARY_DOUBLE` | `FLOAT` / `DOUBLE` | — |
| `ROWID` / `UROWID` | `VARCHAR(18)` / `VARCHAR(4000)` | DM has no equivalent — downgrade |
| `XMLTYPE` | `XML` | XPath/XQuery expressions may need rewriting |

**Type-replacement implementation**: sort by "longer key first" (`LONG RAW` before `LONG` so the shorter doesn't pre-empt); bare `NUMBER` without length isn't padded; `NUMBER(p,s)` carries numbers through; matched cases append warnings from `TYPE_NOTES`.

**Function / keyword mapping** (`FN_MAP`):

| Oracle | DM | Notes |
|---|---|---|
| `SYSDATE` / `SYSTIMESTAMP` | `CURRENT_TIMESTAMP` | DM accepts SYSDATE; standard form is sturdier |
| `NVL(a, b)` | `COALESCE(a, b)` | DM accepts NVL; COALESCE more portable |
| `NVL2(...)` | Kept | If unsupported: `CASE WHEN expr IS NOT NULL THEN a ELSE b END` |
| `MINUS` | `EXCEPT` | DM accepts MINUS; EXCEPT more standard |
| `DUAL` / `ROWNUM` | Kept | DM supports |

**Complex-syntax warnings** (`HARD_WARNINGS` — SQL is unchanged, just `[review]` warnings):

| Pattern | Warning |
|---|---|
| `DECODE(...)` | Still usable, but consider `CASE WHEN` for readability |
| `CONNECT BY` | Mostly compatible; advanced (`NOCYCLE` / `SYS_CONNECT_BY_PATH`) needs case-by-case review |
| `MERGE INTO` | Complex branches (`DELETE WHERE` / multi-source `UPDATE`) may behave differently |
| `INSTEAD OF (INSERT/UPDATE/DELETE) TRIGGER` | DM trigger semantics differ — bodies need manual migration |
| `SDO_GEOMETRY` / `MDSYS.*` | Oracle Spatial has no equivalent — use DMGeo or third-party |
| `DBMS_*` | Only partial simulation (`DBMS_OUTPUT`/`DBMS_LOB`); business packages need rewriting |
| `UTL_*` (`UTL_HTTP`/`UTL_FILE` etc.) | Usually unsupported — needs external scripts |
| `INTERVAL YEAR/DAY TO ...` | Some versions only support simplified forms — verify against your version |
| `PIVOT(...)` / `UNPIVOT(...)` | Partial since DM 8.x; older versions need `CASE WHEN` aggregation rewrite |
| `BULK COLLECT` / `FORALL` | PL/SQL bulk ops — DMSQL syntax differs slightly |

### Things deliberately not done

- **No PL/SQL block semantic translation** — procedures get the CREATE shell only; the body is on you
- **No trigger body translation** — same
- **No constraint dependency ordering** — alphabetical; failures retry on you
- **No transactional atomicity** — each object stands alone; failures get red marks

### Data migration (experimental)

Step 4 "Include data migration (first 100 rows per table)":

```sql
-- Source
SELECT * FROM "<table>"  -- limit 100 rows

-- Target
INSERT INTO "<table>" (col1, col2, ...) VALUES (v1, v2, ...)  -- per row
```

This is a **skeleton only** — full migrations need pagination + type conversion + batch insert; the wizard leaves that to later releases. For production data migrations, use professional tools like DTS / `expdp + impdp`.

### Report

After execution, Step 5 shows a Markdown summary like:

```markdown
# Oracle → DM migration report

- Source connection: `prod-oracle`
- Target connection: `dm-test`
- Time: 2026-05-30 10:23:11
- Total objects: 142, success 138, failure 4

## Succeeded
- [tables] ORDERS (124ms)
- [tables] USERS (89ms)
...

## Failed
- [procedures] CALC_BONUS
  - error: ORA-00942 table or view does not exist

## Translation warnings (human review)
- (ORDERS) [type] DATE: Oracle DATE includes h:m:s; DM DATE does not — switch to TIMESTAMP if you depend on time
- (ORDERS_REPORT) [review] PIVOT/UNPIVOT: partial since DM 8.x; older versions need CASE WHEN aggregation
```

`Copy` to clipboard or `Save` to a `.md` for the archive.

---

## 11. When to use what

A "right tool for the job" table to finish up:

| I want… | Use… |
|---|---|
| See where a slow SQL is stuck | **PlanPanel** + ANALYZE |
| Don't know what indexes to build | **IndexRecommender** |
| Health-check a table I just inherited | **DataInspector** whole-table profile + type optimization |
| Clean dirty data / dedup rows | **DataFixup** |
| Find where a value appears | **SearchValueDialog** |
| See a row's change history | **RowHistoryDialog** |
| Demo query-building to non-technical folks | **VisualQueryDialog** |
| Manage Doris partitions | **MppPartitionDialog** |
| Check MySQL binlog / replication lag | **MysqlAdvancedDialog** |
| Install PG extensions / configure logical replication | **PgAdvancedDialog** |
| Check CH parts / mutation status | **ClickHouseAdvancedDialog** |
| Migrate Oracle to DM | **OracleToDmWizard** |

These compose nicely with [AI assistant](./ai) — when PlanPanel shows a slow node, hit Ask AI; when IndexRecommender candidates are unclear, let AI explain; when DataInspector type suggestions worry you, let AI weigh the risk.
