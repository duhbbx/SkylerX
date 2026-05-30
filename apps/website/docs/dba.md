# DBA 与监控

SkylerX 把 DBA 排障常用的几张「实时视图」做成内置面板:进程列表 / 长事务 / 锁等待 / 复制延迟 / 慢查询 Top N / 服务器指标 / 集群拓扑 / 权限。

所有面板都**直接对目标连接执行 SQL**(不走中间 agent),没有额外采集器,也不会修改数据库配置。每个面板的取数语句和方言路由都可以从源码 `packages/ui/src/components/*Dialog.vue` 里逐字校对。

## 入口一览

DBA 类功能没有独立菜单,统一通过**命令面板**触发:`⌘K` / `Ctrl+K` 打开,搜面板名即可。涉及具体连接的(如「服务器活动」「慢查询」「复制延迟」「OB 拓扑」)会按每个已注册连接生成一条命令,选哪条就连到哪个库。

| 面板 | 命令面板关键字 | 入口 id |
|---|---|---|
| 服务器活动 | `服务器活动 / Server activity` | `act:activity:<connId>` |
| 复制延迟 | `复制延迟 / Replication lag` | `act:repl:<connId>` |
| 慢查询日志分析 | `慢查询 / Slow query` | `act:slowq:<connId>` |
| 操作日志 | `操作日志 / Operation log` | `act:oplog` |
| 服务器监控 | `服务器监控 / Server monitor` | `act:monitor` |
| OceanBase 集群拓扑 | `OceanBase` | `act:obtopo:<connId>` |
| 用户与权限 | `用户与权限 / Users & privileges` | `act:privileges` |

打开命令面板的快捷键由 `DEFAULT_KEY_BINDINGS.palette = 'CmdOrCtrl+K'` 定义,可在「设置 → 自定义快捷键」改。

---

## 服务器活动

`ServerActivityDialog.vue` — 标题 `服务器活动 · {conn}`。包含 3 个 Tab,顶部有「刷新」按钮 + 自动刷新下拉(2s / 5s / 10s / 关)。

### 三个面板

#### 进程列表(`tabProcesses`)

| 方言族 | 取数 SQL |
|---|---|
| MySQL | `information_schema.PROCESSLIST WHERE COMMAND <> 'Sleep' ORDER BY TIME DESC` |
| PostgreSQL | `pg_stat_activity WHERE state IS NOT NULL AND pid <> pg_backend_pid()` |
| SQL Server | `sys.dm_exec_sessions` JOIN `sys.dm_exec_requests` + `OUTER APPLY sys.dm_exec_sql_text(r.sql_handle)` |

字段在 SQL 层做了列名归一(`id / user / host / db / time / state / info`),三方言渲染表头一致。

#### 长事务(`tabLongTx`)

| 方言族 | 取数 SQL |
|---|---|
| MySQL | `information_schema.INNODB_TRX ORDER BY trx_started ASC`(返回 `rows_locked / rows_modified`) |
| PostgreSQL | `pg_stat_activity WHERE xact_start IS NOT NULL` |
| SQL Server | `sys.dm_tran_active_transactions` JOIN `sys.dm_tran_session_transactions` |

#### 锁等待(`tabLocks`)

| 方言族 | 取数 SQL |
|---|---|
| MySQL | `performance_schema.data_lock_waits` |
| PostgreSQL | `pg_locks` JOIN `pg_stat_activity` 的「blocked / blocking」自联结 |
| SQL Server | `sys.dm_tran_locks WHERE request_status = 'WAIT'` |

### KILL 操作

进程列表 / 长事务这两个 Tab 每行右侧有 `✗ KILL` 按钮,点击会弹「终止会话 / 事务」确认框,确认后按方言执行:

| 方言族 | KILL 语句 |
|---|---|
| MySQL | `KILL <id>` |
| PostgreSQL | `SELECT pg_terminate_backend(<pid>)` |
| SQL Server | `KILL <spid>` |

锁等待 Tab 不提供 KILL(锁等待往往是 blocker 在阻塞,要去进程列表里 kill blocker)。

### 方言适配规则

入口走 `familyOfConn()`:先 `dialectKind` 判 NoSQL → 直接拒绝(`'NoSQL 方言不适用本面板'`);否则用 `ddl.familyOf(dialect)`:

- **MySQL 家族** 直接命中 → MariaDB / TiDB / OceanBase / Doris / StarRocks
- **PG 家族** 复用 PG 分支 → CockroachDB / Greenplum / OpenGauss / KingbaseES / H2(`ddl.ts` 把 H2 也归到 pg)
- **SQL Server** → 走 mssql 分支
- 其它方言显示 `当前方言暂不支持此面板`

---

## 复制延迟监控

`ReplicationLagDialog.vue` — 标题 `主从复制延迟 · {conn}`。

顶部显示**方言 badge + 角色 + 自动刷新选项(默认 5s,可选 关 / 2s / 5s / 10s)**。角色分四种,SQL 层判定,UI 用颜色区分:

| 角色 | 来源判定 | UI 颜色 |
|---|---|---|
| 主库 (`source`) | MySQL: `SHOW REPLICAS` / `SHOW SLAVE HOSTS` / `SHOW BINARY LOG STATUS` 任一有行;PG: `pg_stat_replication` 有行;MSSQL: 本地 replica `role_desc = 'PRIMARY'` | 绿色 |
| 从库 (`replica`) | MySQL: `SHOW REPLICA STATUS` / `SHOW SLAVE STATUS` 有行;PG: `pg_is_in_recovery() = true`;MSSQL: 本地 `role_desc = 'SECONDARY'` | 蓝色 |
| 独立 (`standalone`) | 所有探测都空 | 灰色 |
| 未知 (`unknown`) | 不支持的方言 | 灰色 |

### 方言路由细节

#### MySQL 家族

四段回退,任一阶段拿到行就停:

1. `SHOW REPLICA STATUS`(MySQL 8.0.22+ 新名字)
2. `SHOW SLAVE STATUS`(老名字,兼容 5.7 / 8.0 < 22 / MariaDB)
3. 上面都空 → 试 `SHOW REPLICAS` 列出下游从库
4. 再退回 `SHOW BINARY LOG STATUS` / `SHOW MASTER STATUS`

返回列做了「关键列前置」投影:`Channel_Name / Source_Host / Replica_IO_Running / Seconds_Behind_Source / Last_Error` 等先排,其余追加在后。

#### PostgreSQL 家族

```sql
-- 1) 先判 standby
SELECT pg_is_in_recovery() AS is_replica
-- 2a) 从库视角
SELECT
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int AS lag_seconds,
  pg_last_wal_receive_lsn()::text,
  pg_last_wal_replay_lsn()::text
-- 2b) 主库视角
SELECT pid, application_name, state, sync_state,
  EXTRACT(EPOCH FROM write_lag)  AS write_lag_seconds,
  EXTRACT(EPOCH FROM flush_lag)  AS flush_lag_seconds,
  EXTRACT(EPOCH FROM replay_lag) AS replay_lag_seconds,
  sent_lsn, write_lsn, flush_lsn, replay_lsn
FROM pg_stat_replication
```

#### SQL Server(AOAG)

`sys.dm_hadr_database_replica_states` JOIN `sys.availability_replicas` + `sys.dm_hadr_availability_replica_states`,字段含 `synchronization_state_desc / synchronization_health_desc / log_send_queue_size / redo_queue_size / DATEDIFF(SECOND, last_commit_time, GETDATE()) AS lag_seconds`。

无 AOAG 配置就是 standalone。

### 着色阈值

代码常量:

```ts
const LAG_WARN   = 5    // 黄
const LAG_DANGER = 30   // 红
```

只对「lag 秒」类列上色,候选列名:`lag_seconds / Seconds_Behind_Source / Seconds_Behind_Master / replay_lag_seconds / write_lag_seconds / flush_lag_seconds`。

### 容错

`looksLikeNoReplication()` 把含 `not configured / not a slave / not a replica / no such / access denied / permission denied / privilege / does not exist` 的错误转成「未启用复制」的灰色提示,避免权限不足时整页红字。

`Last_Error / Last_IO_Error / Last_SQL_Error` 任一非空 → 顶部出红色 banner 单独高亮。

---

## 慢查询分析

`SlowQueryDialog.vue` + `slowQuery.ts` — 标题 `慢查询日志分析`。

工具只读不改配置:**不会替你 SET 任何变量**。是否启用、保留多久、采样阈值都属于 DBA 决策,SkylerX 只读你已经有的 digest 表。

### 数据源

| 方言族(`slowFamilyOf`) | 包含方言 | 数据源 |
|---|---|---|
| `mysql` | MySQL / MariaDB / TiDB / OceanBase / Doris / StarRocks | `performance_schema.events_statements_summary_by_digest` |
| `pg` | PostgreSQL / CockroachDB / Greenplum / OpenGauss / KingbaseES / Redshift | `pg_stat_statements` 扩展 |
| `other` | 其它 | 显示 `slowq.unsupported` |

> `slowFamilyOf()` 不复用 `ddl.familyOf()` ——后者把 H2 划进 pg、未收录 Redshift,与本模块的判定边界不同。

### 查询模板

#### MySQL — `events_statements_summary_by_digest`

```sql
SELECT
  DIGEST_TEXT AS sql_text,
  COUNT_STAR  AS exec_count,
  ROUND(AVG_TIMER_WAIT/1e9, 2) AS avg_ms,
  ROUND(SUM_TIMER_WAIT/1e9, 2) AS total_ms,
  ROUND(MAX_TIMER_WAIT/1e9, 2) AS max_ms,
  SUM_ROWS_EXAMINED AS rows_examined,
  SUM_ROWS_SENT     AS rows_sent,
  SUM_NO_INDEX_USED AS no_index_count,
  FIRST_SEEN, LAST_SEEN
FROM performance_schema.events_statements_summary_by_digest
WHERE (? IS NULL OR SCHEMA_NAME = ?)
ORDER BY <SUM_TIMER_WAIT | AVG_TIMER_WAIT | COUNT_STAR> DESC
LIMIT 50
```

`*_TIMER_WAIT` 单位是皮秒(10⁻¹² s),按 `/1e9` 换算成毫秒。`schema` 参数会被 connection.database 自动填入。

#### PostgreSQL — `pg_stat_statements`

```sql
SELECT
  query AS sql_text,
  calls AS exec_count,
  ROUND(mean_exec_time::numeric, 2)  AS avg_ms,
  ROUND(total_exec_time::numeric, 2) AS total_ms,
  ROUND(max_exec_time::numeric, 2)   AS max_ms,
  rows AS rows_sent,
  shared_blks_hit, shared_blks_read
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY <total_exec_time | mean_exec_time | calls> DESC NULLS LAST
LIMIT 50
```

### 排序、Top N、未启用提示

- 顶部「排序」下拉:总耗时 / 平均耗时 / 调用次数三选一,每次切换会**用新 `ORDER BY` 重跑**,而不是前端排序
- 默认 LIMIT 50,代码里 `Math.max(1, Math.min(500, limit))` 上限 500
- 启用探测:MySQL 用 `SHOW VARIABLES LIKE 'slow_query_log'`,PG 用 `SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'`
- 探测失败 → 替换列表为「未启用」提示,**带可粘贴的开启 SQL**(MySQL:`SET GLOBAL slow_query_log = ON; SET GLOBAL long_query_time = 1; …`;PG:`CREATE EXTENSION IF NOT EXISTS pg_stat_statements; …`)

### 行展开后的操作

点击某行展开,显示完整 SQL,提供 4 个按钮:

| 按钮 | 行为 |
|---|---|
| 复制 | `navigator.clipboard.writeText(sql)` |
| 打开为查询 | emit `openSql` → 父容器新建查询页 |
| 执行 EXPLAIN | 跑 `EXPLAIN <sql>`(去尾分号),结果就地内联渲染。**不开 ANALYZE**,避免误执行写操作 |
| AI 优化 | emit `optimizeWithAi` → 把 SQL 推给 AI 工具箱的「优化 SQL」任务 |

---

## 操作日志

`OperationLogDialog.vue` — 标题 `操作日志`。**SkylerX 本地审计**,不是数据库侧的 audit log。

进入时拉所有已注册连接,各取最近 200 条 `connections.history`,合并按 `executedAt` 倒序展示。每行包含:成功 / 失败 标记、执行时间、连接名、耗时(ms)、单行化 SQL 文本。

### 过滤

| 过滤维度 | 选项 |
|---|---|
| 状态 | 全部 / 成功 / 失败 |
| 连接 | 全部连接 / 指定单个连接 |
| 关键字 | SQL 文本 case-insensitive `includes` 匹配 |

### 导出

「导出 CSV」按当前过滤结果导出,文件名 `skylerx-operation-log.csv`,列:`time,connection,status,duration_ms,sql`。

点击任意一行 → emit `openSql(connId, sql)` 把这条 SQL 推到查询页(关闭对话框)。

---

## 集群拓扑

### 通用 ClusterTopologyDialog(TiDB / OceanBase)

`ClusterTopologyDialog.vue` —— 两个 Tab:**节点** / **TiKV Stores | Region/Tablet**(按方言切换名字)。

| 方言 | 节点 Tab | Regions Tab |
|---|---|---|
| TiDB | `information_schema.cluster_info`(tidb / tikv / pd / tiflash) | `information_schema.tikv_store_status`(`store_id, address, store_state_name, capacity, available, leader_count, region_count`) |
| OceanBase | `oceanbase.DBA_OB_SERVERS` | 先 `oceanbase.GV$OB_TABLET_TO_LS LIMIT 200`,失败 fallback 到 `oceanbase.DBA_OB_UNITS` |
| 其它 | `'该方言不支持集群拓扑视图'` | 同左 |

字节列(`capacity / available / size$`)前端按 1024 进位格式化成 KB / MB / GB / TB。

### OceanBase 专用拓扑

`OceanBaseTopologyDialog.vue` —— 标题 `OceanBase 集群拓扑`,只在连接方言为 OceanBase 时入口可见。

顶部 4 张计数卡(Zones / Observers / Tenants / Units) + 左侧 Zone → Observer 树 + 右侧 Tenant → Unit 列表(可点开)。4 张视图**并发查询**,失败时 banner 提示但保留上次成功的数据。

| 视图 | SQL |
|---|---|
| Zones | `SELECT zone, status, idc, region FROM oceanbase.DBA_OB_ZONES ORDER BY zone` |
| Observers | `SELECT svr_ip, svr_port, zone, status, with_rootserver, build_version, start_service_time FROM oceanbase.DBA_OB_SERVERS ORDER BY zone, svr_ip` |
| Tenants | `SELECT tenant_id, tenant_name, tenant_type, primary_zone, compatibility_mode, status, locked, locality FROM oceanbase.DBA_OB_TENANTS ORDER BY tenant_id` |
| Units | `SELECT unit_id, resource_pool_id, unit_group_id, tenant_id, zone, svr_ip, svr_port, status FROM oceanbase.DBA_OB_UNITS ORDER BY tenant_id, zone, svr_ip` |

状态着色:`ACTIVE / NORMAL` 绿、`INACTIVE / OFFLINE / DELETING` 红、其它黄。tenant_type 用 emoji 区分:👑 SYS / ⚙ META / 🏢 USER。点 observer 地址一键复制 `svr_ip:svr_port`。

自动刷新可选 关 / 5s / 10s / 30s(默认关)。

---

## 服务器监控

`ServerMonitorDialog.vue` — 标题 `服务器监控`。

下拉切换已注册连接(只对支持的方言可用),启动后 **2 秒一次 setInterval 轮询**,在内存里维护最多 60 个采样点的 sparkline。

### 方言支持

```ts
function fam(d) {
  if ([MySQL, MariaDB, OceanBase].includes(d)) return 'mysql'
  if ([PostgreSQL, KingbaseES].includes(d)) return 'pg'
  return 'other'
}
```

### MySQL 指标(走 `SHOW GLOBAL STATUS` + `SHOW VARIABLES LIKE 'max_connections'`)

| 卡片 | 来源 |
|---|---|
| 运行时长 | `Uptime`(格式化成 `Xd Yh Zm`) |
| QPS | (`Queries`/`Questions` 差值) ÷ 时间差 |
| 连接数 | `Threads_connected / max_connections` |
| 正在运行 | `Threads_running` |
| 慢查询 | `Slow_queries` |
| 拒绝连接 | `Aborted_connects` |

### PostgreSQL 指标(一条聚合 SQL)

```sql
SELECT
  (SELECT count(*) FROM pg_stat_activity) AS conns,
  (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') AS active,
  (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock') AS waiting,
  (SELECT sum(xact_commit + xact_rollback) FROM pg_stat_database) AS xacts,
  (SELECT sum(blks_hit) FROM pg_stat_database) AS hit,
  (SELECT sum(blks_read) FROM pg_stat_database) AS rd,
  extract(epoch FROM (now() - pg_postmaster_start_time()))::bigint AS uptime
```

卡片:运行时长 / TPS(xacts 差分)/ 连接数 / 正在运行 / 等待锁 / Buffer 命中率 `hit / (hit + rd) * 100%`。

底部 sparkline 标题随方言显示 `QPS` 或 `TPS`。

---

## 用户与权限

`PrivilegesDialog.vue` + `privileges.ts` — 标题 `用户与权限`。

左列用户/角色清单 + 右列「已有授权」/「构造 GRANT」。

### 方言支持

| 方言族 | 列出用户的 SQL | 查看授权的 SQL |
|---|---|---|
| MySQL(含 MariaDB / OceanBase) | `SELECT User, Host FROM mysql.user` | `SHOW GRANTS FOR 'usr'@'host'` |
| PostgreSQL(含 KingbaseES) | `SELECT rolname FROM pg_roles WHERE rolcanlogin` | `information_schema.role_table_grants` |
| Oracle(含 DM) | `SELECT username FROM all_users WHERE oracle_maintained = 'N'`(12c+) | `dba_sys_privs ∪ dba_role_privs ∪ dba_tab_privs` |
| SQL Server | `sys.database_principals WHERE type IN ('S','U','G')` | `sys.database_permissions` JOIN `sys.database_principals` |
| 其它 | 显示 `priv.unsupported` | 不支持 |

> Oracle 查授权用了 `dba_*` 视图,连接用户没 DBA 角色会报 ORA-00942,UI 会捕获并把错误信息显示在「已有授权」位置。

### GRANT 构造器

勾选权限 + 填目标 + 可选 `WITH GRANT OPTION` → 实时生成预览语句,例如:

```sql
GRANT SELECT, INSERT ON sales.orders TO 'app'@'%' WITH GRANT OPTION;
```

预置勾选项 `COMMON_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL PRIVILEGES']`。

被授权者按方言格式化:

| 方言 | grantee 格式 |
|---|---|
| MySQL | `'user'@'host'`(host 为空时填 `%`) |
| SQL Server | `[user]`(`]` 转义为 `]]`) |
| Oracle | `"USER"`(全大写,`"` 转义为 `""`) |
| 其它 | `"user"` |

### 不直接改

**SkylerX 不会替你执行 GRANT / REVOKE**。两个按钮:

- 复制 → 拷到剪贴板
- 打开为查询 → 推到查询页,你自己手动执行(走 SkylerX 的 SQL 执行通道,前面有[生产保护](/docs/connections#生产保护)拦截 prod 标记的连接)

`buildRevoke()` 也在 `privileges.ts` 内导出,但当前 UI 没有 REVOKE 构造表单,需要时直接改 GRANT 预览语句也可以。

---

## 兼容性矩阵

| 功能 | MySQL 家族 | PG 家族 | SQL Server | Oracle / DM | OceanBase | TiDB | NoSQL |
|---|---|---|---|---|---|---|---|
| 服务器活动:进程列表 | `information_schema.PROCESSLIST` | `pg_stat_activity` | `dm_exec_sessions` | — | 走 MySQL 分支 | 走 MySQL 分支 | 不适用 |
| 服务器活动:长事务 | `INNODB_TRX` | `pg_stat_activity` | `dm_tran_active_transactions` | — | 走 MySQL 分支 | 走 MySQL 分支 | — |
| 服务器活动:锁等待 | `data_lock_waits` | `pg_locks` | `dm_tran_locks` | — | 走 MySQL 分支 | 走 MySQL 分支 | — |
| KILL 操作 | `KILL <id>` | `pg_terminate_backend` | `KILL <spid>` | — | ✓ | ✓ | — |
| 复制延迟 | `SHOW REPLICA STATUS` 等 | `pg_stat_replication` / `pg_last_xact_replay_timestamp` | AOAG `dm_hadr_database_replica_states` | — | 走 MySQL 分支 | 走 MySQL 分支 | — |
| 慢查询 | `events_statements_summary_by_digest` | `pg_stat_statements` | — | — | ✓ | ✓ | — |
| 服务器监控 | `SHOW GLOBAL STATUS` | `pg_stat_*` 聚合 | — | — | 走 MySQL 分支(只含 KingbaseES 走 pg) | — | — |
| 集群拓扑 | — | — | — | — | `DBA_OB_*` | `cluster_info / tikv_store_status` | — |
| OB 拓扑(专用) | — | — | — | — | ✓ | — | — |
| 用户与权限 | `mysql.user` | `pg_roles` | `database_principals` | `all_users` + `dba_*` | 走 MySQL 分支 | 走 MySQL 分支 | — |
| 操作日志(本地) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

> **「走 X 分支」** 表示该方言被 `ddl.familyOf()`(或 `slowFamilyOf` / `fam()` 等)归入 X 家族,直接复用同一套 SQL,不保证所有版本的字典视图列名完全一致。Doris / StarRocks 协议兼容 MySQL,在慢查询面板上 FE 通常也暴露 `events_statements_summary_by_digest`,个别版本未暴露时会落到「未启用」的友好提示。

> **NoSQL(Redis / MongoDB / Elasticsearch)** 在服务器活动面板里被 `dialectKind(NoSql)` 短路掉,不会下发 SQL,而是给出「请用 ⚙ 服务器 → 客户端 / 慢日志」的提示。Redis 的实时监控在专门的 `RedisMonitorDialog`,不在本页范畴。
