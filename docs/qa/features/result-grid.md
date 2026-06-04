# Result Grid — manual QA

Covers: virtual scrolling, inline edit, JSON / BLOB / image cell viewers, numeric sparklines, sort, filter, "Ask AI on error".

> Run when changing: `packages/ui/src/components/ResultGrid.vue`, `packages/ui/src/editable.ts`, `packages/ui/src/cell-viewer/*`.

## Setup

- Branch / commit:
- OS:
- Active connection + table: <!-- e.g. MySQL sakila.film -->

## Display basics

- [ ] Run a SELECT returning >100 rows → grid renders without blocking the UI thread (< 200ms to first paint)
- [ ] Column headers show name + type (e.g. `id BIGINT`)
- [ ] Click column header → sort ascending; click again → descending; third click → unsorted
- [ ] Drag column edge → resize works, persists across queries in same tab
- [ ] Right-click header → show/hide columns
- [ ] Evidence:

## Virtual scroll

- [ ] Run `SELECT * FROM ... LIMIT 1000000` (or a join generating 1M+) → grid loads, scrolls smoothly (<16ms / frame)
- [ ] Jump scrollbar to bottom → bottom rows render correctly (not blank)
- [ ] Memory usage stable while scrolling (check Activity Monitor)
- [ ] Evidence: screen recording of smooth scroll

## Inline edit (auto-commit mode)

- [ ] Double-click a cell → editor opens, current value selected
- [ ] Type new value → `Tab` or `Enter` → commits via UPDATE
- [ ] Re-run same SELECT → new value visible (proves DB actually updated)
- [ ] `Esc` during edit → cancels, no UPDATE issued
- [ ] Evidence: paste UPDATE SQL the app generated + result of re-query

### Type coercion
- [ ] Edit INT column with string "abc" → error inline, no UPDATE
- [ ] Edit NOT NULL column with empty value → error inline
- [ ] Edit FK column with invalid reference → DB-level error toast (not silent)
- [ ] Edit DATE column with bad format → error inline

## Cell viewers

### JSON cell
- [ ] Run `SELECT '{"a":1,"b":[2,3]}' AS j` → double-click `j` cell → JSON viewer opens with tree
- [ ] Expand/collapse nodes works
- [ ] Copy as JSON / copy raw text both work
- [ ] Edit JSON → format button reformats → save → DB updated
- [ ] Evidence:

### BLOB cell
- [ ] Run a query returning a BLOB column → grid shows `<BLOB 1234 bytes>`
- [ ] Double-click → hex viewer opens
- [ ] Toggle "Decode as text" → shows UTF-8 if valid
- [ ] Save to file → file written, opens in OS
- [ ] Evidence:

### Image cell (BLOB containing image)
- [ ] Run query returning image BLOB → double-click → preview renders
- [ ] PNG / JPEG / GIF all render
- [ ] Save to file → opens correctly in OS image viewer
- [ ] Evidence:

### NULL cell
- [ ] NULL renders distinctly (italic `NULL` or muted color), not empty string
- [ ] Double-click NULL → editor opens with empty; type "x" + Enter → UPDATE sets to "x"
- [ ] Click "set NULL" button → UPDATE sets to NULL explicitly
- [ ] Evidence:

## Numeric sparkline

- [ ] Run query with a numeric column (e.g. `SELECT id, length FROM film`)
- [ ] Column header shows a sparkline of value distribution
- [ ] Hover sparkline → tooltip with min / max / avg
- [ ] Evidence:

## Filter / search in result

- [ ] Click "Filter" → input box → type substring → grid filters in place (no re-query)
- [ ] Clear filter → all rows back
- [ ] Filter by column-specific value (per-column filter chip)
- [ ] Evidence:

## "Ask AI on error" (regression for AI-channel)

- [ ] Run intentionally broken SQL (e.g. `SELCT * FORM film`)
- [ ] Result panel shows red error + "Ask AI" button
- [ ] Click "Ask AI" → AI chat opens with: original SQL + error message + dialect + table schema context
- [ ] AI suggests a fix → "Apply" inserts corrected SQL into editor
- [ ] Evidence:

## Manual-commit interaction

- [ ] Switch to manual-commit mode (toolbar) → BEGIN auto-issued
- [ ] Edit a cell → UPDATE stages but NOT committed
- [ ] Click COMMIT → re-query proves UPDATE persisted
- [ ] Edit again → click ROLLBACK → re-query proves UPDATE rolled back
- [ ] Evidence:

## Export from grid

- [ ] Right-click → Export → CSV / JSON / SQL / Excel / Markdown
- [ ] Each format opens correctly in the matching tool
- [ ] Large result (>100k rows) — export streams, no OOM
- [ ] Evidence: attach 5 exported files

## Cross-platform

- [ ] macOS: Cmd+C copies selected cells (TSV to clipboard, pasteable into Numbers)
- [ ] Windows: Ctrl+C → pasteable into Excel
- [ ] Linux: Ctrl+C → pasteable into LibreOffice
- [ ] Evidence:

## Parameterized queries use real binds (distilled from dbeaver #15310)

> Values must go through driver bind parameters, not be string-interpolated into the
> SQL (injection-safe + correct typing). Already covered for data migration; verify
> the inline-edit / DML-commit path too.

- [ ] Inline-edit a string cell to a value containing a single quote (`O'Brien`),
      a backslash, and CJK → commit → re-query shows it intact (no SQL error, no
      truncation, no broken quoting)
- [ ] Inline-edit a BLOB/binary cell → bytes round-trip exactly (parameter bind, not
      a literal)
- [ ] Inline-edit a NULL ↔ value → stored as real NULL / value, not the string
      `'NULL'`

## Known limitations

- BIGINT > Number.MAX_SAFE_INTEGER (SQL Server, Oracle) display as string with annotation; in-grid edit may truncate — known, separate fix TBD
- BLOB > 10 MB skips preview render to avoid OOM; "Save to file" still works
- Sparkline disabled for columns with >10k distinct values for perf
