<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * #D 进程 / 会话列表 + Kill (long-running query killer).
 *
 * 跨方言:
 *   - mysql 系 (mysql/mariadb/oceanbase/tidb/doris/...): SHOW FULL PROCESSLIST + KILL N
 *   - pg 系 (postgres/kingbase/cockroach/...): pg_stat_activity + pg_terminate_backend(pid)
 *   - mssql: sys.dm_exec_requests + KILL <session_id>
 *   - oracle/dm: v$session + ALTER SYSTEM KILL SESSION 'sid,serial'
 *   - 其它 (sqlite / nosql / clickhouse): 不支持 (清晰提示)
 *
 * 列归一: 各方言查询里通过 AS 把字段对齐到统一形态:
 *   id, user, host, db, command, time_sec, state, info, [serial — 仅 oracle]
 *
 * 安全:
 *   - 生产环境连接 (extra.env='prod') 杀进程要二次输入 KILL 确认 (跟 FLUSHDB 同套路)
 *   - kill 完不立刻刷,等用户按"刷新"或下一个 auto-refresh tick
 */
import { type ConnectionConfig, DbDialect } from '@db-tool/shared-types'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { familyOf } from '../ddl'
import { confirm as appConfirm, prompt as appPrompt, toast } from '../dialog'
import { reportError } from '../errorReporter'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig | null }>()
const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

interface ProcRow {
  id: string
  user: string
  host: string
  db: string
  command: string
  time: number
  state: string
  info: string
  /** Oracle/DM 用,KILL SESSION 'sid,serial' 需要 */
  serial?: string
}

const loading = ref(false)
const error = ref<string | null>(null)
const rows = ref<ProcRow[]>([])
const filter = ref('')
const autoRefresh = ref(false)
const refreshIntervalSec = ref(5)
let autoTimer: ReturnType<typeof setInterval> | null = null

const family = computed(() => (props.conn ? familyOf(props.conn.dialect) : ''))
/** 该方言不支持时显示原因 — SQLite/NoSQL 等没 process 概念. */
const unsupported = computed<string | null>(() => {
  if (!props.conn) return null
  const d = props.conn.dialect
  if (d === DbDialect.SQLite || d === DbDialect.DuckDB) {
    return '文件型数据库无进程概念,不适用 (SQLite/DuckDB).'
  }
  if (d === DbDialect.Redis || d === DbDialect.MongoDB || d === DbDialect.Elasticsearch) {
    return 'NoSQL 数据库没有 SQL 进程列表 (Redis 用 CLIENT LIST, Mongo 用 db.currentOp).'
  }
  return null
})

function buildQuery(): string {
  switch (family.value) {
    case 'mysql':
      // information_schema.PROCESSLIST 列名稳定,跨 MySQL/MariaDB/OB/TiDB 都可
      return `SELECT
          ID AS id, USER AS user, HOST AS host, DB AS db,
          COMMAND AS command, TIME AS time, STATE AS state, INFO AS info
        FROM information_schema.PROCESSLIST
        ORDER BY TIME DESC`
    case 'pg':
      return `SELECT
          pid::text AS id,
          usename AS user,
          COALESCE(client_addr::text, application_name, '') AS host,
          datname AS db,
          state AS command,
          EXTRACT(EPOCH FROM (now() - query_start))::int AS time,
          COALESCE(wait_event_type || '/' || wait_event, '') AS state,
          query AS info
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
        ORDER BY query_start NULLS LAST`
    case 'sqlserver':
      return `SELECT
          CAST(r.session_id AS varchar(20)) AS id,
          s.login_name AS [user],
          s.host_name AS host,
          DB_NAME(r.database_id) AS db,
          r.command AS command,
          DATEDIFF(second, r.start_time, GETDATE()) AS time,
          r.status AS state,
          SUBSTRING(t.text, 1, 4000) AS info
        FROM sys.dm_exec_requests r
        JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
        OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
        WHERE r.session_id <> @@SPID
        ORDER BY r.start_time`
    case 'oracle':
      return `SELECT
          TO_CHAR(s.SID) AS id,
          s.USERNAME AS user_name,
          s.MACHINE AS host,
          s.SCHEMANAME AS db,
          s.STATUS AS command,
          s.LAST_CALL_ET AS time,
          NVL(s.EVENT, '') AS state,
          NVL(q.SQL_FULLTEXT, '') AS info,
          TO_CHAR(s.SERIAL#) AS serial
        FROM V$SESSION s
        LEFT JOIN V$SQLAREA q ON q.SQL_ID = s.SQL_ID
        WHERE s.STATUS = 'ACTIVE' AND s.TYPE = 'USER'`
    default:
      return ''
  }
}

/** 将 QueryResult.rows (Record-shape) 归一成 ProcRow[]. 各方言列名靠 SQL 里
 *  显式 AS 已经对齐到 id/user(or user_name)/host/db/command/time/state/info/serial,
 *  这里大小写不敏感找一次, 兜底为空字符串. */
function normalizeRows(raw: Array<Record<string, unknown>>): ProcRow[] {
  const keyMap = (sample: Record<string, unknown>): Record<string, string> => {
    const m: Record<string, string> = {}
    for (const k of Object.keys(sample)) m[k.toLowerCase()] = k
    return m
  }
  if (raw.length === 0) return []
  const km = keyMap(raw[0])
  const pick = (r: Record<string, unknown>, want: string): unknown => {
    const real = km[want.toLowerCase()]
    return real ? r[real] : undefined
  }
  return raw.map((r) => ({
    id: String(pick(r, 'id') ?? ''),
    user: String(pick(r, 'user') ?? pick(r, 'user_name') ?? ''),
    host: String(pick(r, 'host') ?? ''),
    db: String(pick(r, 'db') ?? ''),
    command: String(pick(r, 'command') ?? ''),
    time: Number(pick(r, 'time') ?? 0) || 0,
    state: String(pick(r, 'state') ?? ''),
    info: String(pick(r, 'info') ?? ''),
    serial: pick(r, 'serial') != null ? String(pick(r, 'serial')) : undefined,
  }))
}

async function refresh(): Promise<void> {
  if (!props.conn || unsupported.value) return
  const sql = buildQuery()
  if (!sql) return
  loading.value = true
  error.value = null
  try {
    const res = await client.connections.execute(props.conn.id, sql)
    rows.value = normalizeRows(res.rows)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function killSql(row: ProcRow): string {
  switch (family.value) {
    case 'mysql':
    case 'sqlserver':
      return `KILL ${row.id}`
    case 'pg':
      return `SELECT pg_terminate_backend(${row.id})`
    case 'oracle':
      return `ALTER SYSTEM KILL SESSION '${row.id},${row.serial ?? ''}' IMMEDIATE`
    default:
      return ''
  }
}

async function kill(row: ProcRow): Promise<void> {
  if (!props.conn) return
  const sql = killSql(row)
  if (!sql) return
  // 生产环境额外多一道确认 — 输入字面 KILL 防误杀
  const isProd = (props.conn.extra as { env?: string } | undefined)?.env === 'prod'
  if (isProd) {
    const typed = await appPrompt({
      message: `⚠️ 生产环境连接「${props.conn.name}」.\n要杀掉会话 ${row.id} (user=${row.user}, time=${row.time}s),请输入 "KILL" 确认:`,
      defaultValue: '',
    })
    if (typed !== 'KILL') {
      toast.warn('已取消')
      return
    }
  } else {
    const ok = await appConfirm({
      message: `确认杀掉会话 ${row.id} (user=${row.user}, time=${row.time}s, ${row.info.slice(0, 60)}...) ?`,
      variant: 'danger',
    })
    if (!ok) return
  }
  try {
    await client.connections.execute(props.conn.id, sql)
    toast.success(`已杀 ${row.id}`)
    void refresh()
  } catch (e) {
    reportError(e, { tag: 'process-list-kill' })
  }
}

const filteredRows = computed(() => {
  if (!filter.value.trim()) return rows.value
  const q = filter.value.trim().toLowerCase()
  return rows.value.filter((r) =>
    [r.id, r.user, r.host, r.db, r.command, r.state, r.info].some((v) =>
      v.toLowerCase().includes(q),
    ),
  )
})

function startAutoRefresh(): void {
  stopAutoRefresh()
  if (!autoRefresh.value) return
  autoTimer = setInterval(refresh, Math.max(1, refreshIntervalSec.value) * 1000)
}
function stopAutoRefresh(): void {
  if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
}
watch(autoRefresh, startAutoRefresh)
watch(refreshIntervalSec, () => {
  if (autoRefresh.value) startAutoRefresh()
})

onMounted(() => void refresh())
onUnmounted(stopAutoRefresh)
</script>

<template>
  <Modal
    v-if="conn"
    :title="`进程 / 会话列表 · ${conn.name}`"
    width="xl"
    fixed-height
    storage-key="process-list"
    @close="emit('close')"
  >
    <div v-if="unsupported" class="msg">{{ unsupported }}</div>
    <template v-else>
      <div class="toolbar">
        <input
          v-model="filter"
          class="filter"
          type="text"
          placeholder="过滤 ID / user / db / SQL..."
        />
        <label class="autoref">
          <input v-model="autoRefresh" type="checkbox" />
          自动刷新
        </label>
        <input
          v-if="autoRefresh"
          v-model.number="refreshIntervalSec"
          class="interval"
          type="number"
          min="1"
          max="60"
          step="1"
        />
        <span v-if="autoRefresh" class="unit">秒</span>
        <button class="ghost" :disabled="loading" @click="refresh">
          {{ loading ? '加载中...' : '刷新' }}
        </button>
        <span class="count">{{ filteredRows.length }} / {{ rows.length }}</span>
      </div>
      <div v-if="error" class="msg err">{{ error }}</div>
      <div v-else class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Host</th>
              <th>DB</th>
              <th>Cmd</th>
              <th>Time(s)</th>
              <th>State</th>
              <th>SQL</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filteredRows" :key="r.id" :class="{ slow: r.time > 30 }">
              <td>{{ r.id }}</td>
              <td>{{ r.user }}</td>
              <td>{{ r.host }}</td>
              <td>{{ r.db }}</td>
              <td>{{ r.command }}</td>
              <td class="num">{{ r.time }}</td>
              <td>{{ r.state }}</td>
              <td class="sql" :title="r.info">{{ r.info }}</td>
              <td>
                <button class="danger" :title="`KILL ${r.id}`" @click="kill(r)">Kill</button>
              </td>
            </tr>
            <tr v-if="filteredRows.length === 0 && !loading">
              <td colspan="9" class="empty">{{ filter ? '过滤无匹配' : '当前没有活动会话' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template #footer>
      <button class="ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.msg {
  padding: 24px;
  text-align: center;
  color: var(--muted);
}
.msg.err {
  color: var(--err, #ff6c6c);
  white-space: pre-wrap;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 8px;
  flex: none;
}
.toolbar .filter {
  flex: 1;
  padding: 5px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
  outline: none;
}
.toolbar .filter:focus {
  border-color: var(--accent, #7c6cff);
}
.toolbar .autoref {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.toolbar .interval {
  width: 48px;
  padding: 4px 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
}
.toolbar .unit {
  font-size: 12px;
  color: var(--muted);
}
.toolbar .count {
  font-size: 12px;
  color: var(--muted);
  margin-left: 4px;
}
.table-wrap {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.tbl th,
.tbl td {
  text-align: left;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}
.tbl th {
  background: var(--panel);
  font-weight: 600;
  position: sticky;
  top: 0;
}
.tbl tr.slow {
  background: rgba(255, 152, 0, 0.06);
}
.tbl tr.slow td:nth-child(6) {
  color: rgb(255, 152, 0);
  font-weight: 600;
}
.tbl .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.tbl .sql {
  max-width: 480px;
  font-family: var(--font-mono, ui-monospace, monospace);
  color: var(--muted);
}
.tbl .empty {
  text-align: center;
  color: var(--muted);
  padding: 24px;
}
button.danger {
  background: rgba(255, 80, 80, 0.12);
  border: 1px solid rgba(255, 80, 80, 0.35);
  color: rgb(255, 80, 80);
  padding: 2px 10px;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
}
button.danger:hover {
  background: rgba(255, 80, 80, 0.22);
}
button.ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 5px 14px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
button.ghost:hover {
  background: rgba(124, 108, 255, 0.08);
}
button.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
