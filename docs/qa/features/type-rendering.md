# Cross-dialect type rendering & connection edges — manual QA

Distilled from the DBX (Tauri) project's changelog + user feedback (V2EX, 2026-04).
Those were bugs in DBX's own driver; SkylerX uses mature drivers (mysql2 / node-postgres)
and formats object cells via `JSON.stringify`, so the values below were **verified correct
live on yiye-mysql + Vastbase**. These cases lock that in against future regressions.

> Run when changing: `packages/core-driver/src/dialects/*`, `ResultGrid.vue` `fmt()`/`cellKind()`,
> `ConnectionForm.vue`, `ssh-tunnel.ts`.

## Setup
- Branch / commit:
- Connections: a MySQL, a PostgreSQL/Vastbase (openGauss), ideally Oracle/DM too.

## Value rendering (the grid must NOT show null / [object Object] / wrong-boolean)

- [ ] **MySQL `TINYINT(1)`** column → grid shows the number (`0`/`1`), NOT `true`/`false`.
      (Driver returns a number; we don't coerce to boolean.)
- [ ] **PostgreSQL `SMALLINT`/`INT2`** → shows the integer, not null.
- [ ] **PG/MySQL `JSON`/`JSONB`** → shows a JSON string (e.g. `{"a":1,"b":[2,3]}`),
      NOT `[object Object]`. Double-click → JSON cell viewer opens with a tree.
- [ ] **PG `UUID`** → shows the uuid string (not null).
- [ ] **PG custom / composite type** (e.g. `CREATE TYPE addr AS (...)`, selected as a value)
      → shows the tuple string `(s,c)`, not null.
- [ ] **NULL** in any of the above → renders as a distinct `NULL` (muted/italic), not empty.
- [ ] **BIGINT > 2^53** (SQL Server / Oracle / PG int8) → shows full value as string with the
      `ⓘ` lossy tag, not a rounded float.

## Identifier quoting / case sensitivity

- [ ] **PG mixed-case table name** (`CREATE TABLE "MyTable" (...)`) → expands in the tree,
      view DDL / copy DDL / SELECT all work (identifiers quoted, no "relation does not exist").
- [ ] **MySQL backtick / reserved-word column** (e.g. `` `order` ``) → inline-edit + commit work.

## SQL statement splitting (Navicat painpoint)

- [ ] A value containing a semicolon — `INSERT INTO t VALUES ('a;b'); SELECT 1` — runs as TWO
      statements, the `;` inside the string is NOT treated as a terminator. (Unit-tested in
      `sqlSplit.test.ts` + `io` regression; verify once in the editor too.)

## Connection edges

- [ ] **IPv6 host**: enter `::1` (no brackets) in the host field + the port separately →
      connects. (Host and port are separate fields, so no `host:port` mis-parse.)
- [ ] **SSH tunnel — password auth**: connection over SSH with a password (not just a key) works.
- [ ] **SSH tunnel — private key (+ passphrase)** works.
- [ ] **Schema context**: on PG, after picking a schema, queries run under that `search_path`
      (an unqualified table in the chosen schema resolves without `schema.` prefix).
- [ ] **Auto-reconnect**: drop the DB / network, run a query → clear error; bring it back, run
      again → reconnects (no need to delete + recreate the connection).

## Import

- [ ] **Import from clipboard**: copy a block of cells from Excel/Sheets (TSV) → Import dialog →
      "粘贴剪贴板" → columns auto-parse (tab-delimited), preview shows, map → run inserts rows.
- [ ] Paste comma-separated text → also parses (delimiter auto-detected from the first line).
- [ ] Paste a JSON array → parsed as JSON (first object's keys = headers).

## Known-correct (do not file as bugs)
- PG `uuid` may print without hyphens on some openGauss builds — that's the server's stored form.
- TINYINT(1) intentionally shows the number; SkylerX does not assume it's a boolean.
