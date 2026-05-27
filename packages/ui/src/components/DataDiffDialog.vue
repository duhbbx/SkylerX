<script setup lang="ts">
import { type ConnectionConfig, DbDialect, type QueryResult } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { type DataDiff, diffRows, generateDataSync } from '../data-diff'
import { quoteId } from '../ddl'
import Modal from './Modal.vue'

const client = useDataClient()
const emit = defineEmits<{ close: []; openSql: [string, string] }>()

const conns = ref<ConnectionConfig[]>([])
const srcId = ref('')
const tgtId = ref('')
const srcSchema = ref('')
const tgtSchema = ref('')
const srcTable = ref('')
const tgtTable = ref('')
const limit = ref(2000)
const busy = ref(false)
const error = ref<string | null>(null)
const sql = ref<string | null>(null)
const diff = ref<DataDiff | null>(null)
const keyInfo = ref('')

const connOf = (id: string) => conns.value.find((c) => c.id === id)
function fam(d: DbDialect | undefined): 'mysql' | 'pg' | 'other' {
  if (d && [DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase].includes(d)) return 'mysql'
  if (d && [DbDialect.PostgreSQL, DbDialect.KingbaseES].includes(d)) return 'pg'
  return 'other'
}
function defaultSchema(c: ConnectionConfig | undefined): string {
  if (!c) return ''
  return fam(c.dialect) === 'pg' ? 'public' : (c.database ?? '')
}
const supported = computed(() => {
  const s = connOf(srcId.value)
  const t = connOf(tgtId.value)
  return !!s && !!t && fam(s.dialect) !== 'other' && fam(t.dialect) !== 'other'
})
const summary = computed(() =>
  diff.value
    ? { ins: diff.value.inserts.length, upd: diff.value.updates.length, del: diff.value.deletes.length }
    : null,
)

onMounted(async () => {
  conns.value = await client.connections.list()
})
function onPickSrc(): void {
  srcSchema.value = defaultSchema(connOf(srcId.value))
}
function onPickTgt(): void {
  tgtSchema.value = defaultSchema(connOf(tgtId.value))
}

const esc = (s: string) => s.replace(/'/g, "''")

/** 主键列（information_schema 标准查询，MySQL/PG 通用）。 */
async function primaryKey(connId: string, schema: string, table: string): Promise<string[]> {
  const q = `SELECT kcu.column_name AS c
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = '${esc(schema)}' AND tc.table_name = '${esc(table)}'
    ORDER BY kcu.ordinal_position`
  const res = (await client.connections.execute(connId, q, [])) as QueryResult
  return (res.rows as Record<string, unknown>[]).map((r) => String(r.c))
}

async function fetchRows(
  c: ConnectionConfig,
  schema: string,
  table: string,
  pk: string[],
): Promise<{ cols: string[]; rows: Record<string, unknown>[] }> {
  const ref = `${quoteId(c.dialect, schema)}.${quoteId(c.dialect, table)}`
  const order = pk.map((k) => quoteId(c.dialect, k)).join(', ')
  const q = `SELECT * FROM ${ref} ORDER BY ${order} LIMIT ${Math.max(1, Math.floor(limit.value))}`
  const res = (await client.connections.execute(c.id, q, [])) as QueryResult
  return { cols: res.columns.map((col) => col.name), rows: res.rows as Record<string, unknown>[] }
}

async function runDiff(): Promise<void> {
  const s = connOf(srcId.value)
  const t = connOf(tgtId.value)
  if (!s || !t || !srcTable.value.trim() || !tgtTable.value.trim()) return
  busy.value = true
  error.value = null
  sql.value = null
  diff.value = null
  try {
    const pk = await primaryKey(s.id, srcSchema.value.trim(), srcTable.value.trim())
    if (!pk.length) {
      error.value = '源表未检测到主键，数据对比需要主键来配对行。'
      return
    }
    keyInfo.value = pk.join(', ')
    const [src, tgt] = await Promise.all([
      fetchRows(s, srcSchema.value.trim(), srcTable.value.trim(), pk),
      fetchRows(t, tgtSchema.value.trim(), tgtTable.value.trim(), pk),
    ])
    const cols = src.cols
    const d = diffRows(src.rows, tgt.rows, pk, cols)
    diff.value = d
    const tgtRef = `${quoteId(t.dialect, tgtSchema.value.trim())}.${quoteId(t.dialect, tgtTable.value.trim())}`
    sql.value = generateDataSync(d, t.dialect, tgtRef, pk, cols) || '-- 数据一致，无需同步'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function copySql(): void {
  if (sql.value) void navigator.clipboard?.writeText(sql.value)
}
function openInQuery(): void {
  if (sql.value && tgtId.value) {
    emit('openSql', tgtId.value, sql.value)
    emit('close')
  }
}
</script>

<template>
  <Modal title="数据对比 / 同步（源 → 目标）" @close="emit('close')">
    <div class="ddiff">
      <div class="pickers">
        <div class="side">
          <label>源连接 / 库 / 表</label>
          <select v-model="srcId" @change="onPickSrc">
            <option value="" disabled>选择连接</option>
            <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} · {{ c.dialect }}</option>
          </select>
          <input v-model="srcSchema" placeholder="库/schema" />
          <input v-model="srcTable" placeholder="表名" />
        </div>
        <span class="arrow">→</span>
        <div class="side">
          <label>目标连接 / 库 / 表（将被同步）</label>
          <select v-model="tgtId" @change="onPickTgt">
            <option value="" disabled>选择连接</option>
            <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} · {{ c.dialect }}</option>
          </select>
          <input v-model="tgtSchema" placeholder="库/schema" />
          <input v-model="tgtTable" placeholder="表名" />
        </div>
      </div>

      <div class="actions">
        <label class="lim">最多对比行数 <input v-model.number="limit" type="number" min="1" /></label>
        <button
          class="primary"
          :disabled="busy || !supported || !srcTable.trim() || !tgtTable.trim()"
          @click="runDiff"
        >
          {{ busy ? '对比中…' : '对比' }}
        </button>
        <span v-if="srcId && tgtId && !supported" class="warn">暂仅支持 MySQL / PostgreSQL 系</span>
      </div>

      <div v-if="error" class="banner err">✗ {{ error }}</div>

      <template v-if="sql !== null">
        <div class="sumline">
          主键：<code>{{ keyInfo }}</code> ·
          <b>{{ summary?.ins }}</b> 新增 · <b>{{ summary?.upd }}</b> 更新 ·
          <b>{{ summary?.del }}</b> 删除
        </div>
        <div class="sql-head">
          <span>同步 SQL（在目标执行）</span>
          <span class="grow" />
          <button @click="copySql">复制</button>
          <button class="primary" @click="openInQuery">在目标查询页打开</button>
        </div>
        <pre class="sql">{{ sql }}</pre>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.ddiff {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 660px;
  max-width: 88vw;
}
.pickers {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.side {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.side label {
  font-size: 12px;
  color: var(--muted);
}
.side select,
.side input {
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.arrow {
  padding-bottom: 8px;
  color: var(--muted);
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.actions .lim {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
}
.actions .lim input {
  width: 90px;
  padding: 5px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.warn {
  font-size: 12px;
  color: #e0a020;
}
.sumline {
  font-size: 13px;
  color: var(--muted);
}
.sql-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
}
.sql-head .grow {
  flex: 1;
}
.sql {
  margin: 0;
  max-height: 300px;
  overflow: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
}
.banner.err {
  color: var(--err, #e04050);
  font-size: 13px;
}
</style>
