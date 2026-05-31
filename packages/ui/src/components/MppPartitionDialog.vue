<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Doris / StarRocks 分区管理(MySQL 协议系):
 *  - 选 schema(库) + table → SHOW PARTITIONS FROM ${db}.${tbl}
 *  - PartitionName / Range / Buckets / DataSize / ReplicationNum / StorageMedium / CooldownTime
 *  - DROP PARTITION / ADD PARTITION(简单输入 SQL,实际语法 Doris/StarRocks 略不同)
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, prompt as appPrompt, toast } from '../dialog'
import { reportError } from '../errorReporter'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  /** 触发节点 — 库名 */
  database?: string
  /** 触发节点 — 表名 */
  table?: string
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

const dbName = ref(props.database ?? '')
const tblName = ref(props.table ?? '')
const partitions = ref<Record<string, unknown>[]>([])
const loading = ref(false)
const errMsg = ref<string | null>(null)
const dbList = ref<string[]>([])
const tblList = ref<string[]>([])

async function execSql(sql: string, database?: string): Promise<Record<string, unknown>[]> {
  const ctx = database ? { database } : {}
  const r = await client.connections.execute(props.conn.id, sql, [], ctx)
  return (r.rows as Record<string, unknown>[]) ?? []
}

async function loadDatabases(): Promise<void> {
  try {
    const rows = await execSql('SHOW DATABASES')
    dbList.value = rows
      .map((r) => Object.values(r)[0] as string)
      .filter((n) => !['information_schema', 'mysql', '__internal_schema'].includes(n))
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e)
  }
}

async function loadTables(): Promise<void> {
  if (!dbName.value) {
    tblList.value = []
    return
  }
  try {
    const rows = await execSql('SHOW TABLES', dbName.value)
    tblList.value = rows.map((r) => Object.values(r)[0] as string)
  } catch (e) {
    tblList.value = []
    errMsg.value = e instanceof Error ? e.message : String(e)
  }
}

async function loadPartitions(): Promise<void> {
  if (!dbName.value || !tblName.value) {
    partitions.value = []
    return
  }
  loading.value = true
  errMsg.value = null
  try {
    partitions.value = await execSql(
      `SHOW PARTITIONS FROM \`${dbName.value}\`.\`${tblName.value}\``,
    )
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e)
    partitions.value = []
  } finally {
    loading.value = false
  }
}

async function dropPartition(p: Record<string, unknown>): Promise<void> {
  const name = String(p.PartitionName ?? p.partitionName ?? '')
  if (!name) return
  if (
    !(await appConfirm({
      message: `DROP PARTITION ${name} ON ${dbName.value}.${tblName.value} ?\n会立即删除该分区所有数据`,
      variant: 'danger',
    }))
  )
    return
  try {
    await execSql(
      `ALTER TABLE \`${dbName.value}\`.\`${tblName.value}\` DROP PARTITION \`${name}\``,
      dbName.value,
    )
    toast.success('已删除')
    await loadPartitions()
  } catch (e) {
    reportError(e)
  }
}

async function addPartition(): Promise<void> {
  const sql = await appPrompt({
    message: '输入 ADD PARTITION 子句(从 ADD 开始;不需要 ALTER TABLE 前缀):',
    defaultValue: `ADD PARTITION p20260601 VALUES [('2026-06-01'), ('2026-07-01'))`,
  })
  if (!sql) return
  try {
    await execSql(`ALTER TABLE \`${dbName.value}\`.\`${tblName.value}\` ${sql}`, dbName.value)
    toast.success('已创建分区')
    await loadPartitions()
  } catch (e) {
    reportError(e)
  }
}

watch(dbName, () => {
  partitions.value = []
  void loadTables()
})

watch(tblName, () => {
  if (tblName.value) void loadPartitions()
  else partitions.value = []
})

watch(
  () => props.open,
  async (op) => {
    if (op) {
      await loadDatabases()
      if (dbName.value) await loadTables()
      if (tblName.value) await loadPartitions()
    }
  },
)

function fmtBytes(v: unknown): string {
  if (typeof v === 'string') {
    // Doris 返回的 DataSize 是 "1.234 MB" 形式字符串,直接展示
    return v
  }
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return String(v)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const COLS_TO_SHOW = [
  'PartitionId',
  'PartitionName',
  'State',
  'PartitionKey',
  'Range',
  'DistributionKey',
  'Buckets',
  'ReplicationNum',
  'StorageMedium',
  'CooldownTime',
  'DataSize',
  'IsInMemory',
]
</script>

<template>
  <Modal v-if="open" :title="`分区管理(Doris/StarRocks)  ·  ${conn.name || conn.dialect}`" width="xl" fixed-height storage-key="mpp-partition" @close="emit('close')">
    <div class="ctrl">
      <label class="lbl-inline">库
        <select v-model="dbName" class="ip">
          <option value="">— 选库 —</option>
          <option v-for="d in dbList" :key="d" :value="d">{{ d }}</option>
        </select>
      </label>
      <label class="lbl-inline">表
        <select v-model="tblName" class="ip" :disabled="!dbName">
          <option value="">— 选表 —</option>
          <option v-for="t in tblList" :key="t" :value="t">{{ t }}</option>
        </select>
      </label>
      <span class="spacer" />
      <button class="btn" :disabled="!tblName || loading" @click="loadPartitions">🔄 刷新</button>
      <button class="btn-primary" :disabled="!tblName" @click="addPartition">+ 新增分区</button>
    </div>

    <div class="body">
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="errMsg" class="err-banner">✗ {{ errMsg }}</div>
      <div v-else-if="!partitions.length" class="empty">{{ tblName ? '该表无分区' : '请先选库和表' }}</div>
      <table v-else class="grid">
        <thead>
          <tr>
            <th v-for="c in COLS_TO_SHOW" :key="c">{{ c }}</th>
            <th style="width: 60px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, i) in partitions" :key="i">
            <td v-for="c in COLS_TO_SHOW" :key="c" class="mono">
              {{ c === 'DataSize' ? fmtBytes(p[c]) : (p[c] ?? '') }}
            </td>
            <td><button class="mini-btn danger" @click="dropPartition(p)">DROP</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.ctrl { display: flex; align-items: center; gap: 10px; padding: 0 0 8px; border-bottom: 1px solid var(--border); margin-bottom: 8px; }
.spacer { flex: 1; }
.lbl-inline { font-size: 12px; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
.ip { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; color: var(--text); font-size: 12px; font-family: var(--font-mono); min-width: 140px; }
.btn, .btn-primary, .btn-ghost { padding: 4px 12px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg); color: var(--text); }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-ghost { background: transparent; color: var(--muted); padding: 6px 14px; font-size: 13px; }
.body { flex: 1; overflow: auto; max-height: 60vh; }
.empty { padding: 30px; text-align: center; color: var(--muted); }
.err-banner { padding: 10px; background: rgba(224, 64, 80, 0.08); border: 1px solid rgba(224, 64, 80, 0.4); border-radius: 6px; color: var(--err, #e04050); font-size: 12px; }
.grid { width: 100%; border-collapse: collapse; font-size: 11px; }
.grid th, .grid td { border-bottom: 1px solid var(--border); padding: 3px 6px; text-align: left; vertical-align: top; }
.grid th { background: var(--panel); color: var(--muted); position: sticky; top: 0; font-size: 10px; }
.mono { font-family: var(--font-mono); word-break: break-all; }
.mini-btn { padding: 2px 8px; font-size: 10px; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; background: var(--bg); color: var(--text); }
.mini-btn.danger { color: #e04050; border-color: rgba(224, 64, 80, 0.4); }
</style>
