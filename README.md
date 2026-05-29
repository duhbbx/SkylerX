<div align="right">

[简体中文](./README.zh-CN.md) | **English**

</div>

# SkylerX

Cross-platform desktop **database management tool** (Navicat / DBeaver alternative), built with Electron + Vue 3 + Vite + TypeScript.

> **License**: [Apache License 2.0](./LICENSE)

> ⚠️ **Disclaimer / Status**
>
> SkylerX is under active development and has **NOT been fully tested in production environments**. Test coverage is partial, edge cases across all supported dialects have not been exhaustively verified, and breaking changes may land between minor versions.
>
> - **Use at your own risk.** Apache License 2.0 provides the software "AS IS", without warranty of any kind, express or implied (see [LICENSE](./LICENSE) §7–8).
> - **Always back up your databases before any write operation, schema change, data sync, or migration.**
> - Prefer evaluation on dev / staging connections; for production connections, mark them as `prod` (the app enforces an extra confirmation step) and verify destructive SQL with `EXPLAIN` / dry-run first.
> - We recommend treating SkylerX as a **power user / developer tool**, not as a managed DBA platform, until a stable 1.0 release.
>
> Bug reports and reproductions via [GitHub Issues](https://github.com/duhbbx/SkylerX/issues) are very welcome — they directly drive the hardening backlog.

## About

**Wuhan Skyler Network Technology Co., Ltd.** (武汉斯凯勒网络科技有限公司)

SkylerX is developed and maintained by Wuhan Skyler Network Technology Co., Ltd.

**We also take on outsourced development and project partnerships.** Areas we work in:

- 🛠 **Full-stack web** development (Vue / React / Node / Go / Java)
- 🖥 **Desktop apps** (Electron / Tauri, multi-platform packaging & auto-update)
- 🗄 **Database consulting**: dialect selection, schema design, performance tuning, migration (incl. Oracle / SQL Server → MySQL / PostgreSQL / 国产数据库)
- 🔄 **Navicat / DataGrip replacement** rollout & customization for enterprises
- 🏢 **On-premise / air-gapped deployment** & private-cloud builds (incl. 信创 / 国产化 environments)
- 📊 **Data platforms**: ETL pipelines, dashboards, data warehouse (ClickHouse / Snowflake / DuckDB) setup
- 🤖 **AI integration**: LLM API gateways, RAG over internal data, agentic workflows, on-prem inference
- 🛡 **DevOps & SRE**: CI/CD, observability, multi-cloud / hybrid deployment

Get in touch:

| Channel | Contact |
| --- | --- |
| 📧 Email | duhbbx@gmail.com |
| 💬 WeChat | tuhoooo |
| 🐛 Issues | [GitHub Issues](https://github.com/duhbbx/SkylerX/issues) |

## Supported databases

### SQL

| Database | Driver | Notes |
| --- | --- | --- |
| MySQL / MariaDB / OceanBase / TiDB | mysql2 | Pure JS |
| PostgreSQL / KingbaseES / CockroachDB / Greenplum / openGauss / H2 | pg | Protocol-compatible |
| SQL Server | mssql | Pure JS |
| Oracle | oracledb | Native (thin mode, no Instant Client needed), lazy-loaded |
| 达梦 DM | dmdb | Native, official vendor distribution, lazy-loaded |
| SQLite | better-sqlite3 | Local file |
| DuckDB | duckdb | Local file, OLAP |
| ClickHouse | @clickhouse/client | Columnar OLAP |
| Snowflake | snowflake-sdk | Cloud DW |

### NoSQL (parallel `executeCommand` channel)

| Database | Driver | Notes |
| --- | --- | --- |
| MongoDB | mongodb | Document store, ObjectId roundtrip |
| Redis | ioredis | KV + STREAM / HLL / Bitmap / Geo viewers |
| Elasticsearch | @elastic/elasticsearch | REST / HTTP search engine |

## Features

### Query workspace
- **Monaco editor** with SQL syntax highlighting, auto-completion for tables / columns / functions / snippets
- **Multiple query tabs**, SQL history (search & favorite), database / schema switching
- **Server-side cancellation** (KILL / pg_cancel)
- **EXPLAIN visualizer** with estimated vs actual rows, slow operator highlighting, `EXPLAIN+` (ANALYZE) opt-in
- **SQL formatter** (⌘⇧F), parameterized queries (`:name`)
- **SQL snippets** library with tag filtering
- **Production safeguard**: connections tagged as `prod` require typing the connection name to confirm DROP / DELETE / TRUNCATE
- **Manual / auto commit**: per-tab toggle in toolbar; defaults from global setting; new transactions auto-start after commit/rollback

### Result grid
- Pagination, **virtual scrolling for large result sets**, editable grid (multi-row select, cell edit, insert / delete → transactional commit)
- Cell viewer with **NULL / empty / large-text / JSON / BLOB** visual differentiation
- **JSON column editing** + **BLOB preview** (auto-detect PNG / JPEG / GIF / WEBP signatures, render inline image or hex dump)
- Column filter, multi-format copy (CSV / TSV / JSON / Markdown / SQL VALUES), export
- **Result charting** (bar / line / pie via inline SVG, PNG export)
- **Alternative views**: pivot table, self-FK tree, geo scatter, timeline
- **Cell right-click**: reverse value search, FK navigation, "Ask AI" about error
- **Foreign key navigation**: jump to referenced row, browse incoming references

### Schema & DBA
- Visual table designer with diff-aware ALTER on save
- View / function / procedure / trigger DDL editor
- ER diagram viewer
- **Schema snapshots** + per-table diff
- **Schema drift detection** between two live connections + auto-generated align SQL
- **Server activity panel**: process list + long transactions + lock waits, with `KILL` action
- **Replication lag monitor**: MySQL `SHOW REPLICA STATUS` / PG `pg_stat_replication` / MSSQL AOAG
- **Data Inspector** (column sample / full profile / constraint scan / type optimization / table maintenance)
- **Data Fixup** (duplicates / NULL backfill / soft-delete recovery)
- **Index Recommender** (based on SQL history + existing indexes)
- **Schema diff & data diff** with sync SQL generation
- **Backup / Restore** wizard (pure-SQL path, cross-platform, no `mysqldump` dependency)

### AI assistant (multi-provider: Anthropic / OpenAI / DeepSeek / Codex / Grok)
- **Right-side chat panel** (Cursor-style), Markdown rendering, SQL highlighting
- **3-tier memory**: free-text profile / structured facts / vector memory (top-K retrieval)
- **AI Toolbox** (7 specialized prompts):
  - Write migration (ALTER + reverse ALTER + data migration script)
  - Optimize SQL (with EXPLAIN context)
  - Explain EXPLAIN (plain-language)
  - Generate test data (FK-aware, realistic style)
  - Natural language → SQL
  - Document table columns (data dictionary)
  - Explain table purpose
- **AI Database Health Check**: scans MySQL/PG metadata, reports 6 anti-patterns
- **AI Write Comments**: AI suggests column comments → one-click ALTER / COMMENT ON
- **AI SQL Translation** between MySQL / PostgreSQL / SQL Server / Oracle
- **Cross-table value search** with cell right-click "find where else this value appears"

### Data flow
- CSV / JSON / **Excel import** with column mapping wizard
- Export table / schema to SQL, data transfer between connections
- **Data dictionary** export (Markdown / HTML)
- **Encrypted export**: AES-256-GCM + PBKDF2 (utility module ready)

### Productivity
- ⌘K **command palette**
- ⌘⇧O **global object search** (search tables / views / columns and locate in tree)
- **Customizable keyboard shortcuts** (per-command rebind, conflict detection)
- **Native application menu** (7 categories: File / Edit / View / Tools / Window / Help, plus macOS app menu)
- **Multi-window** (new SPA window for side-by-side connections)
- **Dashboard** (multi-SQL multi-card view)
- **Data masking** (column-name rules → mask phone / email / ID card / bank card)
- **Data contracts** (notNull / range / regex rules → scan results)
- **Webhook notifications** (DingTalk / Feishu / Slack / generic) for slow query / query error / manual

### Connections
- CRUD + test, local SQLite + `safeStorage` encrypted password store
- **SSH tunneling**, SSL/TLS, connection grouping, env tagging (dev/test/prod with color coding)
- Auto-update (electron-updater)
- **Friendly error categorization** with troubleshooting steps for: port unreachable / DNS / timeout / auth failure / SSL failure / driver missing / etc.

## Common shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘/Ctrl + K | Command palette |
| ⌘/Ctrl + ⇧ + O | Global object search |
| ⌘/Ctrl + Enter | Execute (or selection) |
| ⌘/Ctrl + ⇧ + F | Format SQL |
| ⌘/Ctrl + ⇧ + L | Toggle AI chat panel |
| ⌘/Ctrl + ⇧ + N | New window |
| ⌘/Ctrl + , | Settings |

All shortcuts are customizable in **Settings → Key Bindings**.

## Structure

```
packages/
  shared-types/   Shared DTO / enums / metadata / execute options
  core-driver/    Database driver abstraction + execution channel (LocalTransport)
apps/
  desktop/        Electron + Vue 3 + Vite + TS desktop app (local SQLite store)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.

## Development

```bash
pnpm install                                          # Install deps (downloads Electron on first run)
pnpm --filter @db-tool/desktop rebuild:native         # Rebuild native modules (better-sqlite3, etc.) for Electron ABI — one-time
pnpm dev:desktop                                      # Start desktop app (electron-vite dev, HMR)
pnpm typecheck                                        # Workspace-wide type check
pnpm test                                             # Unit tests (Vitest)
pnpm lint                                             # Biome lint (pnpm format auto-fixes)
pnpm build:desktop                                    # Production build
```

CI (`.github/workflows/ci.yml`) runs typecheck + test + lint on push / PR.

## Packaging

```bash
pnpm --filter @db-tool/desktop exec electron-vite build               # Production bundle → apps/desktop/out
pnpm --filter @db-tool/desktop exec electron-builder install-app-deps # Rebuild native modules for Electron ABI
pnpm --filter @db-tool/desktop exec electron-builder                  # Build platform installer → apps/desktop/release
```

Multi-platform installers are produced by CI (`.github/workflows/build-desktop.yml`, triggered on tag `v*` or manually). Matrix:

| Platform | Architectures | Package formats |
| --- | --- | --- |
| macOS | x64 + arm64 | `.dmg` |
| Windows | x64 + arm64 | NSIS `.exe` installer |
| Linux x64 | x64 | `.AppImage` + `.deb` + `.rpm` + `.pacman` + `.tar.gz` |
| Linux arm64 | arm64 | `.AppImage` + `.tar.gz` |

The `.deb` / `.rpm` packages cover Ubuntu / Debian / Deepin / UnionTech UOS / Ubuntu Kylin / Fedora / openEuler / Red Flag / NeoKylin (RHEL-based) and similar distributions.

Packaging notes:

- **Dependency classification**: runtime native / external deps (better-sqlite3, mysql2, pg, mssql) go in `dependencies`; build-time deps (workspace packages, Monaco, Vue) go in `devDependencies`. electron-builder only packs `dependencies`.
- **pnpm monorepo**: electron-builder requires `node-linker=hoisted` (CI sets `NPM_CONFIG_NODE_LINKER=hoisted`).
- **node-gyp**: Python ≥3.12 lacks `distutils`; CI pins Python 3.11.
- **Version sync**: `scripts/sync-version.mjs` syncs `apps/desktop/package.json#version` from the git tag on tagged builds so artifact names match the tag.
- First local packaging downloads the Electron distribution (~100MB).

> Oracle / 达梦 are native modules with lazy loading; including them in a build requires installing the driver on the target platform and running `electron-rebuild`.

## License

[Apache License 2.0](./LICENSE) — desktop app is open source.
