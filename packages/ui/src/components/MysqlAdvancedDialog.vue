<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * MySQL / MariaDB 高级面板,3 tab:
 *  - Binlog: SHOW MASTER STATUS + SHOW BINARY LOGS;选中文件 SHOW BINLOG EVENTS LIMIT N
 *  - 主从状态: SHOW MASTER STATUS / SHOW REPLICA STATUS(MariaDB 旧版用 SHOW SLAVE STATUS)
 *  - 变量/状态: SHOW GLOBAL VARIABLES + SHOW GLOBAL STATUS,过滤 + SET GLOBAL
 *
 * 适配: MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks(部分查询可能不支持)
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { prompt as appPrompt, toast } from '../dialog'
import { reportError, reportInlineError } from '../errorReporter'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

type Tab = 'binlog' | 'replication' | 'vars'
const tab = ref<Tab>('binlog')
const loading = ref(false)
const errMsg = ref<string | null>(null)

// Binlog
const binLogs = ref<{ Log_name: string; File_size: number; Encrypted?: string }[]>([])
const masterStatus = ref<Record<string, unknown> | null>(null)
const selectedLog = ref<string | null>(null)
const binEvents = ref<Record<string, unknown>[]>([])
const eventLimit = ref(100)

// Replication
const replicaStatus = ref<Record<string, unknown> | null>(null)

// Variables / Status
type VarKind = 'variables' | 'status'
const varKind = ref<VarKind>('variables')
const vars = ref<{ k: string; v: string }[]>([])
const varFilter = ref('')

async function execSql(sql: string): Promise<Record<string, unknown>[]> {
  const r = await client.connections.execute(props.conn.id, sql, [], {})
  return (r.rows as Record<string, unknown>[]) ?? []
}

async function loadBinlog(): Promise<void> {
  loading.value = true
  errMsg.value = null
  try {
    binLogs.value = (await execSql('SHOW BINARY LOGS')) as { Log_name: string; File_size: number }[]
    const ms = await execSql('SHOW MASTER STATUS')
    masterStatus.value = ms[0] ?? null
  } catch (e) {
    reportInlineError(errMsg, e)
  } finally {
    loading.value = false
  }
}

async function loadBinEvents(): Promise<void> {
  if (!selectedLog.value) return
  loading.value = true
  errMsg.value = null
  try {
    binEvents.value = await execSql(
      `SHOW BINLOG EVENTS IN '${selectedLog.value.replace(/'/g, "\\'")}' LIMIT ${eventLimit.value}`,
    )
  } catch (e) {
    reportInlineError(errMsg, e)
  } finally {
    loading.value = false
  }
}

async function loadReplication(): Promise<void> {
  loading.value = true
  errMsg.value = null
  try {
    // 8.0+ 用 SHOW REPLICA STATUS;老版本/MariaDB 用 SHOW SLAVE STATUS
    let rows: Record<string, unknown>[] = []
    try {
      rows = await execSql('SHOW REPLICA STATUS')
    } catch {
      rows = await execSql('SHOW SLAVE STATUS')
    }
    replicaStatus.value = rows[0] ?? null
  } catch (e) {
    reportInlineError(errMsg, e)
  } finally {
    loading.value = false
  }
}

async function loadVars(): Promise<void> {
  loading.value = true
  errMsg.value = null
  try {
    const sql = varKind.value === 'variables' ? 'SHOW GLOBAL VARIABLES' : 'SHOW GLOBAL STATUS'
    const rows = await execSql(sql)
    vars.value = rows.map((r) => {
      // 列名通常 Variable_name / Value(MySQL/MariaDB)
      const keys = Object.keys(r)
      const kCol = keys.find((c) => /^variable/i.test(c)) ?? keys[0]
      const vCol = keys.find((c) => /^value/i.test(c)) ?? keys[1]
      return { k: String(r[kCol] ?? ''), v: String(r[vCol] ?? '') }
    })
  } catch (e) {
    reportInlineError(errMsg, e)
  } finally {
    loading.value = false
  }
}

async function setVar(entry: { k: string; v: string }): Promise<void> {
  if (varKind.value !== 'variables') {
    toast.warn('STATUS 是只读统计')
    return
  }
  const next = await appPrompt({ message: `SET GLOBAL ${entry.k} = `, defaultValue: entry.v })
  if (next == null || next === entry.v) return
  try {
    // 不引号 — 数值/标识符;字符串型用户需手动加引号
    const sql = `SET GLOBAL \`${entry.k}\` = ${/^[\d.-]+$/.test(next) ? next : `'${next.replace(/'/g, "\\'")}'`}`
    await execSql(sql)
    entry.v = next
    toast.success('已更新')
  } catch (e) {
    reportError(e)
  }
}

const filteredVars = computed(() => {
  const q = varFilter.value.trim().toLowerCase()
  if (!q) return vars.value
  return vars.value.filter((e) => e.k.toLowerCase().includes(q) || e.v.toLowerCase().includes(q))
})

/** 主从延迟判断:Seconds_Behind_Source / Seconds_Behind_Master 数值健康度。 */
const replicaHealth = computed(() => {
  if (!replicaStatus.value) return null
  const lag = Number(
    replicaStatus.value.Seconds_Behind_Source ?? replicaStatus.value.Seconds_Behind_Master ?? -1,
  )
  const sqlRun = String(
    replicaStatus.value.Replica_SQL_Running ?? replicaStatus.value.Slave_SQL_Running ?? '',
  )
  const ioRun = String(
    replicaStatus.value.Replica_IO_Running ?? replicaStatus.value.Slave_IO_Running ?? '',
  )
  return { lag, sqlOk: sqlRun === 'Yes', ioOk: ioRun === 'Yes' }
})

async function refresh(): Promise<void> {
  if (tab.value === 'binlog') await loadBinlog()
  else if (tab.value === 'replication') await loadReplication()
  else await loadVars()
}

watch(tab, refresh)
watch(varKind, loadVars)
watch(
  () => props.open,
  async (op) => {
    if (op) {
      tab.value = 'binlog'
      await refresh()
    }
  },
)

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
</script>

<template>
  <Modal v-if="open" :title="`MySQL 高级  ·  ${conn.name || conn.dialect}`" width="xl" fixed-height storage-key="mysql-advanced" @close="emit('close')">
    <div class="tabs">
      <button :class="{ on: tab === 'binlog' }" @click="tab = 'binlog'">Binlog</button>
      <button :class="{ on: tab === 'replication' }" @click="tab = 'replication'">主从状态</button>
      <button :class="{ on: tab === 'vars' }" @click="tab = 'vars'">变量 / 状态</button>
      <span class="spacer" />
      <button class="btn" :disabled="loading" @click="refresh">🔄</button>
    </div>

    <div class="body">
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="errMsg" class="err-banner">✗ {{ errMsg }}</div>

      <!-- Binlog -->
      <template v-else-if="tab === 'binlog'">
        <div v-if="masterStatus" class="ms-card">
          <span class="lbl">MASTER 当前位置</span>
          <span class="mono">{{ masterStatus.File }} : {{ masterStatus.Position }}</span>
          <span class="meta" v-if="masterStatus.Binlog_Do_DB">do_db: {{ masterStatus.Binlog_Do_DB }}</span>
        </div>
        <div class="bl-layout">
          <div class="bl-left">
            <div class="side-title">日志文件({{ binLogs.length }})</div>
            <div
              v-for="l in binLogs"
              :key="l.Log_name"
              class="bl-row"
              :class="{ on: selectedLog === l.Log_name }"
              @click="selectedLog = l.Log_name; loadBinEvents()"
            >
              <span class="mono">{{ l.Log_name }}</span>
              <span class="meta">{{ fmtBytes(Number(l.File_size ?? 0)) }}</span>
            </div>
          </div>
          <div class="bl-right">
            <div v-if="!selectedLog" class="empty">点左侧选一个 binlog 文件</div>
            <template v-else>
              <div class="sub-bar">
                <label class="lbl-inline">limit
                  <input v-model.number="eventLimit" type="number" class="ip-mini" min="10" max="10000" />
                </label>
                <button class="btn" @click="loadBinEvents">查询</button>
                <span class="meta">{{ binEvents.length }} 条</span>
              </div>
              <table class="grid">
                <thead><tr><th>Log_name</th><th style="width: 100px">Pos</th><th style="width: 100px">Event_type</th><th style="width: 80px">Server_id</th><th>Info</th></tr></thead>
                <tbody>
                  <tr v-for="(e, i) in binEvents" :key="i">
                    <td class="mono">{{ e.Log_name }}</td>
                    <td>{{ e.Pos }}</td>
                    <td>{{ e.Event_type }}</td>
                    <td>{{ e.Server_id }}</td>
                    <td class="mono info">{{ e.Info }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>
        </div>
      </template>

      <!-- 主从状态 -->
      <template v-else-if="tab === 'replication'">
        <div v-if="!replicaStatus" class="empty">不是从库,或 SHOW REPLICA STATUS 返回空</div>
        <template v-else>
          <div v-if="replicaHealth" class="health-bar">
            <span class="hp" :class="{ ok: replicaHealth.ioOk }">IO {{ replicaHealth.ioOk ? '✓' : '✗' }}</span>
            <span class="hp" :class="{ ok: replicaHealth.sqlOk }">SQL {{ replicaHealth.sqlOk ? '✓' : '✗' }}</span>
            <span class="hp" :class="{ ok: replicaHealth.lag >= 0 && replicaHealth.lag < 60 }">
              延迟 {{ replicaHealth.lag >= 0 ? `${replicaHealth.lag}s` : 'NULL' }}
            </span>
          </div>
          <table class="grid kv">
            <tbody>
              <tr v-for="(v, k) in replicaStatus" :key="k">
                <td class="info-k">{{ k }}</td>
                <td class="info-v mono">{{ v ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </template>

      <!-- 变量 / 状态 -->
      <template v-else>
        <div class="sub-bar">
          <div class="seg">
            <button :class="{ on: varKind === 'variables' }" @click="varKind = 'variables'">GLOBAL VARIABLES</button>
            <button :class="{ on: varKind === 'status' }" @click="varKind = 'status'">GLOBAL STATUS</button>
          </div>
          <input v-model="varFilter" class="ip" placeholder="过滤名称或值,如 max / buffer" />
          <span class="meta">{{ filteredVars.length }} / {{ vars.length }}</span>
        </div>
        <table class="grid">
          <thead><tr><th style="white-space:nowrap;width:280px">名称</th><th>值</th></tr></thead>
          <tbody>
            <tr v-for="e in filteredVars" :key="e.k" class="row" @click="varKind === 'variables' && setVar(e)">
              <td class="mono var-name">{{ e.k }}</td>
              <td class="mono val">{{ e.v }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; padding: 0 0 8px; border-bottom: 1px solid var(--border); margin-bottom: 8px; align-items: center; }
.tabs button { background: transparent; border: 1px solid transparent; color: var(--muted); padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.tabs button.on { background: rgba(124, 108, 255, 0.18); border-color: var(--accent); color: var(--text); }
.spacer { flex: 1; }
.btn, .btn-ghost { padding: 4px 12px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg); color: var(--text); }
.btn-ghost { background: transparent; color: var(--muted); padding: 6px 14px; font-size: 13px; }
.body { flex: 1; overflow: auto; max-height: 65vh; }
.empty { padding: 30px; text-align: center; color: var(--muted); }
.err-banner { padding: 10px; background: rgba(224, 64, 80, 0.08); border: 1px solid rgba(224, 64, 80, 0.4); border-radius: 6px; color: var(--err, #e04050); font-size: 12px; }
.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
.grid th, .grid td { border-bottom: 1px solid var(--border); padding: 4px 8px; text-align: left; vertical-align: top; }
.grid th { background: var(--panel); color: var(--muted); position: sticky; top: 0; }
.mono { font-family: var(--font-mono); word-break: break-all; }
.info { color: var(--accent); }
.ms-card { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--panel); border-radius: 6px; margin-bottom: 10px; }
.lbl { font-size: 11px; color: var(--muted); font-weight: 600; }
.meta { font-size: 11px; color: var(--muted); }
.bl-layout { display: grid; grid-template-columns: 260px 1fr; gap: 10px; }
.bl-left { display: flex; flex-direction: column; gap: 2px; }
.side-title { font-size: 11px; color: var(--muted); font-weight: 600; margin-bottom: 4px; }
.bl-row { display: flex; align-items: center; gap: 6px; justify-content: space-between; padding: 4px 8px; background: var(--panel); border-radius: 4px; cursor: pointer; font-size: 11px; }
.bl-row.on { background: rgba(124, 108, 255, 0.22); }
.bl-row:hover { background: rgba(124, 108, 255, 0.12); }
.sub-bar { display: flex; align-items: center; gap: 8px; padding: 4px 0 8px; }
.lbl-inline { font-size: 11px; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
.ip-mini, .ip { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; color: var(--text); font-size: 12px; font-family: var(--font-mono); }
.ip-mini { width: 80px; }
.ip { flex: 1; }
.health-bar { display: flex; gap: 8px; padding: 8px; background: var(--panel); border-radius: 6px; margin-bottom: 10px; }
.hp { padding: 4px 12px; border-radius: 4px; font-size: 12px; font-family: var(--font-mono); background: rgba(224, 64, 80, 0.18); color: var(--err, #e04050); }
.hp.ok { background: rgba(76, 175, 80, 0.2); color: #4caf50; }
.kv .info-k { color: var(--muted); width: 280px; font-family: var(--font-mono); font-size: 11px; }
.kv .info-v { font-size: 11px; }
.seg { display: flex; gap: 4px; }
.seg button { padding: 3px 10px; font-size: 11px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; background: var(--bg); color: var(--muted); }
.seg button.on { background: rgba(124, 108, 255, 0.18); color: var(--text); border-color: var(--accent); }
.row { cursor: pointer; }
.row:hover td { background: rgba(124, 108, 255, 0.06); }
.val { color: var(--accent); word-break: break-all; }
.var-name { white-space: nowrap; }
</style>
