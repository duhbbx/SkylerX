# Release Smoke Test

Run before tagging any release. Target: ~15 minutes on one OS, repeat on each platform you ship to. Updated whenever a feature lands — keep the list synced with reality.

> **How to use this in a release**
> Don't edit this file when running a release.
> Open a GitHub issue using the **🚦 Release Smoke** template — it auto-pastes this checklist into the issue body. Check items in the issue, comment on failures, link bug issues. Close the issue once everything is ✅.

## Pre-flight

- [ ] On `main`, `git log` shows the commit you intend to tag
- [ ] `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm lint` all green locally
- [ ] CI on `main` is green for the same commit
- [ ] `apps/desktop/package.json` `version` matches the planned tag (or `scripts/sync-version.mjs` will fix it on CI)

## Boot & basic UI (~1 min)

- [ ] Main window appears in < 2s on cold boot
- [ ] Theme follows previous session (no flash from dark→light)
- [ ] Language picker switches to all 7 locales without crash; selection persists across restart
- [ ] About dialog shows correct version + commit hash
- [ ] DevTools (F12 / ⌥⌘I) opens and closes

## Connection management (~3 min)

- [ ] New MySQL / PostgreSQL / SQLite connections — save, reopen, all fields preserved
- [ ] "Test connection" green toast shows server version
- [ ] Wrong password → red toast with specific error code (not "Unknown error")
- [ ] Duplicate name → inline form validation, focus returns to name field
- [ ] Right-click a saved connection → Edit / Duplicate / Delete all work
- [ ] **Force-kill (`pkill -9 Electron` or Activity Monitor) then restart → all connections still present**
- [ ] **AI settings (provider + apiKey) entered once → force-kill → restart → key still loaded**

## SQL editor (~3 min)

- [ ] ⌘+Enter (or Ctrl+Enter) runs selection / whole tab
- [ ] Multiple tabs: switching keeps SQL content + cursor position
- [ ] AI inline completion (Tab to accept, Esc to dismiss)
- [ ] History panel: filter by tag, pin, edit note, delete
- [ ] Linter underlines obvious antipatterns (`SELECT *`, unbounded UPDATE)
- [ ] Format SQL keybinding works
- [ ] Cancel button stops a long-running query within ~1s

## Result grid (~3 min)

- [ ] 1M+ row result scrolls smoothly (virtual scroll)
- [ ] Click JSON cell → viewer opens with tree
- [ ] Click BLOB cell → hex viewer + decode-as-text toggle
- [ ] Numeric column sparkline shows in column header
- [ ] Inline edit → commit → database actually updated (verify with re-query)
- [ ] Manual-commit mode: BEGIN → edit → COMMIT only after explicit confirm; ROLLBACK works
- [ ] "Ask AI" on error row enters chat with full SQL + error context
- [ ] **Query result diff**: run two queries, diff them → added / removed / changed rows marked
- [ ] **Masking on export**: enable masking → a masked column copies/exports masked (not plaintext)

## DDL / Schema (~2 min)

- [ ] Generate `CREATE TABLE` DDL from existing table (current dialect)
- [ ] Schema diff between two connections produces aligned migration SQL
- [ ] Mock data v1 inserts rows that satisfy column types + NOT NULL
- [ ] **ER diagram**: pick a connection + schema → graph renders (FK arrows child→parent); focus filter works; export PNG + SVG produce files
- [ ] **Nav object types**: expand a schema on PG/openGauss/Oracle/DM/SQL Server → expected object-type groups appear (see `features/nav-tree.md`)

## AI / RAG (~2 min)

- [ ] **RAG knowledge base**: build an index for a schema → ask a question → answer cites the relevant tables; mode badge shows vector/hybrid (with an embedding endpoint) or lexical (without)
- [ ] **Notebook**: create cells (SQL + Markdown), run a SQL cell, reopen → cells persisted
- [ ] **Custom lint rules**: add a rule → matching SQL gets flagged at the chosen severity
- [ ] **Storage capacity**: open the capacity dialog → size snapshot + trend projection render

## Multi-platform & windowing (~1 min)

- [ ] Second window (⌘⇧N or menu "New Window") opens, independent state
- [ ] macOS: ⌘+W closes tab, ⌘+Q quits the app
- [ ] Windows / Linux: standard shortcuts work
- [ ] System tray icon (Linux) / dock badge (mac) show

## Auto-update (~2 min)

- [ ] Check for updates returns the expected latest version
- [ ] Channel switch (GitHub ↔ OSS-CN) persists and is used on next check
- [ ] When unreachable, error message is specific (host + status code), not silent
- [ ] In-app changelog renders properly

## Per-driver minimum (run on the driver matrix you ship to)

For each driver you officially support, run **at least**:

- [ ] Test connection succeeds
- [ ] Tree expands to tables / collections / etc.
- [ ] Run `SELECT 1` (or equivalent) returns 1 row
- [ ] Run a simple `INSERT` + `SELECT` round-trip
- [ ] Disconnect from menu → reconnect works

See [`driver-matrix.md`](./driver-matrix.md) for the per-driver checklist.

## After-checklist

- [ ] All items above ✅, OR failed items have a linked GitHub issue with a clear reproducer
- [ ] No regressions vs previous RC (compare to the previous Release Smoke issue if any)
- [ ] OK to tag → `git checkout main && git tag vX.Y.Z && git push --tags`
