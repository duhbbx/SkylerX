# Query History — manual QA

Covers: history capture, tag, pin, note, search, delete.

> Run when changing: `apps/desktop/src/main/db/historyStore.ts`, history-related IPC channels, `packages/ui/src/components/HistoryPanel.vue`.

## Setup

- Branch / commit:
- OS:
- Active connection:

## Capture

- [ ] Run any SELECT → switch to History panel → query appears at top with timestamp, duration, row count, status (success / error)
- [ ] Run a failing query → also captured, with error message
- [ ] Run same query 5x → 5 entries (not deduped — each execution recorded)
- [ ] Evidence:

## Filter / search

- [ ] Type substring in search box → list filters live (no re-fetch)
- [ ] Filter by connection (dropdown) → only matching connection's history
- [ ] Filter by status (success / error) → only matching
- [ ] Filter by date range → only matching
- [ ] Clear all filters → full list back
- [ ] Evidence:

## Tag / pin / note

- [ ] Right-click a history entry → "Add tag" → input "investigation-29" → tag chip appears
- [ ] Filter by tag → only tagged entries
- [ ] Right-click → "Pin" → entry stays at top regardless of date sort
- [ ] Right-click → "Add note" → text editor → save → note shown as tooltip on hover
- [ ] All three (tag / pin / note) persist after app restart
- [ ] Evidence:

## Re-run

- [ ] Click an entry → editor populates with that SQL, ready to run
- [ ] Click "Run" → runs against current active connection (warn if different from history entry's connection)
- [ ] Evidence:

## Delete

- [ ] Right-click → Delete → removes from list
- [ ] Confirm: refresh / restart → still deleted (persisted)
- [ ] Multi-select + Delete → batch remove
- [ ] "Clear all history for this connection" → confirm dialog, then wipes
- [ ] Evidence:

## Force-kill safety

- [ ] Run 10 queries → `pkill -9 Electron` → restart → all 10 entries present (SQLite synchronous write)
- [ ] Evidence:

## Performance

- [ ] After ~10k history entries, search latency < 200ms (FTS or indexed LIKE)
- [ ] Scroll panel — virtual list, no lag
- [ ] Evidence:

## Privacy / safety

- [ ] If query contains password (e.g. `CREATE USER ... IDENTIFIED BY 'pwd'`) → setting "Mask passwords in history" replaces with `***`
- [ ] Right-click → "Copy without secrets" produces a sanitized copy
- [ ] Evidence:

## Known limitations

- History store size cap (configurable in settings) — oldest entries auto-pruned beyond cap; verify default cap (~10k entries) works
- Cross-connection deduplication is intentionally off — same SQL on dev / prod is different audit context
