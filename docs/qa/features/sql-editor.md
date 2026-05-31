# SQL Editor — manual QA

Covers: Monaco editor, run query, format, AI inline completion, parameterized queries, snippets, multi-tab, linter.

> Run when changing: `packages/ui/src/components/QueryPane.vue`, `packages/ui/src/sql-linter.ts`, `packages/ui/src/ai-inline.ts`, anything Monaco-related.

## Setup

- Branch / commit:
- OS:
- Active connection: <!-- e.g. MySQL 8.0 / sakila DB -->

## Editor basics

- [ ] Click "New tab" → empty editor with cursor focused
- [ ] Type SQL → syntax highlighting applies (keywords colored, strings in quote color)
- [ ] `Ctrl+F` / `Cmd+F` → find dialog opens, find/replace works
- [ ] `Ctrl+/` / `Cmd+/` → comment selected lines
- [ ] Drag tab header to reorder → state preserved
- [ ] Close tab → confirm if dirty, no confirm if saved
- [ ] Evidence:

## Run query

- [ ] Select a SELECT → `Cmd+Enter` (mac) / `Ctrl+Enter` (win/linux) → runs selection only
- [ ] No selection → same shortcut → runs all SQL in tab
- [ ] Cursor inside one of multiple statements → runs only that statement (smart parsing)
- [ ] Run a slow query (e.g. `SELECT SLEEP(5)`) → cancel button enables → click → query stops within 1s
- [ ] Evidence:

## Format

- [ ] Random unformatted SQL → click "Format" / `Shift+Cmd+F` → properly aligned
- [ ] Format does NOT change comments or string literals
- [ ] Format is dialect-aware (e.g. backtick vs double-quote for identifier)
- [ ] Evidence:

## AI inline completion

- [ ] Type partial query → after ~500ms pause, ghost-text suggestion appears
- [ ] `Tab` accepts suggestion
- [ ] `Esc` dismisses suggestion
- [ ] Continue typing → suggestion updates / dismisses
- [ ] Evidence:

### AI off-path
- [ ] Without internet → no suggestion appears, no error toast
- [ ] AI provider key missing → "configure AI in settings" hint appears once per session
- [ ] AI request takes >5s → eventually cancelled, no UI freeze
- [ ] Evidence:

## SQL Linter

- [ ] Write `SELECT * FROM big_table` → warning underline + tooltip "SELECT *"
- [ ] Write `UPDATE t SET x=1` (no WHERE) → warning + tooltip "UPDATE without WHERE"
- [ ] Write `DELETE FROM t` (no WHERE) → warning + tooltip "DELETE without WHERE"
- [ ] Multiple violations → all show, can hover each
- [ ] Linter respects dialect (e.g. `SELECT TOP 10` is valid for SQL Server, not for PG)
- [ ] Evidence:

## Parameterized queries

- [ ] Write `SELECT * FROM users WHERE id = :id AND email = :email`
- [ ] Click "Run" → modal appears asking for `:id` and `:email`
- [ ] Fill values → query runs with bound params (not string-concat)
- [ ] Re-run same query → modal pre-fills last values
- [ ] Evidence:

## Snippets

- [ ] Click "Snippets" panel → predefined snippets listed
- [ ] Double-click a snippet → inserted at cursor
- [ ] Save current selection as new snippet → appears in list, available across tabs
- [ ] Restart app → custom snippets persist
- [ ] Evidence:

## Multi-tab

- [ ] Open tab A with SQL → switch to tab B, write different SQL → switch back → tab A SQL + cursor preserved
- [ ] Run a query in tab A → switch to tab B → tab A's result grid is NOT disturbed
- [ ] Close all tabs → app remains usable, new tab spawnable
- [ ] Evidence:

## Cross-platform shortcut differences

- [ ] **macOS**: `Cmd+Enter` runs, `Cmd+S` saves, `Cmd+W` closes tab
- [ ] **Windows**: `Ctrl+Enter` runs, `Ctrl+S` saves, `Ctrl+W` closes tab
- [ ] **Linux**: same as Windows
- [ ] Evidence:

## Per-dialect smoke (regression-prone)

- [ ] MySQL: backtick identifier `\`my table\`` syntax-highlighted correctly
- [ ] PostgreSQL: dollar-quoted strings `$$ ... $$` highlighted correctly
- [ ] Oracle: PL/SQL `BEGIN ... END;` block does not confuse statement splitter
- [ ] SQL Server: `GO` separator works as batch boundary
- [ ] Evidence:

## Known limitations

- Multi-statement scripts on Oracle / DM may need explicit terminator handling — known to require `/` for PL/SQL blocks
- Format does not currently rewrite to canonical case (keywords stay as-typed)
