---
title: Testing & Quality
description: SkylerX's two-layer quality model — automated unit tests + manual checklists covering every database, every feature, and pre-release smoke.
---

# Testing & Quality

For users, DBAs, and would-be contributors who want to know "is SkylerX taking quality seriously". Short answer:

**Two layers. One runs on every commit; one runs human-driven before release. Both are open source, both visible on GitHub.**

## TL;DR

| Layer | Tooling | Where it runs | Where to find it |
|---|---|---|---|
| **Unit tests** | Vitest | Every push / PR via GitHub Actions CI | `packages/**/src/**/*.test.ts` — 15+ files covering SQL generation, EXPLAIN parsing, schema diff, encryption round-trip, Oracle→DM type mapping, etc. |
| **Manual checklists** | Markdown checkboxes + Evidence (screenshot / SQL log) | PR self-test + release smoke, templates auto-fill into GitHub PRs / issues | [`docs/qa/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa) — 30+ checklists, ~6000 lines, ~1000 checkboxes |

## Layer 1 — Unit tests (Vitest + GitHub Actions)

Any commit triggers CI:

1. `pnpm typecheck` (TypeScript across the monorepo)
2. `pnpm test` (full Vitest suite)
3. `pnpm lint` (Biome)

Red PRs cannot merge to `main` (paired with branch protection).

**What's covered**: pure logic that doesn't need a real database. Examples:
- Cross-dialect DDL generation
- EXPLAIN JSON / XML parsing
- Schema diff algorithms
- Oracle → DM type / syntax translation
- Grid inline edit → UPDATE generation
- Settings encryption round-trip (safeStorage)
- 7-locale i18n key coverage
- SQL Linter rule firing
- Mock data type-constraint satisfaction

**What's NOT covered**: Vue component rendering, real DB interactions, cross-OS keyboard shortcuts, auto-update flow — those go to Layer 2.

Code: [`packages/ui/src/*.test.ts`](https://github.com/duhbbx/SkylerX/tree/main/packages/ui/src) + [`packages/core-driver/src/*.test.ts`](https://github.com/duhbbx/SkylerX/tree/main/packages/core-driver/src)
CI results: [GitHub Actions](https://github.com/duhbbx/SkylerX/actions/workflows/ci.yml)

## Layer 2 — Manual checklists (where unit tests can't reach)

All checklists are Markdown, **Evidence is required** — a tick must be backed by a screenshot / SQL log / recording. Bare ✅ doesn't count. Workflow:

- **Open a PR** → GitHub auto-populates `Manual test` + `Reviewer verification` sections; author ticks while self-testing, attaches evidence. The reviewer must pull the branch and re-run ≥2 random items before approving
- **Before a release** → file a [🚦 Release Smoke issue](https://github.com/duhbbx/SkylerX/issues/new/choose); the template pre-fills the smoke checklist. Tick everything green or link failures to bug issues before shipping

### Checklist organization

```
docs/qa/
├── RELEASE_SMOKE.md          ← ~15-min pre-release smoke across all features
├── driver-matrix.md          ← 22 dialects × connectivity + CRUD matrix (breadth)
├── features/                 ← 13 per-feature deep checklists
│   ├── connections.md        ← new / edit / test / prod-flag / force-kill safety / encryption
│   ├── sql-editor.md         ← Monaco / linter / AI inline completion
│   ├── result-grid.md        ← virtual scroll / inline edit / JSON & BLOB viewers
│   ├── transactions.md       ← manual-commit mode / session lifecycle
│   ├── query-history.md      ← capture / tag / pin / search
│   ├── schema-tools.md       ← DDL gen / schema diff / mock data / Oracle→DM wizard
│   ├── explain-and-dba.md    ← EXPLAIN visualizer / slow-query / health check
│   ├── ai-features.md        ← multi-provider / error-Ask-AI / toolboxes
│   ├── nosql-channels.md     ← MongoDB / Redis / Elasticsearch specifics
│   ├── import-export.md      ← CSV / Excel / JSON / SQL / Parquet / MD
│   ├── multi-window-i18n.md  ← multi-window / 7-locale switching
│   ├── auto-update.md        ← update check / GitHub vs OSS-CN channel
│   └── safety.md             ← prod-flag / dangerous-SQL / settings encryption / audit
└── databases/                ← 16 per-dialect deep checklists
    ├── mysql-family.md       ← MySQL · MariaDB · OceanBase (MySQL) · TiDB
    ├── doris-starrocks.md
    ├── postgres-family.md    ← PG · KingbaseES · CockroachDB · Greenplum · openGauss · H2
    ├── redshift.md
    ├── sqlserver.md
    ├── oracle.md             ← Oracle · OceanBase Oracle tenant
    ├── dm.md                 ← 达梦
    ├── sqlite.md
    ├── duckdb.md
    ├── clickhouse.md
    ├── snowflake.md
    ├── tdengine.md
    ├── mongodb.md
    ├── redis.md
    └── elasticsearch.md
```

### What each "per-dialect" file covers

Same structure across all 16 files for easy cross-dialect comparison:

- **Connection** — auth modes / TLS / error specificity
- **Database / schema** — CREATE / DROP / USE / charsets
- **Tables** — every column type, ALTER / DROP / TRUNCATE / partitioning
- **Indexes** — B-tree / GIN / GiST / BRIN / functional / FT / vector
- **Views** — regular / materialized / secure
- **Constraints** — PK / FK / UNIQUE / CHECK / NOT NULL / EXCLUDE — and whether they're actually enforced
- **Functions / Stored procedures** — procedural language (PL/SQL, PL/pgSQL, T-SQL, Painless, JS UDF)
- **Triggers** — BEFORE / AFTER × INSERT / UPDATE / DELETE
- **Sequences / Identity** — per-dialect syntax
- **Users · Roles · Grants** — full privilege matrix (every DB is different)
- **DML / Query** — INSERT variants + every JOIN type + CTE + window functions + UNION + type-specific queries
- **Transactions** — isolation / DDL TX semantics / post-error state
- **Dialect-specific quirks** — historical traps (regression bait you must recheck on code change)
- **Cross-platform** — per-OS verification (especially native-module drivers)
- **Known limitations** — non-bugs, don't file as issues

### Browse

- All checklists: [docs/qa/](https://github.com/duhbbx/SkylerX/tree/main/docs/qa)
- By database: [docs/qa/databases/](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases)
- By feature: [docs/qa/features/](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/features)
- Pre-release smoke: [RELEASE_SMOKE.md](https://github.com/duhbbx/SkylerX/blob/main/docs/qa/RELEASE_SMOKE.md)

## Templates that make testing leave a trail

Several auto-loaded templates make "was it tested, how thoroughly" auditable:

- [`PULL_REQUEST_TEMPLATE.md`](https://github.com/duhbbx/SkylerX/blob/main/.github/PULL_REQUEST_TEMPLATE.md) — auto-loaded on PR; has `Manual test` (author fills) + `Reviewer verification` (reviewer fills) + Evidence field. **A ✅ without evidence doesn't count**
- [`50_release_smoke.yml`](https://github.com/duhbbx/SkylerX/blob/main/.github/ISSUE_TEMPLATE/50_release_smoke.yml) — pick "🚦 Release Smoke" when filing an issue; full smoke list auto-populates the body. Tick row-by-row, link failures to bug issues; ship only when all green
- [`CODEOWNERS`](https://github.com/duhbbx/SkylerX/blob/main/.github/CODEOWNERS) — critical paths (drivers / IPC / settings encryption / CI) auto-assign to owner; with branch protection enabled, no owner approval = no merge

## What we don't pretend

Current limitations we're honest about:

- **No automated UI tests yet** (Playwright in [ROADMAP](/en/roadmap) Q4)
- **Manual testing depends on discipline**; reviewer countersign + Evidence requirement + CODEOWNERS raise the cost of fake ticking, but no process is 100% cheat-proof — the long-term answer is pushing more to Playwright
- **Real-database coverage depends on the tester's setup** — checklists suggest docker-compose stacks, but actually running them (and how thoroughly) is the tester's call

## Want to help with quality?

- File a bug: use the [Bug Report template](https://github.com/duhbbx/SkylerX/issues/new/choose); Evidence field expects screenshot / recording / reproducer
- Send a PR fixing a bug: follow the standard template; Manual test section is mandatory
- Add unit tests: see [`CONTRIBUTING.md`](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md)'s Testing section; copy any existing `*.test.ts` as a starting point
- Add manual checklists: see [`docs/qa/databases/README.md`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases) for the template; register it in the main index after creating

---

> **Looking at a specific release's quality?** Every RC opens a [Release Smoke issue](https://github.com/duhbbx/SkylerX/issues?q=label%3A%22type%3A+smoke%22), publicly auditable.
> **CI status?** [GitHub Actions](https://github.com/duhbbx/SkylerX/actions), runs on every commit.
> **What's coming?** [ROADMAP](/en/roadmap).
