<script setup lang="ts">
import type { ConnectionConfig, QueryHistoryEntry } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { t } from '../i18n'
import Modal from './Modal.vue'

const client = useDataClient()
const emit = defineEmits<{ close: []; openSql: [string, string] }>()

interface LogRow extends QueryHistoryEntry {
  connName: string
}

const rows = ref<LogRow[]>([])
const loading = ref(true)
const term = ref('')
const status = ref<'all' | 'ok' | 'err'>('all')
const connFilter = ref('')
const conns = ref<ConnectionConfig[]>([])

onMounted(async () => {
  try {
    conns.value = await client.connections.list()
    const all = await Promise.all(
      conns.value.map(async (c) => {
        try {
          const h = await client.connections.history(c.id, 200)
          return h.map((e) => ({ ...e, connName: c.name || c.id }))
        } catch {
          return [] as LogRow[]
        }
      }),
    )
    rows.value = all.flat().sort((a, b) => b.executedAt - a.executedAt)
  } finally {
    loading.value = false
  }
})

const filtered = computed(() => {
  const q = term.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (status.value === 'ok' && !r.success) return false
    if (status.value === 'err' && r.success) return false
    if (connFilter.value && r.connectionId !== connFilter.value) return false
    if (q && !r.sql.toLowerCase().includes(q)) return false
    return true
  })
})

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString()
}
function oneLine(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

function pick(r: LogRow): void {
  emit('openSql', r.connectionId, r.sql)
  emit('close')
}

async function exportCsv(): Promise<void> {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
  const header = 'time,connection,status,duration_ms,sql'
  const lines = filtered.value.map((r) =>
    [esc(fmtTime(r.executedAt)), esc(r.connName), r.success ? 'ok' : 'error', r.durationMs ?? '', esc(oneLine(r.sql))].join(','),
  )
  await client.files.saveText({
    defaultName: 'skylerx-operation-log.csv',
    content: [header, ...lines].join('\n'),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
}
</script>

<template>
  <Modal :title="t('oplog.title')" @close="emit('close')">
    <div class="oplog">
      <div class="bar">
        <input v-model="term" class="q" :placeholder="t('oplog.searchPh')" />
        <select v-model="status" class="sel">
          <option value="all">{{ t('oplog.statusAll') }}</option>
          <option value="ok">{{ t('oplog.statusOk') }}</option>
          <option value="err">{{ t('oplog.statusErr') }}</option>
        </select>
        <select v-model="connFilter" class="sel">
          <option value="">{{ t('oplog.allConns') }}</option>
          <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name || c.id }}</option>
        </select>
        <button class="exp" :disabled="!filtered.length" @click="exportCsv">{{ t('oplog.exportCsv') }}</button>
      </div>

      <div v-if="loading" class="hint">{{ t('common.loading') }}</div>
      <div v-else-if="!filtered.length" class="hint">{{ t('oplog.empty') }}</div>
      <div v-else class="rows">
        <div v-for="r in filtered" :key="r.connectionId + ':' + r.id" class="row" @click="pick(r)">
          <span class="st" :class="{ ok: r.success, err: !r.success }">{{ r.success ? '✓' : '✗' }}</span>
          <span class="time">{{ fmtTime(r.executedAt) }}</span>
          <span class="conn">{{ r.connName }}</span>
          <span class="dur">{{ r.durationMs == null ? '' : r.durationMs + 'ms' }}</span>
          <span class="sql">{{ oneLine(r.sql) }}</span>
        </div>
      </div>
      <p v-if="!loading && filtered.length" class="foot">{{ t('oplog.foot', { n: filtered.length }) }}</p>
    </div>
  </Modal>
</template>

<style scoped>
.oplog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 720px;
  max-width: 88vw;
}
.bar {
  display: flex;
  gap: 8px;
}
.bar .q {
  flex: 1;
}
.bar input,
.bar select,
.bar button {
  padding: 7px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.bar .exp {
  cursor: pointer;
  background: var(--panel);
}
.bar .exp:disabled {
  opacity: 0.5;
  cursor: default;
}
.hint {
  font-size: 13px;
  color: var(--muted);
  padding: 12px 2px;
  text-align: center;
}
.rows {
  max-height: 56vh;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.row:last-child {
  border-bottom: none;
}
.row:hover {
  background: rgba(124, 108, 255, 0.14);
}
.st {
  width: 14px;
  text-align: center;
}
.st.ok {
  color: #4caf50;
}
.st.err {
  color: var(--err, #e04050);
}
.time {
  color: var(--muted);
  white-space: nowrap;
}
.conn {
  color: var(--accent, #7c6cff);
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dur {
  color: var(--muted);
  white-space: nowrap;
  min-width: 48px;
  text-align: right;
}
.sql {
  flex: 1;
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.foot {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
</style>
