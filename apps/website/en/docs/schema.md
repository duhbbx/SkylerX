# Schema Management

A database isn't only about stuffing in data — most of the time you're drawing tables, altering them, reconciling, migrating. SkylerX gathers schema-related capabilities into a set of tools that span library / table / schema scopes, from read-only inspection to full two-database alignment.

This page goes from light to heavy: **view → design → edit → ER diagram → snapshot → cross-database diff → drift → create database/schema → AI assists**.

## Overview

| Tool | Trigger | Purpose | Generates SQL | Lands in DB |
|---|---|---|---|---|
| Table Structure (TableStructure) | Nav tree: default double-click on a table node | Read-only inspect columns/indexes/keys/DDL | — | No |
| Table Designer (TableDesigner) | Tree right-click → New table / Design table | Visual designer + diff-aware ALTER | ✓ (preview) | ✓ (after confirm) |
| DDL Editor (DdlEditor) | Tree right-click → New / Edit view, function, procedure, trigger | Write / edit DDL directly | ✓ (editor) | ✓ |
| ER diagram (ErdView) | Tree right-click schema → ER diagram | Whole-DB visualization + drag-to-create tables / add FKs | ✓ (export .sql) | ✓ (apply to DB) |
| Schema snapshots (SchemaSnapshots) | Command palette `act:snapshots:{connId}` | Save current DDL to localStorage for later diff | — | No |
| Schema diff (SchemaDiff) | Command palette `act:schema-diff` | Cross-connection schema diff + alignment migration script | ✓ (open as query) | No |
| Schema drift (SchemaDrift) | Command palette `act:drift` | Deep drift detection between same-dialect connections (columns / indexes / FKs) | ✓ (alignment script) | ✓ (after confirm) |
| New database (NewDatabase) | Tree right-click connection node → New database | Per-dialect `CREATE DATABASE` | ✓ (editable preview) | ✓ |
| New schema (NewSchema) | Tree right-click DB node → New schema | PG / SQL Server / Oracle etc. | ✓ | ✓ |
| AI table designer (SchemaArchitect) | Command palette → AI table designer | Business description → multi-table DDL | ✓ | ✓ |
| AI reverse (SchemaReverse) | Command palette → AI reverse inference | Sample data → CREATE TABLE | ✓ | ✓ |

Now each one in detail.

## 1. View table structure (TableStructure)

The simplest "what does this table look like" view — clicking a table node opens a read-only tab. Source at `packages/ui/src/components/TableStructure.vue`.

Four tabs, each tab label suffixed with a count:

- **Fields** — column name / type / nullable / PK / default / comment
- **Indexes** — index name list (names only; details in the designer)
- **Keys** — PK / FK / unique key names
- **DDL** — the full `CREATE TABLE`

The DDL tab uses different strategies per dialect:

```ts
if (isMysql) {
  // MySQL family: SHOW CREATE TABLE — authoritative
  const r = await client.connections.execute(connId, `SHOW CREATE TABLE ${ref}`)
  // Read row['Create Table']
}
// Non-MySQL: buildCreateFromColumns(...) reconstructs a simplified DDL from column info
```

So on **MySQL / MariaDB / OceanBase** you see the DB's own DDL output verbatim; on PostgreSQL / Oracle / SQL Server etc., you see a reconstruction — usable but without complex bits like GENERATED / EXTENDS.

The top-right refresh button `⟳` re-fetches (`Promise.all([meta('columns'), meta('indexes'), meta('keys')])`) — handy after editing a table.

## 2. Visual table designer (TableDesigner)

`packages/ui/src/components/TableDesigner.vue`, **880 lines** — the workhorse of schema management. Two modes:

- `mode: 'create'` — new table (blank start)
- `mode: 'alter'` — alter existing (loaded from current columns + indexes + foreign keys)

### Top bar

| Button | Action |
|---|---|
| New / Reset | `resetTable()` clears to empty state |
| Save | Create mode → `CREATE TABLE`; alter mode → `ALTER TABLE` diff sequence |
| Save As | `prompt` for new table name → `CREATE TABLE` with current columns (a "clone structure" of sorts) |
| ➕ field / Insert field / Delete field / PK / ⬆⬇ | Splices the columns array directly |
| Table name input | Read-only in alter mode (renaming requires RENAME, outside the designer's scope) |

### Inner tabs (shown per dialect)

The `INNER` array defines 10 fixed tabs: `fields / indexes / fk / unique / check / trigger / options / storage / comment / sql`. Each is a reactive sub-form; edits feed straight into the SQL preview.

**Field table** (inline edit):

| Column | Editor |
|---|---|
| Name | plain input |
| Type | input + datalist (`type-list`), per-dialect candidates from `typeOptions(dialect)` |
| Length / Precision | numeric input |
| NULL / PK | checkboxes |
| Default / Comment | input |

Selecting a row exposes a "field properties" area below — only MySQL family shows `UNSIGNED / ZEROFILL / AUTO_INCREMENT / ON UPDATE CURRENT_TIMESTAMP / CHARSET / COLLATION`; all dialects show `GENERATED` expression.

**Indexes** — the type dropdown swaps per dialect: MySQL family → `BTREE / HASH / FULLTEXT / SPATIAL`, PG family → `btree / hash / gin / gist`. PG adds two extra columns: `WHERE` (partial index) and `CONC` (`CREATE INDEX CONCURRENTLY`, non-blocking).

**Foreign keys** — same idea: `ON DELETE / ON UPDATE` hardcoded to `CASCADE / SET NULL / RESTRICT / NO ACTION`; PG adds `MATCH FULL/PARTIAL/SIMPLE` and `DEFERRABLE`.

**Options** tab:

- MySQL family: Engine / Charset / Collation / Row Format (`DYNAMIC / COMPRESSED / COMPACT / REDUNDANT`) / Auto-increment start
- PG family: `TABLESPACE / FILLFACTOR / INHERITS`
- Others: empty-state hint

### diff-aware ALTER (heart of alter mode)

Entering alter mode, `loadExisting()` calls `client.connections.metadata` to load columns and maps them to `ColumnDef[]`; then `loadIndexes()` / `loadForeignKeys()` query `information_schema` for current indexes/FKs. **The whole snapshot is stored in `original.value / originalIndexes.value / originalForeignKeys.value`** as the diff baseline.

After that, `alterStmts` is `computed(() => buildAlterTable(dialect, tableRef, original.value, spec, { indexes: originalIndexes.value, foreignKeys: originalForeignKeys.value }))`.

`buildAlterTable` is a field-level diff between source and current:

- Renamed column (when `originalName` exists) → `ALTER TABLE ... RENAME COLUMN / CHANGE COLUMN`
- Removed row → `DROP COLUMN`
- New row → `ADD COLUMN`
- Type / nullability / default / comment changed → `MODIFY COLUMN` (MySQL) or `ALTER COLUMN` (PG/MSSQL)
- Indexes / FKs compared against `originalIndexes.value` → add/drop

The SQL preview tab (`inner === 'sql'`) shows the generated ALTER list; when nothing changes, it shows the `designer.noChanges` placeholder. **Save** executes each ALTER individually via `client.connections.execute`; any failure stops there and focuses the SQL tab — successful ones aren't rolled back (acceptable in alter scenarios; errors are displayed in the error bar).

### Dirty check + create-to-alter pivot

Dirty check compares `JSON.stringify({ tableName, spec })` against the baseline. When closing the tab, the parent calls `isDirty()` and prompts if unsaved. After save / reset, the baseline syncs — a fresh "new table" tab won't false-positive as dirty.

After a successful create-mode save, the component flips `runtimeMode` to `alter` and marks the freshly created columns with `originalName`. Subsequent saves run as ALTER diff. Result: hit save, the table exists, the tab stays open and doesn't jump away, and you can keep adding fields and tweaking types — the "design as you think" workflow.

## 3. DDL editor (views / functions / procedures / triggers)

`packages/ui/src/components/DdlEditor.vue`. For schema objects beyond the designer's scope, write SQL directly — this is a Monaco wrapper with dialect awareness.

- **mode: 'create'** — `objectTemplate(dialect, kind, ctx)` returns a minimal skeleton (e.g. `CREATE VIEW v AS SELECT 1;`)
- **mode: 'edit'** — `objectDdlQuery(dialect, kind, ref, node)` fetches the existing definition

`objectDdlQuery` returns one of three modes:

| mode | Applies to | Source |
|---|---|---|
| `showCreate` | MySQL family | `SHOW CREATE VIEW / PROCEDURE / FUNCTION / TRIGGER`, take the field starting with `^create` |
| `viewdef` | PG views | `pg_get_viewdef(...)`; the component prepends `CREATE OR REPLACE VIEW ... AS\n` |
| `funcdef` / `oracle-ddl` | PG functions / Oracle DBMS_METADATA | Read `row.ddl` directly |

Toolbar:

- **Save / Run** (label switches per mode) — execute the whole text as a single statement (function / procedure bodies contain `;` and can't be split)
- **Format** — `sql-formatter` per dialect: `mysql` family → mysql, `pg` family → postgresql, `sqlserver` → transactsql, `oracle/dm` → plsql. Parse failures keep the text intact (don't block input).
- **Cancel** — close the tab

The error bar shows the server's raw error — triggers / stored procedures often hit DELIMITER issues.

## 4. ER diagram (ErdView)

`packages/ui/src/components/ErdView.vue`, a hand-drawn SVG canvas. Trigger: right-click a database / schema node in the tree → ER diagram, opens a `kind: 'erd'` tab.

### View mode (default)

- Loads all tables (`loadErd`, uses `information_schema` / `pg_constraint` etc.) → auto grid layout
- Mouse wheel = zoom, drag empty space = pan
- Tables can be dragged anywhere (including negative coords — canvas doesn't clip)
- Top bar: `－ / + / 1:1 / ⟳ / Edit` zoom and refresh

### Edit mode (click "Edit")

Three kinds of changes can be made together and committed in one batch:

1. **New table** — `addTable()` adds a blank table; add columns, change types, mark PK
2. **New FK** — drag from a column's right-side port to a column on another table → `newFks.push(...)`; renders as a purple dashed line
3. **ALTER ADD COLUMN** (D1) — "+ ALTER add..." button on existing tables → two prompts (name / type) → enters `alterAddCols[tableName]` and shows in purple with `+` prefix

### Output

`generateDdl()` calls `client.files.saveText` to produce a `.sql` file:

```sql
CREATE TABLE "t1" (
  "id" int,
  ...
);

ALTER TABLE "orders" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "users" ADD COLUMN "phone" varchar(64);
```

`applyChanges()` takes `buildDdl(true)` (additions only), splits by `;\n`, sends them via `executeBatch` to the current connection. On success: `load()` re-pulls, back to view mode. On failure: an alert; the user's structure is untouched.

## 5. Schema snapshots (SchemaSnapshotsDialog)

`packages/ui/src/components/SchemaSnapshotsDialog.vue`. Trigger: command palette `act:snapshots:{connId}`.

Purpose: **same connection, different times** DDL comparison. Doesn't overlap with SchemaDiff (cross-connection) or SchemaDrift (deep drift).

### Take a snapshot

Click "📸 Take snapshot" → pulls all table DDL under the first database/schema. MySQL uses `SHOW CREATE TABLE`; PG assembles a simplified DDL (columns + types + nullable + DEFAULT). When done, prompts for a comment ("before release / after order system rewrite / ...") and saves to `localStorage['skylerx.schema-snapshots']`. Each connection keeps at most `MAX_PER_CONN = 20` snapshots — older ones are LRU-evicted.

### Compare

Check two from the list (selecting a third evicts the oldest) → "⟷ Compare". The diff is straightforward:

- Only in A → `added` (green)
- Only in B → `removed` (red)
- Both but content differs → `changed` (yellow)
- Identical → `same` (hidden by default)

Click a diff row → two-pane DDL appears on the right for visual comparison.

> Limitation: only looks at the first database/schema. For multi-DB cases, snapshot each separately. `localStorage` is used because this is "journal-like" data — we don't want to clutter the SQLite migration with it. The 5MB quota is plenty for a few dozen tables × twenty snapshots.

## 6. Schema diff (SchemaDiffDialog) — cross-connection diff + alignment SQL

`packages/ui/src/components/SchemaDiffDialog.vue`. Trigger: command palette `act:schema-diff`.

### Preconditions

- Pick source connection + source schema, target connection + target schema
- Must be **same family** (MySQL ↔ MySQL / PG ↔ PG) — cross-family SQL syntax differs too much; the UI shows "only MySQL ↔ MySQL / PG ↔ PG supported"

Switching connections, `onPickSrc / onPickTgt` auto-fills the default schema: PG → `public`, MySQL → connection config's `database`.

### Fetch + compare

Both sides run an `information_schema.COLUMNS` query in parallel (`TABLE_NAME / COLUMN_NAME / type / nullable / PK / default`), producing `TableSnapshot[]`. `diffSchemas` then returns three buckets: `added / changed / removed`. Each `changed` row also carries column-level `columnChanges` (`add / drop / modify`).

### Output

`generateMigration` produces an alignment SQL for the target dialect, headed by a summary (X new, Y changed, Z removed). Two buttons:

- **Copy** — to clipboard
- **Open as query on target** — `emit('openSql', tgtId, migration)`; Workspace opens a new query tab with the SQL ready for review before Run. This makes sure **nothing auto-lands in the DB**.

## 7. Schema drift detection (SchemaDriftDialog)

`packages/ui/src/components/SchemaDriftDialog.vue`, **925 lines**, goes a level deeper than SchemaDiff. Trigger: command palette `act:drift`.

Difference: SchemaDiff only checks columns; DriftDialog also checks **indexes** and **foreign keys**, and its alignment script can **execute directly inside SkylerX**.

### TableProfile

Each table is normalized into a `TableProfile`: `columns: Map<name, {type, nullable, default, pk}>` + `indexes: Map<name, {unique, columns[]}>` + `fks: Map<name, "(c1,c2) → other(c1,c2)">`, plus the raw DDL for eyeball comparison.

Source per dialect: MySQL uses `SHOW CREATE TABLE` + `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE`; PG uses `information_schema.columns` + `pg_indexes` (regex on `indexdef` for unique + column names) + `information_schema.constraint_column_usage`.

### Report

Three columns: **only in source / only in target / different content**. Each row in the third column expands to show column changes (`+ name / − name / ~ name`), index changes (`+ idx_x`), FK changes (`~ fk_x`). Clicking a row reveals two-pane DDL diff below.

### Alignment script (the key artifact)

Each row has a "+ Align" button that **appends** the fix SQL to the script preview at the bottom:

| State | Generated |
|---|---|
| Only in source | Copy the source DDL (`CREATE TABLE`) |
| Only in target | `-- DROP TABLE \`x\`; -- commented out, requires manual uncomment` |
| Column add | `ALTER TABLE \`t\` ADD COLUMN \`c\` {srcType};` |
| Column drop | Commented `-- ALTER TABLE ... DROP COLUMN ...` (prevents accidental delete) |
| Column modify | MySQL: `MODIFY COLUMN`; PG: `ALTER COLUMN ... TYPE` |
| Index / FK differences | `-- INDEX +xx` / `-- FK -xx` comment only (**not auto-generated**; index rebuild syntax is messy, left for humans) |

Run flow: `▶ Execute script` → high-risk confirmation → splits by `;\s*\n`, skipping `--` comment lines → `executeBatch`.

> Design choice: destructive ops are commented out, additive ops give executable SQL. "Comment what's destructive, allow what's recoverable" — least likely to cause incidents in ops scenarios.

## 8. New database (NewDatabaseDialog)

`packages/ui/src/components/NewDatabaseDialog.vue`. Tree right-click connection node → New database.

The dialog has: **Name (required)** + collapsible "Advanced" (charset / collation / comment) + **SQL preview (editable)**. What actually runs is the preview text, not the form — so you can manually add `IF NOT EXISTS` etc.

### Dialect matrix

| Dialect | Supported | Notes |
|---|---|---|
| MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks | ✓ | `CREATE DATABASE \`n\` [DEFAULT CHARACTER SET ...] [DEFAULT COLLATE ...]` (no COMMENT) |
| PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift | ✓ | `CREATE DATABASE "n" [ENCODING '...']` + separate `COMMENT ON DATABASE` |
| SQL Server | ✓ | `CREATE DATABASE [n]` (no charset) |
| ClickHouse | ✓ | `CREATE DATABASE \`n\` COMMENT '...'` |
| Snowflake | ✓ | `CREATE DATABASE "n" COMMENT = '...'` |
| TDengine | ✓ | `CREATE DATABASE n` (no quotes) |
| **Oracle / DM** | ✗ | Database = instance-level, needs DBCA. Suggests "usually a new schema (user) is the right move" |
| SQLite / DuckDB | ✗ | File-based; database = file, "create" by adding a new connection pointing to a path |
| H2 | ✗ | Decided by startup args, can't be created via SQL |
| MongoDB / Redis / Elasticsearch | ✗ | Use collection / index / db0-15 mechanisms, no CREATE DATABASE |

Unsupported dialects show a red message and submission is blocked.

### Charset options

Recommended per dialect:

- MySQL family: `utf8mb4 / utf8 / latin1 / gbk`; collation `utf8mb4_general_ci / unicode_ci / 0900_ai_ci / bin`
- PG family: `UTF8 / SQL_ASCII / LATIN1 / GBK`

On submit: split by `;\s*\n` and `execute` each statement.

## 9. New schema (NewSchemaDialog — special handling for Oracle)

`packages/ui/src/components/NewSchemaDialog.vue`. Tree right-click DB node → New schema.

### Dialect matrix

| supportInfo | Dialect | Syntax |
|---|---|---|
| `pg` | PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift | `CREATE SCHEMA "n" [AUTHORIZATION "owner"]` + optional `COMMENT ON SCHEMA` |
| `sqlserver` | SQL Server | `CREATE SCHEMA [n] [AUTHORIZATION owner]` |
| `snowflake` | Snowflake | `CREATE SCHEMA "n" [COMMENT = '...']` |
| `oracle` | Oracle / DM | **Schema = User** — CREATE USER + GRANT (see below) |
| `null` | MySQL / SQLite / ClickHouse / TDengine / NoSQL | No schema concept; shows "this dialect has no schema concept" |

### Oracle / DM special handling

In Oracle, "schema" is synonymous with "user". The dialog defaults reflect a sensible dev setup:

```sql
CREATE USER :name IDENTIFIED BY :password
  DEFAULT TABLESPACE USERS
  TEMPORARY TABLESPACE TEMP
  QUOTA UNLIMITED ON USERS;

GRANT CONNECT, RESOURCE, UNLIMITED TABLESPACE,
      CREATE VIEW, CREATE SYNONYM, CREATE SEQUENCE,
      CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE,
      CREATE MATERIALIZED VIEW, CREATE DATABASE LINK
   TO :name;
```

(`:name` / `:password` placeholders stand for actual username / password.)

The code comments are direct about the reasoning:

- `QUOTA UNLIMITED ON USERS` — without it, the new user gets `ORA-01950: insufficient quota on tablespace USERS` on first insert
- Oracle 12c+ `RESOURCE` no longer includes `CREATE VIEW / SEQUENCE` etc., so we must add them explicitly
- No `SELECT ANY TABLE / DBA / SYSDBA` — stays "only play in your own schema"
- Username / password are unquoted by default: legal unquoted identifiers get Oracle's auto-uppercase (avoids "double-quoted lowercase → later ALTER USER can't find it"). To keep lowercase or special characters, add quotes in the SQL preview manually

A blank password field is filled with a placeholder `CHANGE_ME_123` as a reminder to change it.

### Submit

`execute` is called with the `database` context (PG family schemas belong to a DB — USE first, then CREATE). On failure the toast includes an `askAi` link that sends SQL + error to AI for diagnosis (common cases: missing tablespace / insufficient privileges).

## 10. AI helpers: Schema Architect + Schema Reverse

Two conversational tools. Both leave the final SQL for you to review before executing.

### Schema Architect (business description → multi-table DDL)

`packages/ui/src/components/AiSchemaArchitectDialog.vue`. Conversational, multi-turn.

System prompt gist:

> You are a senior database architect. The user describes a business domain.
> 1. Design **multiple related tables** with PK, FK, indexes for the **`{dialect}`** dialect.
> 2. Output a single ```sql code block containing the COMPLETE CREATE TABLE statements.
> 3. Explain key design decisions in 2-4 bullets.
> 4. When user asks to revise, output the FULL updated SQL again (not a diff).

Workflow:

1. Describe the business ("e-commerce order system: users, products, orders, order items, with coupons")
2. AI returns markdown: design notes + complete SQL code block
3. Ask follow-ups ("add a status field" / "make order_items a partitioned table"); AI returns the **whole** new SQL
4. Top button `▶ Execute latest version` — takes `latestSql` (the SQL block from the most recent assistant turn), splits by `;\s*(?:\n|$)`, executes each

`latestSql` is always the most recent — five revisions in, you run revision five, never pollute with earlier turns.

### Schema Reverse (sample data → CREATE TABLE)

`packages/ui/src/components/AiSchemaReverseDialog.vue`. Single-turn, non-conversational. Good for "I have a CSV — build a table for it".

Inputs: **format** (CSV / TSV / JSON) + **table name** + **sample data** (a few rows with headers is most accurate) + optional "also generate INSERT".

The prompt enforces a 4-section output: **inference notes** (column → type → reasoning), **CREATE TABLE** (`sql` code block), **INSERT (data)** (optional, `sql` code block), **index suggestions** (bullet list).

After the AI responds, `extractSql(text)` automatically pulls the first SQL block into the editor below — edit and click `▶ Execute`.

> About index recommendations: Schema Reverse gives "suggestions" only (rule-of-thumb), it doesn't auto-create indexes. For index recommendations based on real query history + existing indexes → see [Advanced → Index recommender](./advanced.md).

## Compatibility matrix

Each tool's supported dialects. `▣` = full support, `◐` = partial, `-` = N/A.

| Tool | MySQL fam | PG fam | SQL Server | Oracle / DM | SQLite | ClickHouse | NoSQL |
|---|---|---|---|---|---|---|---|
| TableStructure | ▣ (`SHOW CREATE TABLE` raw) | ◐ (column rebuild) | ◐ (column rebuild) | ◐ (column rebuild) | ◐ | ◐ | - |
| TableDesigner — CREATE | ▣ | ▣ | ▣ | ▣ | ◐ (fewer types / options) | ◐ | - |
| TableDesigner — ALTER diff | ▣ | ▣ | ◐ | ◐ | ◐ | ◐ | - |
| DdlEditor | ▣ (SHOW CREATE) | ▣ (`pg_get_viewdef` / `funcdef`) | ◐ | ▣ (DBMS_METADATA) | ◐ | ◐ | - |
| ErdView | ▣ | ▣ | ◐ | ◐ | ◐ | - | - |
| SchemaSnapshots | ▣ | ◐ (simplified DDL) | - | - | - | - | - |
| SchemaDiff | ▣ | ▣ | - | - | - | - | - |
| SchemaDrift | ▣ | ▣ | - | - | - | - | - |
| NewDatabase | ▣ | ▣ | ▣ | - (use NewSchema) | - (file-based) | ▣ | - (uses dedicated commands) |
| NewSchema | - (no concept) | ▣ | ▣ | ▣ (=User) | - | - | - |
| AI Architect / Reverse | ▣ | ▣ | ▣ | ▣ | ▣ | ▣ | ◐ |

"MySQL family" = MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks. "PG family" = PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift / H2 (PG-compatible).

## Common workflows tying it all together

**Build a business database from scratch**:
1. Tree right-click connection → New database → SQL preview check → execute
2. Command palette → AI table designer → describe the business → get full DDL → execute on the new DB
3. Tree right-click schema → ER diagram → check relationships, tweak
4. Modify a field: tree right-click table → Design table (alter mode) → save (ALTER diff)

**Align two databases**:
1. Command palette `act:schema-diff` → pick dev / prod connections → get migration SQL → "Open as query on target" → review → Run
2. Suspect manual changes on prod: `act:drift` → pick baseline / prod → three-column report → click "+ Align" for each table to fix → review the script → execute

**Historical review**:
1. Before release: `act:snapshots:{connId}` → take snapshot → comment "before v2.0"
2. Three months later: open snapshots dialog → check "before v2.0" + a fresh snapshot → compare → see exactly what changed

That covers every schema-layer capability. For runtime query plans, slow logs, and index recommendations, see [Advanced features](./advanced.md); for cross-dialect migration tools, see [Database support](./databases.md).
