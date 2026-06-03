---
title: Roadmap
description: SkylerX upcoming databases and feature plans, refreshed each quarter.
---

# Roadmap

> Last updated: 2026-05-31
> Directional plan — not a commitment. Actual cadence depends on feedback and resources.
> Full source: [ROADMAP.md on GitHub](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)

Want to push something forward?

- 👍 vote on the matching [issue](https://github.com/duhbbx/SkylerX/issues)
- File a new request: [New Feature Issue](https://github.com/duhbbx/SkylerX/issues/new/choose)
- Discuss architecture: [Discussions](https://github.com/duhbbx/SkylerX/discussions)

## Legend

- ✅ Shipped
- 🟢 In progress / this quarter
- 🔵 Next quarter
- ⚪ Candidate — priority shifts with feedback
- 🟣 Long-term / needs architecture change

---

## 1. Database support

### 1.1 Already supported (as of 2026-05)

| Category | Drivers |
|---|---|
| **Relational (OSS)** | MySQL · MariaDB · PostgreSQL · SQLite · H2 |
| **Relational (commercial)** | Oracle · SQL Server |
| **Chinese / 信创** | DM (达梦) · KingbaseES (人大金仓) · OceanBase · TiDB · GBase |
| **Analytical (MPP/OLAP)** | ClickHouse · Snowflake · Amazon Redshift · Apache Doris · StarRocks · DuckDB |
| **Time-series** | TDengine |
| **NoSQL** | MongoDB · Redis · Elasticsearch |

### 1.2 Onboarding plan

#### 🟢 2026 Q3 (Jul–Sep)

| Database | Type | Notes |
|---|---|---|
| **PolarDB-PG / -X** | Cloud-native | Reuses existing driver |
| **GaussDB (Huawei)** | 信创 | PG-compatible mode |
| **TimescaleDB** | Time-series (PG ext) | Hypertable / continuous aggregates |
| **Cassandra / ScyllaDB** | Wide-column NoSQL | CQL over SQL channel |
| **InfluxDB 3.x** | Time-series | FlightSQL |

#### 🔵 2026 Q4 (Oct–Dec)

| Database | Type | Notes |
|---|---|---|
| **Trino / Presto** | Federated SQL | HTTP API, catalog tree maps subsources |
| **Apache Hive (HS2)** | Big-data SQL | JDBC over Kerberos / LDAP |
| **Neo4j** | Graph | Bolt + Cypher, new channel |
| **Couchbase** | Multi-model NoSQL | N1QL |
| **AWS DynamoDB** | KV / document | PartiQL, NoSQL channel |
| **pgvector / Milvus / Qdrant** | Vector | Dedicated vector-field viewer |

#### ⚪ 2027 H1 candidates

Apache IoTDB · Nebula Graph · SequoiaDB · GreatSQL · Hologres (Aliyun PG) · Lindorm (Aliyun HBase) · TDSQL-C (Tencent) · QuestDB · Apache Druid · Apache Pinot · Flink SQL Gateway · Materialize · RisingWave · Vertica · BigQuery · Athena

#### 🟣 Long-term (depends on demand)

Apache HBase · Impala · DynamoDB Streams · Cassandra CDC · LMDB / RocksDB viewers · Weaviate / Chroma · ArangoDB (multi-model)

---

## 2. Feature roadmap

### 2.1 Editor & query UX

| Status | Feature |
|---|---|
| ✅ | SQL Linter + AI inline completion |
| ✅ | Query history with tags + pinning |
| 🟢 | **Notebook mode** — mixed SQL / Markdown / charts cells |
| 🟢 | **Visual Query Builder** — drag-to-join, auto-JOIN, GUI aggregation |
| 🔵 | **Speech-to-SQL** — Whisper offline → AI translation |
| 🔵 | **Cross-dialect SP translator** — Oracle PL/SQL ↔ PG PL/pgSQL ↔ DM |
| ⚪ | Custom linter rule editor |
| ⚪ | Snippet library + cross-device sync |

### 2.2 Result grid UX

| Status | Feature |
|---|---|
| ✅ | Inline edit + DML commit, "Ask AI" on errors, cell viewer |
| 🟢 | **Form view** — vertical single-row editor for wide tables |
| 🟢 | **Excel-style multi-value filter** |
| 🔵 | **Master/Detail linkage** — pick a row, auto-load related tables |
| 🔵 | **FK lookup dropdown** when editing FK columns |
| ⚪ | Live JOIN column expansion · Pivot · JSON column tree viewer |

### 2.3 Schema & modeling

| Status | Feature |
|---|---|
| ✅ | DDL generation · Schema diff · Mock data v1 |
| ✅ | Oracle → DM migration wizard |
| ✅ | **Migration assessment** — source profiling (17 object categories + risk metrics) + A/B/C/D grading + AI PL/SQL conversion + Word/PDF/Excel export; hub-and-spoke IR design |
| 🟢 | **ER diagram auto-layout** — reverse engineering with SVG/PNG export |
| 🔵 | **Forward engineering** — edit ER diagram → emit migration |
| 🔵 | **Cross-DB migration v2** — extend MySQL ↔ PG ↔ DM combos |
| ⚪ | dbt integration · Column-level lineage |

### 2.4 DBA / operations

| Status | Feature |
|---|---|
| ✅ | EXPLAIN visualizer · slow-query sparklines · Health check v1 |
| ✅ | **Long-running query killer** — cross-dialect process/session list (MySQL `information_schema.PROCESSLIST` / PG `pg_stat_activity` / MSSQL `sys.dm_exec_requests` / Oracle `v$session`); per-row KILL with typed `KILL` confirmation on prod connections |
| 🟢 | **Dead index detection** + size stats |
| 🟢 | **Slow query → auto rewrite + index suggestion** |
| 🔵 | Replication lag dashboard |
| ⚪ | Storage growth forecasting · Connection pool tuning · Signed audit log · Backup scheduler |

### 2.5 AI

| Status | Feature |
|---|---|
| ✅ | AI chat · Ask-AI on errors · Mock data v1 · Health check v1 |
| 🟢 | **Mock data v2** — FK-aware across tables + semantic fields (names, addresses, phones) |
| 🟢 | **Health check v2** — anti-pattern library expanded to 50+ checks |
| 🔵 | **Streaming completion (Cursor-style)** — type-as-you-go suggestions |
| 🔵 | **RAG over schema + docs** — project READMEs + schema into AI context |
| ⚪ | AI-suggested masking rules · SQL → ER diagram |

### 2.6 Collaboration / multi-device

| Status | Feature |
|---|---|
| ✅ | Multi-window · 7-language i18n |
| 🔵 | **E2E-encrypted connection sync** — cross-device, encrypted at rest |
| 🔵 | **Team query library** — read-only / comment / fork |
| ⚪ | Web edition · Mobile read-only viewer |
| 🟣 | Real-time pair querying (Yjs protocol) |

### 2.7 Integrations & export

| Status | Feature |
|---|---|
| ✅ | Export to CSV / Excel / JSON / SQL / Parquet / Markdown |
| ✅ | **Chart viewer (ECharts)** — one click from result grid: line / bar / pie / scatter; auto-detect numeric columns for Y, non-numeric for X; supports zoom + multi-series; main-thread render up to 5000 rows |
| 🔵 | **Chart presets / dashboards** — save "this query → this chart" for reuse |
| 🔵 | **BI export** — Metabase / Superset / PowerBI / Tableau data sources |
| ⚪ | REST / GraphQL mock endpoints |

### 2.8 Plugins / extensibility

| Status | Feature |
|---|---|
| 🔵 | **Third-party driver plugin API** |
| ⚪ | Export-format plugins / theme plugins |

### 2.9 Navigation tree / workspace nav

NavTree is the entry point for 95% of daily work — a wave of polish that just landed:

| Status | Feature |
|---|---|
| ✅ | **Multi-select + batch ops** — Ctrl/⌘+click / Shift+range; DROP / TRUNCATE / move-to-group / copy SELECT template / export DDL / parallel test connections; batch SQL uses native multi-target where supported (PG `DROP TABLE a, b, c`) or fail-fast sequential elsewhere (Oracle/DM/SQLite). Refs #25 |
| ✅ | **Drag to resize width** — 200-600px, double-click resets, persisted to settings. Refs #17 |
| ✅ | **Per-connection visible-DB/Schema filter** — DataGrip-style N/M chip next to connection name; v2 supports per-database schema filter (PG with 50 schemas in one DB scenario). Refs #24 |
| ✅ | **Local tree search (Ctrl/⌘+F)** — live filter on loaded nodes, force-expand branches with matches |
| ✅ | **Full-catalog object index + cross-tree search** — per-connection flat catalog cache (~5MB / 100k objects / 10ms scan); silent background build on first search; matches surface above the tree; covers tables / views / functions / procedures / sequences / triggers / indexes; kind-pill filtering |
| ✅ | **Redis key click-to-link** — single-click a Redis key in nav focuses the matching RedisPane tab and selects the key; doesn't spawn a new tab. Refs #19 |
| 🟢 | **Cmd+Shift+P global object finder** — cross-connection fuzzy modal, complements in-tree search |
| 🔵 | **Persist index to IndexedDB** — cold-start results in milliseconds (with staleness marker) |
| 🔵 | **revealObject for all kinds** — currently reveals tables/views in the tree; expand to functions / procedures / sequences |
| ⚪ | **Batch ops across selected connections** — e.g. nightly report on all `prod`-tagged connections |

---

## 3. Platform / engineering

| Status | Item |
|---|---|
| ✅ | Multi-arch build matrix (macOS arm/x64 · Windows · Linux) |
| ✅ | Aliyun OSS mirror + auto-update channel switcher |
| 🟢 | **Code signing** — Apple Developer + Windows (via SignPath OSS) |
| 🟢 | **Crash reporting** — self-hosted Sentry with source maps |
| 🔵 | Playwright E2E + CI matrix |
| 🔵 | Codecov integration |
| ⚪ | AppImage / Snap / Flatpak / MS Store / MAS / Homebrew tap |

---

## 4. Docs / community

| Status | Item |
|---|---|
| ✅ | 7-language site + SEO + self-hosted Umami |
| ✅ | DBA / Schema / NoSQL / Security / AI / Productivity docs |
| 🟢 | **Video tutorials** (Bilibili + YouTube, < 3 min per core feature) |
| 🔵 | Case studies / Public changelog site |

---

## Milestones

| Date | Highlight |
|---|---|
| 2026-05 | AI settings → encrypted SQLite · 7-language SEO · Self-hosted Umami |
| 2026-04 | ClickHouse / Snowflake / Doris / StarRocks / Redshift / H2 driver wave |
| 2026-03 | NoSQL channel (MongoDB / Redis / Elasticsearch) · SQL Linter · AI inline |
| 2026-02 | EXPLAIN visualizer · slow-query sparklines · Oracle → DM wizard |
| 2026-01 | First public release (MySQL / PG / Oracle / SQL Server / DM / KingbaseES) |

---

## Want to contribute?

- See [CONTRIBUTING.md](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md) for setup, testing, and PR rules
- New drivers: copy any `packages/core-driver/src/drivers/*` as a template
- The roadmap itself lives at [ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md) — PRs welcome
