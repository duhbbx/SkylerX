# DBA & Monitoring

SkylerX bakes the DBA's everyday "live views" into built-in panels: process list / long transactions / lock waits / replication lag / slow query Top N / server metrics / cluster topology / privileges.

All panels **run SQL directly against the target connection** — no extra agent, no DB config changes. Every SQL and dialect-routing decision is verifiable against the source under `packages/ui/src/components/*Dialog.vue`.

## Entry points

DBA features have no top-level menu — they're all behind the **command palette**: `⌘K` / `Ctrl+K` then search. Connection-scoped panels (Server activity, Slow query, Replication lag, OB topology) generate one entry per registered connection — picking one routes the panel to that database.

| Panel | Palette keyword | Entry id |
|---|---|---|
| Server activity | `Server activity` | `act:activity:<connId>` |
| Replication lag | `Replication lag` | `act:repl:<connId>` |
| Slow query analysis | `Slow query` | `act:slowq:<connId>` |
| Operation log | `Operation log` | `act:oplog` |
| Server monitor | `Server monitor` | `act:monitor` |
| OceanBase cluster topology | `OceanBase` | `act:obtopo:<connId>` |
| Users & privileges | `Users & privileges` | `act:privileges` |

Default palette shortcut: `DEFAULT_KEY_BINDINGS.palette = 'CmdOrCtrl+K'`; remappable under "Settings → Custom shortcuts".

---

## Server activity

`ServerActivityDialog.vue` — title `Server activity · {conn}`. Three tabs, plus a refresh button + auto-refresh dropdown at the top (2s / 5s / 10s / off).

### Three panes

#### Process list (`tabProcesses`)

| Dialect family | SQL |
|---|---|
| MySQL | `information_schema.PROCESSLIST WHERE COMMAND <> 'Sleep' ORDER BY TIME DESC` |
| PostgreSQL | `pg_stat_activity WHERE state IS NOT NULL AND pid <> pg_backend_pid()` |
| SQL Server | `sys.dm_exec_sessions` JOIN `sys.dm_exec_requests` + `OUTER APPLY sys.dm_exec_sql_text(r.sql_handle)` |

Column names are normalized in SQL (`id / user / host / db / time / state / info`) so the three dialects render with a consistent header.

#### Long transactions (`tabLongTx`)

| Dialect family | SQL |
|---|---|
| MySQL | `information_schema.INNODB_TRX ORDER BY trx_started ASC` (returns `rows_locked / rows_modified`) |
| PostgreSQL | `pg_stat_activity WHERE xact_start IS NOT NULL` |
| SQL Server | `sys.dm_tran_active_transactions` JOIN `sys.dm_tran_session_transactions` |

#### Lock waits (`tabLocks`)

| Dialect family | SQL |
|---|---|
| MySQL | `performance_schema.data_lock_waits` |
| PostgreSQL | `pg_locks` JOIN `pg_stat_activity` "blocked / blocking" self-join |
| SQL Server | `sys.dm_tran_locks WHERE request_status = 'WAIT'` |

### KILL action

The Process list and Long transactions tabs have an `✗ KILL` button per row. Click → confirm "Terminate session / transaction" → execute per dialect:

| Dialect family | KILL syntax |
|---|---|
| MySQL | `KILL <id>` |
| PostgreSQL | `SELECT pg_terminate_backend(<pid>)` |
| SQL Server | `KILL <spid>` |

Lock waits don't offer KILL (you usually want to kill the blocker, which lives in Process list).

### Dialect routing

Entry goes through `familyOfConn()`: first checks `dialectKind` for NoSQL → reject (`'NoSQL dialect not applicable here'`); else uses `ddl.familyOf(dialect)`:

- **MySQL family** direct hit → MariaDB / TiDB / OceanBase / Doris / StarRocks
- **PG family** reuses the PG branch → CockroachDB / Greenplum / OpenGauss / KingbaseES / H2 (`ddl.ts` groups H2 under PG)
- **SQL Server** → mssql branch
- Others show "this dialect is not supported"

---

## Replication lag

`ReplicationLagDialog.vue` — title `Primary/replica lag · {conn}`.

The top shows a **dialect badge + role + auto-refresh (5s default; off / 2s / 5s / 10s)**. Four roles, determined in SQL, color-coded:

| Role | Detection | Color |
|---|---|---|
| Primary (`source`) | MySQL: any row from `SHOW REPLICAS` / `SHOW SLAVE HOSTS` / `SHOW BINARY LOG STATUS`; PG: rows in `pg_stat_replication`; MSSQL: local replica `role_desc = 'PRIMARY'` | Green |
| Replica (`replica`) | MySQL: rows in `SHOW REPLICA STATUS` / `SHOW SLAVE STATUS`; PG: `pg_is_in_recovery() = true`; MSSQL: local `role_desc = 'SECONDARY'` | Blue |
| Standalone (`standalone`) | All probes empty | Grey |
| Unknown (`unknown`) | Unsupported dialect | Grey |

### Dialect routing details

#### MySQL family

Four-step fallback; the first step with rows wins:

1. `SHOW REPLICA STATUS` (MySQL 8.0.22+ new name)
2. `SHOW SLAVE STATUS` (old name; 5.7 / 8.0 < 22 / MariaDB)
3. Both empty → try `SHOW REPLICAS` to list downstream replicas
4. Fall back to `SHOW BINARY LOG STATUS` / `SHOW MASTER STATUS`

Returned columns are reordered so the important ones come first: `Channel_Name / Source_Host / Replica_IO_Running / Seconds_Behind_Source / Last_Error` etc.

#### PostgreSQL family

```sql
-- 1) standby?
SELECT pg_is_in_recovery() AS is_replica
-- 2a) replica view
SELECT
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int AS lag_seconds,
  pg_last_wal_receive_lsn()::text,
  pg_last_wal_replay_lsn()::text
-- 2b) primary view
SELECT pid, application_name, state, sync_state,
  EXTRACT(EPOCH FROM write_lag)  AS write_lag_seconds,
  EXTRACT(EPOCH FROM flush_lag)  AS flush_lag_seconds,
  EXTRACT(EPOCH FROM replay_lag) AS replay_lag_seconds,
  sent_lsn, write_lsn, flush_lsn, replay_lsn
FROM pg_stat_replication
```

#### SQL Server (AOAG)

`sys.dm_hadr_database_replica_states` JOIN `sys.availability_replicas` + `sys.dm_hadr_availability_replica_states`. Includes `synchronization_state_desc / synchronization_health_desc / log_send_queue_size / redo_queue_size / DATEDIFF(SECOND, last_commit_time, GETDATE()) AS lag_seconds`.

Without AOAG configured, the role is standalone.

### Color thresholds

Constants in code:

```ts
const LAG_WARN   = 5    // yellow
const LAG_DANGER = 30   // red
```

Coloring only applies to lag-second columns: `lag_seconds / Seconds_Behind_Source / Seconds_Behind_Master / replay_lag_seconds / write_lag_seconds / flush_lag_seconds`.

### Error tolerance

`looksLikeNoReplication()` translates errors containing `not configured / not a slave / not a replica / no such / access denied / permission denied / privilege / does not exist` into a grey "replication not enabled" notice — avoids a sea of red on permission issues.

`Last_Error / Last_IO_Error / Last_SQL_Error` non-empty → a red banner at the top.

---

## Slow query analysis

`SlowQueryDialog.vue` + `slowQuery.ts` — title `Slow query analysis`.

This tool is read-only — **it doesn't `SET` any variables for you**. Whether slow logging is enabled, how long the retention is, and the sampling threshold are DBA decisions; SkylerX just reads what's already there.

### Data sources

| Family (`slowFamilyOf`) | Dialects | Source |
|---|---|---|
| `mysql` | MySQL / MariaDB / TiDB / OceanBase / Doris / StarRocks | `performance_schema.events_statements_summary_by_digest` |
| `pg` | PostgreSQL / CockroachDB / Greenplum / OpenGauss / KingbaseES / Redshift | `pg_stat_statements` extension |
| `other` | Others | Shows `slowq.unsupported` |

> `slowFamilyOf()` does not reuse `ddl.familyOf()` — the latter puts H2 under pg and excludes Redshift, which doesn't match the boundaries this module needs.

### Query templates

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

`*_TIMER_WAIT` is in picoseconds (10⁻¹² s); we `/1e9` to get ms. The `schema` param is auto-filled with `connection.database`.

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

### Sort, Top N, "not enabled" hint

- "Sort by" dropdown at the top: total time / average time / call count — each change **re-runs the query with a new `ORDER BY`**, not a frontend sort
- Default LIMIT 50; code caps at `Math.max(1, Math.min(500, limit))`
- Enablement probe: MySQL `SHOW VARIABLES LIKE 'slow_query_log'`, PG `SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'`
- Probe fails → the list is replaced with a "not enabled" notice **with copy-pasteable enable SQL** (MySQL: `SET GLOBAL slow_query_log = ON; SET GLOBAL long_query_time = 1; …`; PG: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements; …`)

### Row expansion actions

Click a row to expand → full SQL + 4 buttons:

| Button | Action |
|---|---|
| Copy | `navigator.clipboard.writeText(sql)` |
| Open as query | emit `openSql` → parent opens a new query tab |
| Run EXPLAIN | Runs `EXPLAIN <sql>` (without trailing `;`); result rendered inline. **Does not ANALYZE** to avoid accidentally writing |
| AI optimize | emit `optimizeWithAi` → pushes the SQL into the AI Toolbox's "optimize SQL" task |

---

## Operation log

`OperationLogDialog.vue` — title `Operation log`. **SkylerX's local audit log**, not the DB's audit log.

On open, pulls all registered connections and grabs the last 200 entries each from `connections.history`, then merges by `executedAt` desc. Each row: success/failure mark + execution time + connection name + duration (ms) + single-line SQL.

### Filters

| Filter | Options |
|---|---|
| Status | All / Success / Failure |
| Connection | All / a specific connection |
| Keyword | Case-insensitive substring on SQL text |

### Export

"Export CSV" exports the current filtered list as `skylerx-operation-log.csv` with columns: `time, connection, status, duration_ms, sql`.

Click a row → emit `openSql(connId, sql)` to push the SQL into a query tab (closes the dialog).

---

## Cluster topology

### Generic ClusterTopologyDialog (TiDB / OceanBase)

`ClusterTopologyDialog.vue` — two tabs: **Nodes** / **TiKV Stores | Region/Tablet** (name switches per dialect).

| Dialect | Nodes tab | Regions tab |
|---|---|---|
| TiDB | `information_schema.cluster_info` (tidb / tikv / pd / tiflash) | `information_schema.tikv_store_status` (`store_id, address, store_state_name, capacity, available, leader_count, region_count`) |
| OceanBase | `oceanbase.DBA_OB_SERVERS` | First `oceanbase.GV$OB_TABLET_TO_LS LIMIT 200`; on failure fall back to `oceanbase.DBA_OB_UNITS` |
| Others | `'Cluster topology not supported for this dialect'` | Same |

Byte columns (`capacity / available / size$`) are formatted in the UI as KB / MB / GB / TB.

### OceanBase-specific topology

`OceanBaseTopologyDialog.vue` — title `OceanBase cluster topology`; entry visible only when the connection dialect is OceanBase.

Top: 4 count cards (Zones / Observers / Tenants / Units). Left: Zone → Observer tree. Right: Tenant → Unit list (expandable). All four views fetch **in parallel**; on failure a banner appears but the previously successful data stays visible.

| View | SQL |
|---|---|
| Zones | `SELECT zone, status, idc, region FROM oceanbase.DBA_OB_ZONES ORDER BY zone` |
| Observers | `SELECT svr_ip, svr_port, zone, status, with_rootserver, build_version, start_service_time FROM oceanbase.DBA_OB_SERVERS ORDER BY zone, svr_ip` |
| Tenants | `SELECT tenant_id, tenant_name, tenant_type, primary_zone, compatibility_mode, status, locked, locality FROM oceanbase.DBA_OB_TENANTS ORDER BY tenant_id` |
| Units | `SELECT unit_id, resource_pool_id, unit_group_id, tenant_id, zone, svr_ip, svr_port, status FROM oceanbase.DBA_OB_UNITS ORDER BY tenant_id, zone, svr_ip` |

Status colors: `ACTIVE / NORMAL` green, `INACTIVE / OFFLINE / DELETING` red, others yellow. `tenant_type` uses emoji: 👑 SYS / ⚙ META / 🏢 USER. Click an observer to copy `svr_ip:svr_port`.

Auto-refresh: off / 5s / 10s / 30s (default off).

---

## Server monitor

`ServerMonitorDialog.vue` — title `Server monitor`.

A dropdown switches between supported registered connections. Once started, **polls every 2 seconds** via setInterval and keeps a 60-point sparkline in memory.

### Dialect support

```ts
function fam(d) {
  if ([MySQL, MariaDB, OceanBase].includes(d)) return 'mysql'
  if ([PostgreSQL, KingbaseES].includes(d)) return 'pg'
  return 'other'
}
```

### MySQL metrics (`SHOW GLOBAL STATUS` + `SHOW VARIABLES LIKE 'max_connections'`)

| Card | Source |
|---|---|
| Uptime | `Uptime` (formatted as `Xd Yh Zm`) |
| QPS | (`Queries`/`Questions` delta) ÷ time delta |
| Connections | `Threads_connected / max_connections` |
| Running | `Threads_running` |
| Slow queries | `Slow_queries` |
| Aborted connects | `Aborted_connects` |

### PostgreSQL metrics (single aggregate SQL)

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

Cards: Uptime / TPS (xacts delta) / Connections / Running / Waiting on lock / Buffer hit ratio `hit / (hit + rd) * 100%`.

The bottom sparkline title shows `QPS` or `TPS` depending on dialect.

---

## Users & privileges

`PrivilegesDialog.vue` + `privileges.ts` — title `Users & privileges`.

Left column: user/role list. Right column: "Existing grants" / "Build GRANT".

### Dialect support

| Dialect family | List users | View grants |
|---|---|---|
| MySQL (incl. MariaDB / OceanBase) | `SELECT User, Host FROM mysql.user` | `SHOW GRANTS FOR 'usr'@'host'` |
| PostgreSQL (incl. KingbaseES) | `SELECT rolname FROM pg_roles WHERE rolcanlogin` | `information_schema.role_table_grants` |
| Oracle (incl. DM) | `SELECT username FROM all_users WHERE oracle_maintained = 'N'` (12c+) | `dba_sys_privs ∪ dba_role_privs ∪ dba_tab_privs` |
| SQL Server | `sys.database_principals WHERE type IN ('S','U','G')` | `sys.database_permissions` JOIN `sys.database_principals` |
| Others | Shows `priv.unsupported` | Not supported |

> Oracle grant inspection uses `dba_*` views — if the connection user lacks DBA role you get ORA-00942; the UI captures and shows the error in the "Existing grants" pane.

### GRANT builder

Check privileges + set target + optional `WITH GRANT OPTION` → live preview, e.g.:

```sql
GRANT SELECT, INSERT ON sales.orders TO 'app'@'%' WITH GRANT OPTION;
```

Preset checklist `COMMON_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL PRIVILEGES']`.

Grantee format per dialect:

| Dialect | Grantee format |
|---|---|
| MySQL | `'user'@'host'` (host defaults to `%` when empty) |
| SQL Server | `[user]` (`]` escaped to `]]`) |
| Oracle | `"USER"` (all upper; `"` escaped to `""`) |
| Others | `"user"` |

### Doesn't execute for you

**SkylerX won't run GRANT / REVOKE for you.** Two buttons:

- Copy → to clipboard
- Open as query → push to a query tab where you execute it yourself (through SkylerX's SQL channel, which catches prod-tagged connections via [production safeguards](/en/docs/connections#production-safeguards))

`buildRevoke()` is exported from `privileges.ts` but the current UI doesn't have a REVOKE form — just edit the GRANT preview text directly if you need it.

---

## Compatibility matrix

| Feature | MySQL fam | PG fam | SQL Server | Oracle / DM | OceanBase | TiDB | NoSQL |
|---|---|---|---|---|---|---|---|
| Server activity: process list | `information_schema.PROCESSLIST` | `pg_stat_activity` | `dm_exec_sessions` | — | via MySQL branch | via MySQL branch | N/A |
| Server activity: long tx | `INNODB_TRX` | `pg_stat_activity` | `dm_tran_active_transactions` | — | via MySQL branch | via MySQL branch | — |
| Server activity: lock waits | `data_lock_waits` | `pg_locks` | `dm_tran_locks` | — | via MySQL branch | via MySQL branch | — |
| KILL | `KILL <id>` | `pg_terminate_backend` | `KILL <spid>` | — | ✓ | ✓ | — |
| Replication lag | `SHOW REPLICA STATUS` etc. | `pg_stat_replication` / `pg_last_xact_replay_timestamp` | AOAG `dm_hadr_database_replica_states` | — | via MySQL branch | via MySQL branch | — |
| Slow query | `events_statements_summary_by_digest` | `pg_stat_statements` | — | — | ✓ | ✓ | — |
| Server monitor | `SHOW GLOBAL STATUS` | `pg_stat_*` aggregate | — | — | via MySQL branch (KingbaseES via pg) | — | — |
| Cluster topology | — | — | — | — | `DBA_OB_*` | `cluster_info / tikv_store_status` | — |
| OB topology (dedicated) | — | — | — | — | ✓ | — | — |
| Users & privileges | `mysql.user` | `pg_roles` | `database_principals` | `all_users` + `dba_*` | via MySQL branch | via MySQL branch | — |
| Operation log (local) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

> **"via X branch"** means the dialect is classified into family X by `ddl.familyOf()` (or `slowFamilyOf` / `fam()`), reusing the same SQL — there's no guarantee that every column from every version of the catalog views matches exactly. Doris / StarRocks are MySQL wire-compatible and FE usually exposes `events_statements_summary_by_digest`; some versions don't, and the panel falls back to the "not enabled" notice.

> **NoSQL (Redis / MongoDB / Elasticsearch)** is short-circuited by `dialectKind(NoSql)` on the Server activity panel — no SQL is sent; the UI suggests "use ⚙ Server → Client / Slow log". Redis live monitoring is in the dedicated `RedisMonitorDialog`, out of scope here.
