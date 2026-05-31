<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * ClickHouse 高级面板,4 tab:
 *   - 分区:  system.parts(active 过滤) + DROP/DETACH/ATTACH PARTITION
 *   - Mutation: system.mutations(is_done/command/parts_to_do)
 *   - 副本:  system.replicas(is_leader/queue_size/total_replicas)
 *   - 表 metadata: system.tables(engine/partition_key/sorting_key/sampling_key 含 TTL)
 *
 * 所有数据来源都是 ClickHouse 的 system.* 表,只读为主;写操作只在分区 tab 提供。
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, prompt as appPrompt, toast } from '../dialog'
import { reportError } from '../errorReporter'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  /** 默认 database 过滤(可选);留空查 system.* 时显示所有库 */
  database?: string
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

type Tab = 'partitions' | 'mutations' | 'replicas' | 'tables'
const tab = ref<Tab>('partitions')
const loading = ref(false)
const errMsg = ref<string | null>(null)

const dbFilter = ref(props.database ?? '')
const tblFilter = ref('')

const parts = ref<Record<string, unknown>[]>([])
const mutations = ref<Record<string, unknown>[]>([])
const replicas = ref<Record<string, unknown>[]>([])
const tables = ref<Record<string, unknown>[]>([])

async function execSql(sql: string): Promise<Record<string, unknown>[]> {
  const r = await client.connections.execute(props.conn.id, sql, [], {})
  return (r.rows as Record<string, unknown>[]) ?? []
}

function dbWhere(): string {
  const conds: string[] = []
  if (dbFilter.value.trim())
    conds.push(`database = '${dbFilter.value.trim().replace(/'/g, "\\'")}'`)
  if (tblFilter.value.trim())
    conds.push(`table LIKE '${tblFilter.value.trim().replace(/'/g, "\\'")}'`)
  return conds.length ? `WHERE ${conds.join(' AND ')}` : ''
}

async function loadParts(): Promise<void> {
  loading.value = true
  errMsg.value = null
  try {
    parts.value = await execSql(`SELECT
        database, table, partition, partition_id, active,
        rows, bytes_on_disk, data_compressed_bytes, data_uncompressed_bytes,
        marks, min_date, max_date, level, modification_time
      FROM system.parts
      ${dbWhere()}
      ORDER BY database, table, partition_id`)
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function loadMutations(): Promise<void> {
  loading.value = true
  errMsg.value = null
  try {
    mutations.value = await execSql(`SELECT
        database, table, mutation_id, command, create_time,
        is_done, parts_to_do, latest_failed_part, latest_fail_reason, latest_fail_time
      FROM system.mutations
      ${dbWhere()}
      ORDER BY create_time DESC
      LIMIT 200`)
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function loadReplicas(): Promise<void> {
  loading.value = true
  errMsg.value = null
  try {
    replicas.value = await execSql(`SELECT
        database, table, engine, is_leader, is_readonly, is_session_expired,
        queue_size, inserts_in_queue, merges_in_queue,
        log_max_index, log_pointer, total_replicas, active_replicas,
        replica_name, zookeeper_path
      FROM system.replicas
      ${dbWhere()}
      ORDER BY database, table`)
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function loadTables(): Promise<void> {
  loading.value = true
  errMsg.value = null
  try {
    tables.value = await execSql(`SELECT
        database, name, engine, total_rows, total_bytes,
        partition_key, sorting_key, primary_key, sampling_key,
        storage_policy, metadata_modification_time
      FROM system.tables
      ${dbWhere().replace('table', 'name').replace('table LIKE', 'name LIKE')}
      AND database NOT IN ('system','INFORMATION_SCHEMA','information_schema')
      ORDER BY database, name`)
  } catch (e) {
    // 上面 replace 一次性可能因 dbFilter 为空而退化为 WHERE AND...,简单兜底再试
    try {
      tables.value = await execSql(`SELECT
          database, name, engine, total_rows, total_bytes,
          partition_key, sorting_key, primary_key, sampling_key,
          storage_policy, metadata_modification_time
        FROM system.tables
        WHERE database NOT IN ('system','INFORMATION_SCHEMA','information_schema')
        ORDER BY database, name`)
    } catch (e2) {
      errMsg.value = e2 instanceof Error ? e2.message : String(e2)
    }
  } finally {
    loading.value = false
  }
}

/** ALTER TABLE x DROP PARTITION 'name'。 */
async function dropPartition(p: Record<string, unknown>): Promise<void> {
  if (
    !(await appConfirm({
      message: `DROP PARTITION ${p.partition} ON ${p.database}.${p.table} ?\n会立即删除该分区所有数据,不可恢复`,
      variant: 'danger',
    }))
  )
    return
  try {
    await execSql(
      `ALTER TABLE ${p.database}.${p.table} DROP PARTITION '${String(p.partition).replace(/'/g, "\\'")}'`,
    )
    toast.success('已删除')
    await loadParts()
  } catch (e) {
    reportError(e)
  }
}

async function detachPartition(p: Record<string, unknown>): Promise<void> {
  if (
    !(await appConfirm({
      message: `DETACH PARTITION ${p.partition} ON ${p.database}.${p.table} ?\n数据移到 detached 目录,可后续 ATTACH 恢复`,
      variant: 'danger',
    }))
  )
    return
  try {
    await execSql(
      `ALTER TABLE ${p.database}.${p.table} DETACH PARTITION '${String(p.partition).replace(/'/g, "\\'")}'`,
    )
    toast.success('已 detach')
    await loadParts()
  } catch (e) {
    reportError(e)
  }
}

async function attachPartition(p: Record<string, unknown>): Promise<void> {
  const name = await appPrompt({
    message: `ATTACH PARTITION 名(分区名,如 '202401'):`,
    defaultValue: String(p.partition ?? ''),
  })
  if (!name) return
  try {
    await execSql(
      `ALTER TABLE ${p.database}.${p.table} ATTACH PARTITION '${name.replace(/'/g, "\\'")}'`,
    )
    toast.success('已 attach')
    await loadParts()
  } catch (e) {
    reportError(e)
  }
}

async function killMutation(m: Record<string, unknown>): Promise<void> {
  if (
    !(await appConfirm({
      message: `KILL MUTATION WHERE mutation_id='${m.mutation_id}' ?`,
      variant: 'danger',
    }))
  )
    return
  try {
    await execSql(`KILL MUTATION WHERE mutation_id='${m.mutation_id}'`)
    toast.success('已发出 KILL')
    await loadMutations()
  } catch (e) {
    reportError(e)
  }
}

async function refresh(): Promise<void> {
  if (tab.value === 'partitions') await loadParts()
  else if (tab.value === 'mutations') await loadMutations()
  else if (tab.value === 'replicas') await loadReplicas()
  else await loadTables()
}

watch(tab, refresh)
watch(
  () => props.open,
  async (op) => {
    if (op) {
      tab.value = 'partitions'
      await refresh()
    }
  },
)

function fmtBytes(v: unknown): string {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return String(v)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  if (n < 1024 * 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(n / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`
}

/** 部分分区的压缩比:data_uncompressed/data_compressed。 */
function ratio(p: Record<string, unknown>): string {
  const u = Number(p.data_uncompressed_bytes ?? 0)
  const c = Number(p.data_compressed_bytes ?? 0)
  if (c <= 0) return '—'
  return `${(u / c).toFixed(2)}x`
}

const activeParts = computed(() => parts.value.filter((p) => p.active))
</script>

<template>
  <Modal v-if="open" :title="`ClickHouse 高级  ·  ${conn.name || conn.dialect}`" width="xl" fixed-height storage-key="ch-advanced" @close="emit('close')">
    <div class="tabs">
      <button :class="{ on: tab === 'partitions' }" @click="tab = 'partitions'">分区</button>
      <button :class="{ on: tab === 'mutations' }" @click="tab = 'mutations'">Mutation</button>
      <button :class="{ on: tab === 'replicas' }" @click="tab = 'replicas'">副本</button>
      <button :class="{ on: tab === 'tables' }" @click="tab = 'tables'">表 / TTL</button>
      <span class="spacer" />
      <input v-model="dbFilter" class="ip" placeholder="database" />
      <input v-model="tblFilter" class="ip" placeholder="table (LIKE)" />
      <button class="btn" :disabled="loading" @click="refresh">🔄</button>
    </div>

    <div class="body">
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="errMsg" class="err-banner">✗ {{ errMsg }}</div>

      <!-- 分区 -->
      <template v-else-if="tab === 'partitions'">
        <div class="sub-meta">共 {{ parts.length }} 个 part,active {{ activeParts.length }}</div>
        <table class="grid">
          <thead>
            <tr>
              <th>db.table</th>
              <th>partition</th>
              <th style="width: 50px">active</th>
              <th style="width: 80px">rows</th>
              <th style="width: 90px">on-disk</th>
              <th style="width: 80px">压缩比</th>
              <th style="width: 50px">level</th>
              <th style="width: 150px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in parts" :key="i" :class="{ inactive: !p.active }">
              <td class="mono">{{ p.database }}.{{ p.table }}</td>
              <td class="mono">{{ p.partition }}</td>
              <td>{{ p.active ? '✓' : '' }}</td>
              <td>{{ Number(p.rows ?? 0).toLocaleString() }}</td>
              <td>{{ fmtBytes(p.bytes_on_disk) }}</td>
              <td>{{ ratio(p) }}</td>
              <td>{{ p.level }}</td>
              <td>
                <button class="mini-btn" @click="detachPartition(p)">DETACH</button>
                <button class="mini-btn" @click="attachPartition(p)">ATTACH</button>
                <button class="mini-btn danger" @click="dropPartition(p)">DROP</button>
              </td>
            </tr>
            <tr v-if="!parts.length"><td colspan="8" class="empty-row">无</td></tr>
          </tbody>
        </table>
      </template>

      <!-- Mutation -->
      <template v-else-if="tab === 'mutations'">
        <table class="grid">
          <thead>
            <tr>
              <th>db.table</th>
              <th style="width: 100px">id</th>
              <th>command</th>
              <th style="width: 140px">created</th>
              <th style="width: 60px">done</th>
              <th style="width: 70px">剩余</th>
              <th>最后失败</th>
              <th style="width: 50px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(m, i) in mutations" :key="i" :class="{ done: m.is_done, failed: m.latest_failed_part }">
              <td class="mono">{{ m.database }}.{{ m.table }}</td>
              <td class="mono">{{ m.mutation_id }}</td>
              <td class="mono">{{ m.command }}</td>
              <td>{{ m.create_time }}</td>
              <td>{{ m.is_done ? '✓' : '⏳' }}</td>
              <td>{{ m.parts_to_do }}</td>
              <td class="mono">{{ m.latest_fail_reason || '' }}</td>
              <td><button v-if="!m.is_done" class="mini-btn danger" @click="killMutation(m)">KILL</button></td>
            </tr>
            <tr v-if="!mutations.length"><td colspan="8" class="empty-row">无 mutation</td></tr>
          </tbody>
        </table>
      </template>

      <!-- 副本 -->
      <template v-else-if="tab === 'replicas'">
        <table class="grid">
          <thead>
            <tr>
              <th>db.table</th>
              <th>engine</th>
              <th style="width: 50px">leader</th>
              <th style="width: 60px">readonly</th>
              <th style="width: 70px">queue</th>
              <th style="width: 80px">insert q</th>
              <th style="width: 80px">merge q</th>
              <th style="width: 80px">log idx</th>
              <th style="width: 60px">total</th>
              <th style="width: 60px">active</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in replicas" :key="i" :class="{ alert: Number(r.queue_size) > 100 || r.is_readonly }">
              <td class="mono">{{ r.database }}.{{ r.table }}</td>
              <td class="mono">{{ r.engine }}</td>
              <td>{{ r.is_leader ? '✓' : '' }}</td>
              <td>{{ r.is_readonly ? '!' : '' }}</td>
              <td><b>{{ r.queue_size }}</b></td>
              <td>{{ r.inserts_in_queue }}</td>
              <td>{{ r.merges_in_queue }}</td>
              <td>{{ r.log_pointer }}/{{ r.log_max_index }}</td>
              <td>{{ r.total_replicas }}</td>
              <td>{{ r.active_replicas }}</td>
            </tr>
            <tr v-if="!replicas.length"><td colspan="10" class="empty-row">无复制表</td></tr>
          </tbody>
        </table>
      </template>

      <!-- 表 / TTL -->
      <template v-else-if="tab === 'tables'">
        <table class="grid">
          <thead>
            <tr>
              <th>db.name</th>
              <th>engine</th>
              <th>partition_key</th>
              <th>sorting_key</th>
              <th>sampling_key</th>
              <th style="width: 80px">rows</th>
              <th style="width: 80px">bytes</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(t, i) in tables" :key="i">
              <td class="mono">{{ t.database }}.{{ t.name }}</td>
              <td class="mono">{{ t.engine }}</td>
              <td class="mono">{{ t.partition_key }}</td>
              <td class="mono">{{ t.sorting_key }}</td>
              <td class="mono">{{ t.sampling_key || '' }}</td>
              <td>{{ Number(t.total_rows ?? 0).toLocaleString() }}</td>
              <td>{{ fmtBytes(t.total_bytes) }}</td>
            </tr>
            <tr v-if="!tables.length"><td colspan="7" class="empty-row">无</td></tr>
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
.ip { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; color: var(--text); font-size: 12px; font-family: var(--font-mono); width: 100px; }
.btn, .btn-ghost { padding: 4px 12px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg); color: var(--text); }
.btn-ghost { background: transparent; color: var(--muted); padding: 6px 14px; font-size: 13px; }
.body { flex: 1; overflow: auto; max-height: 65vh; }
.sub-meta { padding: 4px 0; font-size: 11px; color: var(--muted); }
.empty { padding: 30px; text-align: center; color: var(--muted); }
.err-banner { padding: 10px; background: rgba(224, 64, 80, 0.08); border: 1px solid rgba(224, 64, 80, 0.4); border-radius: 6px; color: var(--err, #e04050); font-size: 12px; }
.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
.grid th, .grid td { border-bottom: 1px solid var(--border); padding: 4px 8px; text-align: left; }
.grid th { background: var(--panel); color: var(--muted); position: sticky; top: 0; }
.mono { font-family: var(--font-mono); word-break: break-all; }
tr.inactive td { color: var(--muted); background: rgba(140, 140, 140, 0.05); }
tr.done td { background: rgba(76, 175, 80, 0.05); }
tr.failed td { background: rgba(224, 64, 80, 0.06); }
tr.alert td { background: rgba(255, 152, 0, 0.08); }
.empty-row { text-align: center; color: var(--muted); font-style: italic; }
.mini-btn { padding: 2px 8px; font-size: 10px; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; background: var(--bg); color: var(--text); margin-right: 3px; }
.mini-btn.danger { color: #e04050; border-color: rgba(224, 64, 80, 0.4); }
</style>
