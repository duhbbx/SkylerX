# 结构管理

数据库不是只有「往里塞数据」那一面,更多时间是在画表、改表、对账、迁移。SkylerX 把结构相关的能力拢成一组面向库 / 表 / Schema 的工具,从只读查看到双库对齐一条龙。

本页按从轻到重的顺序介绍:**查看 → 设计 → 编辑 → 关系图 → 快照 → 跨库对比 → 漂移 → 建库建 Schema → AI 辅助**。

## 概述

| 工具 | 触发 | 目的 | 是否生成 SQL | 是否直接落库 |
|---|---|---|---|---|
| 表结构(TableStructure) | 左侧树:表节点 → 默认双击 | 只读看列/索引/键/DDL | — | 否 |
| 表设计器(TableDesigner) | 树右键 → 新建表 / 设计表 | 可视化建表 + diff-aware ALTER | ✓(预览) | ✓(确认后) |
| DDL 编辑器(DdlEditor) | 树右键 → 新建 / 编辑视图、函数、过程、触发器 | 直接写 / 改对象 DDL | ✓(编辑器) | ✓ |
| ER 图(ErdView) | 树右键 schema → ER 图 | 整库可视化 + 拖拽建表 / 加 FK | ✓(导出 .sql) | ✓(应用到 DB) |
| 结构快照(SchemaSnapshots) | 命令面板 `act:snapshots:{connId}` | 把当前所有表 DDL 存 localStorage,日后对比 | — | 否 |
| 结构对比(SchemaDiff) | 命令面板 `act:schema-diff` | 两连接 schema 横向对比 + 生成对齐迁移脚本 | ✓(可一键打开为查询) | 否 |
| 结构漂移(SchemaDrift) | 命令面板 `act:drift` | 同方言两连接深度漂移检测(列/索引/FK) | ✓(对齐脚本) | ✓(确认后) |
| 新建数据库(NewDatabase) | 树右键连接节点 → 新建数据库 | 按方言生成 `CREATE DATABASE` | ✓(预览可编辑) | ✓ |
| 新建 Schema(NewSchema) | 树右键库节点 → 新建 Schema | PG / SQL Server / Oracle 等 | ✓ | ✓ |
| AI 建表(SchemaArchitect) | 命令面板 → AI 建表助手 | 业务描述 → 多表 DDL | ✓ | ✓ |
| AI 反推(SchemaReverse) | 命令面板 → AI 反向推断 | 样本数据 → CREATE TABLE | ✓ | ✓ |

下面逐项展开。

## 1. 表结构查看(TableStructure)

最朴素的"看看这张表长什么样",树里点表节点会打开一个只读 tab。源码在 `packages/ui/src/components/TableStructure.vue`。

界面分四个标签页,标签后缀显示数量:

- **字段** — 列名 / 类型 / 是否 NULL / 是否主键 / 默认值 / 注释
- **索引** — 索引名列表(只展示名称,详细列在设计器里看)
- **键** — 主键 / 外键 / 唯一键名称
- **DDL** — 表的 `CREATE TABLE` 全文

DDL 这一页的获取策略按方言分:

```ts
if (isMysql) {
  // MySQL 系直接 SHOW CREATE TABLE，最权威
  const r = await client.connections.execute(connId, `SHOW CREATE TABLE ${ref}`)
  // 取 row['Create Table']
}
// 非 MySQL：buildCreateFromColumns(...) 用列信息重建一份简化 DDL
```

也就是说:**MySQL / MariaDB / OceanBase** 看到的 DDL 是 DB 原汁原味输出的;PostgreSQL / Oracle / SQL Server 等看到的是按列信息组装的近似版,够用但不会带 GENERATED / EXTENDS 这种复杂语法。

右上角刷新按钮 `⟳` 重新拉取(`Promise.all([meta('columns'), meta('indexes'), meta('keys')])`),适合改完表回来确认。

## 2. 可视化表设计器(TableDesigner)

`packages/ui/src/components/TableDesigner.vue`,**880 行**,是结构管理的主力。两种 mode:

- `mode: 'create'` — 新建表(空白起步)
- `mode: 'alter'` — 改表(从现有列结构 + 索引 + 外键载入)

### 顶栏

| 按钮 | 行为 |
|---|---|
| 新建 / 重置 | `resetTable()` 清空回到空表状态 |
| 保存 | 创建模式 → `CREATE TABLE`;改表模式 → `ALTER TABLE` diff 序列 |
| 另存为 | `prompt` 新表名 → 用当前列结构 `CREATE TABLE` 一张新表(等价"复制结构") |
| ➕ 字段 / 插入字段 / 删字段 / 主键 / ⬆⬇ | 直接在 columns 数组里 splice |
| 表名输入框 | alter 模式只读(改表名要走 RENAME,不在本设计器范围) |

### 内部标签页(随方言显隐)

`INNER` 数组定义了固定 10 个 tab:`fields / indexes / fk / unique / check / trigger / options / storage / comment / sql`。每个 tab 都是一个 reactive 子表单,改完立刻反映到 SQL 预览。

**字段表格**(行内编辑):

| 列 | 编辑方式 |
|---|---|
| 字段名 | 普通 input |
| 类型 | input + datalist(`type-list`),按方言提供候选(`typeOptions(dialect)`) |
| 长度 / 精度 | 数值 input |
| NULL / PK | 复选框 |
| 默认值 / 注释 | input |

选中行的下方还有「字段属性」区,仅 MySQL 系显示 `UNSIGNED / ZEROFILL / AUTO_INCREMENT / ON UPDATE CURRENT_TIMESTAMP / CHARSET / COLLATION`,所有方言显示 `GENERATED` 表达式。

**索引** 的类型下拉按方言切:MySQL 系 `BTREE / HASH / FULLTEXT / SPATIAL`,PG 系 `btree / hash / gin / gist`。PG 还多两列 `WHERE`(部分索引)和 `CONC`(`CREATE INDEX CONCURRENTLY`,改表时不锁表)。

**外键** 同样按方言:`ON DELETE / ON UPDATE` 候选写死为 `CASCADE / SET NULL / RESTRICT / NO ACTION`;PG 额外有 `MATCH FULL/PARTIAL/SIMPLE` 和 `DEFERRABLE`。

**选项** 页:

- MySQL 系:Engine / Charset / Collation / Row Format(`DYNAMIC / COMPRESSED / COMPACT / REDUNDANT`)/ Auto-increment 起始值
- PG 系:`TABLESPACE / FILLFACTOR / INHERITS`
- 其它:留空提示

### diff-aware ALTER(改表模式的核心)

进入 alter 模式时,`loadExisting()` 走 `client.connections.metadata` 拉列信息映射为 `ColumnDef[]`、再 `loadIndexes()` / `loadForeignKeys()` 用 `information_schema` 拉现有索引外键,**整套快照存为 `original.value / originalIndexes.value / originalForeignKeys.value`** 作为 diff 基线。

之后 `alterStmts` 是 `computed(() => buildAlterTable(dialect, tableRef, original.value, spec, { indexes: originalIndexes.value, foreignKeys: originalForeignKeys.value }))`。

`buildAlterTable` 是源 vs 当前的字段级 diff:

- 改了列名(且 `originalName` 存在)→ `ALTER TABLE ... RENAME COLUMN / CHANGE COLUMN`
- 删了某行 → `DROP COLUMN`
- 新增行 → `ADD COLUMN`
- 类型 / NULL / 默认值 / 注释变了 → `MODIFY COLUMN`(MySQL)或 `ALTER COLUMN`(PG/MSSQL)
- 索引 / FK 比较 `originalIndexes.value` → 增减

SQL 预览页(`inner === 'sql'`)显示生成的 ALTER 列表;没改任何东西时显示 `designer.noChanges` 占位。**保存**会把每条 ALTER 单独 `client.connections.execute`,任何一条失败就停在那里并把焦点切到 SQL tab,不会回滚已成功的(改表场景一般可接受,失败信息会显示在错误条)。

### 脏检查 + 创建后转 alter

脏检查走 `JSON.stringify({ tableName, spec })` 与基线对比,关 tab 时父组件调 `isDirty()` 决定是否弹"未保存"提示。保存成功 / 重置后基线会同步,刚打开新建 tab 不会被误判 dirty。

新建保存成功后,组件自己把 `runtimeMode` 切到 `alter`,并把刚 CREATE 的列标记为 `originalName`,后续每次保存都走 ALTER diff。效果:点保存,表就建好了,tab 不关、不会跳走,可以继续追加字段、改类型 — 这是"边建边想"工作流的优化。

## 3. DDL 编辑器(视图 / 函数 / 过程 / 触发器)

`packages/ui/src/components/DdlEditor.vue`。设计器之外的 schema 对象用 SQL 文本直接写,本组件就是一个带方言识别的 Monaco 包装。

- **mode: 'create'** — 用 `objectTemplate(dialect, kind, ctx)` 给一个最小骨架(例如 `CREATE VIEW v AS SELECT 1;`)
- **mode: 'edit'** — 调 `objectDdlQuery(dialect, kind, ref, node)` 拉现有定义

`objectDdlQuery` 返回三种 mode 之一:

| mode | 适用 | 取定义方式 |
|---|---|---|
| `showCreate` | MySQL 系 | `SHOW CREATE VIEW / PROCEDURE / FUNCTION / TRIGGER`,从 row 里 `^create` 开头的字段拿 |
| `viewdef` | PG 视图 | `pg_get_viewdef(...)`,本组件再拼 `prefix`(`CREATE OR REPLACE VIEW ... AS\n`) |
| `funcdef` / `oracle-ddl` | PG 函数 / Oracle DBMS_METADATA | 直接读 `row.ddl` |

工具栏:

- **保存 / 执行**(根据 mode 显示文案)— 整段作为单条 statement 执行(函数 / 过程体里有分号,不能按分号拆)
- **格式化** — `sql-formatter` 按方言:`mysql` 系 → mysql,`pg` 系 → postgresql,`sqlserver` → transactsql,`oracle/dm` → plsql。解析失败保持原样不阻断输入。
- **取消** — 直接关闭 tab

错误条会显示后端原始报错,触发器 / 存储过程一般是分号 / DELIMITER 写法问题。

## 4. ER 图(ErdView)

`packages/ui/src/components/ErdView.vue`,SVG 手画的画布。打开方式:树里某个库 / Schema 节点右键 → ER 图,会新开一个 `kind: 'erd'` 的 tab。

### 视图模式(默认)

- 拉所有表(`loadErd`,内部走 `information_schema` / `pg_constraint` 等)→ 自动栅格布局
- 鼠标滚轮 = 缩放,空白处按住拖 = 平移
- 表框可单独拖到任意位置(包括负坐标,canvas 不裁切)
- 顶部:`－ / + / 1:1 / ⟳ / 编辑` 缩放与刷新

### 编辑模式(点"编辑"打开)

可同时做三种修改,提交时一并执行:

1. **新建表** — `addTable()` 弹一张框,可加列、改类型、勾主键
2. **新建外键** — 在任一列右侧的端口按下 → 拖到另一张表的列上松开 → `newFks.push(...)` ;视觉上是一条紫色虚线
3. **ALTER 加列**(D1)— 现有表的"+ ALTER 加列..."按钮 → 弹两个 prompt(列名 / 类型)→ 进入 `alterAddCols[tableName]`,在框里以紫色高亮显示带 `+` 前缀

### 产出

`generateDdl()` 走 `client.files.saveText`,产出一个 `.sql` 文件,包含:

```sql
CREATE TABLE "t1" (
  "id" int,
  ...
);

ALTER TABLE "orders" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "users" ADD COLUMN "phone" varchar(64);
```

`applyChanges()` 把 `buildDdl(true)`(仅新增部分)按 `;\n` 拆开,`executeBatch` 一次性下发到当前连接,成功后 `load()` 重拉、回到视图模式。如果失败会弹 alert,用户结构没动。

## 5. 结构快照(SchemaSnapshotsDialog)

`packages/ui/src/components/SchemaSnapshotsDialog.vue`。命令面板 `act:snapshots:{connId}` 触发。

定位:**同一连接、不同时间点**的 DDL 对比。和后面的 SchemaDiff(两连接)、SchemaDrift(深度漂移)不重叠。

### 拍快照

点 "📸 拍快照" → 拉第一个 database/schema 下所有表的 DDL。MySQL 走 `SHOW CREATE TABLE`,PG 拼一份简化 DDL(列 + 类型 + NULL + DEFAULT)。结束后弹 prompt 让你写注释("发布前 / 改完订单系统 / ..."),存到 `localStorage['skylerx.schema-snapshots']`,每个连接最多保留 `MAX_PER_CONN = 20` 份,超出 LRU 淘汰最老的。

### 对比

列表里勾两份(超过两份会自动顶出最老的)→ "⟷ 对比"。算法很直白:

- 仅 A 有 → `added`(绿色)
- 仅 B 有 → `removed`(红色)
- 两边都有但内容不同 → `changed`(黄色)
- 完全相同 → `same`(默认隐藏)

点某条 diff 行 → 右侧出现双栏 DDL,可直接眼比。

> 限制:仅看第一个 database/schema,多库场景需要分别为每个库拍。底层存 `localStorage` 是因为 SQLite 迁移不想被这种"日志型"数据干扰,5MB 配额一般够几十张表 × 二十个快照。

## 6. 结构对比(SchemaDiffDialog)— 两连接对比 + 对齐 SQL

`packages/ui/src/components/SchemaDiffDialog.vue`。命令面板 `act:schema-diff` 触发。

### 触发条件

- 选源连接 + 源 schema、目标连接 + 目标 schema
- 必须**同家族**(MySQL ↔ MySQL / PG ↔ PG),跨家族 SQL 语法对不上,UI 上会显示"仅支持 MySQL ↔ MySQL / PG ↔ PG"

切换连接后 `onPickSrc / onPickTgt` 自动填默认 schema:PG → `public`,MySQL → 连接配置里的 `database`。

### 抓取 + 对比

两边并行跑一条 `information_schema.COLUMNS` 查询(`TABLE_NAME / COLUMN_NAME / 类型 / 是否 NULL / 是否 PK / 默认值`),得到 `TableSnapshot[]` → `diffSchemas` 出三类:`added / changed / removed`。每条 changed 行还带列级 `columnChanges`(`add / drop / modify`)。

### 产出

`generateMigration` 按目标方言出一段对齐 SQL,头部带摘要(几张新增、几张改、几张少)。下面两个按钮:

- **复制** — 写剪贴板
- **打开到目标连接的查询** — `emit('openSql', tgtId, migration)`,Workspace 会新开一个 query tab,把 SQL 塞进去,你审一下再 Run。这一步保证**不会自动落库**。

## 7. 结构漂移检测(SchemaDriftDialog)

`packages/ui/src/components/SchemaDriftDialog.vue`,**925 行**,比 SchemaDiff 更深一层。命令面板 `act:drift`。

差别:SchemaDiff 只看列,DriftDialog 还看**索引**和**外键**,并且生成的对齐脚本可以**直接在 SkylerX 里下发执行**。

### TableProfile

每张表归一化为一个 `TableProfile`:`columns: Map<name, {type, nullable, default, pk}>` + `indexes: Map<name, {unique, columns[]}>` + `fks: Map<name, "(c1,c2) → other(c1,c2)">`,外加一份原始 DDL 供人眼对比。

抓取来源按方言:MySQL 走 `SHOW CREATE TABLE` + `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE`;PG 走 `information_schema.columns` + `pg_indexes`(`indexdef` 文本里正则抠 unique 和列名)+ `information_schema.constraint_column_usage`。

### 报告

三栏:**仅源有 / 仅目标有 / 内容不同**。第三栏的每张表展开显示列变化(`+ name / − name / ~ name`)、索引变化(`+ idx_x`)、FK 变化(`~ fk_x`)。点行可以展开下方双栏 DDL diff。

### 对齐脚本(关键产出)

每行有"+ 对齐"按钮,把该表的修复 SQL **追加**到下方脚本预览框:

| 状态 | 生成的语句 |
|---|---|
| 仅源有 | 直接抄源端 DDL(`CREATE TABLE`) |
| 仅目标有 | `-- DROP TABLE \`x\`; -- 注释掉,需人工去掉` |
| 列 add | `ALTER TABLE \`t\` ADD COLUMN \`c\` {srcType};` |
| 列 drop | 注释掉的 `-- ALTER TABLE ... DROP COLUMN ...`(防误删) |
| 列 modify | MySQL:`MODIFY COLUMN`;PG:`ALTER COLUMN ... TYPE` |
| 索引 / FK 差异 | 仅以 `-- INDEX +xx` / `-- FK -xx` 注释提示,**不自动生成**(索引重建语法复杂,留人工) |

执行流程:`▶ 执行脚本` 弹高危确认 → 按 `;\s*\n` 切语句、跳过 `--` 注释行 → `executeBatch`。

> 设计取舍:删表 / 删列默认注释,加列 / 改类型直接给可执行 SQL。"破坏性强的注释,补救式的允许执行",运维场景下最不容易出事。

## 8. 新建数据库(NewDatabaseDialog)

`packages/ui/src/components/NewDatabaseDialog.vue`。树右键连接节点 → 新建数据库。

弹窗里:**名称(必填)** + 折叠的"高级选项"(字符集 / 排序规则 / 注释)+ **SQL 预览(可编辑)**。最终执行的是预览框里的文字,不是表单 — 预览之后你可以手动加 `IF NOT EXISTS` 之类。

### 方言矩阵

| 方言 | 支持 | 备注 |
|---|---|---|
| MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks | ✓ | `CREATE DATABASE \`n\` [DEFAULT CHARACTER SET ...] [DEFAULT COLLATE ...]`(不带 COMMENT) |
| PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift | ✓ | `CREATE DATABASE "n" [ENCODING '...']` + 独立 `COMMENT ON DATABASE` |
| SQL Server | ✓ | `CREATE DATABASE [n]`(无字符集) |
| ClickHouse | ✓ | `CREATE DATABASE \`n\` COMMENT '...'` |
| Snowflake | ✓ | `CREATE DATABASE "n" COMMENT = '...'` |
| TDengine | ✓ | `CREATE DATABASE n`(不要引号) |
| **Oracle / DM** | ✗ | 数据库 = 实例级,需 DBCA。提示"通常应该新建 schema(用户)代替" |
| SQLite / DuckDB | ✗ | 文件型,数据库 = 文件,通过新建连接选文件路径"创建" |
| H2 | ✗ | 由启动参数决定,不能即时 SQL 创建 |
| MongoDB / Redis / Elasticsearch | ✗ | 通过 collection / index / db0-15 等机制,不走 CREATE DATABASE |

不支持的方言界面会直接显示一段红色提示,无法提交。

### 字符集选项

按方言推荐:

- MySQL 系:`utf8mb4 / utf8 / latin1 / gbk`,collation `utf8mb4_general_ci / unicode_ci / 0900_ai_ci / bin`
- PG 系:`UTF8 / SQL_ASCII / LATIN1 / GBK`

提交时按 `;\s*\n` 拆语句逐条 `execute`。

## 9. 新建 Schema(NewSchemaDialog,Oracle 特殊处理)

`packages/ui/src/components/NewSchemaDialog.vue`。树右键库节点 → 新建 Schema。

### 方言矩阵

| supportInfo | 方言 | 语法 |
|---|---|---|
| `pg` | PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift | `CREATE SCHEMA "n" [AUTHORIZATION "owner"]` + 可选 `COMMENT ON SCHEMA` |
| `sqlserver` | SQL Server | `CREATE SCHEMA [n] [AUTHORIZATION owner]` |
| `snowflake` | Snowflake | `CREATE SCHEMA "n" [COMMENT = '...']` |
| `oracle` | Oracle / DM | **Schema = User**,走 CREATE USER + GRANT(见下) |
| `null` | MySQL / SQLite / ClickHouse / TDengine / NoSQL | 没有 Schema 概念,显示"该方言无 Schema 概念" |

### Oracle / DM 的特殊处理

Oracle 里 "schema" 是 "user" 的同义词,本对话框针对这点做了一组开发场景下的合理默认:

```sql
CREATE USER :name IDENTIFIED BY :password
  DEFAULT TABLESPACE USERS
  TEMPORARY TABLESPACE TEMP
  QUOTA UNLIMITED ON USERS;

GRANT CONNECT, RESOURCE, UNLIMITED TABLESPACE,
      CREATE VIEW, CREATE SYNONYM, CREATE SEQUENCE,
      CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE,
      CREATE MATERIALIZED VIEW, CREATE DATABASE LINK
   TO :name;
```

(占位 `:name` / `:password` 代表实际填写的用户名 / 密码。)

为什么这么写,代码注释解释得很直白:

- `QUOTA UNLIMITED ON USERS` — 不加的话新用户一插入数据就 `ORA-01950: insufficient quota on tablespace USERS`
- Oracle 12c+ `RESOURCE` 不再含 `CREATE VIEW / SEQUENCE` 等,需要显式补齐开发常用
- 不给 `SELECT ANY TABLE / DBA / SYSDBA` — 保持"只能玩自己 schema"
- 用户名 / 密码默认**不加引号**:合法 unquoted 标识符走 Oracle 自动大写(避免"双引号小写 → 后续 ALTER USER 找不到")。要保留小写或特殊字符,自己在 SQL 预览里加双引号

密码字段为空时填占位符 `CHANGE_ME_123`,提醒用户改掉。

### 提交

`execute` 时带 `database` 上下文(PG 系 schema 属于库,先 USE 再 CREATE)。失败的 toast 错误信息还会附 `askAi` 链接,把 SQL + 错误一并扔给 AI 解释(常见于 Oracle 表空间不存在 / 权限不足)。

## 10. AI 辅助:Schema Architect + Schema Reverse

两个对话式工具,都把生成的 SQL 留到最后让用户审一下再执行。

### Schema Architect(业务描述 → 多表 DDL)

`packages/ui/src/components/AiSchemaArchitectDialog.vue`。对话式,可多轮迭代。

System Prompt 大意:

> You are a senior database architect. The user describes a business domain.
> 1. Design **multiple related tables** with PK, FK, indexes for the **`{dialect}`** dialect.
> 2. Output a single ```sql code block containing the COMPLETE CREATE TABLE statements.
> 3. Explain key design decisions in 2-4 bullets.
> 4. When user asks to revise, output the FULL updated SQL again (not a diff).

工作流:

1. 描述业务("做个电商订单系统:用户、商品、订单、订单项,支持优惠券")
2. AI 给一段 markdown:设计说明 + 完整 SQL 代码块
3. 在对话里追问("加个 status 字段" / "把 order_items 改成分区表"),AI 出**整段**新版 SQL
4. 顶部按钮 `▶ 执行最新版本` — 取 `latestSql`(最后一次助手回答里的 SQL 块),`;\s*(?:\n|$)` 拆 → 逐条 `execute`

`latestSql` 永远取最新一轮 — 你迭代了五轮,执行的是第五轮的版本,不会被早期版本污染。

### Schema Reverse(样本数据 → CREATE TABLE)

`packages/ui/src/components/AiSchemaReverseDialog.vue`。单轮非对话式,适合"我有一份 CSV,帮我建对应的表"。

输入:**格式**(CSV / TSV / JSON)+ **表名** + **示例数据**(贴几行就够,带表头最准)+ 可选"同时生成 INSERT"。

Prompt 强制了 4 段输出:**推断说明**(列名 → 类型 → 理由)、**CREATE TABLE**(`sql` 代码块)、**INSERT (数据)**(可选,`sql` 代码块)、**索引建议**(bullet list)。

AI 回完之后会自动 `extractSql(text)` 把第一段 SQL 代码块抽出来填到下方编辑框,你可以改完再点 `▶ 执行`。

> 关于索引推荐:Schema Reverse 里 AI 只给"建议"(凭经验),不自动建索引。基于真实历史 SQL + 现有索引推荐 → 看 [高级与工程化 → 索引推荐器](./advanced.md)。

## 11. 信创迁移评估(MigrationAssessWizard)

把一个 Oracle / DM 源库评估成「迁去 openGauss 系国产库(Vastbase / openGauss)/ DM」的可行性报告。面向去O 项目的售前 / DBA:先看清源库有多少东西、多大、多难,再决定迁移工作量。

**入口**:命令面板 `act:mig-assess`(搜「信创迁移评估」),或右键一个 Oracle / DM 连接 → `🧭 信创迁移评估…`(预填该连接为源)。代码 `packages/ui/src/components/MigrationAssessWizard.vue`,评估逻辑全在 `packages/ui/src/migrate/`。

### 5 步向导

| 步 | 做什么 |
|---|---|
| 1 连接 | 选源库(可画像的方言)+ 目标库(有结构转换通道的方言) |
| 2 源库画像 | 列 database / schema(过滤系统),勾选要迁的 schema,出全量对象盘点 + 风险指标 |
| 3 评估 | 拉所选 schema 的对象,逐个打 A/B/C/D 等级 + 整体「就绪度」 |
| 4 AI 转换 | 把 C 级(PL/SQL 过程体 / 复杂 SQL)逐个交 AI 翻成目标方言(只读,供复核) |
| 5 报告 | 汇总,导出 Excel / Word / PDF / Markdown |

### hub-and-spoke 转换架构

不写「源库 → 目标库」的两两翻译器(N×M 爆炸),而是中间加一层抽象数据库模型(Logical IR):

```
源库 ──parse──▶ Logical IR ──emit──▶ 目标库
```

每个库只需 1 个 parser 或 1 个 emitter,加库是 N+M 而非 N×M。代码:`migrate/ir.ts`(模型)、`migrate/convert.ts`(编排)、`migrate/dialects/{oracle,postgres,dameng}.ts`。**边界**:结构对象(表 / 列 / 类型 / 约束)走确定性 IR;过程化对象(过程 / 函数 / 包 / 触发器 / 视图)原样交 AI(`migrate/aiConvert.ts`),正则转译搞不定的语义级改写让模型做。

### 源库画像(精准评估)

`migrate/profile.ts` + `migrate/profilers/{oracle,postgres}.ts`,每个源库一套 catalog 查询。盘点 17 类对象,**库不支持的显示 `—`(null)而非假装 0**:

> 表 · 视图 · 物化视图 · 分区表 · 索引 · 主键 · 外键 · 唯一约束 · 检查约束 · 序列 · 函数 · 存储过程 · 包 · 触发器 · 自定义类型 · 同义词 · 数据库链接

外加迁移风险指标:**无主键表数**(增量同步头号坑)、**LOB 大对象列数**(数据迁移耗时大头)、**带触发器表数**、**有注释表数**;以及行数分桶(≥100 万 / ≥1000 万 / ≥1 亿)、表空间大小、Top 大表。行数取 catalog 统计估算(`reltuples` / `num_rows`),不做精确 `COUNT(*)`,亿级表也是秒级返回。无 DBA 权限拿不到 `dba_segments` 时自动降级(大小按 0 + 提示)。

### 文档导出

报告页四个按钮,全部复用现有依赖(`xlsx` / `marked`),无新增库,中文无障碍:

| 格式 | 实现 |
|---|---|
| Excel `.xlsx` | 多 sheet:概览 / 对象盘点 / 大表 / 评估明细 / AI 转换 |
| Word `.doc` | Markdown 渲染成带样式 HTML,Word 原生打开 |
| PDF | 同一份 HTML 新窗口自动弹打印 → Chromium「另存为 PDF」 |
| Markdown `.md` | 纯文本报告 |

> 评级口径:**A 自动**(确定性直接用)· **B 辅助**(有类型 / 语义差,建议抽查)· **C 人工**(PL/SQL 体或专有语法,需 AI + 人工)· **D 阻断**(空间 / 外部包等无等价能力,需架构层评估)。就绪度 = 各对象等级加权均值(A=100 / B=80 / C=40 / D=0)。

### v0.5.8 扩展:从评估到落地的完整闭环

向导从 5 步扩到 6 步(新增**数据迁移**),引擎补齐了真正「做一次迁移」需要的能力:

- **确定性转换保真度**:除类型外,还生成主键/外键/唯一/检查约束、索引、序列、注释,按依赖顺序(序列→表→注释→索引→外键)输出完整可跑脚本。
- **生成完整迁移脚本 + 一键建库**:读源库结构 → `convertSchema` 生成整库 DDL → 在目标库执行;PG 系**事务内先 dry-run 再提交**(任一句失败整体回滚),非事务库逐句执行、首错即停。
- **AI 自修复闭环**:AI 转完的 DDL 拿到目标库事务内试跑(`BEGIN…ROLLBACK`,不留痕),报错回喂 AI 自动重修,最多 3 次;过了标 ✅。
- **数据迁移**:逐表分块搬运(可取消 + 表级断点续)+ 行数对账 + 主键列级对账(非空数/最小/最大),逐表 ✅/❌。
- **扩源方言**:除 Oracle/DM 外,新增 **PG 系 / MySQL / SQL Server** 作源(去 PG / 去 MySQL / 去 SQL Server);目标新增 **MySQL 系**(OceanBase / TiDB / GBase 等)。加新库仍是 N+M。

> 关键路径(转换 / 画像 / 校验 / 建库 / 数据搬运 / 整库 round-trip)均在活的 openGauss 内核库(Vastbase)上验证过。

## 兼容性矩阵

下表归纳每个工具支持哪些方言。`▣` = 完整支持,`◐` = 部分支持,`-` = 不适用 / 跳过。

| 工具 | MySQL 系 | PG 系 | SQL Server | Oracle / DM | SQLite | ClickHouse | NoSQL |
|---|---|---|---|---|---|---|---|
| TableStructure | ▣(`SHOW CREATE TABLE` 原汁) | ◐(列重建) | ◐(列重建) | ◐(列重建) | ◐ | ◐ | - |
| TableDesigner — CREATE | ▣ | ▣ | ▣ | ▣ | ◐(类型 / 选项较少) | ◐ | - |
| TableDesigner — ALTER diff | ▣ | ▣ | ◐ | ◐ | ◐ | ◐ | - |
| DdlEditor | ▣(SHOW CREATE) | ▣(`pg_get_viewdef` / `funcdef`) | ◐ | ▣(DBMS_METADATA) | ◐ | ◐ | - |
| ErdView | ▣ | ▣ | ◐ | ◐ | ◐ | - | - |
| SchemaSnapshots | ▣ | ◐(简化 DDL) | - | - | - | - | - |
| SchemaDiff | ▣ | ▣ | - | - | - | - | - |
| SchemaDrift | ▣ | ▣ | - | - | - | - | - |
| NewDatabase | ▣ | ▣ | ▣ | -(改用 NewSchema) | -(文件型) | ▣ | -(走专属命令) |
| NewSchema | -(无概念) | ▣ | ▣ | ▣(=User) | - | - | - |
| AI Architect / Reverse | ▣ | ▣ | ▣ | ▣ | ▣ | ▣ | ◐ |

"MySQL 系"包含 MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks。"PG 系"包含 PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift / H2(PG 兼容)。

## 常见工作流串起来看

**从零搭一个业务库**:
1. 树右键连接 → 新建数据库 → SQL 预览检查无误 → 执行
2. 命令面板 → AI 建表助手 → 描述业务 → 拿到完整 DDL → 在新库上执行
3. 树右键 schema → ER 图 → 检查关系 / 微调
4. 改字段:树右键表 → 设计表(alter 模式)→ 改完保存(走 ALTER diff)

**库与库对齐**:
1. 命令面板 `act:schema-diff` → 选 dev / prod 两连接 → 拿到迁移 SQL → "打开到目标连接的查询" → 审一下 → Run
2. 怀疑被人手改过 prod:`act:drift` → 选 baseline / prod → 看三栏报告 → 给该改的表点"+ 对齐" → 脚本预览审查 → 执行

**历史回顾**:
1. 上线前 `act:snapshots:{connId}` → 拍快照 → 备注"v2.0 上线前"
2. 三个月后再来:打开快照对话框 → 勾"v2.0 上线前" + 当前一份新快照 → 对比 → 看到底改了哪些表

到这里结构层的所有能力就齐了。要继续看运行时的查询计划、慢日志、索引推荐,翻 [高级与工程化](./advanced.md);要看跨方言迁移工具,翻 [数据库支持](./databases.md)。
