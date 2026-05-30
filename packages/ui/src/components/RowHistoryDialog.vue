<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 行历史追溯（A9）：给定一行的主键，找它在 audit / *_history / *_log 表里的所有版本。
 *
 * 启发式发现影子表：
 *   - 同库下叫 <table>_history / <table>_audit / <table>_log 的表
 *   - 列结构里如果有 _changed_at / version / revision 字段则视为历史表
 * 用户也可以手动选影子表名。
 */
import type { ConnectionConfig, QueryResult } from '@db-tool/shared-types'
import { onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { quoteId } from '../ddl'
import { toast } from '../dialog'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{
  conn: ConnectionConfig
  table: string
  /** 主键列名 + 值。比如 {id: 42} */
  pk: Record<string, unknown>
}>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()

const shadowTable = ref<string>('')
const history = ref<QueryResult | null>(null)
const loading = ref(false)
const candidates = ref<string[]>([])

onMounted(async () => {
  const base = props.table.replace(/^.*\./, '')
  try {
    const r = await client.connections.execute(
      props.conn.id,
      `SELECT table_name FROM information_schema.tables
       WHERE table_name LIKE '${base}_%' OR table_name = 'audit_${base}' OR table_name = '${base}_history'`,
    )
    candidates.value = r.rows.map((row) => String(row.table_name))
    if (candidates.value.length) shadowTable.value = candidates.value[0]
  } catch {
    /* ignore */
  }
})

async function loadHistory(): Promise<void> {
  if (!shadowTable.value) {
    toast.warn(t('rowhist.pickShadow'))
    return
  }
  loading.value = true
  try {
    // 找 audit 表里以同样 pk 列 = 同样值的所有行，按时间倒序
    const conds: string[] = []
    for (const [col, val] of Object.entries(props.pk)) {
      if (val == null) continue
      const lit = typeof val === 'number' ? String(val) : `'${String(val).replace(/'/g, "''")}'`
      conds.push(`${quoteId(props.conn.dialect, col)} = ${lit}`)
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    const orderCol = ['changed_at', 'updated_at', 'created_at', 'version', 'revision']
      .map((c) => quoteId(props.conn.dialect, c))
      .join(', ')
    const sql = `SELECT * FROM ${quoteId(props.conn.dialect, shadowTable.value)} ${where} ORDER BY ${orderCol} DESC LIMIT 200`
    history.value = await client.connections.execute(props.conn.id, sql)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Modal :title="t('rowhist.title', { table })" width="wide" @close="emit('close')">
    <div class="rh">
      <div class="cfg">
        <span class="lbl">{{ t('rowhist.shadowTable') }}</span>
        <input v-model="shadowTable" list="rh-cands" :placeholder="t('rowhist.shadowPh')" />
        <datalist id="rh-cands">
          <option v-for="c in candidates" :key="c" :value="c" />
        </datalist>
        <button class="primary" :disabled="loading" @click="loadHistory">{{ loading ? '…' : t('rowhist.load') }}</button>
      </div>
      <div class="pk-info">
        <span class="lbl">{{ t('rowhist.pk') }}</span>
        <code>{{ JSON.stringify(pk) }}</code>
      </div>
      <div v-if="!history" class="empty">{{ t('rowhist.noLoaded') }}</div>
      <div v-else class="result">
        <p class="muted">{{ t('rowhist.versions', { n: history.rowCount }) }}</p>
        <table class="mini-tbl">
          <thead><tr><th v-for="c in history.columns" :key="c.name">{{ c.name }}</th></tr></thead>
          <tbody>
            <tr v-for="(row, i) in history.rows" :key="i">
              <td v-for="c in history.columns" :key="c.name">{{ row[c.name] == null ? 'NULL' : String(row[c.name]).slice(0, 80) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.rh { min-width: 720px; min-height: 380px; max-height: 70vh; display: flex; flex-direction: column; gap: 8px; }
.cfg, .pk-info { display: flex; align-items: center; gap: 8px; }
.lbl { font-size: 12px; color: var(--muted); }
.cfg input, .pk-info code { padding: 4px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; font-family: var(--font-mono); }
.cfg input { flex: 1; }
.cfg .primary { padding: 5px 14px; background: var(--accent, #7c6cff); color: #fff; border: 1px solid var(--accent, #7c6cff); border-radius: 4px; cursor: pointer; font-size: 12px; }
.empty { padding: 40px; text-align: center; color: var(--muted); }
.result { flex: 1; overflow: auto; }
.muted { color: var(--muted); font-size: 11px; }
.mini-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
.mini-tbl th, .mini-tbl td { border: 1px solid var(--border); padding: 3px 6px; font-family: var(--font-mono); white-space: nowrap; }
.mini-tbl th { background: var(--panel); position: sticky; top: 0; }
</style>
