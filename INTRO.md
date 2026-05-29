# SkylerX —— 开源跨平台数据库管理工具（Navicat / DataGrip 替代）

> **GitHub**：https://github.com/duhbbx/SkylerX
> **License**：Apache 2.0
> **下载**：https://github.com/duhbbx/SkylerX/releases （macOS / Windows / Linux 全平台 + arm64）

---

## 一句话

一个**开源、免费、跨平台**的桌面数据库管理工具，能连 14 个 SQL 方言（含 **国产数据库：达梦 / 人大金仓 / openGauss / OceanBase / TiDB**）+ 3 个 NoSQL（MongoDB / Redis / Elasticsearch），自带 **AI 助手 / EXPLAIN 可视化 / 结构 & 数据对比 / 索引推荐 / 服务器活动监控**，技术栈 Electron + Vue 3 + TypeScript。

## 为什么写它

- **Navicat 收费且不开源**，国内还有续费/激活的麻烦
- **DataGrip 订阅贵**，对个人开发者不友好
- **DBeaver 卡且 UI 老**，AI 能力薄
- 国产数据库（达梦 / KingbaseES / openGauss）在主流工具里支持都不算友好
- 想要一个**真正能用 AI 帮你写 SQL / 解读 EXPLAIN / 体检数据库**的工具

所以 SkylerX 重新写了一个。

---

## 支持的数据库（17 个）

**SQL（14）**：MySQL · MariaDB · OceanBase · TiDB · PostgreSQL · 人大金仓 KingbaseES · CockroachDB · Greenplum · openGauss · H2 · SQL Server · Oracle · 达梦 DM · SQLite · DuckDB · ClickHouse · Snowflake

**NoSQL（3）**：MongoDB · Redis · Elasticsearch

> 国产数据库**达梦 DM** / **人大金仓 KingbaseES** / **openGauss** / **OceanBase** 全部原生支持，信创 / 国产化项目可直接用。

---

## 主要功能

### 🔥 查询工作区
- Monaco 编辑器 + SQL 高亮 + 表/列/函数/片段自动补全
- 多查询页签、SQL 历史（搜索 + 收藏）、库 / schema 一键切换
- **EXPLAIN 可视化执行计划**：预估行 vs 实际行、慢算子着色、可选 `EXPLAIN ANALYZE`
- **prod 安全闸**：标记为生产的连接执行 DROP / TRUNCATE / DELETE 强制二次确认
- **手动 / 自动提交模式**：每个 tab 独立切换，commit/rollback 后自动开新事务
- 参数化查询（`:name`）、SQL 格式化、SQL 片段库（按标签）

### 📊 结果集
- 分页 + **大结果集虚拟滚动**
- 可编辑网格：多选 / 改单元格 / 增删行 → 事务提交
- **NULL / 空串 / 长文本 / JSON / BLOB 视觉区分**
- **BLOB 自动识图**（PNG / JPEG / GIF / WEBP 头识别，渲染图像或十六进制）
- **结果图表化**：柱 / 线 / 饼，可导出 PNG
- **替代视图**：透视表、自引用 FK 树、地理散点、时间轴
- 多格式复制（CSV / TSV / JSON / Markdown / SQL VALUES）
- **外键跳转**：跳到被引用行、查反向引用

### 🛠 结构 & DBA
- 可视化表设计器，保存时按 diff 生成 ALTER
- 视图 / 函数 / 存储过程 / 触发器 DDL 编辑
- ER 图查看
- **结构快照** + **双连接结构漂移检测** + 自动生成对齐 SQL
- **服务器活动面板**：进程列表 + 长事务 + 锁等待，支持 `KILL`
- **主从延迟监控**：MySQL / PG / MSSQL
- **数据巡检**（列采样 / 完整画像 / 约束扫描 / 类型优化建议）
- **数据修复**（重复行 / NULL 回填 / 软删除恢复）
- **结构对比 / 数据对比** + 同步 SQL 生成
- **备份 / 还原**向导（纯 SQL 路径，无需 `mysqldump`）

### 🤖 AI 助手（多提供商）
支持 **Anthropic Claude / OpenAI / DeepSeek / Codex / Grok**，免费用户可用 DeepSeek。

- **右侧 Cursor 风格聊天面板**，Markdown + SQL 高亮
- **三层记忆**：自由文本档案 / 结构化事实 / 向量记忆（Top-K 召回）
- **AI 工具箱 7 大 Prompt**：
  - 写迁移（含反向 ALTER + 数据迁移脚本）
  - 优化 SQL（带 EXPLAIN 上下文）
  - 解读 EXPLAIN（白话讲清）
  - 生成测试数据（识别 FK，风格真实）
  - 自然语言 → SQL
  - 写列注释（数据字典）
  - 说明表用途
- **AI 数据库体检**：扫元数据，报 6 类反模式
- **AI SQL 方言互译**：MySQL ↔ PostgreSQL ↔ SQL Server ↔ Oracle
- **AI 写注释**：建议列注释 → 一键 ALTER / COMMENT ON
- **索引推荐**：基于 SQL 历史 + 现有索引

### 📥 数据流通
- CSV / JSON / **Excel 导入**（列映射向导）
- 表 / 库导出为 SQL
- 连接间**数据传输**
- **数据字典**导出（Markdown / HTML）

### ⚡ 效率
- **⌘K 命令面板**
- **⌘⇧O 全局对象搜索**（搜表 / 视图 / 列并在树中定位）
- **快捷键完全可自定义**，所有命令均可重绑
- **原生应用菜单**（7 大类）
- **多窗口**支持
- **仪表盘**（多 SQL 多卡片）
- **数据脱敏**（按列名规则）
- **数据契约**（notNull / range / regex 规则）
- **Webhook 通知**（钉钉 / 飞书 / Slack / 通用）—— 慢查询、报错触发

### 🔌 连接
- 本地 SQLite + `safeStorage` 加密存口令
- **SSH 隧道** / **SSL/TLS**
- 连接分组、环境标签（dev/test/prod 带颜色，prod 红点）
- 自动更新（electron-updater）

---

## 快捷键

| 快捷键 | 作用 |
| --- | --- |
| ⌘/Ctrl + K | 命令面板 |
| ⌘/Ctrl + ⇧ + O | 全局对象搜索 |
| ⌘/Ctrl + Enter | 执行（有选区只跑选中） |
| ⌘/Ctrl + ⇧ + F | 格式化 SQL |
| ⌘/Ctrl + ⇧ + L | AI 聊天面板 |
| ⌘/Ctrl + ⇧ + N | 新窗口 |
| ⌘/Ctrl + , | 设置 |

全部可在「设置 → 快捷键」自定义。

---

## 跨平台 & 跨架构

| 平台 | 架构 | 包格式 |
| --- | --- | --- |
| macOS | Intel + Apple Silicon | `.dmg` |
| Windows | x64 + arm64 | `.exe` (NSIS) |
| Linux x64 | x64 | `.AppImage` + `.deb` + `.rpm` + `.pacman` + `.tar.gz` |
| Linux arm64 | arm64 | `.AppImage` + `.tar.gz` |

`.deb` / `.rpm` 直接覆盖 Ubuntu / Debian / Deepin / **统信 UOS** / **银河麒麟** / Fedora / openEuler / **中科红旗** / **中标麒麟** 等。

---

## 技术栈

- **前端**：Vue 3 + Vite + TypeScript + Monaco Editor
- **桌面**：Electron 31 + electron-vite + electron-builder
- **构建**：Biome（lint + format）+ Vitest（单测）
- **CI**：GitHub Actions（typecheck / lint / test on PR，tag 触发多平台打包）

源码 monorepo（pnpm workspace）：
```
packages/
  shared-types/   DTO / 枚举 / 元数据
  core-driver/    驱动抽象 + 执行通道
apps/
  desktop/        Electron + Vue3 桌面端
```

架构详见仓库 [ARCHITECTURE.md](https://github.com/duhbbx/SkylerX/blob/main/ARCHITECTURE.md)。

---

## ⚠️ 状态声明

项目仍在快速迭代，**尚未经过生产环境的完整测试**。建议先在 dev / staging 评估使用；生产连接请打 `prod` 标记，破坏性 SQL 先 EXPLAIN / dry-run 验证。**写入 / 改表 / 数据同步前请务必备份**。

欢迎 issue / PR / star ⭐：https://github.com/duhbbx/SkylerX

---

## 关于开发者

**武汉斯凯勒网络科技有限公司**

承接外包开发与项目合作，方向：

- 全栈 Web 开发（Vue / React / Node / Go / Java）
- 桌面端应用（Electron / Tauri）
- **数据库咨询**：选型 / 表设计 / 调优 / 迁移（含国产化方向）
- **Navicat / DataGrip 企业替代方案** 落地与定制
- **私有化 / 信创 / 离网部署**
- 数据平台（ETL / 看板 / ClickHouse / Snowflake / DuckDB）
- AI 集成（LLM 网关 / RAG / Agent / 本地推理）
- DevOps & SRE

**联系方式：**
- 📧 邮箱：duhbbx@gmail.com
- 💬 微信：tuhoooo
- 🐛 Issue：https://github.com/duhbbx/SkylerX/issues

---

## 转发短文案（适合一句话推荐）

> 自己写了个开源跨平台数据库管理工具 **SkylerX**：连 14 个 SQL 方言（含达梦 / 人大金仓 / openGauss 等国产库）+ MongoDB / Redis / ES，带 AI 助手 / EXPLAIN 可视化 / 结构 & 数据对比 / 索引推荐 / 主从延迟监控，Apache 2.0 开源，macOS / Windows / Linux 全平台 arm64 都有包 → https://github.com/duhbbx/SkylerX

---

<details>
<summary><b>English version (for international forums)</b></summary>

# SkylerX — Open-source cross-platform database GUI

**GitHub**: https://github.com/duhbbx/SkylerX · **License**: Apache 2.0

A free & open-source desktop DB tool (Navicat / DataGrip alternative) built with Electron + Vue 3 + TypeScript. Supports **17 databases**: MySQL · MariaDB · PostgreSQL · SQL Server · Oracle · SQLite · DuckDB · ClickHouse · Snowflake · TiDB · OceanBase · CockroachDB · Greenplum · openGauss · KingbaseES · DM · H2 · MongoDB · Redis · Elasticsearch.

**Highlights:**
- 🤖 AI assistant (Claude / OpenAI / DeepSeek / Grok) — NL→SQL, EXPLAIN reading, migration writing, column commenting
- 📈 EXPLAIN visualizer with row-estimate vs actual coloring
- 🔁 Schema & data diff + sync SQL generation
- 🚦 prod-tag safeguard (DROP/DELETE/TRUNCATE confirmation)
- 🧪 Data Inspector (profile / constraint / type optimization)
- 🔍 Index recommender from SQL history
- 📡 Server activity panel + replication lag monitor
- 🧰 Backup / restore wizard (no mysqldump)
- 🔐 SSH tunnel + TLS + safeStorage-encrypted secrets
- 🖥 Full multi-arch builds (macOS x64+arm64, Windows x64+arm64, Linux x64+arm64)

> Status: actively developed, NOT yet production-tested — use with backups; details in repo README.

Star / try it: https://github.com/duhbbx/SkylerX

</details>
