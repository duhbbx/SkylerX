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
import { onMounted, ref } from 'vue'
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
const progress = ref({ done: 0, total: 0 })

interface Hit {
  table: string
  col: string
  /** 命中行的样例（最多 50 行） */
  rows: Record<string, unknown>[]
}
const hits = ref<Hit[]>([])
const focused = ref<Hit | null>(null)

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
  const fam = familyOf(
    conns.value.find((c) => c.id === connId.value)?.dialect ?? ('mysql' as never),
  )
  if (fam === 'mysql') {
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
  if (fam === 'pg') {
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
    const conn = conns.value.find((c) => c.id === connId.value)
    const fam = familyOf(conn?.dialect ?? ('mysql' as never))
    const tables = [...byTable.entries()]
    progress.value = { done: 0, total: tables.length }

    // 并发跑，每次 concurrency 张表
    const operator = matchMode.value === 'exact' ? '=' : 'LIKE'
    const valLit =
      matchMode.value === 'exact'
        ? `'${value.value.replace(/'/g, "''")}'`
        : `'%${value.value.replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_')}%'`

    const next = async (): Promise<void> => {
      while (tables.length > 0) {
        const job = tables.shift()
        if (!job) break
        const [tbl, cs] = job
        const where = cs
          .map((c) =>
            fam === 'pg'
              ? `${quoteId('postgresql' as never, c)}::text ${operator} ${valLit}`
              : `${quoteId('mysql' as never, c)} ${operator} ${valLit}`,
          )
          .join(' OR ')
        const sql =
          fam === 'pg'
            ? `SELECT * FROM ${quoteId('postgresql' as never, tbl)} WHERE ${where} LIMIT ${maxPerTable.value}`
            : `SELECT * FROM ${quoteId('mysql' as never, tbl)} WHERE ${where} LIMIT ${maxPerTable.value}`
        try {
          const r = await client.connections.execute(connId.value, sql)
          if (r.rowCount > 0) {
            // 找到第一个匹配的列做标签（不精确但够展示）
            for (const c of cs) {
              if (
                r.rows.some((row) => {
                  const v = row[c]
                  if (v == null) return false
                  const s = String(v).toLowerCase()
                  return matchMode.value === 'exact'
                    ? s === value.value.toLowerCase()
                    : s.includes(value.value.toLowerCase())
                })
              ) {
                hits.value.push({ table: tbl, col: c, rows: r.rows })
                break
              }
            }
          }
        } catch {
          /* 单表失败不致命：可能是视图、权限不够等 */
        }
        progress.value.done++
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => next()))
  } finally {
    running.value = false
  }
}
</script>

<template>
  <Modal :title="t('search.title')" width="xl" fixed-height storage-key="search-value" @close="emit('close')">
    <div class="srch">
      <div class="bar">
        <select v-model="connId" :title="t('aichat.conn')">
          <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name || c.dialect }}</option>
        </select>
        <input v-model="value" class="grow" :placeholder="t('search.valuePh')" @keydown.enter="runSearch" />
        <input v-model="tableFilter" class="tf" :placeholder="t('search.tableFilterPh')" />
        <select v-model="matchMode">
          <option value="contains">{{ t('search.contains') }}</option>
          <option value="exact">{{ t('search.exact') }}</option>
        </select>
        <button class="primary" :disabled="running" @click="runSearch">
          {{ running ? `⏳ ${progress.done}/${progress.total}` : '🔍 ' + t('search.run') }}
        </button>
      </div>

      <div class="body">
        <div class="hits">
          <div v-if="!hits.length && !running" class="empty">{{ t('search.empty') }}</div>
          <div
            v-for="(h, i) in hits"
            :key="i"
            class="hit"
            :class="{ on: focused === h }"
            @click="focused = h"
          >
            <span class="t-name">{{ h.table }}</span>
            <span class="c-name">.{{ h.col }}</span>
            <span class="count">{{ h.rows.length }}</span>
          </div>
        </div>
        <div class="preview">
          <div v-if="!focused" class="empty">{{ t('search.pickHit') }}</div>
          <table v-else class="mini-tbl">
            <thead>
              <tr>
                <th v-for="(_, k) in focused.rows[0]" :key="String(k)">{{ k }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in focused.rows.slice(0, 20)" :key="i">
                <td v-for="(_, k) in row" :key="String(k)">{{ row[k as string] == null ? 'NULL' : String(row[k as string]).slice(0, 60) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.srch { min-width: 920px; min-height: 480px; max-height: 75vh; display: flex; flex-direction: column; gap: 8px; }
.bar { display: flex; gap: 6px; align-items: center; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.bar select, .bar input { padding: 4px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; }
.bar .grow { flex: 1; }
.bar .tf { width: 160px; font-family: ui-monospace, monospace; }
.bar .primary {
  padding: 5px 14px;
  font-size: 13px;
  background: var(--accent, #7c6cff);
  color: #fff;
  border: 1px solid var(--accent, #7c6cff);
  border-radius: 4px;
  cursor: pointer;
}
.bar .primary:disabled { opacity: 0.6; cursor: not-allowed; }
.body { flex: 1; display: flex; gap: 8px; overflow: hidden; }
.hits { width: 280px; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; }
.hit {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 8px; border-bottom: 1px solid var(--border);
  cursor: pointer; font-family: ui-monospace, monospace; font-size: 12px;
}
.hit:hover { background: rgba(124, 108, 255, 0.10); }
.hit.on { background: rgba(124, 108, 255, 0.18); }
.t-name { font-weight: 600; }
.c-name { color: var(--muted); }
.count { margin-left: auto; padding: 1px 6px; background: var(--accent, #7c6cff); color: #fff; border-radius: 8px; font-size: 10px; }
.preview { flex: 1; overflow: auto; border: 1px solid var(--border); border-radius: 6px; }
.empty { padding: 40px; text-align: center; color: var(--muted); }
.mini-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
.mini-tbl th, .mini-tbl td { border: 1px solid var(--border); padding: 3px 6px; text-align: left; font-family: ui-monospace, monospace; white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.mini-tbl th { background: var(--panel); position: sticky; top: 0; }
</style>
