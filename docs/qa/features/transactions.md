# Transactions / Manual Commit — manual QA

Covers: auto-commit vs manual-commit mode, session lifecycle, BEGIN / COMMIT / ROLLBACK semantics across dialects.

> Run when changing: `apps/desktop/src/main/ipc/connections.ts` (session APIs), `packages/ui/src/components/QueryPane.vue` (commit toolbar), `packages/core-driver/src/dialects/*` (session handling).

## Setup

- Branch / commit:
- OS:
- Active connection + test table: <!-- e.g. PG; CREATE TABLE qa_tx (id INT PRIMARY KEY, v VARCHAR) -->

## Auto-commit mode (default)

- [ ] New connection → toolbar shows "Auto-commit" badge
- [ ] Run `INSERT INTO qa_tx VALUES (1,'a')` → row visible in re-query immediately
- [ ] Run `UPDATE qa_tx SET v='b' WHERE id=1` → re-query shows `b`
- [ ] Run `ROLLBACK` (no active TX) → no-op, no error
- [ ] Evidence:

## Switch to manual-commit

- [ ] Click toolbar "Switch to manual commit" → confirm dialog → confirm
- [ ] Toolbar now shows "Manual commit" + visible COMMIT / ROLLBACK buttons
- [ ] Session ID appears (debug info shown)
- [ ] BEGIN was implicitly issued (check via server-side: PG `SELECT now() FROM pg_stat_activity WHERE state='idle in transaction'`)
- [ ] Evidence:

## Stage + COMMIT

- [ ] In manual mode: `INSERT INTO qa_tx VALUES (2,'two')`
- [ ] Open a **second window** with same connection (also manual or auto) → query `SELECT * FROM qa_tx`
- [ ] The second window must **NOT** see row id=2 yet (isolation working)
- [ ] In first window → click COMMIT
- [ ] Second window re-query → row id=2 now visible
- [ ] Evidence: 2 screenshots before/after COMMIT, showing the visibility change

## Stage + ROLLBACK

- [ ] In manual mode: `INSERT INTO qa_tx VALUES (3,'three')`
- [ ] First-window re-query → row 3 visible (own session sees it)
- [ ] Click ROLLBACK
- [ ] First-window re-query → row 3 gone
- [ ] Evidence:

## Mid-transaction error

- [ ] In manual mode: run a valid INSERT, then a broken SQL (`SLECT * FROM nope`)
- [ ] Error toast for the broken one
- [ ] Session state: depends on dialect
  - [ ] **PG**: rest of session must be aborted until ROLLBACK; further valid SQL errors with "current transaction is aborted"
  - [ ] **MySQL**: session continues; rolled-back implicit savepoint
  - [ ] **Oracle / DM**: session continues
- [ ] After ROLLBACK → session usable again, BEGIN re-issued
- [ ] Evidence:

## Session timeout / idle

- [ ] In manual mode: idle for >10 min (or whatever the configured idle-tx-timeout is)
- [ ] Try to commit → toast warns "session ended", grid offers re-open
- [ ] No crash, no silent data loss
- [ ] Evidence:

## Cancel a long query inside a TX

- [ ] In manual mode: run `BEGIN; UPDATE qa_tx SET v='x'; ` then a slow query (`SELECT pg_sleep(30)` or `SELECT SLEEP(30)`)
- [ ] Click Cancel → query stops within ~1s
- [ ] Session state preserved (the UPDATE is still staged, COMMIT / ROLLBACK still work)
- [ ] Evidence: paste before/after `SELECT * FROM qa_tx`

## Close window mid-transaction

- [ ] In manual mode with uncommitted UPDATE → close the SkylerX window (Cmd+W / X)
- [ ] Confirm dialog appears: "You have uncommitted changes — Commit / Rollback / Cancel?"
- [ ] Choose Rollback → window closes, server-side TX rolled back (verify from another tool)
- [ ] Evidence:

## Force-kill mid-transaction

- [ ] In manual mode with uncommitted UPDATE → `pkill -9 Electron`
- [ ] Server-side TX should ROLLBACK on connection drop (DB-driven, not app)
- [ ] Restart app → re-query → row state matches pre-UPDATE
- [ ] Evidence:

## Switch from manual to auto mid-TX

- [ ] In manual mode with staged UPDATE → click "Switch to auto-commit"
- [ ] Confirm dialog: "This will COMMIT / ROLLBACK current TX — choose"
- [ ] Choose Commit → switch happens, TX persisted
- [ ] Re-open manual → start fresh
- [ ] Evidence:

## Per-dialect specifics

| Dialect | Specific case to verify | Status |
|---|---|:---:|
| MySQL | DDL implicitly commits — manual mode warns before running DDL | [ ] |
| PostgreSQL | DDL inside TX is OK (transactional DDL) — no implicit commit | [ ] |
| Oracle | DDL implicit commit; manual mode warns | [ ] |
| SQL Server | DDL can be in TX; default isolation read-committed | [ ] |
| DM | DDL behavior matches Oracle | [ ] |
| SQLite | manual mode = wrap in BEGIN IMMEDIATE; only one writer | [ ] |
| DuckDB | manual mode works; check `START TRANSACTION` syntax | [ ] |
| ClickHouse | **no transactions** — manual mode should be disabled in UI | [ ] |
| Snowflake | autocommit-by-default; manual TX has 4h lock timeout | [ ] |

## Known limitations

- ClickHouse does not support transactions — UI should grey out manual mode for ClickHouse connections (if not, bug)
- TDengine likewise — verify UI
- NoSQL drivers (Mongo / Redis / ES) don't have SQL TX semantics; multi-document Mongo TX has its own UI track (out of scope here)
