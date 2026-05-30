# Data Flow: Import / Export / Backup / Migration

SkylerX collects every "data leaving / entering the database" path into a unified set of dialogs. Saving goes through a custom `SaveFileDialog` (cross-platform consistent — not the native system one); parsing happens in the renderer (CSV/JSON/Excel all processed in memory). This chapter goes in order: **export → import → backup/restore → cross-DB migration → data dictionary → data diff**.

## 1. Overview: what this chapter covers

| Scenario | Entry | Main dialog / function | Formats |
|---|---|---|---|
| Quickly copy a row or two | Result grid right-click → "Copy as" | `ResultGrid.vue::copyRows` | CSV / TSV / JSON / Markdown / SQL VALUES |
| Download a table / whole schema | NavTree right-click "Export SQL" → `ExportOptionsDialog` | `Workspace.vue::doTableExport` / `doSchemaExport` | SQL (CREATE + INSERT) |
| Move an entire workspace | Command palette `act:export-conns` / `WorkspaceExportDialog` | `WorkspaceExportDialog.vue` | `.skylerxws` JSON |
| Import CSV/JSON/Excel into a table | NavTree right-click "Import data" → `ImportDialog` | `ImportDialog.vue` + `io.ts` | CSV / TXT / JSON / NDJSON / XLSX |
| Paste straight from Excel / Lark | ⌘V in the main area (or `PasteImportDialog`) | `PasteImportDialog.vue` | TSV / CSV |
| Inspect a .ndjson file directly | Command palette `act:ndjson-viewer` | `NdjsonViewerDialog.vue` | `.ndjson` / `.jsonl` |
| Backup / restore a whole DB | Command palette `act:backup:<id>` (one per connection) | `BackupRestoreDialog.vue` | `.sql` / `.ndjson` |
| Copy a table across connections | NavTree right-click "Data transfer" | `DataTransferDialog.vue` | Row-level SELECT → batch INSERT |
| Generate a data dictionary | NavTree right-click schema/db → "Data dictionary" | `Workspace.vue::genDataDict` + `dump.ts` | Markdown / HTML |
| Compare data between two tables | Command palette `act:data-diff` | `DataDiffDialog.vue` + `data-diff.ts` | Row-level diff → sync SQL |

File IO uniformly goes through `client.files` (implemented in the main process: `openText / saveText / listDir / commonDirs / mkdir`). On Web, `listDir` is unavailable and falls back to browser download/upload (text formats only).

## 2. Export

### 2.1 Multi-format result-set copy

`ResultGrid.vue` right-click on a cell/selection → "Copy as" sub-menu:

| Item | Implementation | Use case |
|---|---|---|
| CSV | `io.ts::toCSV` | Paste straight into Excel / Numbers |
| TSV | `io.ts::toTSV` | Excel / Notion / Lark Sheets (`\t` separator) |
| JSON | `io.ts::toJSON` | `JSON.parse` in code; `Date` becomes `toISOString()` |
| Markdown | `io.ts::toMarkdown` | Tables in docs / PR descriptions (escapes `|` and newlines) |
| SQL VALUES | `io.ts::toSqlValuesList` | Form like `(1, 'a'), (2, 'b')` — paste into `INSERT...VALUES` / `VALUES (...) AS t` / `ON CONFLICT ... EXCLUDED` |
| SQL INSERT | `io.ts::toInsertSql` | Ready-to-run `INSERT INTO tbl (...) VALUES (...)` per row |

**Type restoration details** (`io.ts` implementation):

- `null/undefined` → empty (CSV) / `NULL` (SQL);
- `Date` → `toISOString()`;
- `number` → as-is; `Infinity/NaN` degrade to `NULL` in SQL;
- `boolean` → `TRUE/FALSE` in SQL (note: SQLite translates back to `1/0`);
- `object/array` → `JSON.stringify`, wrapped in single quotes in SQL;
- Single quotes `'` are doubled (`a'b` → `'a''b'`) to prevent injection.

CSV cells only get quoted when they contain `"`, `,` or newlines; TSV only when they contain `\t`, newlines, or `"`. No blanket quoting — pastes into Excel cleaner.

### 2.2 ExportOptionsDialog — whole-table / whole-schema export

NavTree right-click table or schema → "Export SQL". A minimal two-option dialog `ExportOptionsDialog` appears:

- **Structure only** → `withData = false`, just `CREATE TABLE`;
- **Structure + data** → `withData = true`, then `SELECT * FROM ref` for data and append `INSERT` list.

After `pick`, `Workspace.vue` runs `doTableExport` / `doSchemaExport`:

1. `client.connections.metadata(... group: 'columns')` for columns;
2. `dump.ts::buildCreateFromColumns` reconstructs `CREATE TABLE` from column metadata (v1 has PK only, no indexes or FKs — cross-dialect index/FK syntax diverges too much, stability first);
3. With `withData = true`, `SELECT * FROM ref` (no pagination — use backup/migration for large tables);
4. `buildTableDump` assembles:

   ```sql
   -- Table structure
   CREATE TABLE `users` (...);

   -- Data (N rows)
   INSERT INTO `users` (...) VALUES (...);
   ```

5. Default file name is `<object>.sql`, extension fixed at `.sql`; `client.files.saveText` routes through the custom `SaveFileDialog` for the user to pick a path.

Whole-schema export iterates all base tables and prepends `-- ws.dumpHeader { label, n }` as metadata.

### 2.3 Workspace bulk export (`.skylerxws`)

`WorkspaceExportDialog.vue` covers both "switch machines" and "share with a colleague". File structure:

```ts
interface WorkspaceFile {
  version: 1
  exportedAt: number
  source: string                  // 'SkylerX'
  connections?: ConnectionConfig[]
  snippets?: typeof snippets
}
```

Export options (all independently selectable):

| Option | Default | Notes |
|---|---|---|
| Include connection config | ✓ | Calls `client.connections.list()`; **redacted by default** (no passwords) |
| ⚠ Include passwords | ✗ | Pulls clear text via `client.connections.get(id)` per connection. The file is portable across machines (no system keychain needed) at the cost of being plaintext — use with care |
| Include SQL Snippets | ✓ | Whole JSON copy, no ID rename |

Default file name `skylerx-workspace-YYYY-MM-DD.skylerxws`; filter accepts `.skylerxws` and `.json`.

On import: tally "connections + Snippets" → confirm → merge by conflict strategy:

- **skip**: same name skipped (default);
- **overwrite**: same `name` calls `update` with dup.id, overwriting all fields (including password if present);
- **rename**: name suffixed `(import)` then created.

### 2.4 Encrypted export `.sql.enc` (AES-256-GCM + PBKDF2)

`export-encrypt.ts` provides pure-function API; the UI calls it as needed (typical use: sharing a sensitive SQL dump with an external partner). Algorithm choices:

| Item | Value | Rationale |
|---|---|---|
| Magic header | `SKYLERX-ENC-v1` | Identify the version when upgrading the algorithm |
| KDF | PBKDF2-HMAC-SHA-256 | Native in browser/Node, no deps |
| Iterations | `DEFAULT_ITER = 200_000` | OWASP 2023 recommends ≥ 600k; we compromise for older hardware, may raise later |
| Cipher | AES-GCM | Built-in 128-bit auth tag — wrong password / tampering raises `WRONG_PASSWORD` |
| Key length | 256 bit | `deriveKey` produces AES-GCM 256 directly |
| Salt | 16 random bytes | Regenerated each time, no reuse |
| IV | 16 random bytes | Regenerated each time, no reuse |
| Serialization | Single-line JSON | Easy streaming read/write; `.sql.enc` visible in a text editor |

On-disk format (single-line JSON):

```json
{ "magic": "SKYLERX-ENC-v1", "salt": "<b64>", "iv": "<b64>", "iter": 200000, "data": "<b64-cipher+tag>" }
```

Implementation notes:

- Uses `globalThis.crypto.subtle`, **no third-party deps**; on old Node without subtle it throws and asks the user to upgrade;
- `Uint8Array` always backs with `new ArrayBuffer(n)` to dodge TS 5.7 + lib.dom tightening `BufferSource` to `ArrayBuffer`;
- base64 encoded in 32 KB chunks to avoid `String.fromCharCode(...bytes)` blowing the stack on large files;
- GCM auth failures are uniformly mapped to `WRONG_PASSWORD` — original `OperationError` isn't leaked, no side-channel for attackers.

## 3. Import

### 3.1 ImportDialog — CSV / JSON / NDJSON / Excel three-step wizard

NavTree right-click table → "Import data". `ImportDialog.vue` is a fixed 3-step wizard (`step: 'pick' | 'map' | 'run'`):

#### Step 1: pick a file

- Main button "Choose file" → `client.files.openText`, filter `csv / txt / json` (JSON detected via `\.json$/i` or first char `[`/`{`, routed to `parseJSON`).
- Secondary "Excel…" → uses the renderer's `<input type=file>`, reads `ArrayBuffer`, then **lazy-loads** `xlsx` (SheetJS) on demand. Reads the first sheet only with `raw: false` (display values, dates don't become numbers) and `defval: ''`. Excel skips the text channel (binary), so big files don't choke IPC.
- After parsing, the first 5 rows preview; a "First row is header" toggle lets you flip it.

`io.ts::parseCSV` is a hand-rolled state machine: handles BOM, `""` escapes, CRLF / LF, commas / newlines inside quotes. Filters out "rows" that contain only one empty field.

`io.ts::parseJSON` handles three shapes:

- **Array of objects**: union of keys becomes headers (insertion order);
- **Array of arrays**: first row is the header;
- **Single object**: treated as a single row.

#### Step 2: column mapping + type inference

`autoMap()` matches source/target columns by lowercased exact match. Each column has a dropdown for manual selection; "skip" = `-1`.

Type inference `inferType(srcIdx)` samples the **first 50 non-empty values** of the column:

| Inference | Regex |
|---|---|
| `number` | `/^-?\d+(\.\d+)?$/` |
| `date` | `/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?Z?$/i` |
| `boolean` | `/^(true|false|t|f|y|n)$/i` |
| `string` | fallback |

If any empty string appears, the column is flagged `nullable` (UI shows `·∅`). **Note**: inference is just a hint — values are still inserted as strings; the actual cast happens in the DB per column definition. This tolerates dialect differences (MySQL casts `'2024-01-01'` to DATE; SQLite keeps TEXT).

#### Step 3: options + run

| Option | Default | Behavior |
|---|---|---|
| TRUNCATE before import | ✗ | Inserts a `TRUNCATE TABLE <ref>` before `INSERT`; **not rollback-able** (MySQL/PG TRUNCATE is DDL) — use with care |
| Rows per batch | 200 (min 1, max 2000) | Controls how many rows per `INSERT INTO t (...) VALUES (...), (...), ...`; avoids long statements being truncated by drivers |

Execution uses `client.connections.executeBatch`. Empty source strings (`''`) are treated as `NULL` uniformly (`io.ts::buildInsertStatements` does `s == null || s === '' ? 'NULL' : ...`), so **import can't distinguish "real empty string" from "no value"**. If you need that distinction, hand-write SQL in the editor.

### 3.2 PasteImportDialog — paste from clipboard

`PasteImportDialog.vue` is the lightweight counterpart: opens with `navigator.clipboard.readText()`, no file picker.

| Input | Parsing path |
|---|---|
| Contains `\t` | TSV (Excel / Lark Sheets default copy format) split on `\t` |
| No `\t` | Simple CSV parsing (supports `""` escapes, but **no complex nested quotes** — fall back to ImportDialog for those) |

Target table columns are fetched live from `information_schema.columns` (MySQL / MariaDB / OB / TiDB / Doris / StarRocks use `table_schema + table_name`; PG / others use `table_name + table_catalog`). Columns auto-match after normalization (`toLowerCase + strip _-whitespace`); the rest is manual; blank = skip.

Batch size fixed at `BATCH = 500`, each batch is one `INSERT INTO ... VALUES (...), (...)`; `sqlLiteral` simplifies: empty string → `NULL`, pure numbers as-is, everything else single-quoted (`'` doubled to escape). **Redis / document stores etc. are pre-filtered out** (only `dialectKind === DbKind.Sql` connections appear).

Use case: a few dozen to a few thousand rows from Lark/Excel pasted straight in. For larger batches use ImportDialog (`executeBatch`) or DataTransferDialog (pagination).

## 4. NDJSON viewer (`NdjsonViewerDialog`)

Command palette `act:ndjson-viewer` → pick a `.ndjson` / `.jsonl` file → view as a table — **no DB connection needed**.

Parse rules (`parse()`):

- Split by line; blank / parse-fail lines count toward `skipped` (non-blocking);
- Recognize dbgate Archives-style `{ __table, data }` wrappers → row's table is `__table`, data is `data`;
- Recognize error markers `{ __error: "..." }` → counted in `skipped`;
- Otherwise treated as a regular JSON row with `table = ''`.

UI features:

- **Cross-table tabs**: tabs at the top for each distinct `__table`; click to filter;
- **Union of columns**: header is the union of `Object.keys` over visible rows (per-row fields can differ — missing shown as `null`);
- **Row detail**: double-click expands the full JSON;
- **Copy all / Save as**: copy the whole file to clipboard or `saveText` (default file name preserved);
- **Read-only v1**: no editing, no DB import — coming later.

## 5. Backup / restore (`BackupRestoreDialog`)

Command palette `act:backup:<connId>` → `BackupRestoreDialog`. **MVP goes pure SQL**: doesn't shell out to `mysqldump` / `pg_dump` (cross-platform path detection is messy, and users may not have them); we'll IPC `child_process.spawn` if/when DDL completeness (triggers / views / FK ordering) demands it.

#### Backup formats

| Format | Implementation | Notes |
|---|---|---|
| **SQL** | Routes the user through NavTree right-click "Export SQL" (reuses `doSchemaExport`) | Traditional path, directly eatable by `mysql/psql` |
| **NDJSON** | Built-in `doBackupNdjson()` | dbgate Archives style, cross-connection import/export friendly |

NDJSON backup flow:

1. `metadata({ group: 'tables', path: [database] })` for all base tables;
2. Per table `SELECT * FROM <sqlName>`, write `{"__table":"t","data":{...}}\n` per row;
3. Single-table failures **don't abort**; instead write `{"__table":"t","__error":"..."}` (visible during restore);
4. `saveText` to `skylerx-<connName>-<timestamp>.ndjson`; filter accepts `.ndjson / .jsonl`;
5. Progress bar (`done / total · phase`) + "⏹ Stop" button (`stopRequested` checked before each table).

Known limitation: `BLOB / Buffer` through `JSON.stringify` becomes `{ type: 'Buffer', data: [...] }` and **won't restore as binary**; use the SQL path for strict scenarios.

#### Restore flow

| Path | Flow |
|---|---|
| SQL | `client.files.openText` → `splitStatements(content)` by `;` → confirm → execute in order, **single failure doesn't abort**, errors stored in `restoreProgress.errors[]` (each error truncated to 200 chars) |
| NDJSON | Bucket by `__table` → **one large `INSERT` per bucket**, chunked at `chunkSize = 100` (avoids `max_allowed_packet`) → same error collection |

Live progress bar + error list (truncated + wrapped) + completion `restoreOk / restoreWithErrors / restoreStopped` tri-state toast.

## 6. Cross-connection data migration (`DataTransferDialog`)

NavTree right-click table → "Data transfer". Narrower than backup/restore: **single table to single table**; starts as soon as the source is picked — good for moving data from dev → staging.

| Field | Default | Notes |
|---|---|---|
| Target connection | Current | Lists all connections, `(current)` suffix on the current one |
| Target database | Source ctx | Meaning differs per dialect: PG = catalog, MySQL = database |
| Target schema | Source ctx | PG/KB requires it (default `public`); MySQL can leave it blank |
| Target table name | Source table | Insert fails if missing; doesn't auto-create |
| Rows per batch | 500 | Controls source `SELECT ... LIMIT ? OFFSET ?` page size |
| TRUNCATE target first | ✗ | Actually runs `DELETE FROM <ref>` (not `TRUNCATE` — can be rolled back) |

Execution loop:

```ts
for (let page = 0; page < 100000; page++) {
  const res = await execute(srcId, `SELECT * FROM ${srcRef}`, [],
    { ..., limit: size, offset: page * size })
  if (!res.rows.length) break
  await executeBatch(tgtId, rowInserts(tgt.dialect, dstRef, cols, res.rows), dstOpts)
  if (res.rows.length < size) break    // early exit
}
```

- The 100k page cap is a runaway guard;
- Column names come from source-table `metadata`, so **the target table must have the same column names** (order doesn't matter — `rowInserts` lists columns explicitly);
- Type conversion is JS → SQL literal (`io.ts::sqlLiteral`) + target DB implicit casts. Complex types (Postgres `jsonb`, MySQL `BIT(1)`) may lose fidelity — do a spot-check after migration.

## 7. Data dictionary export (Markdown / HTML)

NavTree right-click schema (or DB) → "Data dictionary → Markdown / HTML". `Workspace.vue::genDataDict` calls `dump.ts::buildDataDictMarkdown / buildDataDictHtml`.

Each table is a section; field-table columns are fixed:

| Field | Type | Nullable | PK | Default | Comment |
|---|---|---|---|---|---|
| `id` | `bigint unsigned` | N | 🔑 | | User PK |
| `email` | `varchar(255)` | Y | | `NULL` | Email |

Data source: `metadata({ group: 'columns' })` returning `MetadataNode.detail.{dataType, nullable, primaryKey, defaultValue, comment}`.

#### Markdown vs HTML differences

| Dimension | Markdown | HTML |
|---|---|---|
| Escapes | `|` → `\|`, newlines → spaces | `&<>` entities |
| TOC | None (use the IDE outline) | 3-column TOC, anchor `#t-<urlencoded>` |
| Layout | Plain markdown | Inline `<style>`, sans-serif, table borders, zebra stripes, `@media print` to avoid section page-breaks |
| Best for | Wiki / GitLab / docs | Open in browser, print to PDF |

File name `<schema-or-db>-data-dict.md|html`. **Fully offline** generation — data dictionaries are a top compliance need and may need to run on isolated networks.

## 8. Data diff (`DataDiffDialog`)

Command palette `act:data-diff`. **Two connections × two tables → row-level diff → sync SQL**.

The core algorithm in `data-diff.ts::diffRows` (pure function, unit-testable):

```ts
diff = {
  inserts: Row[],            // source has, target missing
  updates: RowUpdate[],      // same PK, non-key columns differ
  deletes: Row[]             // target has, source missing
}
```

Match keys (`keyCols`):

- Default: the **primary key** from source via `information_schema.table_constraints + key_column_usage` (works on MySQL / PG);
- User can override via `keyColsInput` (comma-separated).

Value comparison `same(a, b)` goes **stringified-normalize**: `null/undefined` equates to empty; otherwise `String(a) === String(b)` — tolerates driver differences (`MySQL2` returns `BigInt`, `pg` returns `Number`, SQLite returns `string`).

Support: **MySQL family only (MySQL / MariaDB / OB) + PostgreSQL family (PG / KingbaseES)**; other dialects (SQLite / Oracle / SQL Server / Redis etc.) show a warning and the button is greyed out.

Result categories:

| Bucket | Meaning |
|---|---|
| `inserts` | Catch target up to source |
| `updates` | Change target to match source (only SET columns that actually differ) |
| `deletes` | Extra rows in target — **emitted last with a comment**: "in target only; confirm before executing" to prevent accidents |

`generateDataSync` produces a readable SQL chunk; you can "copy" or "open as query" on the target connection — a dry-run / human-review window before anything lands.

`LIMIT` (default 2000) prevents memory blowup; narrow the range first when PKs diverge widely.

## 9. Security (summary)

See [Troubleshooting / security](./troubleshooting.md) for details. Highlights:

- **Workspace export omits passwords by default**; opting in produces plaintext JSON — the UI shows a red "⚠" warning;
- **`.sql.enc` encrypted export** uses AES-256-GCM; wrong password and tampered files give the same error to avoid side-channel leaks;
- NDJSON backups are **not masked**; do real masking either at generation time with the PII Scanner or with `SELECT replace(...)` in the SQL editor;
- Temp data during import/export **stays in memory** — no intermediate files; closing the dialog releases it immediately.

## 10. Compatibility matrix

| Capability | MySQL fam | PG fam | SQLite | Oracle | SQL Server | DM / KingbaseES | Redis | MongoDB |
|---|---|---|---|---|---|---|---|---|
| Copy as CSV/TSV/JSON/MD | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Copy as SQL VALUES/INSERT | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Table/Schema export SQL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| `.skylerxws` workspace export | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `.sql.enc` encrypted export | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ImportDialog (CSV/JSON/Excel) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Use RedisImportExport | Use NDJSON path |
| Clipboard import | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| NDJSON viewer | DB-independent | DB-independent | — | — | — | — | — | — |
| Backup/restore SQL path | ✓ | ✓ | ✓ | partial | ✓ | ✓ | — | — |
| Backup/restore NDJSON path | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Cross-connection migration | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Data dictionary (MD/HTML) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Row-level diff + sync SQL | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ (KB) | — | — |

"✗" = explicitly greyed out; "—" = doesn't apply to this dialect (KV / document stores have their own `RedisImportExportDialog`).

## Quick triggers

| Action | Toolbar | Right-click | ⌘K palette | Shortcut |
|---|---|---|---|---|
| Copy result as CSV / TSV / ... | — | Result grid → Copy as → ... | — | — |
| Export table SQL | — | NavTree table node → Export SQL | — | — |
| Export schema SQL | — | NavTree schema node → Export SQL | — | — |
| Export Workspace | Gear menu → Export | — | `Export Workspace` (`act:export-conns`) | — |
| Import Workspace | Gear menu → Import | — | `Import Workspace` (`act:import-conns`) | — |
| Import data (CSV/JSON/Excel) | — | NavTree table node → Import data | — | — |
| Clipboard import | — | — | `PasteImport` (top menu trigger) | — |
| Open NDJSON viewer | — | — | `NDJSON viewer` (`act:ndjson-viewer`) | — |
| Backup / restore | — | — | `Backup/Restore · <conn>` (`act:backup:<id>`) | — |
| Data transfer | — | NavTree table node → Data transfer | — | — |
| Data dictionary | — | NavTree schema/db → Data dictionary → MD / HTML | — | — |
| Data diff | — | — | `Data diff` (`act:data-diff`) | — |

Tip: every "save as" action underneath uses the same custom `SaveFileDialog` (`packages/ui/src/components/SaveFileDialog.vue`) — consistent across macOS / Windows / Linux, **does not use the native OS dialog**; supports favorites, recent dirs, ↑↓ navigation, Enter to save, ⌘L to focus the address bar.
