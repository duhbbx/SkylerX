<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 跨表全文搜索（A2 + A8）：在某个连接上，把一个值扫遍所有「字符列」并报告命中。
 *
 * 实现策略：
 *  - 通过 information_schema 拿所有 TEXT/VARCHAR/CHAR 列（PG: text/varchar/character；MySQL 同名）
 *  - 给每张表生成一条 SELECT * FROM t WHERE col1 LIKE :v OR col2 LIKE :v ... LIMIT 50
 *  - 并发跑（同时最多 6 条，避免连接池打满），结果合并展示
 *  - 大库可能有几千列，搜前先按表/前缀过滤范围
 *
 * 触发：⌘K 命令面板 / 结果集单元格右键「找这个值还出现在哪」（A8 复用本对话框，prefillValue）
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { familyOf, quoteId } from '../ddl'
import { toast } from '../dialog'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{
  /** 可选默认连接 ID */
  initialConnId?: string
  /** A8 反向查找：来自单元格右键时预填该值 */
  prefillValue?: string
}>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()

const conns = ref<ConnectionConfig[]>([])
const connId = ref<string>(props.initialConnId ?? '')
const value = ref<string>(props.prefillValue ?? '')
const tableFilter = ref<string>('') // 限制只搜表名匹配此前缀的（防大库爆）
const matchMode = ref<'contains' | 'exact'>('contains')
const maxPerTable = ref<number>(50)
const concurrency = 6
const running = ref(false)
const searched = ref(false) // 是否已经搜过至少一次（区分"初始"与"无命中"）
const progress = ref({ done: 0, total: 0 })

interface Hit {
  table: string
  /** 命中此值的所有字符列 */
  cols: string[]
  /** 命中行的样例（最多 maxPerTable 行） */
  rows: Record<string, unknown>[]
}
const hits = ref<Hit[]>([])
const focused = ref<Hit | null>(null)

const fam = computed(() => {
  const d = conns.value.find((c) => c.id === connId.value)?.dialect
  return familyOf(d ?? ('mysql' as never))
})
const supported = computed(() => fam.value === 'mysql' || fam.value === 'pg')

const totalRows = computed(() => hits.value.reduce((s, h) => s + h.rows.length, 0))
const focusedCols = computed(() => new Set(focused.value?.cols ?? []))

onMounted(async () => {
  conns.value = await client.connections.list()
  if (!connId.value && conns.value.length) connId.value = conns.value[0].id
})

interface ColumnInfo {
  table: string
  column: string
}

/** 拉当前连接所有"可搜"的字符列（按方言） */
async function listSearchableColumns(): Promise<ColumnInfo[]> {
  if (fam.value === 'mysql') {
    const r = await client.connections.execute(
      connId.value,
      `SELECT TABLE_NAME AS \`table\`, COLUMN_NAME AS \`column\`
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND DATA_TYPE IN ('varchar','char','text','tinytext','mediumtext','longtext','json')
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    )
    return r.rows as unknown as ColumnInfo[]
  }
  if (fam.value === 'pg') {
    const r = await client.connections.execute(
      connId.value,
      `SELECT table_name AS "table", column_name AS "column"
       FROM information_schema.columns
       WHERE table_schema NOT IN ('pg_catalog','information_schema')
         AND data_type IN ('character varying','character','text','json','jsonb')
       ORDER BY table_name, ordinal_position`,
    )
    return r.rows as unknown as ColumnInfo[]
  }
  return []
}

async function runSearch(): Promise<void> {
  if (!value.value) {
    toast.warn(t('search.emptyValue'))
    return
  }
  if (!connId.value) {
    toast.warn(t('search.noConn'))
    return
  }
  if (!supported.value) {
    toast.warn(t('search.unsupported'))
    return
  }
  running.value = true
  hits.value = []
  focused.value = null
  try {
    let cols = await listSearchableColumns()
    if (tableFilter.value.trim()) {
      const pat = tableFilter.value.trim().toLowerCase()
      cols = cols.filter((c) => c.table.toLowerCase().includes(pat))
    }
    // 按表分组
    const byTable = new Map<string, string[]>()
    for (const c of cols) {
      const arr = byTable.get(c.table) ?? []
      arr.push(c.column)
      byTable.set(c.table, arr)
    }
    const isPg = fam.value === 'pg'
    const tables = [...byTable.entries()]
    progress.value = { done: 0, total: tables.length }

    // 并发跑，每次 concurrency 张表
    const operator = matchMode.value === 'exact' ? '=' : 'LIKE'
    const valLit =
      matchMode.value === 'exact'
        ? `'${value.value.replace(/'/g, "''")}'`
        : `'%${value.value.replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_')}%'`
    const needle = value.value.toLowerCase()

    const next = async (): Promise<void> => {
      while (tables.length > 0) {
        const job = tables.shift()
        if (!job) break
        const [tbl, cs] = job
        const where = cs
          .map((c) =>
            isPg
              ? `${quoteId('postgresql' as never, c)}::text ${operator} ${valLit}`
              : `${quoteId('mysql' as never, c)} ${operator} ${valLit}`,
          )
          .join(' OR ')
        const sql = isPg
          ? `SELECT * FROM ${quoteId('postgresql' as never, tbl)} WHERE ${where} LIMIT ${maxPerTable.value}`
          : `SELECT * FROM ${quoteId('mysql' as never, tbl)} WHERE ${where} LIMIT ${maxPerTable.value}`
        try {
          const r = await client.connections.execute(connId.value, sql)
          if (r.rowCount > 0) {
            // 收集真正命中的列（二次校验，挡掉 LIKE 转义差异带来的假阳性）
            const matched: string[] = []
            for (const c of cs) {
              const ok = r.rows.some((row) => {
                const v = row[c]
                if (v == null) return false
                const s = String(v).toLowerCase()
                return matchMode.value === 'exact' ? s === needle : s.includes(needle)
              })
              if (ok) matched.push(c)
            }
            if (matched.length) hits.value.push({ table: tbl, cols: matched, rows: r.rows })
          }
        } catch {
          /* 单表失败不致命：可能是视图、权限不够等 */
        }
        progress.value.done++
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => next()))
    if (hits.value.length) focused.value = hits.value[0]
  } finally {
    running.value = false
    searched.value = true
  }
}

/** 把单元格文本按命中子串切片，命中段标 m=true 用于 <mark> 高亮（大小写不敏感）。 */
function segments(text: string, needle: string): { s: string; m: boolean }[] {
  if (!needle) return [{ s: text, m: false }]
  const out: { s: string; m: boolean }[] = []
  const lower = text.toLowerCase()
  const nl = needle.toLowerCase()
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(nl, i)
    if (idx < 0) {
      out.push({ s: text.slice(i), m: false })
      break
    }
    if (idx > i) out.push({ s: text.slice(i, idx), m: false })
    out.push({ s: text.slice(idx, idx + nl.length), m: true })
    i = idx + nl.length
  }
  return out
}

/** 预览单元格：NULL 占位；超长截断到 120 字符（命中一般靠前，够看）。 */
function cellSegments(v: unknown): { s: string; m: boolean }[] | null {
  if (v == null) return null
  let s = String(v)
  if (s.length > 120) s = s.slice(0, 120) + '…'
  return segments(s, value.value)
}
</script>

<template>
  <Modal
    :title="t('search.title')"
    width="xl"
    fixed-height
    storage-key="search-value"
    @close="emit('close')"
  >
    <div class="srch">
      <!-- 工具条：连接 + 搜索值 + 按钮 -->
      <div class="bar">
        <select v-model="connId" class="conn" :title="t('aichat.conn')">
          <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name || c.dialect }}</option>
        </select>
        <input
          v-model="value"
          class="q"
          autofocus
          :placeholder="t('search.valuePh')"
          @keydown.enter="runSearch"
        />
        <button class="primary" :disabled="running || !supported" @click="runSearch">
          <span v-if="running" class="spin" />
          {{ t('search.run') }}
        </button>
      </div>

      <!-- 选项行：匹配模式分段 + 表名过滤 -->
      <div class="opts">
        <div class="seg" role="tablist">
          <button :class="{ on: matchMode === 'contains' }" @click="matchMode = 'contains'">
            {{ t('search.contains') }}
          </button>
          <button :class="{ on: matchMode === 'exact' }" @click="matchMode = 'exact'">
            {{ t('search.exact') }}
          </button>
        </div>
        <input
          v-model="tableFilter"
          class="tf"
          :placeholder="t('search.tableFilterPh')"
          @keydown.enter="runSearch"
        />
      </div>

      <!-- 状态条 -->
      <div v-if="!supported" class="hint warn">{{ t('search.unsupported') }}</div>
      <div v-else-if="running" class="hint progress">
        <span class="bar-track"><span class="bar-fill" :style="{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }" /></span>
        <span class="ptext">{{ t('search.searching', { done: progress.done, total: progress.total }) }}</span>
      </div>
      <div v-else-if="!searched" class="hint">{{ t('search.idle') }}</div>
      <div v-else-if="!hits.length" class="hint">{{ t('search.empty') }}</div>
      <div v-else class="hint summary">
        {{ t('search.summary', { tables: hits.length, rows: totalRows }) }}
      </div>

      <!-- 结果双栏 -->
      <div v-if="hits.length" class="body">
        <div class="hits">
          <div
            v-for="(h, i) in hits"
            :key="i"
            class="hit"
            :class="{ on: focused === h }"
            @click="focused = h"
          >
            <div class="hit-main">
              <span class="t-name">{{ h.table }}</span>
              <span class="count">{{ h.rows.length }}</span>
            </div>
            <div class="hit-cols">{{ h.cols.join(', ') }}</div>
          </div>
        </div>

        <div class="preview">
          <div v-if="!focused" class="empty">{{ t('search.pickHit') }}</div>
          <template v-else>
            <div class="pv-head">
              <span class="pv-table">{{ focused.table }}</span>
              <span class="pv-note">{{ t('search.matchedCols') }}: {{ focused.cols.join(', ') }}</span>
              <span v-if="focused.rows.length > 20" class="pv-note">
                {{ t('search.previewNote', { n: 20, total: focused.rows.length }) }}
              </span>
            </div>
            <div class="pv-scroll">
              <table class="mini-tbl">
                <thead>
                  <tr>
                    <th
                      v-for="(_, k) in focused.rows[0]"
                      :key="String(k)"
                      :class="{ mcol: focusedCols.has(String(k)) }"
                    >
                      {{ k }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in focused.rows.slice(0, 20)" :key="ri">
                    <td
                      v-for="(_, k) in row"
                      :key="String(k)"
                      :class="{ mcol: focusedCols.has(String(k)), nullc: row[k as string] == null }"
                    >
                      <template v-if="cellSegments(row[k as string]) === null">NULL</template>
                      <template v-else>
                        <template v-for="(seg, si) in cellSegments(row[k as string])!" :key="si">
                          <mark v-if="seg.m">{{ seg.s }}</mark>
                          <template v-else>{{ seg.s }}</template>
                        </template>
                      </template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.srch {
  min-width: 880px;
  max-width: 92vw;
  min-height: 460px;
  max-height: 76vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── 工具条 ── */
.bar {
  display: flex;
  gap: 8px;
  align-items: center;
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
  font-size: 13px;
}
.bar .q {
  font-family: var(--font-mono);
}
.bar .primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 18px;
  font-size: 13px;
  font-weight: 600;
  background: var(--accent, #7c6cff);
  color: #fff;
  border: 1px solid var(--accent, #7c6cff);
  border-radius: 6px;
  cursor: pointer;
}
.bar .primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.spin {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── 选项行 ── */
.opts {
  display: flex;
  gap: 8px;
  align-items: center;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.seg button {
  padding: 5px 12px;
  font-size: 12px;
  background: var(--bg);
  color: var(--muted);
  border: none;
  border-right: 1px solid var(--border);
  cursor: pointer;
}
.seg button:last-child {
  border-right: none;
}
.seg button.on {
  background: var(--accent, #7c6cff);
  color: #fff;
}
.opts .tf {
  flex: 1;
  max-width: 260px;
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
  font-family: var(--font-mono);
}

/* ── 状态条 ── */
.hint {
  font-size: 12px;
  color: var(--muted);
  padding: 2px 2px;
}
.hint.warn {
  color: #e0a020;
}
.hint.summary {
  color: var(--text);
  font-weight: 500;
}
.hint.progress {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bar-track {
  flex: 1;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}
.bar-fill {
  display: block;
  height: 100%;
  background: var(--accent, #7c6cff);
  transition: width 0.2s ease;
}
.ptext {
  flex: none;
  font-variant-numeric: tabular-nums;
}

/* ── 结果双栏 ── */
.body {
  flex: 1;
  display: flex;
  gap: 10px;
  overflow: hidden;
}
.hits {
  width: 280px;
  flex: none;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.hit {
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.hit:hover {
  background: rgba(124, 108, 255, 0.1);
}
.hit.on {
  background: rgba(124, 108, 255, 0.18);
}
.hit-main {
  display: flex;
  align-items: center;
  gap: 6px;
}
.t-name {
  font-weight: 600;
  font-family: var(--font-mono);
  font-size: 12.5px;
  word-break: break-all;
}
.count {
  margin-left: auto;
  flex: none;
  padding: 1px 7px;
  background: var(--accent, #7c6cff);
  color: #fff;
  border-radius: 9px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.hit-cols {
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.pv-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.pv-table {
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 13px;
}
.pv-note {
  font-size: 11px;
  color: var(--muted);
}
.pv-scroll {
  flex: 1;
  overflow: auto;
}
.empty {
  padding: 40px;
  text-align: center;
  color: var(--muted);
}
.mini-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.mini-tbl th,
.mini-tbl td {
  border: 1px solid var(--border);
  padding: 3px 6px;
  text-align: left;
  font-family: var(--font-mono);
  white-space: nowrap;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mini-tbl th {
  background: var(--panel);
  position: sticky;
  top: 0;
  z-index: 1;
}
.mini-tbl th.mcol {
  color: var(--accent, #7c6cff);
}
.mini-tbl td.mcol {
  background: rgba(124, 108, 255, 0.06);
}
.mini-tbl td.nullc {
  color: var(--muted);
  font-style: italic;
}
.mini-tbl mark {
  background: rgba(124, 108, 255, 0.32);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}
</style>
