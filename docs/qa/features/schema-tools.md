# Schema Tools — manual QA

Covers: DDL generation, schema diff, Mock data v1, Oracle → DM migration wizard.

> Run when changing: `packages/ui/src/ddl.ts`, `packages/ui/src/schema-diff.ts`, `packages/ui/src/mockgen.ts`, `packages/ui/src/oracleToDm.ts`.

## Setup

- Branch / commit:
- OS:
- Two active connections (for schema diff): A and B

## DDL generation

### Per-dialect output validity
For each shipped dialect, right-click a table → "Generate DDL" → verify:

| Dialect | Output is syntactically valid? | Notes |
|---|:---:|---|
| MySQL | [ ] | check backtick identifiers, ENGINE/CHARSET |
| MariaDB | [ ] | as MySQL |
| OceanBase MySQL | [ ] | as MySQL |
| OceanBase Oracle | [ ] | as Oracle |
| TiDB | [ ] | as MySQL |
| Doris | [ ] | DISTRIBUTED BY clause present |
| StarRocks | [ ] | DISTRIBUTED BY clause present |
| PostgreSQL | [ ] | check double-quoted idents, SERIAL → identity |
| KingbaseES | [ ] | as PG |
| openGauss | [ ] | as PG, watch for `WITH (orientation=...)` |
| Oracle | [ ] | thin-mode dbms_metadata.get_ddl |
| DM | [ ] | as Oracle |
| SQL Server | [ ] | bracket idents, IDENTITY syntax |
| SQLite | [ ] | INTEGER PRIMARY KEY AUTOINCREMENT |
| DuckDB | [ ] | LIST / STRUCT preserved |
| ClickHouse | [ ] | ENGINE = MergeTree() syntax |
| Snowflake | [ ] | identifier UPPERCASE handling |
| H2 | [ ] | PG-server mode dialect |

### CREATE TABLE → run on fresh DB
- [ ] Generate DDL from connection A's `users` table
- [ ] Connect to empty connection B (same dialect, different DB)
- [ ] Paste DDL → execute → table created
- [ ] Run `INSERT INTO users ...` on B → succeeds
- [ ] Evidence:

### Round-trip
- [ ] DDL → execute → re-Generate DDL → diff vs original → identical (or trivial whitespace only)
- [ ] Evidence: paste both DDLs

## Schema diff

- [ ] Pick connection A → pick connection B → run schema diff
- [ ] Output: 3 sections — Tables only in A, Tables only in B, Tables in both with column diffs
- [ ] For "in both with diff" → expand → see column-by-column diff (added / removed / changed type)
- [ ] Click "Generate align SQL" → emits ALTER TABLE statements to make B match A
- [ ] Evidence: paste alignment SQL + dry-run output

### Edge cases
- [ ] Same DB (A=B) → "schemas identical" message, no SQL
- [ ] Cross-dialect (MySQL vs PG) → warning shown, but diff still attempted at logical level
- [ ] Tables with same name but different schemas → flagged with schema prefix
- [ ] Evidence:

### Index / FK / view diff
- [ ] Add an index in A → re-diff → index shown in diff
- [ ] Add a FK in A → re-diff → FK shown
- [ ] Create a view in A → re-diff → view shown
- [ ] Evidence:

## Mock data v1

- [ ] Right-click a table → "Insert mock data" → modal with row count input
- [ ] Set rows = 100 → click Generate → SQL preview shows 100 INSERT statements
- [ ] Click Execute → table populated with 100 rows
- [ ] Each row satisfies:
  - [ ] NOT NULL constraints
  - [ ] Column types (no string in INT column)
  - [ ] PRIMARY KEY uniqueness (auto-increment or generated)
  - [ ] CHECK constraints (if any)
- [ ] Evidence: paste sample rows

### Type coverage
- [ ] INT / BIGINT / DECIMAL → reasonable numeric values
- [ ] VARCHAR → strings of appropriate length
- [ ] DATE / TIMESTAMP → valid dates within reasonable range
- [ ] BOOLEAN → true / false mix
- [ ] ENUM → values from declared list
- [ ] JSON → valid JSON
- [ ] Evidence:

### Limitations of v1 (known, not bugs)
- FK relationships are NOT honored — FK columns get random IDs that may not exist in parent table
- No business-aware fields (no "fake names" / "fake addresses" yet — comes in v2)

## Oracle → DM wizard

- [ ] Have an Oracle connection with at least one schema containing tables
- [ ] Tools → "Oracle → DM Migration Wizard" → wizard opens
- [ ] Step 1: pick source Oracle connection + schema → next
- [ ] Step 2: pick target DM connection → next
- [ ] Step 3: show object list (tables / views / sequences / triggers) → pick subset
- [ ] Step 4: preview translated DDL for each picked object — verify:
  - [ ] Oracle type → DM type mapping correct (NUMBER → NUMERIC, VARCHAR2 → VARCHAR, DATE → DATE, etc.)
  - [ ] CLOB / BLOB preserved
  - [ ] Constraints preserved (PK, FK, CHECK)
  - [ ] Sequences translated
- [ ] Step 5: execute on target → progress per object, success/fail breakdown
- [ ] Step 6: verify on DM side via tree expand → all objects present
- [ ] Evidence: screenshot of completion screen + DM-side `\d` equivalent

### Edge cases
- [ ] Source has 0 tables → wizard shows "nothing to migrate", graceful exit
- [ ] Target already has a same-named table → wizard offers "skip / drop / rename" per object
- [ ] Network failure mid-migration → partial success report, no app crash
- [ ] Source has Oracle-only features (e.g. ANSI PL/SQL packages) → wizard flags as "manual translation required", does not silently corrupt
- [ ] Evidence:

## Cross-platform

- [ ] All three OS: wizard layout fits min window size (940×600)
- [ ] Long DDL in preview pane scrolls, not truncated
- [ ] Evidence:

## Known limitations

- Mock data v1 is NOT FK-aware — v2 in roadmap
- DDL generation for Snowflake / Redshift may not capture all engine-specific clauses (e.g. CLUSTER BY) — verify in PR
- Schema diff between very large schemas (>500 tables) may take >30s — known, no progress bar yet
