# SQLite — manual QA

**Covers**: SQLite (file-based).
**Driver**: `packages/core-driver/src/dialects/sqlite.ts` (`better-sqlite3` npm, **native** synchronous).
**Wire**: None — file-based.

## Setup

- Branch / commit:
- OS:
- Test file: `/tmp/qa.sqlite` (delete before test)

## Native module load

- [ ] Fresh `pnpm install` + `pnpm rebuild:native` works on current OS
- [ ] First SQLite connection lazy-loads `better-sqlite3` without crash
- [ ] No prebuilt binary for current platform → falls back to build-from-source, succeeds OR shows clear error
- [ ] Evidence:

## Connection

- [ ] "New connection" → SQLite dialect → file picker
- [ ] **Existing file**: pick → opens read-write
- [ ] **New file**: select non-existent path + "Create new" toggle → file created on first connect
- [ ] Read-only mode: `mode=ro` query param → INSERT fails with "attempt to write a readonly database"
- [ ] In-memory: `:memory:` path → ephemeral, lost on disconnect
- [ ] Connection JSON does NOT contain a useful concept of host/port (file-based)
- [ ] Wrong path (non-existent + no Create) → specific "file not found" error
- [ ] Permissions issue (read-only filesystem) → specific error mentioning permission
- [ ] Evidence:

### Force-kill safety (the better-sqlite3 advantage)
- [ ] Run a query → `pkill -9 Electron` mid-write
- [ ] Restart → file integrity preserved (synchronous fsync vs async LevelDB)
- [ ] Evidence:

## Database / schema

SQLite has only ONE database per connection (the file). No schemas in classical sense.

- [ ] `ATTACH DATABASE '/tmp/qa2.sqlite' AS qa2` → secondary DB attached
- [ ] Cross-DB query: `SELECT * FROM qa2.t` works
- [ ] `DETACH DATABASE qa2`
- [ ] Tree shows attached DBs as separate groups
- [ ] Evidence:

## Tables

SQLite type system is dynamic ("type affinity").

```sql
CREATE TABLE qa_t (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE,
  age         INTEGER,
  salary      REAL,
  bio         TEXT,
  payload     TEXT CHECK (json_valid(payload)),  -- JSON via json1 extension
  bin_data    BLOB,
  is_active   INTEGER DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT,
  birth_date  TEXT  -- SQLite has no native DATE; stored as ISO 8601 TEXT
);
```

- [ ] Statement runs
- [ ] Tree expand → columns + types
- [ ] `INTEGER PRIMARY KEY` is alias for ROWID (special, auto-increments without AUTOINCREMENT)
- [ ] `AUTOINCREMENT` is stricter (uses `sqlite_sequence` to prevent ID reuse)
- [ ] Verify which the app's "auto-increment" toggle generates
- [ ] Type affinity in action: insert string "123" into INTEGER column → stored as integer 123
- [ ] Strict tables (SQLite 3.37+): `CREATE TABLE … STRICT` → enforces types
- [ ] Evidence:

### Identifier case
- [ ] Default: case-insensitive
- [ ] `"my_col"` and `[my_col]` and `` `my_col` `` all work
- [ ] Tree shows actual stored case

### ALTER TABLE (limited)
- [ ] `ALTER TABLE qa_t ADD COLUMN phone TEXT` — supported
- [ ] `ALTER TABLE qa_t RENAME COLUMN phone TO mobile` — supported in 3.25+
- [ ] `ALTER TABLE qa_t DROP COLUMN mobile` — supported in 3.35+
- [ ] `ALTER TABLE qa_t RENAME TO qa_t_v2` — supported
- [ ] **No** `ALTER TABLE … MODIFY COLUMN` — must drop+recreate; verify app's DDL gen handles
- [ ] Evidence:

### DROP / TRUNCATE
- [ ] `DROP TABLE qa_t`
- [ ] No `TRUNCATE` — must `DELETE FROM qa_t` (caveat: doesn't reset AUTOINCREMENT unless `DELETE FROM sqlite_sequence WHERE name='qa_t'`)
- [ ] Evidence:

## Indexes

- [ ] B-tree (default): `CREATE INDEX qa_idx ON qa_t(name)`
- [ ] UNIQUE: `CREATE UNIQUE INDEX uq_email ON qa_t(email)`
- [ ] Partial: `CREATE INDEX qa_idx_active ON qa_t(name) WHERE is_active = 1`
- [ ] Expression: `CREATE INDEX qa_idx_lower ON qa_t(LOWER(email))`
- [ ] FTS5 virtual table for full-text search (if json1 / fts5 extensions present):
  - `CREATE VIRTUAL TABLE qa_fts USING fts5(name, bio)`
  - `INSERT INTO qa_fts SELECT name, bio FROM qa_t`
  - `SELECT * FROM qa_fts WHERE qa_fts MATCH 'term'`
- [ ] `DROP INDEX qa_idx`
- [ ] Evidence:

## Views

- [ ] `CREATE VIEW qa_v AS SELECT id, name FROM qa_t WHERE is_active = 1`
- [ ] `SELECT * FROM qa_v` works
- [ ] Views are read-only in SQLite (no INSTEAD OF triggers shipped by default)
- [ ] `DROP VIEW qa_v`

## Constraints

- [ ] PK enforces uniqueness
- [ ] UNIQUE
- [ ] NOT NULL
- [ ] CHECK
- [ ] FK: **off by default**, must `PRAGMA foreign_keys = ON` per connection
- [ ] Verify the app sets foreign_keys ON automatically on connect (otherwise FKs silently ignored)
- [ ] `PRAGMA foreign_keys` returns 1
- [ ] FK with CASCADE / SET NULL / RESTRICT — works once enabled
- [ ] Evidence:

## Functions / Stored procedures

- SQLite has NO stored procedures.
- Built-in functions: `json_*`, `date`, `time`, `strftime`, math, string ops
- Custom functions: only via C extensions (out of scope for app)
- Skip this section in checklists.

## Triggers

```sql
CREATE TRIGGER qa_t_set_updated AFTER UPDATE ON qa_t FOR EACH ROW
BEGIN UPDATE qa_t SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
```

- [ ] Trigger created → fires on UPDATE
- [ ] BEFORE / AFTER × INSERT / UPDATE / DELETE supported
- [ ] FOR EACH ROW only (no statement-level)
- [ ] `DROP TRIGGER qa_t_set_updated`

## Sequences

Not supported in SQLite. `INTEGER PRIMARY KEY` + AUTOINCREMENT is the closest.

- [ ] `sqlite_sequence` system table visible in tree (read-only)

## Users · Roles · Grants

SQLite has NO user / role / grant system. File access is controlled by OS file permissions.

- [ ] Skip this section
- [ ] DBA panel for SQLite should NOT show user management — verify UI hides

## DML / Query

### INSERT
- [ ] Single, multi-row
- [ ] `INSERT OR IGNORE` — skips duplicates
- [ ] `INSERT OR REPLACE` — upserts
- [ ] `INSERT ... ON CONFLICT(col) DO UPDATE SET …` (3.24+)
- [ ] `INSERT ... RETURNING *` (3.35+)
- [ ] Evidence:

### UPDATE / DELETE
- [ ] `UPDATE qa_t SET … WHERE …`
- [ ] `UPDATE qa_t SET … FROM other WHERE qa_t.id = other.id` (3.33+)
- [ ] `UPDATE ... RETURNING *`
- [ ] `DELETE FROM qa_t WHERE id IN (…)`
- [ ] `DELETE ... RETURNING *`

### SELECT — query shapes
- [ ] JOIN: INNER, LEFT, CROSS (NO RIGHT or FULL — verify error message is specific)
- [ ] Subquery
- [ ] CTE: `WITH cte AS (…) SELECT …`
- [ ] Recursive CTE (very useful since SQLite lacks proc loops)
- [ ] Window functions (3.25+): ROW_NUMBER, RANK, LAG/LEAD
- [ ] GROUP BY + HAVING
- [ ] LIMIT … OFFSET …
- [ ] UNION / INTERSECT / EXCEPT
- [ ] JSON: `json_extract(payload, '$.k')`, `payload->>'$.k'` (3.38+)
- [ ] FTS5 MATCH (if extension loaded)
- [ ] Evidence:

## Transactions

- [ ] Default: each statement is implicit TX
- [ ] `BEGIN` → `COMMIT` / `ROLLBACK`
- [ ] `BEGIN IMMEDIATE` — acquires write lock now (recommended for multi-writer)
- [ ] `BEGIN EXCLUSIVE` — locks the whole DB
- [ ] **ONLY ONE WRITER at a time** — if a second connection tries to write while one TX holds, SQLITE_BUSY error
- [ ] Savepoints: `SAVEPOINT sp1; ROLLBACK TO sp1; RELEASE sp1`
- [ ] WAL mode: `PRAGMA journal_mode = WAL` → allows concurrent readers during write
- [ ] `PRAGMA journal_mode` returns the current mode
- [ ] Evidence:

## Dialect-specific quirks

### Type affinity
- [ ] Insert string into INTEGER column → stored as integer (silent coercion)
- [ ] Insert non-coercible (string "abc" into INTEGER) → stored as TEXT (silent!), unless STRICT table
- [ ] Verify app warns user when this happens

### Date handling
- [ ] No native DATE / DATETIME type — stored as TEXT (ISO 8601) or INTEGER (Unix epoch) or REAL (Julian day)
- [ ] App's grid should detect and format if column declared as DATE / DATETIME affinity
- [ ] `strftime('%Y-%m-%d %H:%M:%S', col)` to format
- [ ] Evidence:

### PRAGMA configuration
Important PRAGMAs the app should know about:

- [ ] `journal_mode = WAL` (recommended)
- [ ] `synchronous = NORMAL` (good balance for WAL)
- [ ] `foreign_keys = ON` (app sets this)
- [ ] `cache_size = -65536` (64MB negative = KiB)
- [ ] `busy_timeout = 5000` (wait 5s on lock contention)
- [ ] Evidence:

### Extensions
- [ ] json1 (built-in 3.38+) — JSON functions work
- [ ] fts5 — full-text search
- [ ] R-Tree — spatial indexing
- [ ] Load extension: `SELECT load_extension('/path/to/ext')` — only if `enable_load_extension` is set

## Cross-platform

- [ ] better-sqlite3 prebuilt for macOS arm64, macOS x64, Windows x64, Linux x64
- [ ] Windows ARM64 + Linux ARM64 — may build from source on install; verify works
- [ ] File path with non-ASCII chars (Chinese / Japanese in path) → works
- [ ] Network filesystem (NFS / SMB) → SQLite cautions against; verify app's `journal_mode` choice doesn't corrupt
- [ ] Evidence:

## Known limitations

- Single writer at a time — multi-process write contention surfaces as SQLITE_BUSY
- Max DB size: 281 TB (theoretical), but performance degrades on huge files
- No native networking — to share across machines, must use a wrapper service (e.g. SQLite-network projects, not shipped)
- AUTOINCREMENT vs INTEGER PRIMARY KEY: latter is faster + more standard, former is stricter on ID reuse — document choice
