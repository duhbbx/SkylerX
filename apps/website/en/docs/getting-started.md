# Quick Start

From download to your first successful query in five minutes.

## 1. Download and install

Head to the [download page](/en/download) and grab the installer for your platform:

- **macOS**: `.dmg` file — drag SkylerX to Applications
- **Windows**: `.exe` installer — click through the wizard
- **Linux**: `.AppImage` (no install — `chmod +x` and run) or `.deb` / `.rpm` (`sudo dpkg -i` / `sudo rpm -ivh`)

On first launch the app initializes a local config store (SQLite, in the OS standard user-data directory).

## 2. Create your first connection

Launch the app → click "New connection" in the top-left (⌘N / Ctrl+N) → pick a dialect.

### MySQL / PostgreSQL and friends

| Field | Example |
|---|---|
| Name | Local dev DB |
| Dialect | MySQL |
| Host | 127.0.0.1 |
| Port | 3306 (MySQL default) |
| User | root |
| Password | (your password) |
| Database | (optional — leave blank to choose after connecting) |
| Environment | dev / test / prod |

Click "Test connection" → save when it succeeds.

### Oracle / OB Oracle tenant

Oracle needs a Service Name (default `XEPDB1`; containerized `gvenzl/oracle-free` uses `FREEPDB1`):

| Field | Example |
|---|---|
| Dialect | Oracle |
| Host | 127.0.0.1 |
| Port | 1521 |
| User | system |
| Password | oracle |
| Database / Service | FREEPDB1 |
| Advanced → privilege | (blank = normal) or SYSDBA / SYSOPER etc. |

### Chinese-vendor databases

- **DM**: port 5236, install the `dmdb` npm package (`pnpm -F @db-tool/desktop add dmdb`)
- **KingbaseES**: port 54321 (default), PG-compatible, no extra driver
- **openGauss**: PG-compatible, no extra driver
- **OceanBase**: port 2881, uses mysql2 — Oracle tenants also use this dialect

Field-level details in [Connection management →](/en/docs/connections)

## 3. Browse the nav tree

**Double-click a connection** in the list — the nav tree on the left expands:

```
📦 Local dev DB (MySQL)
  └── 📁 mydb
       ├── 📁 Tables (12)
       │    ├── users
       │    ├── orders
       │    └── ...
       ├── 📁 Views (3)
       ├── 📁 Functions (1)
       └── 📁 Procedures (0)
```

**Double-click a table name** → opens the data grid by default (SELECT first 200 rows; change under `Settings → Default page size`).

## 4. Write and run SQL

- Click "New query" in the toolbar or press ⌘T / Ctrl+T for a fresh SQL tab
- Monaco-powered autocomplete for tables / columns / keywords
- ⌘+Enter / Ctrl+Enter runs (selection only if you've selected text)
- Results land in the grid below

### Handy shortcuts

| Action | macOS | Windows / Linux |
|---|---|---|
| Command palette | ⌘K | Ctrl+K |
| Global object search | ⌘⇧O | Ctrl+Shift+O |
| Run SQL | ⌘+Enter | Ctrl+Enter |
| Format SQL | ⌘⇧F | Ctrl+Shift+F |
| Toggle AI chat | ⌘⇧L | Ctrl+Shift+L |
| New window (second session) | ⌘⇧N | Ctrl+Shift+N |

All shortcuts are customizable under `Settings → Key bindings`.

## 5. Configure the AI assistant (optional)

`Settings → AI Provider` → add any supported provider:

- Anthropic (Claude family)
- OpenAI (GPT-4 / o1 family)
- DeepSeek
- Codex
- Grok / xAI

Once an API key is set you get:
- The right-hand chat panel (⌘⇧L to toggle)
- Inline completion in the editor (Copilot-style)
- "✨ Ask AI" on any error dialog for auto-diagnose
- 7 pro Toolboxes (write migrations / tune SQL / read EXPLAIN / generate test data / NL→SQL / write comments / explain table purpose)

## 6. Going further

- [SQL editor deep dive](/en/docs/query) — autocomplete / snippet library / EXPLAIN
- [Result grid](/en/docs/grid) — editable mode / filters / coloring / export
- [AI assistant](/en/docs/ai) — provider setup / memory system / Toolbox details
- [Troubleshooting & compatibility](/en/docs/troubleshooting) — ORA-xxx / SQLSTATE auto-diagnose

## Stuck?

- Click "**✨ Ask AI**" on any error dialog — SkylerX feeds the SQL + error + connection metadata straight to the AI
- Still stuck? [GitHub Issues](https://github.com/duhbbx/SkylerX/issues)
