<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 「服务器活动」面板：DBA 排障常用 3 件套
 *   - 进程列表（#1）：MySQL `SHOW PROCESSLIST` / PG `pg_stat_activity` / MSSQL `sys.dm_exec_requests`
 *   - 长事务（#8）：MySQL `information_schema.innodb_trx` / PG `pg_stat_activity` 中 state='idle in transaction'
 *   - 锁等待（#8）：MySQL `performance_schema.data_lock_waits` / PG `pg_locks`
 *
 * 每个面板：列表 + 选行后右下 KILL（mysql `KILL <pid>` / pg `pg_terminate_backend(pid)` / mssql `KILL <spid>`），
 * 顶部有「刷新」按钮 + 可选自动刷新（2s/5s/10s）。
 */
import { DbKind, dialectKind, type ConnectionConfig, type QueryResult } from '@db-tool/shared-types'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { familyOf } from '../ddl'
import { confirm as appConfirm, toast } from '../dialog'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig }>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()

type TabId = 'processes' | 'longtx' | 'locks'
const active = ref<TabId>('processes')
const result = ref<QueryResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const refreshIntervalSec = ref<0 | 2 | 5 | 10>(0)
let refreshTimer: ReturnType<typeof setInterval> | null = null

// 复用 ddl.ts 的 familyOf()：CockroachDB / Greenplum / OpenGauss / H2 已被归入 'pg' 家族，
// 因此会自动走 PG 的 pg_stat_activity / pg_stat_statements 查询分支。
function familyOfConn(): 'mysql' | 'pg' | 'mssql' | 'nosql' | 'other' {
  // NoSQL(Redis/Mongo/ES)这个面板完全不适用 — ddl.familyOf 兜底会回 'mysql',会导致
  // 用 SQL 去打 Redis 直接抛 SQL_CHANNEL_UNSUPPORTED。这里先按 dialectKind 短路。
  if (dialectKind(props.conn.dialect) === DbKind.NoSql) return 'nosql'
  const f = familyOf(props.conn.dialect)
  if (f === 'sqlserver') return 'mssql'
  if (f === 'mysql' || f === 'pg') return f
  return 'other'
}

/** 各方言下三个面板的查询 SQL；返回的列名做了温和的归一（id/info/time）以便统一渲染 */
function sqlFor(tab: TabId): string | null {
  const f = familyOfConn()
  if (tab === 'processes') {
    if (f === 'mysql') {
      return `SELECT ID AS id, USER AS user, HOST AS host, DB AS db, COMMAND AS command,
              TIME AS time, STATE AS state, INFO AS info
              FROM information_schema.PROCESSLIST
              WHERE COMMAND <> 'Sleep'
              ORDER BY TIME DESC`
    }
    if (f === 'pg') {
      return `SELECT pid AS id, usename AS user, client_addr::text AS host, datname AS db,
              state AS state, wait_event_type, wait_event,
              EXTRACT(EPOCH FROM (now() - query_start))::int AS time, query AS info
              FROM pg_stat_activity
              WHERE state IS NOT NULL AND pid <> pg_backend_pid()
              ORDER BY time DESC NULLS LAST`
    }
    if (f === 'mssql') {
      return `SELECT s.session_id AS id, s.login_name AS [user], s.host_name AS host,
              DB_NAME(s.database_id) AS db, s.status AS state,
              DATEDIFF(SECOND, r.start_time, GETDATE()) AS time,
              SUBSTRING(qt.text, 1, 4000) AS info
              FROM sys.dm_exec_sessions s
              LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
              OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) qt
              WHERE s.is_user_process = 1 AND s.session_id <> @@SPID
              ORDER BY time DESC`
    }
    return null
  }
  if (tab === 'longtx') {
    if (f === 'mysql') {
      // innodb_trx 在 information_schema（MySQL 5.7+）/ performance_schema（8.0+ 也都有副本）
      return `SELECT trx_id AS id, trx_mysql_thread_id AS thread_id, trx_state AS state,
              TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS time,
              trx_query AS info, trx_rows_locked AS rows_locked,
              trx_rows_modified AS rows_modified
              FROM information_schema.INNODB_TRX
              ORDER BY trx_started ASC`
    }
    if (f === 'pg') {
      return `SELECT pid AS id, usename AS user, datname AS db, state,
              EXTRACT(EPOCH FROM (now() - xact_start))::int AS time,
              query AS info
              FROM pg_stat_activity
              WHERE xact_start IS NOT NULL AND pid <> pg_backend_pid()
              ORDER BY xact_start ASC`
    }
    if (f === 'mssql') {
      return `SELECT s.session_id AS id, s.login_name AS [user],
              DB_NAME(t.database_id) AS db, t.transaction_type, t.transaction_state AS state,
              DATEDIFF(SECOND, t.transaction_begin_time, GETDATE()) AS time,
              SUBSTRING(qt.text, 1, 4000) AS info
              FROM sys.dm_tran_active_transactions t
              LEFT JOIN sys.dm_tran_session_transactions st ON st.transaction_id = t.transaction_id
              LEFT JOIN sys.dm_exec_sessions s ON s.session_id = st.session_id
              LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
              OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) qt
              ORDER BY t.transaction_begin_time ASC`
    }
    return null
  }
  // locks
  if (f === 'mysql') {
    return `SELECT REQUESTING_ENGINE_TRANSACTION_ID AS requesting_trx,
            BLOCKING_ENGINE_TRANSACTION_ID AS blocking_trx,
            REQUESTING_THREAD_ID AS requesting_thread,
            BLOCKING_THREAD_ID AS blocking_thread,
            REQUESTING_ENGINE_LOCK_ID AS requesting_lock,
            BLOCKING_ENGINE_LOCK_ID AS blocking_lock
            FROM performance_schema.data_lock_waits`
  }
  if (f === 'pg') {
    return `SELECT bl.pid AS blocked_pid, a.usename AS blocked_user,
            ka.query AS blocking_statement,
            now() - ka.query_start AS blocking_duration,
            kl.pid AS blocking_pid, ka.usename AS blocking_user,
            a.query AS blocked_statement,
            now() - a.query_start AS blocked_duration
            FROM pg_catalog.pg_locks bl
            JOIN pg_catalog.pg_stat_activity a ON a.pid = bl.pid
            JOIN pg_catalog.pg_locks kl
              ON kl.transactionid = bl.transactionid AND kl.pid <> bl.pid
            JOIN pg_catalog.pg_stat_activity ka ON ka.pid = kl.pid
            WHERE NOT bl.granted`
  }
  if (f === 'mssql') {
    return `SELECT request_session_id AS session_id, resource_type, resource_database_id AS db_id,
            resource_associated_entity_id, request_mode, request_status
            FROM sys.dm_tran_locks
            WHERE request_status = 'WAIT'`
  }
  return null
}

async function load(): Promise<void> {
  if (familyOfConn() === 'nosql') {
    error.value =
      'NoSQL 方言不适用本面板。Redis 请用「⚙ 服务器」→ 客户端/慢日志;MongoDB/ES 同。'
    result.value = null
    return
  }
  const sql = sqlFor(active.value)
  if (!sql) {
    error.value = t('activity.unsupported')
    result.value = null
    return
  }
  loading.value = true
  error.value = null
  try {
    result.value = await client.connections.execute(props.conn.id, sql)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// KILL 路由：mysql `KILL <id>` / pg `SELECT pg_terminate_backend(pid)` / mssql `KILL <spid>`
async function killRow(row: Record<string, unknown>): Promise<void> {
  const id = row.id ?? row.session_id ?? row.thread_id
  if (id == null) {
    toast.error(t('activity.noIdToKill'))
    return
  }
  const idNum = Number(id)
  if (!Number.isFinite(idNum)) {
    toast.error(t('activity.noIdToKill'))
    return
  }
  if (
    !(await appConfirm({
      title: t('activity.killTitle'),
      message: t('activity.killConfirm', { id: String(idNum) }),
      variant: 'danger',
    }))
  )
    return
  const f = familyOfConn()
  let killSql = ''
  if (f === 'mysql') killSql = `KILL ${idNum}`
  else if (f === 'pg') killSql = `SELECT pg_terminate_backend(${idNum})`
  else if (f === 'mssql') killSql = `KILL ${idNum}`
  else {
    toast.error(t('activity.unsupported'))
    return
  }
  try {
    await client.connections.execute(props.conn.id, killSql)
    toast.success(t('activity.killed', { id: String(idNum) }))
    await load()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
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
watch(active, () => {
  result.value = null
  void load()
})
onMounted(() => void load())
onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<template>
  <Modal :title="t('activity.title', { conn: conn.name || conn.dialect })" width="wide" @close="emit('close')">
    <div class="act">
      <!-- Tab 切换 -->
      <div class="tabs">
        <button :class="{ on: active === 'processes' }" @click="active = 'processes'">{{ t('activity.tabProcesses') }}</button>
        <button :class="{ on: active === 'longtx' }" @click="active = 'longtx'">{{ t('activity.tabLongTx') }}</button>
        <button :class="{ on: active === 'locks' }" @click="active = 'locks'">{{ t('activity.tabLocks') }}</button>
        <span class="grow" />
        <select v-model.number="refreshIntervalSec" class="refresh-sel" :title="t('activity.autoRefresh')">
          <option :value="0">{{ t('activity.refreshOff') }}</option>
          <option :value="2">2s</option>
          <option :value="5">5s</option>
          <option :value="10">10s</option>
        </select>
        <button class="ghost sm" :disabled="loading" @click="load">{{ loading ? '…' : t('activity.refresh') }}</button>
      </div>

      <!-- 表格区 -->
      <div class="tbl-wrap">
        <div v-if="error" class="err">✗ {{ error }}</div>
        <div v-else-if="!result || !result.columns.length" class="empty">{{ loading ? t('activity.loading') : t('activity.noData') }}</div>
        <table v-else class="act-tbl">
          <thead>
            <tr>
              <th v-for="c in result.columns" :key="c.name">{{ c.name }}</th>
              <th class="op">{{ t('activity.op') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in result.rows" :key="i">
              <td v-for="c in result.columns" :key="c.name" :title="String(row[c.name] ?? '')">
                {{ row[c.name] == null ? 'NULL' : String(row[c.name]).slice(0, 200) }}
              </td>
              <td class="op">
                <button v-if="active === 'processes' || active === 'longtx'" class="kill" @click="killRow(row)">
                  ✗ KILL
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.act {
  display: flex;
  flex-direction: column;
  min-width: 820px;
  min-height: 480px;
  max-height: 70vh;
}
.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 0 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
  /* 防止文字过多自动换行(刷新选项/tab 名称中文较长时容易 wrap) */
  flex-wrap: nowrap;
  white-space: nowrap;
}
.tabs button {
  padding: 5px 12px;
  font-size: 13px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;
}
.tabs button:hover { color: var(--text); background: rgba(124, 108, 255, 0.10); }
.tabs button.on { color: var(--accent); border-color: var(--accent); }
.grow { flex: 1; }
.refresh-sel {
  padding: 3px 8px;
  font-size: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
}
.ghost.sm { padding: 3px 12px; font-size: 12px; }
.tbl-wrap { flex: 1; overflow: auto; }
.err {
  padding: 16px;
  color: var(--err, #e04050);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
}
.empty { padding: 24px; color: var(--muted); text-align: center; }
.act-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.act-tbl th, .act-tbl td {
  border: 1px solid var(--border);
  padding: 4px 8px;
  text-align: left;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, Menlo, monospace;
}
.act-tbl th { background: var(--panel); font-weight: 600; position: sticky; top: 0; }
.act-tbl td.op { padding: 2px 6px; white-space: nowrap; }
.kill {
  padding: 2px 8px;
  font-size: 11px;
  background: transparent;
  color: var(--err, #e04050);
  border: 1px solid var(--err, #e04050);
  border-radius: 4px;
  cursor: pointer;
}
.kill:hover { background: rgba(224, 64, 80, 0.14); }
</style>
