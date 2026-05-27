<script setup lang="ts">
import { type ConnectionConfig, DbDialect, type QueryResult } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { type DataDiff, diffRows, generateDataSync } from '../data-diff'
import { quoteId } from '../ddl'
import { t } from '../i18n'
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
const keyColsInput = ref('') // 配对列（逗号分隔）：留空时自动检测主键，可手填/覆盖
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
  const tc = connOf(tgtId.value)
  if (!s || !tc || !srcTable.value.trim() || !tgtTable.value.trim()) return
  busy.value = true
  error.value = null
  sql.value = null
  diff.value = null
  try {
    // 配对列：优先用手填的，否则自动检测源表主键
    const manual = keyColsInput.value
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    const pk = manual.length
      ? manual
      : await primaryKey(s.id, srcSchema.value.trim(), srcTable.value.trim())
    if (!pk.length) {
      error.value = t('ddiff.needKey')
      return
    }
    keyColsInput.value = pk.join(', ') // 回填，便于查看/调整
    keyInfo.value = pk.join(', ')
    const [src, tgt] = await Promise.all([
      fetchRows(s, srcSchema.value.trim(), srcTable.value.trim(), pk),
      fetchRows(tc, tgtSchema.value.trim(), tgtTable.value.trim(), pk),
    ])
    const cols = src.cols
    const d = diffRows(src.rows, tgt.rows, pk, cols)
    diff.value = d
    const tgtRef = `${quoteId(tc.dialect, tgtSchema.value.trim())}.${quoteId(tc.dialect, tgtTable.value.trim())}`
    sql.value = generateDataSync(d, tc.dialect, tgtRef, pk, cols) || t('ddiff.consistent')
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
  <Modal :title="t('ddiff.title')" @close="emit('close')">
    <div class="ddiff">
      <div class="pickers">
        <div class="side">
          <label>{{ t('ddiff.srcConn') }}</label>
          <select v-model="srcId" @change="onPickSrc">
            <option value="" disabled>{{ t('diff.selectConn') }}</option>
            <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} · {{ c.dialect }}</option>
          </select>
          <input v-model="srcSchema" :placeholder="t('diff.schemaPh')" />
          <input v-model="srcTable" :placeholder="t('ddiff.tablePh')" />
        </div>
        <span class="arrow">→</span>
        <div class="side">
          <label>{{ t('ddiff.tgtConn') }}</label>
          <select v-model="tgtId" @change="onPickTgt">
            <option value="" disabled>{{ t('diff.selectConn') }}</option>
            <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} · {{ c.dialect }}</option>
          </select>
          <input v-model="tgtSchema" :placeholder="t('diff.schemaPh')" />
          <input v-model="tgtTable" :placeholder="t('ddiff.tablePh')" />
        </div>
      </div>

      <div class="actions">
        <label class="lim">{{ t('ddiff.keyCols') }} <input v-model="keyColsInput" class="keycol" :placeholder="t('ddiff.keyColsPh')" /></label>
        <label class="lim">{{ t('ddiff.maxRows') }} <input v-model.number="limit" type="number" min="1" /></label>
        <button
          class="primary"
          :disabled="busy || !supported || !srcTable.trim() || !tgtTable.trim()"
          @click="runDiff"
        >
          {{ busy ? t('diff.comparing') : t('diff.compare') }}
        </button>
        <span v-if="srcId && tgtId && !supported" class="warn">{{ t('diff.onlyMyPgShort') }}</span>
      </div>

      <div v-if="error" class="banner err">✗ {{ error }}</div>

      <template v-if="sql !== null">
        <div class="sumline">
          {{ t('ddiff.pk') }}<code>{{ keyInfo }}</code> ·
          <b>{{ summary?.ins }}</b> {{ t('ddiff.ins') }} · <b>{{ summary?.upd }}</b> {{ t('ddiff.upd') }} ·
          <b>{{ summary?.del }}</b> {{ t('ddiff.del') }}
        </div>
        <div class="sql-head">
          <span>{{ t('ddiff.syncSql') }}</span>
          <span class="grow" />
          <button @click="copySql">{{ t('common.copy') }}</button>
          <button class="primary" @click="openInQuery">{{ t('diff.openTarget') }}</button>
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
.actions .lim input.keycol {
  width: 170px;
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
