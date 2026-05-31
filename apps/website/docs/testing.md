---
title: 测试与质量保障
description: SkylerX 的两层质量体系 — 自动化单元测试 + 手测清单覆盖每个数据库 / 每个功能 / 发版冒烟。
---

# 测试与质量保障

这页给关心"SkylerX 是不是在认真做质量"的用户、DBA 和潜在贡献者。简单说:

**两层覆盖。一层 CI 跑机器,一层人工跑流程。两层都开源,清单都在 GitHub。**

## TL;DR

| 层 | 工具 | 跑在哪 | 数据 |
|---|---|---|---|
| **单元测试** | Vitest | 每次 push / PR 走 GitHub Actions CI | `packages/**/src/**/*.test.ts`,15+ 个文件,覆盖 SQL 生成、EXPLAIN 解析、schema diff、加密 round-trip、Oracle→DM 类型映射等纯逻辑 |
| **手测清单** | Markdown checkbox + Evidence(截图 / SQL log) | PR 自测 + 发版冒烟,模板自动填到 GitHub PR / issue | [`docs/qa/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa),30+ 份清单,~6000 行,~1000 个 checkbox |

## 第一层 — 单元测试(Vitest + GitHub Actions CI)

代码改动一推到 GitHub,CI 自动跑:

1. `pnpm typecheck`(全 monorepo TypeScript)
2. `pnpm test`(Vitest 全部 spec)
3. `pnpm lint`(Biome)

红的 PR 不让 merge(配合 branch protection)。

**测试覆盖什么**:纯逻辑、可重复的、不依赖真实数据库的部分。比如:
- SQL DDL 生成的多方言正确性
- EXPLAIN JSON / XML 解析
- Schema diff 算法
- Oracle → DM 类型 / 语法翻译
- 网格行内编辑生成 UPDATE 语句
- 设置加密 round-trip(safeStorage)
- 7 语言 i18n key 完整性
- SQL Linter 规则
- Mock 数据类型约束满足

**不覆盖什么**:Vue 组件渲染、真实数据库交互、跨平台快捷键、自动更新流程 —— 这些归第二层。

代码: [`packages/ui/src/*.test.ts`](https://github.com/duhbbx/SkylerX/tree/main/packages/ui/src) + [`packages/core-driver/src/*.test.ts`](https://github.com/duhbbx/SkylerX/tree/main/packages/core-driver/src)
CI 运行结果: [GitHub Actions](https://github.com/duhbbx/SkylerX/actions/workflows/ci.yml)

## 第二层 — 手测清单(覆盖单元测试到不了的地方)

清单全部 markdown,**带 Evidence 要求** —— 勾 ✅ 必须附截图 / SQL log / 录屏,不接受空勾。流程:

- **开 PR** → GitHub 自动填 `Manual test` + `Reviewer verification` 段;作者一边自测一边勾 + 贴证据。评审者要 pull 分支重测 ≥2 项才能 Approve
- **发版前** → 开 [🚦 Release Smoke issue](https://github.com/duhbbx/SkylerX/issues/new/choose),模板自动塞入冒烟清单;每条勾过 + 失败有 issue 链接才 ship

### 清单组织

```
docs/qa/
├── RELEASE_SMOKE.md          ← 发版前 15 分钟全功能冒烟
├── driver-matrix.md          ← 22 方言连通 + CRUD 矩阵(广度)
├── features/                 ← 13 个功能专项清单(深度)
│   ├── connections.md        ← 连接管理 / 强杀安全 / 加密验证
│   ├── sql-editor.md         ← Monaco + AI 内联 + Linter
│   ├── result-grid.md        ← 虚拟滚动 + 行内编辑 + JSON/BLOB 查看
│   ├── transactions.md       ← 手动提交模式 + Session 生命周期
│   ├── query-history.md      ← 历史 + 标签 + Pin
│   ├── schema-tools.md       ← DDL 生成 + Schema diff + Mock 数据 + Oracle→DM
│   ├── explain-and-dba.md    ← EXPLAIN 可视化 + 慢查询 + 健康检查
│   ├── ai-features.md        ← 多 provider + 错误问 AI + 工具箱
│   ├── nosql-channels.md     ← Mongo / Redis / ES 专项
│   ├── import-export.md      ← CSV / Excel / JSON / SQL / Parquet / MD
│   ├── multi-window-i18n.md  ← 多窗口 + 7 语言切换
│   ├── auto-update.md        ← 自动更新 + GitHub/OSS-CN 切换
│   └── safety.md             ← 生产标记 + 危险 SQL + 设置加密
└── databases/                ← 16 个按数据库深度清单(对象/用户/角色/查询)
    ├── mysql-family.md       ← MySQL · MariaDB · OceanBase · TiDB
    ├── doris-starrocks.md    ← Apache Doris · StarRocks
    ├── postgres-family.md    ← PG · KingbaseES · CockroachDB · Greenplum · openGauss · H2
    ├── redshift.md
    ├── sqlserver.md
    ├── oracle.md             ← Oracle · OceanBase Oracle tenant
    ├── dm.md                 ← 达梦
    ├── sqlite.md
    ├── duckdb.md
    ├── clickhouse.md
    ├── snowflake.md
    ├── tdengine.md           ← 信创时序
    ├── mongodb.md
    ├── redis.md
    └── elasticsearch.md
```

### 每份"按数据库"清单覆盖什么

固定结构、跨方言可比对:

- **Connection** — 各种认证方式 / TLS / 错误码具体性
- **Database / schema** — CREATE / DROP / USE / 字符集
- **Tables** — 全类型 CREATE / ALTER / DROP / TRUNCATE / 分区
- **Indexes** — B-tree / GIN / GiST / BRIN / 函数索引 / FT / 向量
- **Views** — 普通视图 / 物化视图 / 安全视图
- **Constraints** — PK / FK / UNIQUE / CHECK / NOT NULL / EXCLUDE / 是否真强制
- **Functions / Stored procs** — 过程语言(PL/SQL / PL/pgSQL / T-SQL / Painless / JS UDF)
- **Triggers** — BEFORE / AFTER × INSERT / UPDATE / DELETE
- **Sequences / Identity** — 各方言语法
- **Users · Roles · Grants** — 完整权限矩阵(每个 DB 都不一样)
- **DML / Query** — INSERT 各种 + JOIN 全种类 + CTE + 窗口 + UNION + 类型专项查询
- **Transactions** — 隔离级别 / DDL 事务行为 / 错误后状态
- **Dialect-specific quirks** — 历史上踩过的坑(回归坑点,代码改动时必看)
- **Cross-platform** — 各 OS 验证(尤其原生模块 driver)
- **Known limitations** — 不要当 bug 报的事

### 浏览入口

- 全部清单: [docs/qa/](https://github.com/duhbbx/SkylerX/tree/main/docs/qa)
- 按数据库找: [docs/qa/databases/](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases)
- 按功能找: [docs/qa/features/](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/features)
- 发版前冒烟主清单: [RELEASE_SMOKE.md](https://github.com/duhbbx/SkylerX/blob/main/docs/qa/RELEASE_SMOKE.md)

## 用 PR / Issue 模板把"测了什么"留痕

仓库里有几个自动加载的模板,让"测试是否做过、做了多少"可追溯:

- [`PULL_REQUEST_TEMPLATE.md`](https://github.com/duhbbx/SkylerX/blob/main/.github/PULL_REQUEST_TEMPLATE.md) — 开 PR 时自动加载,有 `Manual test`(作者填) + `Reviewer verification`(评审者必填) + Evidence 字段。**勾 ✅ 不带证据等于没勾**
- [`50_release_smoke.yml`](https://github.com/duhbbx/SkylerX/blob/main/.github/ISSUE_TEMPLATE/50_release_smoke.yml) — 开 issue 时选 "🚦 Release Smoke",自动塞完整冒烟清单到 body,逐条勾;失败的留 issue 链接;全绿才允许 tag 发版
- [`CODEOWNERS`](https://github.com/duhbbx/SkylerX/blob/main/.github/CODEOWNERS) — 关键路径(driver / IPC / 设置加密 / CI)自动指派给 owner;开启分支保护后,无 owner approve 不允许 merge

## 不掩盖真相

我们也承认目前的局限:

- **没有自动化的 UI 测试**(Playwright 还没接进来,在 [ROADMAP](/roadmap) Q4)
- **手测依赖自觉**;评审制度 + Evidence 要求 + CODEOWNERS 把"瞎勾"成本拉高,但不能 100% 防住 — 长期解决方案是把可自动化的挪到 Playwright
- **真实数据库覆盖看你怎么搭测试环境** — 清单写明每个驱动建议的 docker compose,但跑不跑、跑全不全是测试者决定

## 想参与质量保障?

- 提 issue 报 bug:用 [Bug Report 模板](https://github.com/duhbbx/SkylerX/issues/new/choose),Evidence 字段贴截图 / 录屏 / SQL 重现路径
- 提 PR 修 bug:走标准模板,Manual test 段必填
- 加测试用例:看 [`CONTRIBUTING.md`](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md) 的 Testing 章节,Vitest 模板照抄已有 `*.test.ts` 文件
- 加手测清单:看 [`docs/qa/databases/README.md`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases) 的模板章节,新建一份后在主 README 索引登记

---

> **看版本质量?** 每个 RC 都开一个 [Release Smoke issue](https://github.com/duhbbx/SkylerX/issues?q=label%3A%22type%3A+smoke%22),公开追溯。
> **看 CI 状态?** [GitHub Actions](https://github.com/duhbbx/SkylerX/actions),每次 commit 都跑。
> **看路线图?** [ROADMAP](/roadmap)。
