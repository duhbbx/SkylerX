<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ConnectionConfig, DbDialect, type QueryResult } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { type DataDiff, diffRows, generateDataSync } from '../data-diff'
import { familyOf, quoteId } from '../ddl'
import { reportInlineError } from '../errorReporter'
import { t } from '../i18n'
import ConnTargetPicker, { type PickedTarget } from './ConnTargetPicker.vue'
import Modal from './Modal.vue'

const client = useDataClient()
const emit = defineEmits<{ close: []; openSql: [string, string] }>()

const conns = ref<ConnectionConfig[]>([])
const srcPick = ref<PickedTarget>({ connId: '', database: '', schema: '' })
const tgtPick = ref<PickedTarget>({ connId: '', database: '', schema: '' })
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
/** 数据对比走 information_schema + 标准 SQL —— MySQL 系 / PG 系都支持。 */
function fam(d: DbDialect | undefined): 'mysql' | 'pg' | 'other' {
  if (!d) return 'other'
  const f = familyOf(d)
  return f === 'mysql' || f === 'pg' ? f : 'other'
}
const supported = computed(
  () => fam(srcPick.value.dialect) !== 'other' && fam(tgtPick.value.dialect) !== 'other',
)
const summary = computed(() =>
  diff.value
    ? {
        ins: diff.value.inserts.length,
        upd: diff.value.updates.length,
        del: diff.value.deletes.length,
      }
    : null,
)

onMounted(async () => {
  conns.value = await client.connections.list()
})

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
  const s = connOf(srcPick.value.connId)
  const tc = connOf(tgtPick.value.connId)
  if (!s || !tc || !srcTable.value.trim() || !tgtTable.value.trim()) return
  const srcSchema = srcPick.value.schema.trim()
  const tgtSchema = tgtPick.value.schema.trim()
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
    const pk = manual.length ? manual : await primaryKey(s.id, srcSchema, srcTable.value.trim())
    if (!pk.length) {
      error.value = t('ddiff.needKey')
      return
    }
    keyColsInput.value = pk.join(', ') // 回填，便于查看/调整
    keyInfo.value = pk.join(', ')
    const [src, tgt] = await Promise.all([
      fetchRows(s, srcSchema, srcTable.value.trim(), pk),
      fetchRows(tc, tgtSchema, tgtTable.value.trim(), pk),
    ])
    const cols = src.cols
    const d = diffRows(src.rows, tgt.rows, pk, cols)
    diff.value = d
    const tgtRef = `${quoteId(tc.dialect, tgtSchema)}.${quoteId(tc.dialect, tgtTable.value.trim())}`
    sql.value = generateDataSync(d, tc.dialect, tgtRef, pk, cols) || t('ddiff.consistent')
  } catch (e) {
    reportInlineError(error, e)
  } finally {
    busy.value = false
  }
}

function copySql(): void {
  if (sql.value) void navigator.clipboard?.writeText(sql.value)
}
function openInQuery(): void {
  if (sql.value && tgtPick.value.connId) {
    emit('openSql', tgtPick.value.connId, sql.value)
    emit('close')
  }
}
</script>

<template>
  <Modal :title="t('ddiff.title')" width="wide" @close="emit('close')">
    <div class="ddiff">
      <div class="pickers">
        <div class="sidecol">
          <ConnTargetPicker :conns="conns" :label="t('ddiff.srcConn')" @change="srcPick = $event" />
          <input v-model="srcTable" :placeholder="t('ddiff.tablePh')" />
        </div>
        <span class="arrow">→</span>
        <div class="sidecol">
          <ConnTargetPicker :conns="conns" :label="t('ddiff.tgtConn')" @change="tgtPick = $event" />
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
        <span v-if="srcPick.connId && tgtPick.connId && !supported" class="warn">{{ t('diff.onlyMyPgShort') }}</span>
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
  align-items: flex-start;
  gap: 12px;
}
.sidecol {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.sidecol input {
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.arrow {
  padding-top: 24px;
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
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
}
.banner.err {
  color: var(--err, #e04050);
  font-size: 13px;
}
</style>
