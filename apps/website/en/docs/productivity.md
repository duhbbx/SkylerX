# Productivity

SkylerX wires every "DBA / backend day-to-day 30-second to 30-minute action" into **keyboard / command palette / notifications** — the goal: fewer clicks, fewer window switches. This page lists the most-used entry points, each tied to source files and code facts.

## 1. Overview

| Tool | Entry | Solves |
|---|---|---|
| Command palette ⌘K | Global / `Settings → Key bindings` | Everything searchable — skip menu navigation |
| Global object search ⌘⇧O | Global | Cross-DB fuzzy search tables / views / columns → jump to nav tree |
| SQL snippet library | Editor right drawer / `★` button | Save and reuse queries; `{{var}}` templates |
| Query history | Editor right drawer | Sort by time / duration; slow queries flagged red |
| Favorites | ⌘K → "Favorites" / toolbar | Quick return to tables / views / queries |
| Custom shortcuts | `Settings → Key bindings` | 12 commands, fully rebindable + conflict detection |
| Dashboard | ⌘K → "Dashboard" | Multi-SQL, multi-card "status dashboard" |
| Webhook notifications | `Settings → Notifications` | DingTalk / Lark / Slack / generic — push slow queries + errors |
| Multi-window ⌘⇧N | File → New window | Same app, two independent sessions (local vs local / local vs remote) |

---

## 2. Command palette ⌘K

Code: `packages/ui/src/components/CommandPalette.vue` + `packages/ui/src/Workspace.vue` (item source / routing)

Press ⌘K (mac) / Ctrl+K (Win/Linux) → a floating search box appears → type a keyword → ↑↓ to select → Enter to run. Esc closes.

### Search logic

```ts
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q
    ? props.items.filter((it) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(q))
    : props.items
})
```

- Matches label + hint (the connection hint is the dialect name); plain substring `includes`, **no pinyin or fuzzy order-sensitive matching** (we prioritize speed of typing)
- Shows up to 50 items (avoid sluggish long lists)

### Built-in command list

The table below is the full `paletteItems` computed in `Workspace.vue` (actions + per-connection actions + connection entries):

| Action ID | Label | Equivalent path |
|---|---|---|
| `act:new-conn` | New connection | Toolbar + |
| `act:object-search` | Global object search | ⌘⇧O |
| `act:schema-diff` | Schema diff | Tools → Schema diff |
| `act:data-diff` | Data diff | Tools → Data diff |
| `act:privileges` | Privileges | Right-click connection → Privileges |
| `act:settings` | Settings | ⌘, |
| `act:export-conns` / `act:import-conns` | Import / export connections | File menu |
| `act:refresh` | Refresh nav tree | F5 |
| `act:favorites` | Favorites | Toolbar ⭐ |
| `act:oplog` | Operation log | Toolbar |
| `act:monitor` | Monitor panel | Toolbar |
| `act:dashboard` | Dashboard | Tools → Dashboard |
| `act:ndjson-viewer` | NDJSON viewer | Toolbar |
| `act:contracts` | Data contracts | Tools → Data contracts |
| `act:o2dm` | Oracle → DM migration wizard | Toolbar |
| `act:mig-assess` | Migration assessment (source profiling + grades + AI convert + export) | Right-click an Oracle/DM connection |
| `act:translate` | SQL translation (cross-dialect) | Toolbar |
| `act:notif` | Notification webhook config | `Settings → Notifications` |
| `act:keybind` | Custom shortcuts | `Settings → Key bindings` |
| `act:drift` | Schema drift detection | Toolbar |
| `act:ai-chat` / `act:ai` / `act:ai-toolbox` | AI chat / AI assistant / AI Toolbox | ⌘⇧L |
| `act:about` / `act:shortcuts` | About / shortcut reference | Help menu |
| `act:new-window` | New window (desktop only) | ⌘⇧N |

### Per-connection actions

These expand into one entry per registered connection, suffixed `· connectionName · dialect`:

| ID prefix | Meaning |
|---|---|
| `act:activity:` | Server activity (processlist / pg_stat_activity) |
| `act:obtopo:` | OceanBase cluster topology (OB dialect only) |
| `act:snapshots:` / `act:backup:` | Schema snapshots / backup-restore |
| `act:health:` / `act:vqd:` | AI health check / visual query builder |
| `act:slowq:` / `act:idxrec:` / `act:repl:` | Slow query analysis / index recommendation / replication lag |
| `act:compliance:` / `act:search-value:` | Compliance check / cross-table value search |
| `act:aicmt:` | AI write comments |
| `conn:` prefix | Open the connection (group = "Connections") |

> A workspace with 5 connections shows 80+ commands. Group label + substring `includes` mean 3-4 keystrokes is enough to pinpoint anything.

### Extending it

Logic concentrates in `paletteItems`. Adding a command is two steps: append a `{ id, label, group }` and add `else if (item.id === ...)` routing in `onPaletteSelect()`. For "one entry per connection", see `act:compliance:`'s pattern: `.map(c => ({ id: \`act:xxx:${c.id}\`, ... }))`, then route with `item.id.startsWith()`.

---

## 3. Global object search ⌘⇧O

Code: `packages/ui/src/components/ObjectSearchDialog.vue`

⌘⇧O (mac) / Ctrl+Shift+O (Win/Linux) pops a dialog that **fuzzy-searches tables, views, and columns across DBs / schemas** within the selected connection.

### Search SQL

Uses `information_schema`. MySQL family vs PG family:

| Family | Excluded schemas | Escape mode |
|---|---|---|
| MySQL family | `mysql / information_schema / performance_schema / sys` | `LIKE '%term%'` with `%_\\` 3-char escape |
| PG family | `pg_catalog / information_schema` | `ILIKE '%term%'` |
| Others | — | Not supported; tells the user to search manually |

Each category (tables / views / columns) caps at the first 100; input debounced 280ms.

### Result actions

- **Click row = reveal**: emit `reveal`; Workspace expands the path in the nav tree and selects the object (auto-expanding intermediate nodes)
- **Hover shows "Preview"**: emit `preview` → opens `SELECT * FROM schema.table LIMIT 200` (with dialect-appropriate quoting)
- **Icons**: `▦` table / `◫` view / `·` column

### Concurrency safety

Each input keystroke bumps a `seq` counter; only the latest result is committed — prevents stale responses from overwriting fresh ones.

---

## 4. SQL snippet library

Code: `packages/ui/src/snippets.ts` + `packages/ui/src/components/SnippetsPanel.vue`

### Data structure

```ts
interface Snippet {
  id: string        // `${timestamp}-${rand5}`
  name: string      // User-chosen; defaults to first 40 chars of SQL if empty
  sql: string
  tags?: string[]   // Tags for UI filtering by #
  dialects?: DbDialect[]  // Restricted dialects; empty = universal
  createdAt: number
}
```

Stored in `localStorage.skylerx.snippets`; Vue `reactive` + `watch deep` for live persistence.

### Add / remove

- Right-click any SQL editor → "Save as snippet", or toolbar `★`
- Star button on any history row → save as snippet directly
- `Settings → Editor → Save snippet` binds ⌘S by default (rebindable)

### Placeholder templates

`{{var}}` in a snippet prompts when inserting:

```sql
SELECT * FROM {{table}} WHERE id = {{id}}
```

`applySnippetVars()` extracts placeholders in order and prompts one by one; cancel at any step → nothing is inserted (no half-formed SQL).

### Dialect filtering

`snippetsForDialect(dialect)` filters the panel by current editor dialect:

- `dialects = []` or unset → visible to any dialect ("universal")
- `dialects = [MySQL, MariaDB]` → only shows for MySQL / MariaDB connections

Stops MySQL-only snippets from cluttering a PG connection.

### Panel interactions

| Action | Effect |
|---|---|
| Search at the top | Substring filter on name + SQL + tags |
| Click `#xxx` tag | Filter by that tag; click again to clear |
| Double-click a row | Apply placeholders then insert into editor |
| `×` | Delete (no confirm) |

---

## 5. Query history

Code: `packages/ui/src/components/HistoryPanel.vue`

Every execution (success or failure) writes a row to the local SQLite — fields include `sql / executedAt / durationMs / success / pinned / tags / note`.

### Sort + filter

| Control | Notes |
|---|---|
| Search box | Substring scan on sql + tags + note |
| Sort dropdown | `Time desc` (default) / `Duration desc` |
| `≥ N ms` | Slow-query filter; rows above the threshold **turn red** (default 500ms) |
| `📌` | Show pinned only |
| `Clear` | Wipe the table |

Pinned rows always sit at the top (`pinned: 1`); the rest sort by your choice.

### Row actions

| Button | Action |
|---|---|
| `📌` | Toggle pin |
| `🏷` | Edit tags (comma-separated, e.g. `daily,prod,join`) |
| `📝` | Edit note (free text) |
| `★` | Save as SQL snippet (emit `saveSnippet`) |
| Double-click | Load the SQL into the current editor |

All metadata edits go through `client.connections.historyMeta(id, patch)` → SQLite, not localStorage.

### Slow-query notification linkage

`Settings → Notifications → Global triggers → Slow-query threshold (ms)` (`settings.slowQueryNotifyMs`). Set non-zero, and any execution above the threshold fires `notify('slow-query', ...)` → matching webhook.

---

## 6. Favorites

Code: `packages/ui/src/favorites.ts`

Three `kind`s:

| kind | Meaning | Click action |
|---|---|---|
| `table` | Data table | Reveal in tree + preview first 200 rows |
| `view` | View | Same |
| `query` | Custom SQL | Open in current / new tab as draft |

### Key rules

- Object: `${connId}|${sqlName}` — same object can be favorited only once per connection; click again to remove
- Query: `q|${connId}|${createdAt}|${rand4}` — same SQL can be favorited many times (use case: "snapshots" of the same query at different moments)

### Group tags

`setFavoriteTag(id, tag)` assigns a tag to a favorite; the panel collapses by tag. A favorite has only one tag (simple and enough).

### Persistence

`localStorage.skylerx.favorites`, reactive + watch deep.

### Add-to-favorites from history

`addQueryFavorite({ connId, connName, dialect, name, sql, tags })` is the path for "I ran this query and want to keep it". HistoryPanel's `★` goes to snippets; the toolbar's "Favorite current query" goes here.

---

## 7. Custom shortcuts (K1)

Code: `packages/ui/src/keybindings.ts` + `packages/ui/src/components/KeyBindingsDialog.vue`

Entry: `Settings → Key bindings` / command palette → "Custom shortcuts".

### 12 bindable commands

| ID | Default chord | Purpose |
|---|---|---|
| `run-sql` | `CmdOrCtrl+Enter` | Run SQL |
| `palette` | `CmdOrCtrl+K` | Command palette |
| `object-search` | `CmdOrCtrl+Shift+O` | Global object search |
| `ai-chat` | `CmdOrCtrl+Shift+L` | Toggle AI chat |
| `new-conn` | `CmdOrCtrl+N` | New connection |
| `new-query` | `CmdOrCtrl+T` | New query |
| `close-tab` | `CmdOrCtrl+W` | Close tab |
| `find` | `CmdOrCtrl+F` | Find in editor |
| `replace` | `CmdOrCtrl+H` | Replace in editor |
| `format-sql` | `CmdOrCtrl+Shift+F` | Format SQL |
| `save-snippet` | `CmdOrCtrl+S` | Save current SQL as snippet |
| `settings` | `CmdOrCtrl+,` | Settings |

### `CmdOrCtrl` rendering convention

| Platform | `CmdOrCtrl+Shift+K` renders as |
|---|---|
| macOS | `⌘⇧K` (system-menu style, no `+`) |
| Windows / Linux | `Ctrl+Shift+K` |

Storage uses `CmdOrCtrl+...` consistently; the display is OS-mapped via `formatChord()`.

### Recording flow

1. Click "Record" on a command row → the row enters recording mode and renders an invisible `input` (`position: absolute; left: -9999px`) to grab keyboard focus
2. Listen on `keydown`, `chordFromEvent(e)` parses the combo:
   - Modifier order fixed as `CmdOrCtrl → Shift → Alt` (so string equality maps to chord equality)
   - Single letters uppercased; space → `Space`; `Enter` / `,` / `ArrowUp` kept as-is
   - Bare modifier (just Shift, no main key) returns empty string
3. Press Enter to save / Esc to cancel / Backspace on empty draft = "disable this command" (stored as empty string)

### Conflict detection

The `conflicts` computed scans the merged bindings (including the recording `draftChord`) — two commands bound to the same chord trigger a red end-of-row "Conflicts with XX" warning, surfacing it immediately.

### Storage + "Restore defaults"

Only "deltas from defaults" are stored under `settings.keyBindings` (`Record<string, string>`).

- Changed back to default → auto-removed from overrides (keeps storage lean)
- "Restore all defaults" → wipes `settings.keyBindings` after confirm
- "Disable a command" = empty string (key retained, value `''`)

---

## 8. Dashboard — multi-SQL multi-card

Code: `packages/ui/src/components/DashboardDialog.vue`

Entry: Tools menu → Dashboard / ⌘K → "Dashboard".

### Card structure

```ts
interface Card {
  id: string
  title: string
  connId: string
  sql: string
  lastRunAt?: number
  lastResult?: QueryResult | null
  lastError?: string | null
}
```

- Persisted to `localStorage.skylerx.dashboard.cards`, but **not `lastResult`** (potentially huge) — cleared on reopen
- Each card shows title + connection + SQL preview (200-char truncate) + last 5 rows (60-char truncate)

### Actions

| Button | Action |
|---|---|
| `+ Add card` | Mini form: title + connection + SQL (4-row textarea) |
| `↻ Refresh all` | `Promise.all(cards.map(runCard))` in parallel |
| Card header `↻` | Refresh single card |
| Card header `✎` | Enter edit form |
| Card header `×` | Delete (with confirm) |

### Things it deliberately doesn't do

- **No auto-refresh**: easy to forget running in the background — refresh manually
- **No charts**: a "→ open in ChartDialog" link is the clearer "view when you want to" path
- **No sharing / collaboration**: not before v0.5 — keeps us off cloud dependencies

---

## 9. Webhook notifications

Code: `packages/ui/src/notifications.ts` + `packages/ui/src/components/NotificationSettingsDialog.vue`

Entry: `Settings → Notifications` / ⌘K → "Notification webhooks".

### Four channels

| Channel | URL shape | Signature |
|---|---|---|
| `dingtalk` | DingTalk robot webhook | HMAC-SHA256(`ts\n${secret}`, key=`secret`), appended to query as `?timestamp=&sign=urlencoded(...)` |
| `feishu` | Lark robot webhook | HMAC-SHA256 (empty data, key=`ts\n${secret}`), sign goes into body |
| `slack` | Slack incoming webhook | No signature (URL = credential) |
| `webhook` | Generic POST JSON | No signature; recipient parses on their side |

Signing uses `globalThis.crypto.subtle` HMAC-SHA256 — **no third-party deps**.

### Three trigger events

| Event | Trigger |
|---|---|
| `query-error` | SQL execution failed |
| `slow-query` | Execution time ≥ `settings.slowQueryNotifyMs` (0 = off) |
| `manual` | User clicks "Test send" / toolbar "Notify" |

Each config can subscribe to these independently (`subscribe: NotifEvent[]`).

### Config schema

```ts
interface NotifConfig {
  id: string
  name: string
  channel: 'dingtalk' | 'feishu' | 'slack' | 'webhook'
  webhookUrl: string
  secret?: string           // DingTalk / Lark signing secret (optional)
  enabled: boolean
  subscribe: NotifEvent[]
}
```

Stored in `localStorage.skylerx.notifications`, separate from `settings` (notifications are noisy and shouldn't pollute settings sync).

### Test send

`Settings → Notifications` → select a config → "Test send". Send conditions:

- `enabled === true`
- `webhookUrl` non-empty
- `subscribe.includes('manual')` (test goes through `notify('manual', ...)`)

If any condition fails, a toast says so — nothing is actually sent.

### Dispatch doesn't block

`notify(event, payload)` is fire-and-forget:

```ts
await Promise.all(targets.map(async (c) => {
  try { await dispatchOne(c, payload) }
  catch (e) { console.warn(`[notify] ${c.channel}/${c.name} failed:`, e) }
}))
```

Per-webhook failures are swallowed (console warn only). **Notifications are auxiliary — they must not slow down the main flow.**

### Desktop fetch proxy

On desktop Electron the call goes through `globalThis.api.ai.fetch` IPC (bypasses browser CORS); on Web it falls back to native `fetch`.

---

## 10. App menu structure

Code: `apps/desktop/src/main/menu.ts`

7 top-level menus (DataGrip / Navicat-like):

| Menu | Highlights |
|---|---|
| **SkylerX** (mac only) | About / Settings ⌘, / Check for updates / Services / Hide / Quit |
| **File** | New connection ⌘N / New query ⌘T / Open SQL file ⌘O / Import · Export connections / Backup · Restore / Close tab ⌘W |
| **Edit** | System roles (undo / redo / cut / copy / paste / select all) + Find ⌘F / Replace ⌘H / Format SQL ⌘⇧F |
| **View** | Command palette ⌘K / Object search ⌘⇧O / Toggle AI chat ⌘⇧L / Favorites / Operation log / Zoom / Full screen / DevTools |
| **Tools** | Server activity / Backup-restore / Data transfer / Schema diff / Data diff / Schema snapshots / Dashboard / Cross-table search / Data contracts / AI Toolbox / AI assistant |
| **Window** | New window ⌘⇧N / Minimize / Reload / (mac) Bring all to front |
| **Help** | About / Shortcut reference / GitHub repo / Report a bug / Check for updates |

### Implementation note

Custom menu items **don't run business logic in the main process** (can't access renderer Vue state); they `webContents.send('menu:command', '<key>')` and the renderer subscribes via `window.api.menu.onCommand(key => ...)` in `Workspace.vue`, routing each key to the matching paletteItem `onPaletteSelect`.

---

## 11. Settings overview

Code: `packages/ui/src/components/SettingsDialog.vue`

The settings dialog has 5 categories on the left, a dynamic form on the right.

| Category | Highlights |
|---|---|
| **General** ⚙ | Language (zh / en), theme (dark / light), UI scaling (70% - 200%), default commit mode (auto / manual), NavTree usage-based ordering, **data masking toggle + rule editor** |
| **Editor** ⌨ | Font size, indent, word wrap, autocomplete toggle, keyword casing (upper / lower / preserve) |
| **Data grid** ▦ | Default page size (50 / 100 / 200 / 500 / 1000), NULL display text |
| **Production watermark** ⚠ | Text, opacity (0.04 - 0.5), angle (-90° - 90°), font size, color; live preview |
| **AI assistant** ✨ | Provider switch (Anthropic / OpenAI / DeepSeek / Codex / Grok), API key / model / base URL, memory & profile (A free text / B structured facts / C vector memory) |

> **Theme-related**: `Settings → General → Theme` toggles dark / light across all panels. Dark is the default (`appearance: 'dark'` set in VitePress / Electron renderer CSS variables).

### "AI memory" three tiers

| Tier | Field | Meaning |
|---|---|---|
| A | `aiCustomInstructions` | Free-text profile, appended to every system prompt |
| B | `aiFacts[]` + `aiAutoExtractFacts` | Structured fact list, manual / auto extract |
| C | `aiVectorMemory` + embedding triple + `aiVectorTopK` | Vector memory, cross-session semantic recall |

Bottom `Restore defaults` resets the whole settings table with confirmation.

---

## 12. Multi-window ⌘⇧N

Code: `apps/desktop/src/main/index.ts` `spawnExtraWindow()` + IPC `window:newSession`

⌘⇧N (mac) / Ctrl+Shift+N (Win/Linux) opens a fresh BrowserWindow (1100 × 750) on the same renderer URL — **completely independent session** from the main window.

### Typical uses

| Scenario | How |
|---|---|
| Local vs remote | Main window on local dev, new window on prod replica, side by side |
| Multi-tenant switching | One window per tenant |
| Long query + write more | Main runs slow SQL, new window writes the next one |

Each window owns its own SQL tabs / currently selected connection · DB · schema / editor cursor. History / favorites / snippets are **shared** (same-origin localStorage + single SQLite file).

No "window sync" (executions in the same connection across windows don't see each other; each writes its own historyPanel) and no "window manager" — no max window count, just use the OS's Mission Control / Exposé.

---

## 13. All productivity shortcuts

Defaults below; everything (except `new-window`, which is a menu item not in the `COMMANDS` table) is rebindable under `Settings → Key bindings`.

| Action | macOS | Windows / Linux | Command ID |
|---|---|---|---|
| Command palette | ⌘K | Ctrl+K | `palette` |
| Global object search | ⌘⇧O | Ctrl+Shift+O | `object-search` |
| Run SQL | ⌘+Enter | Ctrl+Enter | `run-sql` |
| Toggle AI chat | ⌘⇧L | Ctrl+Shift+L | `ai-chat` |
| New conn / new query / close tab | ⌘N / ⌘T / ⌘W | Ctrl+N / T / W | `new-conn` / `new-query` / `close-tab` |
| Find / replace / format SQL | ⌘F / ⌘H / ⌘⇧F | Ctrl+F / H / Shift+F | `find` / `replace` / `format-sql` |
| Save snippet / settings | ⌘S / ⌘, | Ctrl+S / Ctrl+, | `save-snippet` / `settings` |
| New window | ⌘⇧N | Ctrl+Shift+N | (menu item) |
