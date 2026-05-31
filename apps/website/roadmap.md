---
title: 路线图
description: SkylerX 数据库扩列 + 功能规划,按季度迭代更新。
---

# 路线图

> 最后更新:2026-05-31
> 仅代表方向性规划,不构成承诺,实际节奏依社区反馈和资源调整。
> GitHub 完整版:[ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)

想让某项尽快推进?

- 在 [Issues](https://github.com/duhbbx/SkylerX/issues) 给对应需求点 👍
- 提新需求:[New Issue / Feature](https://github.com/duhbbx/SkylerX/issues/new/choose)
- 讨论方案:[Discussions](https://github.com/duhbbx/SkylerX/discussions)

## 图例

- ✅ 已发布
- 🟢 进行中 / 本季度目标
- 🔵 下个季度
- ⚪ 候选,按反馈调整优先级
- 🟣 远期 / 需架构变更

---

## 1. 数据库支持

### 1.1 已支持(截至 2026-05)

| 类型 | 已支持 |
|---|---|
| **关系型(开源)** | MySQL · MariaDB · PostgreSQL · SQLite · H2 |
| **关系型(商业)** | Oracle · SQL Server |
| **国产 / 信创** | 达梦 DM · 人大金仓 KingbaseES · OceanBase · TiDB · GBase |
| **分析型(MPP/OLAP)** | ClickHouse · Snowflake · Amazon Redshift · Apache Doris · StarRocks · DuckDB |
| **时序** | TDengine |
| **NoSQL** | MongoDB · Redis · Elasticsearch |

### 1.2 接入路线

#### 🟢 2026 Q3(7-9 月)

| 数据库 | 类型 | 备注 |
|---|---|---|
| **PolarDB-PG / -X** | 云原生 | 沿用现有 driver |
| **GaussDB(华为)** | 信创 | PG 兼容模式 |
| **TimescaleDB** | 时序(PG 扩展) | hypertable / 连续聚合 |
| **Cassandra / ScyllaDB** | NoSQL 列族 | CQL 走 SQL channel |
| **InfluxDB 3.x** | 时序 | FlightSQL |

#### 🔵 2026 Q4(10-12 月)

| 数据库 | 类型 | 备注 |
|---|---|---|
| **Trino / Presto** | 联邦查询 | HTTP API,catalog 树映射 |
| **Apache Hive(HS2)** | 大数据 SQL | JDBC over Kerberos / LDAP |
| **Neo4j** | 图 | Bolt + Cypher,新 channel |
| **Couchbase** | 多模 NoSQL | N1QL |
| **AWS DynamoDB** | KV / 文档 | PartiQL,NoSQL channel |
| **pgvector / Milvus / Qdrant** | 向量 | 向量字段专属 viewer |

#### ⚪ 2027 H1 候选

Apache IoTDB(信创时序)· Nebula Graph(国产图)· SequoiaDB(巨杉)· GreatSQL(万里)· Hologres(阿里 PG)· Lindorm(阿里 HBase)· TDSQL-C(腾讯)· QuestDB · Druid · Pinot · Flink SQL Gateway · Materialize · RisingWave(国产)· Vertica · BigQuery · Athena

#### 🟣 远期 / 视生态而定

Apache HBase · Impala · DynamoDB Streams · Cassandra CDC · LMDB / RocksDB viewer · Weaviate / Chroma 向量库 · ArangoDB(多模)

---

## 2. 功能路线图

### 2.1 编辑器 & 查询 UX

| 状态 | 功能 |
|---|---|
| ✅ | SQL Linter + AI 内联补全 |
| ✅ | 查询历史 + 标签 + 置顶 |
| 🟢 | **Notebook 模式** — 多 cell 混排 SQL / Markdown / 图表 |
| 🟢 | **Visual Query Builder** — 拖拽建关联、自动 JOIN |
| 🔵 | **Speech-to-SQL** — Whisper 离线 → AI 翻 SQL |
| 🔵 | **跨方言 SP 翻译** — Oracle PL/SQL ↔ PG PL/pgSQL ↔ DM |
| ⚪ | Linter 自定义规则编辑器 |
| ⚪ | Snippet 库 + 跨设备同步 |

### 2.2 结果网格 UX

| 状态 | 功能 |
|---|---|
| ✅ | 行内编辑 + DML 提交、错误问 AI、单元格 viewer |
| 🟢 | **Form 视图** — 宽表竖排单行编辑 |
| 🟢 | **Excel 式多值筛选** |
| 🔵 | **Master/Detail 联动** — 选一行自动拉相关表 |
| 🔵 | **FK 下拉编辑** — 编辑 FK 列时弹下拉 |
| ⚪ | 实时 JOIN 列扩展 / Pivot 透视 / JSON 列树展开 |

### 2.3 Schema & 建模

| 状态 | 功能 |
|---|---|
| ✅ | DDL 生成 · Schema diff · Mock 数据 v1 |
| ✅ | Oracle → DM 迁移向导 |
| 🟢 | **ER 图自动布局** — 反向工程出图 + SVG/PNG 导出 |
| 🔵 | **正向工程** — 改 ER 图 → 生成 migration |
| 🔵 | **跨库迁移 v2** — 扩 MySQL ↔ PG ↔ DM 等组合 |
| ⚪ | dbt 集成 / 数据 lineage 图 |

### 2.4 DBA / 运维

| 状态 | 功能 |
|---|---|
| ✅ | EXPLAIN 可视化 · 慢查询 sparkline · 健康检查 v1 |
| 🟢 | **死索引检测 + 体积统计** |
| 🟢 | **慢查询 → 自动重写 + 索引建议** |
| 🔵 | 复制延迟仪表板 / 长跑 query 杀手 |
| ⚪ | 存储增长预测 · 连接池调优器 · 审计日志(签名加密)· 备份调度 |

### 2.5 AI 能力

| 状态 | 功能 |
|---|---|
| ✅ | AI Chat · 错误问 AI · Mock 数据 v1 · 健康检查 v1 |
| 🟢 | **Mock 数据 v2** — 跨多表 FK 感知 + 业务字段语义 |
| 🟢 | **健康检查 v2** — 反模式库扩到 50+ 项 |
| 🔵 | **流式补全(类 Cursor)** — 边输入边补 |
| 🔵 | **RAG over schema + docs** — 项目内文档进 AI 上下文 |
| ⚪ | AI 脱敏推荐 / SQL → ER 图 |

### 2.6 协作 / 多端

| 状态 | 功能 |
|---|---|
| ✅ | 多窗口 · 7 语言 i18n |
| 🔵 | **连接 E2E 加密云同步** — 跨设备 / 端到端加密 |
| 🔵 | **团队共享 query 库** — 只读 / 评论 / 分叉 |
| ⚪ | Web 版 · Mobile 只读 viewer |
| 🟣 | 实时协同查询(Yjs) |

### 2.7 集成 & 导出

| 状态 | 功能 |
|---|---|
| ✅ | CSV / Excel / JSON / SQL / Parquet / Markdown 导出 |
| 🔵 | **图表 viewer** — 结果集 → ECharts |
| 🔵 | **导出到 BI** — Metabase / Superset / PowerBI / Tableau |
| ⚪ | REST / GraphQL 模拟接口 |

### 2.8 插件 / 扩展性

| 状态 | 功能 |
|---|---|
| 🔵 | **第三方 driver 插件 API** |
| ⚪ | 导出格式插件 / 主题插件 |

---

## 3. 平台 / 工程

| 状态 | 事项 |
|---|---|
| ✅ | 多架构构建矩阵(macOS arm/x64 · Windows · Linux) |
| ✅ | 阿里云 OSS 镜像 + 自动更新 channel 切换 |
| 🟢 | **自动签名** — Apple Developer + Windows 代码签名(SignPath OSS) |
| 🟢 | **崩溃上报** — 自托管 Sentry + source-map |
| 🔵 | E2E 测试(Playwright)+ CI 矩阵 |
| 🔵 | codecov 接入 |
| ⚪ | AppImage / Snap / Flatpak / MS Store / MAS / Homebrew |

---

## 4. 文档 / 社区

| 状态 | 事项 |
|---|---|
| ✅ | 7 语言官网 + SEO + Umami 自托管 |
| ✅ | DBA / Schema / NoSQL / Security / AI / Productivity 全套文档 |
| 🟢 | **视频教程**(B 站 + YouTube,每个核心功能 < 3 分钟) |
| 🔵 | 接入案例集 / 公开 Changelog 站点 |

---

## 历史里程碑

| 时间 | 重大节点 |
|---|---|
| 2026-05 | AI 设置加密落 SQLite · 7 语言 SEO · Umami 自托管 |
| 2026-04 | ClickHouse / Snowflake / Doris / StarRocks / Redshift / H2 批量接入 |
| 2026-03 | NoSQL 通道(MongoDB / Redis / Elasticsearch)· SQL Linter · AI 内联 |
| 2026-02 | EXPLAIN 可视化 · 慢查询 sparkline · Oracle → DM 向导 |
| 2026-01 | 首个公开版本(MySQL / PG / Oracle / SQL Server / DM / KingbaseES) |

---

## 想参与?

- 看 [CONTRIBUTING.md](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md) 上手
- 接驱动可拿现有的 `packages/core-driver/src/drivers/*` 作模板
- 路线图本身在 GitHub 的 [ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md),欢迎 PR 调整 / 补充
