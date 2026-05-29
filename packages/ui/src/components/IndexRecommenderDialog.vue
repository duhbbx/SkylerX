<script setup lang="ts">/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * C5「索引推荐器」弹窗。
 *
 * 流程：
 *  1. client.connections.history(connId, 1000) 拉历史 SQL
 *  2. information_schema (MySQL) 或 pg_index (PG) 拉已存在索引
 *  3. extractColumnUsage → recommendIndexes 算出候选
 *  4. 表格列出建议，点「采用」把 DDL 抛给上层（emit runSql）
 *
 * 仅支持 MySQL 家族 / PG 家族，其它方言给一行不支持提示。
 */
import { type ConnectionConfig, DbDialect, type QueryHistoryEntry } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { t } from '../i18n'
import {
  type IndexHint,
  type QueryPattern,
  extractColumnUsage,
  recommendIndexes,
} from '../index-recommender'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig }>()
const emit = defineEmits<{ close: []; runSql: [string] }>()

const client = useDataClient()

type Phase = 'scanning' | 'done' | 'unsupported' | 'error'
const phase = ref<Phase>('scanning')
const error = ref<string | null>(null)
const hints = ref<IndexHint[]>([])
const historyCount = ref(0)
const knownCount = ref(0)
const adopted = ref<Set<number>>(new Set())

function fam(d: DbDialect): 'mysql' | 'pg' | 'other' {
  if ([DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase, DbDialect.TiDB].includes(d)) {
    return 'mysql'
  }
  if (
    [
      DbDialect.PostgreSQL,
      DbDialect.KingbaseES,
      DbDialect.CockroachDB,
      DbDialect.Greenplum,
      DbDialect.OpenGauss,
      DbDialect.H2,
    ].includes(d)
  ) {
    return 'pg'
  }
  return 'other'
}

/** 历史 SQL 聚合为模式：完全相同 SQL 合一行（计数 + 累计耗时）。 */
function groupHistory(entries: QueryHistoryEntry[]): QueryPattern[] {
  const map = new Map<string, QueryPattern>()
  for (const e of entries) {
    const sql = (e.sql || '').trim()
    if (!sql) continue
    // 仅推荐 SELECT/JOIN 类语句的索引；DML/DDL 跳过
    if (!/^(\s*\(?\s*)?(?:WITH|SELECT)\b/i.test(sql)) continue
    const cur = map.get(sql)
    if (cur) {
      cur.count += 1
      cur.totalMs += e.durationMs ?? 0
    } else {
      map.set(sql, { sql, count: 1, totalMs: e.durationMs ?? 0 })
    }
  }
  return Array.from(map.values())
}

interface KnownIndexRow {
  table: string
  index: string
  column: string
}

async function fetchKnownIndexes(
  f: 'mysql' | 'pg',
): Promise<{ table: string; columns: string[] }[]> {
  const sql =
    f === 'mysql'
      ? `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, COLUMN_NAME AS column_name
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`
      : `SELECT t.relname AS table_name, ic.relname AS index_name, a.attname AS column_name
         FROM pg_index i
         JOIN pg_class t ON i.indrelid = t.oid
         JOIN pg_class ic ON i.indexrelid = ic.oid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
         WHERE t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')`

  const schemaExtra = props.conn.extra?.schema
  const opts = {
    database: props.conn.database,
    schema: typeof schemaExtra === 'string' ? schemaExtra : undefined,
  }
  const res = await client.connections.execute(props.conn.id, sql, [], opts)
  const rows = (res.rows as Record<string, unknown>[]).map(
    (r): KnownIndexRow => ({
      table: String(r.table_name ?? ''),
      index: String(r.index_name ?? ''),
      column: String(r.column_name ?? ''),
    }),
  )
  // 按 (table, index) 聚合成列数组
  const grouped = new Map<string, { table: string; columns: string[] }>()
  for (const r of rows) {
    const key = `${r.table}::${r.index}`
    const cur = grouped.get(key)
    if (cur) cur.columns.push(r.column)
    else grouped.set(key, { table: r.table, columns: [r.column] })
  }
  return Array.from(grouped.values())
}

async function run(): Promise<void> {
  phase.value = 'scanning'
  error.value = null
  hints.value = []
  adopted.value = new Set()
  try {
    const f = fam(props.conn.dialect)
    if (f === 'other') {
      phase.value = 'unsupported'
      return
    }
    const history = await client.connections.history(props.conn.id, 1000)
    const patterns = groupHistory(history)
    historyCount.value = patterns.length
    if (patterns.length === 0) {
      hints.value = []
      phase.value = 'done'
      return
    }
    const known = await fetchKnownIndexes(f)
    knownCount.value = known.length
    const usages = extractColumnUsage(patterns)
    hints.value = recommendIndexes(usages, known, f)
    phase.value = 'done'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    phase.value = 'error'
  }
}

function adopt(idx: number): void {
  const h = hints.value[idx]
  if (!h) return
  emit('runSql', h.ddl)
  adopted.value.add(idx)
  // 触发响应式更新
  adopted.value = new Set(adopted.value)
  toast.success(t('idxrec.adopted'))
}

async function copyAll(): Promise<void> {
  if (hints.value.length === 0) return
  const txt = hints.value.map((h) => h.ddl).join('\n')
  try {
    await navigator.clipboard?.writeText(txt)
    toast.success(t('idxrec.copied'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

const showEmpty = computed(() => phase.value === 'done' && hints.value.length === 0)

onMounted(() => {
  void run()
})
</script>

<template>
  <Modal
    :title="t('idxrec.title')"
    width="wide"
    fixed-height
    storage-key="index-recommender"
    @close="emit('close')"
  >
    <div class="ir">
      <div class="bar">
        <span class="conn-name">{{ props.conn.name || props.conn.id }} · {{ props.conn.dialect }}</span>
        <span v-if="phase === 'done'" class="meta">
          {{ t('idxrec.scanned', { patterns: historyCount, known: knownCount }) }}
        </span>
        <span class="spacer"></span>
        <button v-if="phase === 'done'" class="ghost" @click="run">{{ t('idxrec.rescan') }}</button>
        <button
          v-if="phase === 'done' && hints.length > 0"
          class="ghost"
          @click="copyAll"
        >
          {{ t('idxrec.copyAll') }}
        </button>
      </div>

      <div v-if="phase === 'scanning'" class="status">
        <div class="spinner"></div>
        <div>{{ t('idxrec.scanning') }}</div>
      </div>
      <div v-else-if="phase === 'unsupported'" class="status">
        {{ t('idxrec.unsupported') }}
      </div>
      <div v-else-if="phase === 'error'" class="status err">
        <div class="err-msg">✗ {{ error }}</div>
        <button class="ghost" @click="run">{{ t('idxrec.rescan') }}</button>
      </div>
      <div v-else-if="historyCount === 0" class="status">{{ t('idxrec.noHistory') }}</div>
      <div v-else-if="showEmpty" class="status">{{ t('idxrec.empty') }}</div>
      <div v-else class="table-wrap">
        <table class="hints">
          <thead>
            <tr>
              <th>{{ t('idxrec.col.table') }}</th>
              <th>{{ t('idxrec.col.columns') }}</th>
              <th class="num">{{ t('idxrec.score') }}</th>
              <th>{{ t('idxrec.reason') }}</th>
              <th>{{ t('idxrec.col.ddl') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(h, i) in hints" :key="i" :class="{ done: adopted.has(i) }">
              <td class="tbl">{{ h.table }}</td>
              <td>
                <code v-for="c in h.columns" :key="c" class="chip">{{ c }}</code>
              </td>
              <td class="num">{{ h.scoreEstimate }}</td>
              <td class="reason">{{ h.reason }}</td>
              <td class="ddl"><code>{{ h.ddl }}</code></td>
              <td>
                <button class="primary" :disabled="adopted.has(i)" @click="adopt(i)">
                  {{ adopted.has(i) ? t('idxrec.adopted') : t('idxrec.adopt') }}
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
.ir {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.conn-name {
  font-weight: 600;
  color: var(--text);
}
.meta {
  font-size: 12px;
  color: var(--muted);
  font-family: ui-monospace, monospace;
}
.spacer {
  flex: 1 1 auto;
}
.bar button {
  padding: 5px 12px;
  font-size: 12px;
}
.status {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--muted);
  text-align: center;
  padding: 30px;
}
.status.err {
  color: var(--err, #e04050);
}
.err-msg {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  max-width: 80%;
  word-break: break-word;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
table.hints {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
table.hints thead {
  position: sticky;
  top: 0;
  background: var(--panel);
  z-index: 1;
}
table.hints th,
table.hints td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
table.hints th.num,
table.hints td.num {
  text-align: right;
  font-family: ui-monospace, monospace;
}
table.hints tr.done {
  opacity: 0.55;
}
.tbl {
  font-weight: 600;
}
.chip {
  display: inline-block;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 6px;
  margin-right: 4px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.reason {
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.ddl code {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  word-break: break-all;
  white-space: pre-wrap;
}
button.primary {
  padding: 4px 12px;
  font-size: 12px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
button.primary:disabled {
  background: var(--border);
  color: var(--muted);
  cursor: default;
}
</style>
