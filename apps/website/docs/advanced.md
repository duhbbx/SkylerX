# 高级特性

这一篇集中介绍 SkylerX 给**重度使用者(DBA / 数据工程师 / 后端开发)**准备的进阶能力。这些功能藏在右键菜单、`⌘K` 命令面板或工具栏更下层,日常 SELECT 大概率用不到,但碰到下面这些场景会非常省时:

- 想看执行计划是否走索引、哪个节点最慢
- 想根据历史 SQL 反推该建什么索引
- 想看一张表的列分布 / NULL 比例 / 类型是否选大了
- 想清掉重复行 / 给历史数据回填默认值 / 从软删里恢复
- 想在整个库里搜一个值出现在哪些表
- 想可视化拖拽建查询而不是手写 SQL
- 想管 Doris/StarRocks 的分区 / ClickHouse 的 part / MySQL binlog / PG 扩展
- 想把一个 Oracle 库整体迁去达梦(DM)

下面按照"看 → 改 → 搜 → 建 → 迁"的顺序展开。

## 1. EXPLAIN 可视化 — PlanPanel

写 SQL 的人都看过 EXPLAIN,但裸文本不直观。SkylerX 在 QueryPane 旁边挂一个 **Plan 面板**,把 EXPLAIN 输出渲染成树 + 摘要。

### 触发方式

| 入口 | 行为 |
|---|---|
| QueryPane 工具栏 `📊 Plan` | EXPLAIN 当前 SQL(不真正执行) |
| `⌘⇧E` / Ctrl+Shift+E | 同上 |
| `📊 Plan` 旁的 `▶ Analyze` | EXPLAIN ANALYZE(**真的执行**,DML 慎用) |

底层走 `plan.ts → planQuery(dialect, sql, { analyze })`:

| 方言 | 生成的语句 |
|---|---|
| PostgreSQL / Kingbase | `EXPLAIN (FORMAT JSON) <sql>` / `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <sql>` |
| MySQL / MariaDB / OceanBase | `EXPLAIN FORMAT=TREE <sql>` / `EXPLAIN ANALYZE <sql>`(MySQL 8.0.18+) |
| 其他方言 | 回退表格 EXPLAIN(plain pre 渲染) |

### 节点树渲染

PG 的 JSON Plan 用 `parsePgPlan` 解出 `PlanNode` 树,然后用 `flattenPlan` 压平成 `{node, depth}` 列表渲染。每个节点显示:

- **标签**:`Seq Scan` / `Index Scan` / `Hash Join` …
- **细节**:`on users` / `using users_pk` / `inner join`
- **成本条**:水平条宽度 = `cost / maxCost * 60px`,绿到红渐变
- **数字**:`cost 1234.56 · est 1000 · act 1234 · 12.3ms`(act / ms 仅 ANALYZE 时有)

### 慢算子着色

PlanPanel 自动把"贵的 1/3 节点"标红:

```ts
function isSlow(node) {
  return node.cost >= maxCost.value * 0.33 && maxCost.value > 0
}
```

红色背景 + 红色标签,**眼睛立刻能看到要优化哪里**,不用一个个比成本数字。

### 预估 vs 实际偏差

`estimateSkew(node)` 计算 `max(est, act) / min(est, act)`。≥ 10× 视为**优化器统计过时**(典型信号),节点左侧加黄色边条 + 节点末尾追加 `⚠ 24×` 徽章。摘要条里也会单独点出"偏差最严重的节点":

```ts
let skewWorst = null
for (const r of arr) {
  const sk = estimateSkew(r.node)
  if (sk == null) continue
  if (!skewWorst || sk > skewWorst.skew) skewWorst = { node: r.node, skew: sk }
}
```

看到这个徽章一般就该 `ANALYZE table` 或 `pg_statistic refresh` 了。

### 摘要条

面板顶部展示:

| 字段 | 含义 |
|---|---|
| `Total Cost` | 最重节点的 cost(根节点累计) |
| `Actual ms` | EXPLAIN ANALYZE 时各节点实际耗时累加 |
| `Heaviest` | 成本最高的节点名 |
| `Skew` | 估算 vs 实际偏差最严重的节点 + 倍数 |

---

## 2. 索引推荐 — IndexRecommender

`⌘K → 索引推荐` 或 NavTree 库节点右键 `🔧 推荐索引`。

### 输入与输出

| 输入 | 来源 |
|---|---|
| 历史 SQL 模式 | `client.connections.history(connId, 1000)` 最近 1000 条 |
| 已存在索引 | MySQL `information_schema.STATISTICS` / PG `pg_index + pg_class` |

输出:`IndexHint[]`,每条带表名、列名、综合分、推断原因、可直接执行的 `CREATE INDEX` DDL。

### 推断算法(`index-recommender.ts`)

不引 SQL parser(开销大且方言差异多),用**正则启发**抽 WHERE / JOIN / ORDER BY / GROUP BY:

1. **聚合历史**:相同 SQL 文本合一行,累加 `count` + `totalMs`
2. **过滤**:只保留 `SELECT` / `WITH` 类语句,跳过 DML/DDL
3. **解析别名**:`parseTableAliases(sql)` 从 `FROM`/`JOIN` 后抽 `tbl [AS] alias` 进 Map
4. **扫四类子句**,每个命中按基础分加权:

| 子句 | 基础分 | 说明 |
|---|---|---|
| `WHERE col = ?` / `LIKE` / `IN` / `IS NULL` / `BETWEEN` | 5 | 强信号 |
| `JOIN ON a.col = b.col` | 3 | 两侧列都加分 |
| `ORDER BY col` | 2 | 排序需要有序索引 |
| `GROUP BY col` | 2 | 分组同上 |

5. **时间权重**:每条 SQL `count × min(perMs/avgMs, MAX_TIME_MULTIPLIER=5)`,避免一两条慢 SQL 把整张表淹没
6. **多表 SQL** 必须带别名才认裸列;**单表 SQL** 才允许裸列名
7. **过滤已有索引**:`isCovered(table, cols, known)` 按"已存在索引前缀完全包含建议列"判断,命中则跳过
8. **复合建议**:每张表前 3 个高分列两两配对,生成双列复合索引建议

### DDL 生成

```ts
function buildDdl(table, columns, dialect) {
  const idxName = `idx_${sanitize(table)}_${cols.map(sanitize).join('_')}`.slice(0, 60)
  return `CREATE INDEX ${quoteIdent(idxName)} ON ${quoteIdent(table)}(${cols.map(quoteIdent).join(', ')});`
}
```

MySQL 用反引号 \``\`,PG 用双引号 `"`。

### UI 流程

弹窗打开自动 `run()`:扫描 → 列出候选(按 `scoreEstimate` 降序)。每行:

- `[采用]` 按钮 → `emit('runSql', h.ddl)` 把 DDL 抛给 QueryPane(用户审完点执行)
- `[复制全部]` 一次性把所有候选 DDL 复制到剪贴板
- `[重新扫描]` 重跑流程

仅支持 MySQL 家族 / PG 家族,其它方言显示"暂不支持"。

---

## 3. 数据探查 — DataInspector

表右键 `🔬 数据探查`。一张对话框 5 个 tab,覆盖"看数据健康度 + 一键维护"的 DBA 排障核心动作。**设计上不并发跑 SQL**(怕拉爆生产):用户点哪个 tab 才拉哪个 tab 的数据。

### Tab 1:列采样(A3)

挑一列,一条 SQL 跑完所有统计:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(col) AS non_null,
  COUNT(DISTINCT col) AS distinct_cnt,
  MIN(col) AS min_val,
  MAX(col) AS max_val
FROM <table>
```

再跑一条 top-10:

```sql
SELECT col AS value, COUNT(*) AS cnt
FROM <table> GROUP BY col ORDER BY cnt DESC LIMIT 10
```

卡片化展示统计 + top-N 表格。NULL 率高 / distinct 极低(可能是状态码)/ 极值异常一眼能看出。

### Tab 2:整表剖析(B6)

一条大 SELECT 给所有列同时算 `COUNT(col)` + `COUNT(DISTINCT col)`:

```sql
SELECT COUNT(*) AS total,
       COUNT(`a`) AS nn_a, COUNT(DISTINCT `a`) AS dc_a,
       COUNT(`b`) AS nn_b, COUNT(DISTINCT `b`) AS dc_b,
       ...
FROM <table>
```

输出表:`列名 | 类型 | NULL% | DISTINCT/总数`。NULL% > 50 标黄,提醒"这列可能根本没在用"。

### Tab 3:约束扫描(B5)

按表的 `IS_NULLABLE = 'NO'` 列出"声明 NOT NULL"的列,然后对每列跑 `SELECT COUNT(*) WHERE col IS NULL`。命中 > 0 的视为**违反约束**(往往是早年没加 NOT NULL,后来补了但脏数据没清)。

### Tab 4:类型优化建议(B9)

按列分类型策略给收缩建议:

| 当前类型 | 检查 | 建议 |
|---|---|---|
| `VARCHAR(255)` | `MAX(CHAR_LENGTH(col))` 实际 max | `VARCHAR(max(32, ceil(maxlen*1.5)))`,若 declared > maxlen*4 且差 > 50 |
| `BIGINT` | `MAX(ABS(col))` | 若 < 2³¹-1 → `INT` |
| `INT` | 同上 | 若 < 32767 → `SMALLINT` |

每条建议给出原因(`实际最大长度 20,声明 255 浪费了 235 字节`)。

### Tab 5:表维护(B10)

按方言提供四个一键按钮:

| 方言 | 按钮 |
|---|---|
| MySQL 家族 | `ANALYZE TABLE` / `OPTIMIZE TABLE` / `CHECK TABLE` |
| PG 家族 | `ANALYZE` / `VACUUM FULL` / `VACUUM` / `REINDEX TABLE` |

每次执行带二次确认(VACUUM FULL 会锁表)。

---

## 4. 数据修整 — DataFixup

表右键 `🩹 数据修整`。3 个 tab,共用"输入条件 → 生成 SQL → 用户审阅 → 执行"四步骨架。**不直接 commit**,把生成的 SQL 抛给 QueryPane 当 pending 让用户检查。

### Tab 1:重复行检测(B3)

勾几列当**业务键**(`email + tenant_id`),先跑 GROUP BY 看哪些组重复:

```sql
SELECT col1, col2, COUNT(*) AS cnt
FROM <table>
GROUP BY col1, col2 HAVING COUNT(*) > 1
ORDER BY cnt DESC LIMIT 100
```

确认有重复后,点 `生成清理 SQL` 拿到一段带 `ROW_NUMBER()` 的窗口删除语句(PG 版),并注释里给出 MySQL 自连接版本作为备选:

```sql
-- 留每组里 ROW_NUMBER() = 1 的那条,删其余
DELETE FROM <table>
WHERE (col1, col2, ctid) IN (
  SELECT col1, col2, ctid FROM (
    SELECT col1, col2, ctid,
           ROW_NUMBER() OVER (PARTITION BY col1, col2 ORDER BY ctid) AS rn
    FROM <table>
  ) sub WHERE sub.rn > 1
);
```

### Tab 2:NULL 回填(B4)

挑一列 + 策略:

| 策略 | 生成的 SET 表达式 |
|---|---|
| `literal` | `'<用户填的值>'` |
| `avg` | `(SELECT AVG(col) FROM <table>)` |
| `min` / `max` | `(SELECT MIN/MAX(col) FROM <table>)` |
| `most_common` | `(SELECT col GROUP BY col ORDER BY COUNT(*) DESC LIMIT 1)` |

最终生成 `UPDATE <table> SET col = <expr> WHERE col IS NULL;`,注释里加一句"建议先 SELECT COUNT 看影响数"。

### Tab 3:软删恢复(B8)

启发式扫列名找软删字段(`deleted_at` / `is_deleted` / `deleted`)。根据列名是布尔型还是时间戳生成对应的复活语句:

| 列名 | 生成 |
|---|---|
| `is_deleted` / `*_flag` | `UPDATE ... SET col = FALSE WHERE col = TRUE` |
| `deleted_at` / 其他时间戳 | `UPDATE ... SET col = NULL WHERE col IS NOT NULL` |

可选填"额外 WHERE"(`AND user_id = 42`)限定范围,避免一次性把所有软删全复活。

---

## 5. 跨表搜值 — SearchValueDialog

`⌘K → 跨表搜索` 或在结果集单元格上右键 `🔎 找这个值还出现在哪`(后者会自动 prefill)。

### 工作流

1. **拉所有"可搜"字符列**(`information_schema.columns`):
   - MySQL:`varchar / char / text / tinytext / mediumtext / longtext / json`
   - PG:`character varying / character / text / json / jsonb`
2. **按表分组**:每张表生成一条 `SELECT * FROM t WHERE col1 LIKE :v OR col2 LIKE :v ... LIMIT 50`
3. **并发跑**(同时 max 6 条,防连接池打满)
4. **进度条** + 命中列表

### 性能边界

大库可能有几千列,搜前用 `table_prefix` 过滤范围(`user_*`)。`matchMode` 可选 `contains` / `exact`:

- `contains` → `LIKE '%v%'`(慢但全)
- `exact` → `= 'v'`(快,适合精确查 ID)

`maxPerTable` 限制每张表最多 50 条命中,避免某张大宽表把内存撑爆。

### 用法示例

线上排查"为什么用户 `alice@x.com` 收到推送":

1. ⌘K → 跨表搜索
2. 值填 `alice@x.com`,模式 `exact`
3. 一次扫所有库,看到 `users(email)` + `subscription(email)` + `mail_logs(to_addr)` 都有它 → 锁定数据流

---

## 6. 行变更历史 — RowHistoryDialog

结果集中选中一行右键 `⏱ 看历史版本`。

### 启发式找影子表

给定一行的 PK(`{id: 42}`),自动扫 `information_schema.tables` 找候选影子表:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE '<base>_%'
   OR table_name = 'audit_<base>'
   OR table_name = '<base>_history'
```

用户在下拉(`<datalist>`)里挑或手动输入。

### 拉历史

按 PK 过滤,按 `changed_at / updated_at / created_at / version / revision` 降序排:

```sql
SELECT * FROM <shadowTable>
WHERE id = 42
ORDER BY changed_at, updated_at, created_at, version, revision DESC
LIMIT 200
```

输出表格里每行是一个版本,列名是影子表原始列,字符串字段截断到 80 字。

---

## 7. 可视化查询构造器 — VisualQueryDialog

`⌘K → 可视化查询` 或库节点右键 `🎨 可视化构造`。

**MVP 不做拖拽画布** —— 走更稳的"列表 + 卡片"布局,真正能用而不只是 demo。

### 布局

| 区域 | 内容 |
|---|---|
| 左侧 | 当前库所有表 + 搜索框 + 复选 |
| 中间 | 已勾选表展开成卡片,每列前面有复选(勾的进 SELECT,不勾的展示) |
| 顶部 | WHERE / ORDER BY 输入框 + `LIMIT` 数字框 |
| 底部 | 实时生成的 SQL + `打开为新查询 tab` 按钮 |

### 自动 JOIN

勾选两张表时自动检测两边的"外键样列",生成 `INNER JOIN`:

```ts
// inferConventionalFks
const m = /^(.+?)_id$|^(.+?)Id$/.exec(col.name)
// user_id → users.id  /  category_id → categories.id
```

候选目标表:`<base>` 原样 + 简单复数(`user → users`,`category → categories`)。找不到 FK 路径就降级 `CROSS JOIN`(给用户视觉提示注意效率)。

### SQL 生成

```sql
SELECT users.id AS users_id, users.name AS users_name,
       orders.id AS orders_id, orders.amount AS orders_amount
FROM users
  INNER JOIN orders ON users.id = orders.user_id
WHERE amount > 100
ORDER BY users.id DESC
LIMIT 200
```

列名加 `<table>_<col>` 别名,避免多表同名列冲突。

---

## 8. MPP 分区管理 — MppPartitionDialog

适用 Doris / StarRocks(MySQL 协议系)。库节点右键 `🗂 分区管理`。

### 字段

调 `SHOW PARTITIONS FROM <db>.<tbl>`,展示:

| 字段 | 含义 |
|---|---|
| `PartitionId` / `PartitionName` | 分区元信息 |
| `State` | NORMAL / 等 |
| `PartitionKey` / `Range` | 分区列与范围 |
| `DistributionKey` / `Buckets` | 分桶键与数量 |
| `ReplicationNum` | 副本数 |
| `StorageMedium` | HDD / SSD |
| `CooldownTime` | 冷却时间(HDD 降级) |
| `DataSize` | 分区数据量(自动格式化 KB/MB/GB) |

### 操作

| 按钮 | 行为 |
|---|---|
| `+ 新增分区` | 弹框输入 `ADD PARTITION ...` 子句,自动拼 `ALTER TABLE <db>.<tbl>` 前缀 |
| 每行 `DROP` | 二次确认后 `ALTER TABLE <db>.<tbl> DROP PARTITION <name>` |
| `🔄 刷新` | 重跑 SHOW PARTITIONS |

---

## 9. 方言专属高级

### 9.1 MysqlAdvancedDialog

适配 MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks。3 tab:

| Tab | 用到的 SQL |
|---|---|
| **Binlog** | `SHOW MASTER STATUS` + `SHOW BINARY LOGS` + 选中文件后 `SHOW BINLOG EVENTS IN '<file>' LIMIT N` |
| **主从状态** | 优先 `SHOW REPLICA STATUS`(8.0+),失败 fallback `SHOW SLAVE STATUS`(MariaDB / 旧版) |
| **变量 / 状态** | `SHOW GLOBAL VARIABLES` / `SHOW GLOBAL STATUS`,带过滤;Variables 还能 `SET GLOBAL k = v` 改运行时参数 |

### 9.2 PgAdvancedDialog

适配 PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift。3 tab:

| Tab | 数据源 |
|---|---|
| **Extensions** | `pg_available_extensions`;一键 `CREATE EXTENSION IF NOT EXISTS "<name>" WITH SCHEMA "<schema>"` / `DROP EXTENSION` |
| **Publications / Subscriptions** | `pg_publication` + `pg_publication_tables` + `pg_subscription`(逻辑复制管理) |
| **Slots** | `pg_replication_slots`(slot_name / plugin / slot_type / active / restart_lsn / confirmed_flush_lsn / wal_status);可 `DROP_REPLICATION_SLOT` |

### 9.3 ClickHouseAdvancedDialog

4 tab,全部读 `system.*`,只读为主:

| Tab | 数据源 | 用途 |
|---|---|---|
| **分区** | `system.parts` (active 过滤) | 看 `rows / bytes_on_disk / data_compressed_bytes / marks / min_date / max_date / level`;支持 `DROP / DETACH / ATTACH PARTITION` |
| **Mutation** | `system.mutations` | 看 `is_done / command / parts_to_do / latest_failed_part / latest_fail_reason` |
| **副本** | `system.replicas` | 看 `is_leader / queue_size / inserts_in_queue / merges_in_queue / total_replicas / active_replicas / zookeeper_path` |
| **表 metadata** | `system.tables` | 看 `engine / total_rows / total_bytes / partition_key / sorting_key / primary_key / sampling_key / storage_policy` |

所有 tab 顶部都有 `database / table` 过滤框,大集群必备。

---

## 10. Oracle → DM(达梦)迁移向导

信创外包高频场景:把客户 Oracle 库整体迁去达梦。`⌘K → Oracle → DM 迁移` 打开向导。

### 5 步流程

| 步 | 行为 |
|---|---|
| 1. **选连接** | 从已配置连接里筛 `dialect == Oracle` / `dialect == DM`,左右各选一个 |
| 2. **选对象** | 拉源库 `tables / views / sequences / procedures` 四组,默认全选,可按组 / 单条勾选 |
| 3. **预览** | 每个对象用 `DBMS_METADATA.GET_DDL` 拉源 DDL → `translateDdl()` 翻译 → 显示 warnings + 允许编辑 |
| 4. **执行** | 逐对象 `client.connections.execute(dstConnId, ddl)`,错误收集不中断 |
| 5. **报告** | Markdown 总结成败 + warnings,可复制 / saveText 落盘 |

### 翻译规则(`oracleToDm.ts`)

**类型映射**(`TYPE_MAP`):

| Oracle | DM | 备注 |
|---|---|---|
| `VARCHAR2` | `VARCHAR` | — |
| `NVARCHAR2` | `NVARCHAR` | — |
| `NUMBER` | `NUMERIC` | DM 也认 NUMBER,但 NUMERIC 更标准 |
| `CLOB` / `NCLOB` / `BLOB` | 同名保留 | — |
| `DATE` | `DATE` | ⚠ Oracle 含时分秒,DM 不含 |
| `TIMESTAMP` | `TIMESTAMP` | — |
| `RAW` / `LONG RAW` | `VARBINARY` | — |
| `LONG` | `CLOB` | Oracle 已废弃 |
| `BINARY_FLOAT` / `BINARY_DOUBLE` | `FLOAT` / `DOUBLE` | — |
| `ROWID` / `UROWID` | `VARCHAR(18)` / `VARCHAR(4000)` | DM 无等价,降级 |
| `XMLTYPE` | `XML` | XPath/XQuery 表达式可能要重写 |

**类型替换实现**:按"长键在前"排序匹配(`LONG RAW` 排 `LONG` 前面避免被抢);裸 `NUMBER` 无长度时不补;`NUMBER(p,s)` 直接搬数字;命中后追加对应 `TYPE_NOTES` 警告。

**函数 / 关键字映射**(`FN_MAP`):

| Oracle | DM | 备注 |
|---|---|---|
| `SYSDATE` / `SYSTIMESTAMP` | `CURRENT_TIMESTAMP` | DM 也接受 SYSDATE,标准函数更稳 |
| `NVL(a, b)` | `COALESCE(a, b)` | DM 兼容 NVL,COALESCE 更跨库 |
| `NVL2(...)` | 保留 | 若不支持需 `CASE WHEN expr IS NOT NULL THEN a ELSE b END` |
| `MINUS` | `EXCEPT` | DM 兼容 MINUS,EXCEPT 更标准 |
| `DUAL` / `ROWNUM` | 同名保留 | DM 支持 |

**复杂语法告警**(`HARD_WARNINGS`,SQL 不动,只发 `[review]` 警告):

| 模式 | 警告内容 |
|---|---|
| `DECODE(...)` | 仍可用,但建议改 `CASE WHEN` 以提可读性 |
| `CONNECT BY` | 兼容大部分;`NOCYCLE` / `SYS_CONNECT_BY_PATH` 等高级特性需逐句复核 |
| `MERGE INTO` | 复杂分支(含 `DELETE WHERE` / 多源 `UPDATE`)行为可能不一致 |
| `INSTEAD OF (INSERT/UPDATE/DELETE) TRIGGER` | DM 触发器语义有差异,触发器体需人工迁移 |
| `SDO_GEOMETRY` / `MDSYS.*` | Oracle Spatial 无等价,需 DMGeo 或第三方 |
| `DBMS_*` | 仅模拟部分(`DBMS_OUTPUT`/`DBMS_LOB`),业务包需重写 |
| `UTL_*`(`UTL_HTTP`/`UTL_FILE` 等) | 一般不支持,需外部脚本替代 |
| `INTERVAL YEAR/DAY TO ...` | 部分版本只支持简化形式,需核对版本 |
| `PIVOT(...)` / `UNPIVOT(...)` | DM 8.x 起部分支持,旧版本需改写为 `CASE WHEN` 聚合 |
| `BULK COLLECT` / `FORALL` | PL/SQL 批量操作,DMSQL 语法略有差异 |

### 故意不做的事

- **不做 PL/SQL 块语义翻译** — 存储过程仅迁 CREATE 壳,函数体让用户人工
- **不做触发器内容翻译** — 同上
- **不解约束依赖排序** — 字典序;失败让用户重跑
- **不做事务原子性** — 每对象独立,失败用红色标记

### 数据迁移(实验性)

Step 4 勾"含数据迁移(每表前 100 行示例)":

```sql
-- 源
SELECT * FROM "<table>"  -- 限 100 行

-- 目标
INSERT INTO "<table>" (col1, col2, ...) VALUES (v1, v2, ...)  -- 逐行
```

只是个**骨架** —— 完整迁移需要分页 + 类型转换 + 批量插入,本向导留给后续。生产环境的全量数据迁移建议走 DTS / `expdp + impdp` 之类专业工具。

### 报告

执行完进 Step 5,Markdown 报告示例:

```markdown
# Oracle → DM 迁移报告

- 源连接: `prod-oracle`
- 目标连接: `dm-test`
- 时间: 2026-05-30 10:23:11
- 总对象数: 142,成功 138,失败 4

## 成功对象
- [tables] ORDERS (124ms)
- [tables] USERS (89ms)
...

## 失败对象
- [procedures] CALC_BONUS
  - 错误: ORA-00942 表或视图不存在

## 翻译警告(人工 review)
- (ORDERS) [type] DATE: Oracle DATE 含时分秒,DM DATE 不含;原列若依赖时间分量请改用 TIMESTAMP
- (ORDERS_REPORT) [review] PIVOT/UNPIVOT:DM 8.x 起部分支持,旧版本需改写为 CASE WHEN 聚合
```

`复制` 到剪贴板或 `保存` 到 `.md` 文件存档。

---

## 11. 何时该用哪个?

最后给一张"对症下药"表:

| 我想…… | 用这个 |
|---|---|
| 看一条慢 SQL 卡哪了 | **PlanPanel** + ANALYZE |
| 不知道该建什么索引 | **IndexRecommender** |
| 看一张新接手的表健康度 | **DataInspector** 整表剖析 + 类型优化 |
| 清掉脏数据 / 重复行 | **DataFixup** |
| 排查某个值出现在哪 | **SearchValueDialog** |
| 看一行的修改历史 | **RowHistoryDialog** |
| 给非技术同事演示建查询 | **VisualQueryDialog** |
| 管 Doris 分区 | **MppPartitionDialog** |
| 看 MySQL binlog / 主从延迟 | **MysqlAdvancedDialog** |
| 装 PG 扩展 / 配逻辑复制 | **PgAdvancedDialog** |
| 看 CH part / Mutation 状态 | **ClickHouseAdvancedDialog** |
| Oracle 库迁达梦 | **OracleToDmWizard** |

这些功能配合 [AI 助手](./ai) 用威力翻倍 —— 比如 PlanPanel 看到慢节点直接"问 AI",IndexRecommender 看不懂候选时让 AI 解释,DataInspector 类型建议让 AI 评估风险。
