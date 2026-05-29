<script setup lang="ts">/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 「主从复制延迟监控」面板（C1）。
 *
 * 思路：根据当前连接的方言家族跑差异化的复制状态查询，展示
 *   - 复制角色（主 / 从 / 独立）
 *   - 每个 peer / channel 的 lag 秒数 + IO/SQL 线程状态 + Last_Error
 *   - 顶部刷新间隔（不刷 / 2s / 5s / 10s）+ 手动刷新
 * lag > 5s 标黄，lag > 30s 标红。
 *
 * 方言路由：
 *   - MySQL 族（含 MariaDB/TiDB/OceanBase）：先 `SHOW REPLICA STATUS`（MySQL 8.0.22+），
 *     失败回退 `SHOW SLAVE STATUS`。若两者都空，再试 `SHOW MASTER STATUS` / `SHOW BINARY LOG STATUS`
 *     判定是主库；都没有 = 单机。
 *   - PG 族（含 KingbaseES/Greenplum/openGauss/CockroachDB）：用 `pg_is_in_recovery()` 判 standby，
 *     主库视角查 `pg_stat_replication`，从库视角算 `now() - pg_last_xact_replay_timestamp()`。
 *   - SqlServer：查 `sys.dm_hadr_database_replica_states`（AOAG）。无 AOAG 即视为单机。
 *   - 其它方言：unsupported。
 *
 * 容错：权限不足 / 单机模式没有复制 → 走友好「未启用复制」提示，避免红色报错刷屏。
 */
import type { ConnectionConfig, QueryResult } from '@db-tool/shared-types'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { familyOf } from '../ddl'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig }>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()

type Family = 'mysql' | 'pg' | 'mssql' | 'other'
type Role = 'source' | 'replica' | 'standalone' | 'unknown'

const role = ref<Role>('unknown')
const result = ref<QueryResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
/** 「没启用复制」之类的友好提示（区别于真正的错误） */
const notice = ref<string | null>(null)
const refreshIntervalSec = ref<0 | 2 | 5 | 10>(5)
let refreshTimer: ReturnType<typeof setInterval> | null = null

const LAG_WARN = 5
const LAG_DANGER = 30

const family = computed<Family>(() => {
  const f = familyOf(props.conn.dialect)
  if (f === 'sqlserver') return 'mssql'
  if (f === 'mysql' || f === 'pg') return f
  return 'other'
})

const roleLabel = computed<string>(() => {
  switch (role.value) {
    case 'source':
      return t('repl.roleSource')
    case 'replica':
      return t('repl.roleReplica')
    case 'standalone':
      return t('repl.roleStandalone')
    default:
      return '—'
  }
})

/**
 * 「lag 秒数」候选列名集合：用于着色阈值判断 + 表头本地化。
 * 不同方言/视角列名不同，这里给出候选名集合（均为「秒级延迟」单位）。
 */
const LAG_COLS = [
  'lag_seconds',
  'Seconds_Behind_Source',
  'Seconds_Behind_Master',
  'replay_lag_seconds',
  'write_lag_seconds',
  'flush_lag_seconds',
]

function lagClass(row: Record<string, unknown>, col: string): string {
  // 仅对「lag 秒」类列上色，避免给状态列误着色
  if (!LAG_COLS.includes(col)) return ''
  const v = row[col]
  if (v == null) return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  if (n >= LAG_DANGER) return 'lag-danger'
  if (n >= LAG_WARN) return 'lag-warn'
  return ''
}

/** 失败/空结果时的「friendly empty」分类——避免把权限错抛成大红字 */
function looksLikeNoReplication(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('not configured') ||
    m.includes('not a slave') ||
    m.includes('not a replica') ||
    m.includes('no such') ||
    m.includes('access denied') ||
    m.includes('permission denied') ||
    m.includes('privilege') ||
    m.includes('does not exist')
  )
}

async function tryExec(sql: string): Promise<QueryResult | null> {
  try {
    return await client.connections.execute(props.conn.id, sql)
  } catch {
    return null
  }
}

/** MySQL 家族：REPLICA → SLAVE → MASTER 三段路由。 */
async function loadMysql(): Promise<void> {
  // 1) 从库视角：8.0.22+ 用 SHOW REPLICA STATUS
  let r = await tryExec('SHOW REPLICA STATUS')
  if (!r || r.rows.length === 0) {
    // 2) 老版本回退 SHOW SLAVE STATUS
    r = await tryExec('SHOW SLAVE STATUS')
  }
  if (r && r.rows.length > 0) {
    role.value = 'replica'
    // 归一字段：列出关键列在前
    const KEY_COLS = [
      'Channel_Name',
      'Source_Host',
      'Master_Host',
      'Source_Port',
      'Master_Port',
      'Replica_IO_Running',
      'Slave_IO_Running',
      'Replica_SQL_Running',
      'Slave_SQL_Running',
      'Seconds_Behind_Source',
      'Seconds_Behind_Master',
      'Source_Log_File',
      'Master_Log_File',
      'Read_Source_Log_Pos',
      'Read_Master_Log_Pos',
      'Last_Error',
      'Last_IO_Error',
      'Last_SQL_Error',
    ]
    result.value = projectColumns(r, KEY_COLS)
    return
  }
  // 3) 主库视角：先尝试 SHOW REPLICAS（8.0.22+）列出从库；再退回 SHOW SLAVE HOSTS
  let m = await tryExec('SHOW REPLICAS')
  if (!m || m.rows.length === 0) m = await tryExec('SHOW SLAVE HOSTS')
  if (m && m.rows.length > 0) {
    role.value = 'source'
    result.value = m
    return
  }
  // 4) 没有副本也没有上游，再确认是否还有 binlog（仍可能是「孤立 master」）；
  //    任意一条 SHOW MASTER/BINARY LOG STATUS 拿到 1 行就视为 source
  const ms = (await tryExec('SHOW BINARY LOG STATUS')) || (await tryExec('SHOW MASTER STATUS'))
  if (ms && ms.rows.length > 0) {
    role.value = 'source'
    result.value = ms
    notice.value = t('repl.noReplicas')
    return
  }
  role.value = 'standalone'
  result.value = null
  notice.value = t('repl.noReplication')
}

/** PG 家族：pg_is_in_recovery() → 区分主/从视角。 */
async function loadPg(): Promise<void> {
  // 1) 判 standby
  const isReplicaQ = await tryExec('SELECT pg_is_in_recovery() AS is_replica')
  const isReplica = !!(
    isReplicaQ &&
    isReplicaQ.rows.length > 0 &&
    (isReplicaQ.rows[0].is_replica === true || isReplicaQ.rows[0].is_replica === 't')
  )

  if (isReplica) {
    role.value = 'replica'
    // 从库视角：根据 last replay timestamp 估算 lag
    const r = await tryExec(
      `SELECT
         CASE WHEN pg_last_xact_replay_timestamp() IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int
         END AS lag_seconds,
         pg_last_xact_replay_timestamp() AS last_replay_at,
         pg_last_wal_receive_lsn()::text  AS last_receive_lsn,
         pg_last_wal_replay_lsn()::text   AS last_replay_lsn`,
    )
    if (r && r.rows.length > 0) {
      result.value = r
    } else {
      result.value = null
      notice.value = t('repl.noReplication')
    }
    return
  }
  // 2) 主库视角：列出 pg_stat_replication
  const r = await tryExec(
    `SELECT pid,
            application_name,
            client_addr::text AS client_addr,
            state,
            sync_state,
            EXTRACT(EPOCH FROM write_lag)::int  AS write_lag_seconds,
            EXTRACT(EPOCH FROM flush_lag)::int  AS flush_lag_seconds,
            EXTRACT(EPOCH FROM replay_lag)::int AS replay_lag_seconds,
            sent_lsn::text   AS sent_lsn,
            write_lsn::text  AS write_lsn,
            flush_lsn::text  AS flush_lsn,
            replay_lsn::text AS replay_lsn
       FROM pg_stat_replication
       ORDER BY pid`,
  )
  if (r && r.rows.length > 0) {
    role.value = 'source'
    result.value = r
    return
  }
  role.value = 'standalone'
  result.value = null
  notice.value = t('repl.noReplication')
}

/** SqlServer：AOAG（sys.dm_hadr_database_replica_states）。 */
async function loadMssql(): Promise<void> {
  // 综合视图：把 lag 秒数 / 角色 / 状态都拼好
  const r = await tryExec(
    `SELECT ar.replica_server_name        AS replica_server,
            DB_NAME(rs.database_id)       AS db,
            CASE rs.is_local WHEN 1 THEN 'local' ELSE 'remote' END AS locality,
            ars.role_desc                 AS role_desc,
            rs.synchronization_state_desc AS state,
            rs.synchronization_health_desc AS health,
            rs.log_send_queue_size        AS log_send_queue_size,
            rs.log_send_rate              AS log_send_rate,
            rs.redo_queue_size            AS redo_queue_size,
            rs.redo_rate                  AS redo_rate,
            DATEDIFF(SECOND, rs.last_commit_time, GETDATE()) AS lag_seconds,
            rs.last_commit_time           AS last_commit_time
       FROM sys.dm_hadr_database_replica_states rs
       JOIN sys.availability_replicas ar
         ON ar.replica_id = rs.replica_id
       JOIN sys.dm_hadr_availability_replica_states ars
         ON ars.replica_id = rs.replica_id
      ORDER BY ar.replica_server_name, db`,
  )
  if (r && r.rows.length > 0) {
    // 用本地副本的 role 推断当前角色
    const local = r.rows.find((row) => row.locality === 'local')
    const roleDesc = local ? String(local.role_desc ?? '').toUpperCase() : ''
    role.value =
      roleDesc === 'PRIMARY' ? 'source' : roleDesc === 'SECONDARY' ? 'replica' : 'unknown'
    result.value = r
    return
  }
  role.value = 'standalone'
  result.value = null
  notice.value = t('repl.noReplication')
}

/** 按指定顺序投影列；保留 result 中原有但不在 keys 里的列追加在后面。 */
function projectColumns(r: QueryResult, keys: string[]): QueryResult {
  const present = new Set(r.columns.map((c) => c.name))
  const ordered = keys.filter((k) => present.has(k))
  const tail = r.columns.map((c) => c.name).filter((n) => !ordered.includes(n))
  const finalNames = [...ordered, ...tail]
  return {
    ...r,
    columns: finalNames.map((n) => r.columns.find((c) => c.name === n)!),
  }
}

async function load(): Promise<void> {
  if (family.value === 'other') {
    error.value = null
    notice.value = t('repl.unsupported')
    role.value = 'unknown'
    result.value = null
    return
  }
  loading.value = true
  error.value = null
  notice.value = null
  try {
    if (family.value === 'mysql') await loadMysql()
    else if (family.value === 'pg') await loadPg()
    else if (family.value === 'mssql') await loadMssql()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (looksLikeNoReplication(msg)) {
      role.value = 'standalone'
      result.value = null
      notice.value = t('repl.noReplication')
    } else {
      error.value = msg
    }
  } finally {
    loading.value = false
  }
}

function startAutoRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
  if (refreshIntervalSec.value > 0) {
    refreshTimer = setInterval(load, refreshIntervalSec.value * 1000)
  }
}
watch(refreshIntervalSec, startAutoRefresh)
onMounted(() => {
  void load()
  startAutoRefresh()
})
onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

function formatCell(v: unknown): string {
  if (v == null) return 'NULL'
  if (v instanceof Date) return v.toISOString()
  const s = String(v)
  return s.length > 240 ? `${s.slice(0, 240)}…` : s
}

/** 收集 Last_Error / Last_IO_Error / Last_SQL_Error 等非空错误，单独高亮一栏 */
const lastErrors = computed<string[]>(() => {
  const r = result.value
  if (!r) return []
  const out: string[] = []
  for (const row of r.rows) {
    for (const k of ['Last_Error', 'Last_IO_Error', 'Last_SQL_Error']) {
      const v = row[k]
      if (v != null && String(v).trim() !== '') out.push(`${k}: ${String(v)}`)
    }
  }
  return out
})

const dialectLabel = computed<string>(() => props.conn.dialect)

// 列名 → 本地化表头（找不到就用原名）
const HEADER_KEYS: Record<string, string> = {
  Seconds_Behind_Source: 'repl.lag',
  Seconds_Behind_Master: 'repl.lag',
  lag_seconds: 'repl.lag',
  replay_lag_seconds: 'repl.replayLag',
  write_lag_seconds: 'repl.writeLag',
  flush_lag_seconds: 'repl.flushLag',
  Replica_IO_Running: 'repl.ioStatus',
  Slave_IO_Running: 'repl.ioStatus',
  Replica_SQL_Running: 'repl.sqlStatus',
  Slave_SQL_Running: 'repl.sqlStatus',
  state: 'repl.status',
  sync_state: 'repl.syncState',
  Last_Error: 'repl.lastError',
}
function headerLabel(name: string): string {
  const k = HEADER_KEYS[name]
  if (!k) return name
  return t(k) || name
}
</script>

<template>
  <Modal :title="t('repl.title', { conn: conn.name || conn.dialect })" @close="emit('close')">
    <div class="repl">
      <!-- 顶部：方言判定 + 角色 + 刷新控制 -->
      <div class="head">
        <div class="meta">
          <span class="badge">{{ dialectLabel }}</span>
          <span class="sep">·</span>
          <span class="role-label">{{ t('repl.role') }}：</span>
          <span class="role-val" :class="`role-${role}`">{{ roleLabel }}</span>
        </div>
        <span class="grow" />
        <label class="auto-label">{{ t('repl.autoRefresh') }}</label>
        <select v-model.number="refreshIntervalSec" class="refresh-sel">
          <option :value="0">{{ t('repl.refreshOff') }}</option>
          <option :value="2">2s</option>
          <option :value="5">5s</option>
          <option :value="10">10s</option>
        </select>
        <button class="ghost sm" :disabled="loading" @click="load">
          {{ loading ? '…' : t('repl.refresh') }}
        </button>
      </div>

      <!-- Last_Error 高亮（MySQL replica 视角） -->
      <div v-if="lastErrors.length" class="last-err">
        <div class="last-err-title">{{ t('repl.lastError') }}</div>
        <div v-for="(e, i) in lastErrors" :key="i" class="last-err-row">{{ e }}</div>
      </div>

      <!-- 主体 -->
      <div class="body">
        <div v-if="error" class="err">✗ {{ error }}</div>
        <div v-else-if="notice" class="empty notice">{{ notice }}</div>
        <div v-else-if="!result || !result.columns.length || !result.rows.length" class="empty">
          {{ loading ? t('common.loading') : t('repl.noReplication') }}
        </div>
        <table v-else class="repl-tbl">
          <thead>
            <tr>
              <th v-for="c in result.columns" :key="c.name">{{ headerLabel(c.name) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in result.rows" :key="i">
              <td
                v-for="c in result.columns"
                :key="c.name"
                :class="lagClass(row, c.name)"
                :title="String(row[c.name] ?? '')"
              >
                {{ formatCell(row[c.name]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.repl {
  display: flex;
  flex-direction: column;
  min-width: 880px;
  min-height: 460px;
  max-height: 70vh;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}
.meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.badge {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel);
  color: var(--text);
  font-family: ui-monospace, monospace;
  text-transform: uppercase;
  font-size: 11px;
}
.sep { color: var(--muted); }
.role-label { color: var(--muted); }
.role-val { font-weight: 600; }
.role-val.role-source   { color: #4caf50; }
.role-val.role-replica  { color: #2196f3; }
.role-val.role-standalone { color: var(--muted); }
.role-val.role-unknown  { color: var(--muted); }
.grow { flex: 1; }
.auto-label { color: var(--muted); font-size: 12px; }
.refresh-sel {
  padding: 3px 8px;
  font-size: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
}
.ghost.sm { padding: 3px 12px; font-size: 12px; }
.body { flex: 1; overflow: auto; }
.err {
  padding: 16px;
  color: var(--err, #e04050);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
}
.empty { padding: 24px; color: var(--muted); text-align: center; font-size: 13px; }
.empty.notice { color: var(--muted); font-style: italic; }
.repl-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.repl-tbl th,
.repl-tbl td {
  border: 1px solid var(--border);
  padding: 4px 8px;
  text-align: left;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, Menlo, monospace;
}
.repl-tbl th {
  background: var(--panel);
  font-weight: 600;
  position: sticky;
  top: 0;
}
.repl-tbl td.lag-warn {
  background: rgba(255, 193, 7, 0.18);
  color: #b58a00;
  font-weight: 600;
}
.repl-tbl td.lag-danger {
  background: rgba(224, 64, 80, 0.20);
  color: var(--err, #e04050);
  font-weight: 700;
}
.last-err {
  border: 1px solid var(--err, #e04050);
  background: rgba(224, 64, 80, 0.08);
  border-radius: 4px;
  padding: 6px 10px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--err, #e04050);
  font-family: ui-monospace, monospace;
  max-height: 120px;
  overflow: auto;
}
.last-err-title { font-weight: 600; margin-bottom: 4px; }
.last-err-row { white-space: pre-wrap; word-break: break-all; }
</style>
