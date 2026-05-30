# SQL Editor

## Opening a query tab

- ⌘T / Ctrl+T: new query tab
- Double-click a table → opens the data grid (equivalent to `SELECT * FROM table LIMIT 200`)
- Right-click a table → "New query" — pre-fills `SELECT * FROM ...` in the editor

## Editor capabilities

Powered by Monaco (the VS Code editor), with a SQL-friendly theme.

### Autocomplete

Triggered by `Ctrl+Space` or automatically while typing. Completes:

- SQL keywords / built-in functions
- All database / schema names on the current connection
- Column names of tables already referenced in FROM / JOIN
- Saved SQL snippets (snippet name as trigger word)

### Formatter

⌘⇧F / Ctrl+Shift+F formats the SQL (powered by sql-formatter). Respects dialect-specific style (MySQL / PG / Oracle each have their own preference).

### Parameterization

Named parameters `:name` are supported. A prompt appears at execution time:

```sql
SELECT * FROM orders
 WHERE user_id = :uid
   AND created_at >= :start
```

You fill in `uid` and `start`, and SkylerX rewrites them to whatever form the driver expects (`?` or `$1` etc.).

### SQL snippet library

`⌘K → Snippets` or the "Snippets" panel on the left:

- Save frequently used SQL (name + description + tags)
- Filter by tag
- Double-click to insert into the current editor, or drag to any tab

## Execution

| Shortcut | Action |
|---|---|
| ⌘+Enter / Ctrl+Enter | Run (selection if any, otherwise everything) |
| Toolbar "Run" | Same as above |
| Toolbar "Cancel" | Server-side cancel (MySQL `KILL QUERY` / PG `pg_cancel_backend`) |

Multi-statement input is auto-split on `;` and run sequentially. The first failure stops and the failing statement is highlighted in red.

## SQL Linter — risk interception

A rule engine runs before execution:

| Severity | Rule | Action |
|---|---|---|
| error | UPDATE / DELETE without WHERE | Pops a "dangerous SQL" confirmation |
| error | DROP TABLE / DATABASE on a prod connection | Confirmation prompt |
| warn | TRUNCATE on prod | Toast warning |
| warn | Multi-table FROM without ON | Toast |
| info | `SELECT *` | Console log |
| info | SELECT without LIMIT | Console log |

**The Linter takes precedence over the prod confirmation prompt**, so a single WHERE-less UPDATE doesn't fire two dialogs at the user.

## EXPLAIN visualizer

Toolbar **Explain** button (or `EXPLAIN+` to toggle real ANALYZE):

- Tree view of the execution plan
- Estimated vs actual rows (ANALYZE mode)
- Slow operators colored by time: green (< 100ms) / yellow (< 1s) / red (> 1s)
- Optional PNG / Markdown export for sharing

## AI inline completion (Copilot-style)

Automatically enabled once `Settings → AI Provider` is configured:

- Triggers 600ms after the cursor settles
- In-flight requests are cancelled when a new trigger fires
- Tab to accept, Esc/Backspace to dismiss
- Shares the master "SQL autocomplete" toggle (`Settings → Completion`)

## Auto-ask AI on errors

When a statement fails:

- The result pane shows the full error + SQLSTATE / errno
- A "**✨ Ask AI**" button at the top sends the current SQL + error + connection metadata into the AI chat panel and starts a new conversation
- Every alert dialog also exposes an "Ask AI" button

## Query history

`⌘K → History` or the "History" panel on the left:

- Sorted by time descending
- Shows connection / SQL summary / duration / success status
- Double-click to reopen
- Star / search

## Favorites

The ⭐ button adds the current SQL to your favorites:

- Custom name + tags
- Works across connections
- ⌘K → "Favorites" for quick access

## Multi-tab management

- Middle-click a tab → close
- Right-click → duplicate / move to other window / pin / close all on the right
- Drag to reorder
- Pinned tabs survive app restarts
