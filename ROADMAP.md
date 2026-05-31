# SkylerX Roadmap

> 最后更新:2026-05-31 · 仅代表方向性规划,不构成承诺,实际节奏取决于反馈和资源。
> 想看进度 / 提建议 → [Issues](https://github.com/duhbbx/SkylerX/issues) · [Discussions](https://github.com/duhbbx/SkylerX/discussions)

## 图例

- ✅ 已发布
- 🟢 进行中 / 本季度目标
- 🔵 下个季度
- ⚪ 候选,优先级按反馈调整
- 🟣 远期 / 需要架构变更

---

## 1. 数据库支持

### 1.1 已支持(截至 2026-05)

| 类型 | 已支持 |
|---|---|
| **关系型(开源)** | MySQL · MariaDB · PostgreSQL · SQLite · H2 |
| **关系型(商业)** | Oracle · SQL Server |
| **国产 / 信创** | 达梦 DM · 人大金仓 KingbaseES · OceanBase · TiDB · GBase · **GaussDB(华为)** · **GreatSQL(万里)** · **Hologres(阿里)** · openGauss |
| **云原生 / PG-MySQL 兼容** | **PolarDB-PG / -X (阿里)** · **TDSQL-C (腾讯)** · CockroachDB · Greenplum |
| **分析型(MPP/OLAP)** | ClickHouse · Snowflake · Amazon Redshift · Apache Doris · StarRocks · DuckDB |
| **时序** | TDengine · **TimescaleDB(PG 扩展)** · **QuestDB(PG-wire)** |
| **流式 SQL** | **Materialize** · **RisingWave** |
| **向量** | **pgvector**(走标准 PostgreSQL 连接 + 服务端装扩展;`vector` 列在 metadata 树正常出现,SELECT/INSERT/UPDATE 都 work。专属向量 viewer / KNN 搜索 UI 仍在路线图) |
| **NoSQL** | MongoDB · Redis · Elasticsearch |

### 1.2 接入路线图

> 已搬到「1.1 已支持」的 wire-compatible 方言(PolarDB-PG/-X · GaussDB · TimescaleDB · QuestDB · Materialize · RisingWave · Hologres · GreatSQL · TDSQL-C · pgvector)不再列在这里。它们沿用现有 PG / MySQL driver,5e195bc 起在方言下拉里可选。

#### 🟢 2026 Q3(7-9 月)

| 数据库 | 类型 | 接入策略 | 备注 |
|---|---|---|---|
| **Apache Cassandra / ScyllaDB** | NoSQL 列族 | CQL,新建 `core-driver/cassandra` 包(`cassandra-driver` npm) | 走 SQL channel(CQL ≈ SQL) |
| **InfluxDB 3.x** | 时序 | FlightSQL(gRPC + Arrow),沿用 SQL channel | 1.x InfluxQL + 2.x Flux 用 NoSQL channel 兼容 |
| **TimescaleDB 专属 metadata** | 时序(PG 扩展, 已可连) | 在已支持的 PG 入口上加 hypertable / 连续聚合视图节点 | 不算新方言, 算 UX 增强 |
| **pgvector 向量 viewer** | 向量(已可 SQL 操作) | dim 列内嵌预览, KNN(`<->`/`<#>`/`<=>`)搜索面板, HNSW/IVFFlat 索引识别 | PG driver 不动, 加结果列渲染 + 一个搜索 dialog |

#### 🔵 2026 Q4(10-12 月)

| 数据库 | 类型 | 接入策略 |
|---|---|---|
| **Trino / Presto** | 联邦查询引擎 | HTTP API,SQL channel,catalog 树映射底层多源 |
| **Apache Hive(HS2)** | 大数据 SQL | HiveServer2 thrift(纯 JS 实现, 不走 Java sidecar) |
| **Neo4j** | 图 | Bolt 协议(`neo4j-driver` npm),Cypher,新 channel(`executeCypher`) |
| **Couchbase** | 多模 NoSQL | N1QL 走 SQL channel(`couchbase` npm) |
| **DynamoDB(AWS)** | KV/文档 | AWS SDK(`@aws-sdk/client-dynamodb`),PartiQL,NoSQL channel |
| **Milvus / Qdrant** | 专用向量库 | Milvus 用 `@zilliz/milvus2-sdk-node`,Qdrant 用 `@qdrant/js-client-rest`,各自 collection viewer + KNN UI |

#### ⚪ 2027 H1 候选

| 数据库 | 类型 | 备注 |
|---|---|---|
| **Apache IoTDB** | 信创时序 | 与 TDengine 互补;thrift,需 Node-side 实现 |
| **Nebula Graph** | 国产图 | nGQL,与 Neo4j 同一图通道复用 |
| **SequoiaDB(巨杉)** | 国产分布式 NoSQL | 信创金融客户 |
| **Lindorm(阿里)** | HBase 兼容 | 多模:宽表 / 时序 / 搜索;thrift 同上 |
| **Apache Druid** | 实时 OLAP | Druid SQL HTTP API |
| **Apache Pinot** | 实时 OLAP | PQL / SQL HTTP |
| **Apache Flink SQL Gateway** | 流式 SQL | SQL channel |
| **Vertica** | 列存 MPP | `vertica-nodejs` |
| **Google BigQuery** | 云 DW | `@google-cloud/bigquery` SDK + 标准 SQL |
| **AWS Athena** | Serverless SQL | AWS SDK(`@aws-sdk/client-athena`) |

#### 🟣 远期 / 视生态而定

- Apache HBase(thrift / REST)
- Cloudera Impala(thrift)
- AWS DynamoDB Streams(实时观察)
- Apache Cassandra 的 CDC 流
- LMDB / RocksDB 嵌入式 KV viewer
- Weaviate / Chroma 的语义搜索 UI
- ArangoDB(多模:文档 + 图 + KV)

---

## 2. 功能路线图

### 2.1 编辑器 & 查询 UX

| 状态 | 功能 | 说明 |
|---|---|---|
| ✅ | SQL Linter + AI 内联补全 | 已上线 |
| ✅ | 查询历史 + 标签 + 置顶 | 已上线 |
| 🟢 | **Notebook 模式** | 多 cell 混排 SQL / Markdown / 图表,类似 Jupyter |
| 🟢 | **Visual Query Builder** | 拖拽建表关联、自动 JOIN、聚合 GUI |
| 🔵 | **Speech-to-SQL** | Whisper 离线转文字 → AI 翻成 SQL |
| 🔵 | **跨方言 SP 翻译** | Oracle PL/SQL ↔ PG PL/pgSQL ↔ DM,作 Oracle→DM 的延伸 |
| ⚪ | **Linter 自定义规则编辑器** | 用户自己加禁用模式 / 风格规则 |
| ⚪ | **Snippet 库 + 跨设备同步** | E2E 加密的云端 snippet 共享 |

### 2.2 结果网格 UX

| 状态 | 功能 | 说明 |
|---|---|---|
| ✅ | 行内编辑 + DML 提交 | 已上线 |
| ✅ | 错误问 AI · 单元格 viewer · 导出 | 已上线 |
| 🟢 | **Form 视图** | 宽表竖排单行编辑,类似 Notion |
| 🟢 | **Excel 式多值筛选** | 列头点开勾选多值 |
| 🔵 | **Master/Detail 联动** | 选一行 → 下方自动按 FK 拉相关表数据 |
| 🔵 | **FK 下拉编辑** | FK 列编辑时弹下拉自动查找父表 |
| ⚪ | **实时 JOIN 列扩展** | 在网格里直接"展开"父表的字段,无需写 JOIN |
| ⚪ | **Pivot / 透视聚合** | 网格内直接聚合,导出到图表 |
| ⚪ | **JSON 列树展开** | 嵌套 JSON 字段树形 viewer + 路径筛选 |

### 2.3 Schema & 建模

| 状态 | 功能 | 说明 |
|---|---|---|
| ✅ | DDL 生成 · Schema diff · Mock 数据 | 已上线 |
| ✅ | Oracle → DM 迁移向导 | 已上线 |
| 🟢 | **ER 图自动布局** | 反向工程出图,foreign-key 自动连线,可导出 SVG / PNG |
| 🔵 | **正向工程** | 在 ER 图改完 → 生成 migration SQL |
| 🔵 | **跨库迁移 v2** | 扩 MySQL → PG / PG → DM 等组合,带类型 / 索引 / 视图全套 |
| ⚪ | **dbt 集成** | 识别 dbt 项目,模型预览 / lineage |
| ⚪ | **数据 lineage 图** | 解析 SQL 出表级 / 列级血缘 |

### 2.4 DBA / 运维

| 状态 | 功能 | 说明 |
|---|---|---|
| ✅ | EXPLAIN 可视化 · 慢查询 sparkline · 健康检查 | 已上线 |
| 🟢 | **死索引检测 + 体积统计** | 长期未命中索引列表 + drop SQL 候选 |
| 🟢 | **慢查询 → 自动重写 + 索引建议** | 选 slow log 行,AI 给重写 + 索引方案 |
| 🔵 | **复制延迟仪表板** | MySQL/PG 主从延迟可视化 |
| 🔵 | **长跑 query 杀手** | 表格列出 + 一键 kill + 记录原因 |
| ⚪ | **存储增长趋势预测** | 7/30/90 天容量曲线 |
| ⚪ | **连接池调优器** | 看历史并发 / 等待时间,给 max-connections 建议 |
| ⚪ | **审计日志(签名加密)** | 所有 DDL / DML 写本地签名链 |
| ⚪ | **备份调度器** | 定时 dump,本地 / OSS / S3,带保留策略 |

### 2.5 AI 能力

| 状态 | 功能 | 说明 |
|---|---|---|
| ✅ | AI Chat · 错误问 AI · Mock 数据 v1 · 健康检查 v1 | 已上线 |
| 🟢 | **Mock 数据 v2(关系感知)** | 跨多表自动维持 FK 关系 + 业务字段语义(姓名 / 地址 / 手机) |
| 🟢 | **健康检查 v2** | 反模式库扩到 50+ 项,按数据库分类 |
| 🔵 | **流式补全(类 Cursor)** | 边输入边补,Tab 接受;脱机模型可选 |
| 🔵 | **RAG over schema + docs** | 项目内 README / 注释 + schema → AI 上下文 |
| ⚪ | **AI 脱敏规则推荐** | 看采样数据,自动给 mask 规则 |
| ⚪ | **SQL → ER 图** | 反向出图;AI 推断未声明 FK |

### 2.6 协作 / 多端

| 状态 | 功能 | 说明 |
|---|---|---|
| ✅ | 多窗口 · 7 语言 i18n | 已上线 |
| 🔵 | **连接 E2E 加密云同步** | 端到端加密,云端只存密文,跨设备 |
| 🔵 | **团队共享 query 库** | 团队空间,只读 / 评论 / 分叉 |
| ⚪ | **Web 版** | 同 codebase,改 Vite target = browser;只读为主 |
| ⚪ | **Mobile 只读 viewer** | iOS/Android 看连接 / 跑只读查询 |
| 🟣 | **实时协同查询** | 一人写一人看,共享 cursor + 结果(Yjs 协议) |

### 2.7 集成 & 导出

| 状态 | 功能 | 说明 |
|---|---|---|
| ✅ | CSV / Excel / JSON / SQL / Parquet / Markdown 导出 | 已上线 |
| 🔵 | **图表 viewer** | 结果集 → ECharts(柱 / 线 / 饼 / 热力) |
| 🔵 | **导出到 BI** | Metabase / Superset / PowerBI / Tableau 数据源 push |
| ⚪ | **REST API 模拟** | 连接 → 自动生成只读 REST 接口预览 |
| ⚪ | **GraphQL 模拟** | 同上,自动出 GraphQL schema |

### 2.8 插件 / 扩展性

| 状态 | 功能 | 说明 |
|---|---|---|
| 🔵 | **第三方 driver 插件 API** | 社区自己加冷门数据库 |
| ⚪ | **导出格式插件** | 自定义导出器 |
| ⚪ | **主题 / 配色插件** | 当前内置主题 → 开放 |

---

## 3. 平台 / 工程

| 状态 | 事项 | 说明 |
|---|---|---|
| ✅ | 多架构构建矩阵(mac arm/x64 · win · linux) | 已上线 |
| ✅ | 阿里云 OSS 镜像 + 自动更新 channel 切换 | 已上线 |
| 🟢 | **自动签名(Apple Developer + Windows 代码签名)** | Apple 已申请,Windows 走 [SignPath OSS](https://signpath.org/) 免费方案 |
| 🟢 | **崩溃上报** | 自托管 Sentry,带 source-map |
| 🔵 | **E2E 测试(Playwright)** | 主流程 smoke,CI 矩阵跑 |
| 🔵 | **codecov 接入** | README 加覆盖率徽章 |
| ⚪ | **AppImage / Snap / Flatpak** | Linux 多种分发 |
| ⚪ | **Microsoft Store / Mac App Store** | 当前只有 GitHub releases |
| ⚪ | **官方 Homebrew tap** | `brew install --cask skylerx` |

---

## 4. 文档 / 社区

| 状态 | 事项 |
|---|---|
| ✅ | 7 语言官网 + SEO + Umami 自托管 |
| ✅ | DBA / Schema / NoSQL / Security / AI / Productivity 全套文档 |
| 🟢 | **视频教程**(B 站 + YouTube,每个核心功能 < 3 分钟) |
| 🔵 | **接入案例集**(欢迎用户投稿) |
| ⚪ | **公开 Changelog / Release notes** 站点 |
| ⚪ | **社区贡献者激励**(top-contributor 上 README) |

---

## 5. 如何参与

- 提需求:[Issues / New](https://github.com/duhbbx/SkylerX/issues/new/choose),用 `type: feature` 模板
- 投票:已有的 issue 加 👍,我们按热度调度
- 接驱动:看 [`CONTRIBUTING.md`](./CONTRIBUTING.md) + `packages/core-driver/src/drivers/*` 任一已实现 driver 作模板,基本就是抄一份改字段
- 讨论方向:[Discussions](https://github.com/duhbbx/SkylerX/discussions)

---

## 历史里程碑

| 时间 | 重大节点 |
|---|---|
| 2026-05 | AI 设置加密落 SQLite · 7 语言 SEO · Umami 自托管 |
| 2026-04 | ClickHouse / Snowflake / Doris / StarRocks / Redshift / H2 等驱动批量接入 |
| 2026-03 | NoSQL 通道(MongoDB / Redis / Elasticsearch)· SQL Linter · AI 内联 |
| 2026-02 | EXPLAIN 可视化 · 慢查询 sparkline · Oracle → DM 向导 |
| 2026-01 | 首个公开版本(MySQL / PG / Oracle / SQL Server / DM / KingbaseES) |
