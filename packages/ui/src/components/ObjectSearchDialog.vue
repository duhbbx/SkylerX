<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ConnectionConfig, DbDialect, type QueryResult } from '@db-tool/shared-types'
import { onMounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { quoteId } from '../ddl'
import { t } from '../i18n'
import Modal from './Modal.vue'

const client = useDataClient()
const emit = defineEmits<{
  close: []
  preview: [string, string]
  reveal: [string, string, string]
}>()

interface Hit {
  schema: string
  table: string
  column?: string
  kind: 'table' | 'view' | 'column'
}

const conns = ref<ConnectionConfig[]>([])
const connId = ref('')
const term = ref('')
const hits = ref<Hit[]>([])
const error = ref<string | null>(null)
const busy = ref(false)
let seq = 0

function fam(d: DbDialect | undefined): 'mysql' | 'pg' | 'other' {
  if (d && [DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase].includes(d)) return 'mysql'
  if (d && [DbDialect.PostgreSQL, DbDialect.KingbaseES].includes(d)) return 'pg'
  return 'other'
}
const connOf = (id: string) => conns.value.find((c) => c.id === id)
const supported = () => fam(connOf(connId.value)?.dialect) !== 'other'

onMounted(async () => {
  conns.value = await client.connections.list()
  connId.value = conns.value[0]?.id ?? ''
})

function rows(res: QueryResult): Record<string, unknown>[] {
  return res.rows as Record<string, unknown>[]
}

async function search(): Promise<void> {
  const c = connOf(connId.value)
  const q = term.value.trim()
  hits.value = []
  error.value = null
  if (!c || q.length < 2) return
  if (fam(c.dialect) === 'other') {
    error.value = t('diff.onlyMyPg')
    return
  }
  const my = fam(c.dialect) === 'mysql'
  const esc = q.replace(/'/g, "''").replace(/[%_\\]/g, (m) => `\\${m}`)
  const like = my ? `LIKE '%${esc}%'` : `ILIKE '%${esc}%'`
  const exclude = my
    ? `TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')`
    : `table_schema NOT IN ('pg_catalog','information_schema')`
  const tableSql = my
    ? `SELECT TABLE_SCHEMA AS sch, TABLE_NAME AS obj, TABLE_TYPE AS ty FROM information_schema.TABLES
       WHERE ${exclude} AND TABLE_NAME ${like} ORDER BY TABLE_SCHEMA, TABLE_NAME LIMIT 100`
    : `SELECT table_schema AS sch, table_name AS obj, table_type AS ty FROM information_schema.tables
       WHERE ${exclude} AND table_name ${like} ORDER BY table_schema, table_name LIMIT 100`
  const colSql = my
    ? `SELECT TABLE_SCHEMA AS sch, TABLE_NAME AS obj, COLUMN_NAME AS col FROM information_schema.COLUMNS
       WHERE ${exclude} AND COLUMN_NAME ${like} ORDER BY TABLE_SCHEMA, TABLE_NAME LIMIT 100`
    : `SELECT table_schema AS sch, table_name AS obj, column_name AS col FROM information_schema.columns
       WHERE ${exclude} AND column_name ${like} ORDER BY table_schema, table_name LIMIT 100`

  const mine = ++seq
  busy.value = true
  try {
    const [tRes, cRes] = await Promise.all([
      client.connections.execute(c.id, tableSql, []) as Promise<QueryResult>,
      client.connections.execute(c.id, colSql, []) as Promise<QueryResult>,
    ])
    if (mine !== seq) return // 已被新搜索取代
    const out: Hit[] = []
    for (const r of rows(tRes)) {
      out.push({
        schema: String(r.sch),
        table: String(r.obj),
        kind: /view/i.test(String(r.ty)) ? 'view' : 'table',
      })
    }
    for (const r of rows(cRes)) {
      out.push({
        schema: String(r.sch),
        table: String(r.obj),
        column: String(r.col),
        kind: 'column',
      })
    }
    hits.value = out
  } catch (e) {
    if (mine === seq) error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (mine === seq) busy.value = false
  }
}

// 输入防抖
let timer: ReturnType<typeof setTimeout> | undefined
watch([term, connId], () => {
  clearTimeout(timer)
  timer = setTimeout(() => void search(), 280)
})

function icon(h: Hit): string {
  return h.kind === 'column' ? '·' : h.kind === 'view' ? '◫' : '▦'
}

// 点击结果 = 在导航树中定位选中该对象
function reveal(h: Hit): void {
  const c = connOf(connId.value)
  if (!c) return
  emit('reveal', c.id, h.schema, h.table)
  emit('close')
}
// 预览 = 查询前 200 行
function preview(h: Hit): void {
  const c = connOf(connId.value)
  if (!c) return
  emit('preview', c.id, `${quoteId(c.dialect, h.schema)}.${quoteId(c.dialect, h.table)}`)
  emit('close')
}
</script>

<template>
  <Modal :title="t('osearch.title')" @close="emit('close')">
    <div class="osearch">
      <div class="bar">
        <select v-model="connId" class="conn">
          <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} · {{ c.dialect }}</option>
        </select>
        <input
          v-model="term"
          class="q"
          autofocus
          :placeholder="t('osearch.ph')"
          @keyup.enter="search"
        />
      </div>

      <div v-if="!supported()" class="hint warn">{{ t('osearch.unsupported') }}</div>
      <div v-else-if="error" class="hint err">{{ error }}</div>
      <div v-else-if="busy" class="hint">{{ t('osearch.searching') }}</div>
      <div v-else-if="term.trim().length >= 2 && !hits.length" class="hint">{{ t('osearch.noMatch') }}</div>
      <div v-else-if="term.trim().length < 2" class="hint">{{ t('osearch.min') }}</div>

      <div v-if="hits.length" class="results">
        <div v-for="(h, i) in hits" :key="i" class="hit" @click="reveal(h)">
          <span class="ico">{{ icon(h) }}</span>
          <span class="path">{{ h.schema }}.<b>{{ h.table }}</b><template v-if="h.column">.<span class="col">{{ h.column }}</span></template></span>
          <span class="kind">{{ h.kind === 'column' ? t('osearch.col') : h.kind === 'view' ? t('osearch.view') : t('osearch.table') }}</span>
          <button class="prev-btn" :title="t('osearch.previewTitle')" @click.stop="preview(h)">{{ t('osearch.preview') }}</button>
        </div>
      </div>
      <p v-if="hits.length" class="foot">{{ t('osearch.foot') }}</p>
    </div>
  </Modal>
</template>

<style scoped>
.osearch {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 560px;
  max-width: 84vw;
}
.bar {
  display: flex;
  gap: 8px;
}
.bar .conn {
  flex: none;
  max-width: 200px;
}
.bar .q {
  flex: 1;
}
.bar select,
.bar input {
  padding: 7px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.hint {
  font-size: 13px;
  color: var(--muted);
  padding: 4px 2px;
}
.hint.err {
  color: var(--err, #e04050);
}
.hint.warn {
  color: #e0a020;
}
.results {
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.hit {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.hit:hover {
  background: rgba(124, 108, 255, 0.14);
}
.ico {
  width: 16px;
  text-align: center;
  color: var(--muted);
}
.path {
  flex: 1;
  font-family: ui-monospace, monospace;
}
.path .col {
  color: var(--accent, #7c6cff);
}
.kind {
  font-size: 11px;
  color: var(--muted);
}
.prev-btn {
  flex: none;
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  opacity: 0;
}
.hit:hover .prev-btn {
  opacity: 1;
}
.foot {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
</style>
