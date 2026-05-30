<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * G1 「AI 数据库体检」弹窗
 *
 * 流程：
 *   1) 从 information_schema 一次性拉这个连接当前默认库 / public schema 的：
 *      - columns（name, type, nullable, key, default, comment）
 *      - indexes（table, index_name, column_name, non_unique）
 *      - foreign keys（table, column, ref_table, ref_column）
 *   2) 序列化成紧凑文本（按表分组），交给 pHealthCheck() 拼 prompt
 *   3) 调 askAiChat() 拿回 Markdown 报告，用 marked 渲染；按 H2 拆"分类卡片"
 *
 * 仅支持 MySQL 家族 / PG 家族；其它方言提示不支持。
 * 元数据有体积上限，避免 prompt 爆 token（默认 ~12K 字符截断）。
 */
import { type ConnectionConfig, DbDialect } from '@db-tool/shared-types'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { askAiChat } from '../ai'
import { pHealthCheck } from '../ai-prompts'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { t } from '../i18n'
import { renderMarkdown } from '../markdown'
import { settings } from '../settings'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig }>()
const emit = defineEmits<{ close: []; openSettings: [] }>()

const client = useDataClient()

type Phase = 'collecting' | 'analyzing' | 'done' | 'error'
const phase = ref<Phase>('collecting')
const error = ref<string | null>(null)
const answer = ref('')
const tableCount = ref(0)
const columnCount = ref(0)
const copied = ref(false)
let controller: AbortController | null = null

function fam(d: DbDialect): 'mysql' | 'pg' | 'other' {
  if ([DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase].includes(d)) return 'mysql'
  if (
    [
      DbDialect.PostgreSQL,
      DbDialect.KingbaseES,
      DbDialect.CockroachDB,
      DbDialect.Greenplum,
      DbDialect.OpenGauss,
      DbDialect.H2,
    ].includes(d)
  )
    return 'pg'
  return 'other'
}

interface ColRow {
  table: string
  name: string
  type: string
  nullable: string
  key: string
  default: string
  comment: string
}
interface IdxRow {
  table: string
  index: string
  column: string
  nonUnique: number
}
interface FkRow {
  table: string
  column: string
  refTable: string
  refColumn: string
}

/**
 * 拉元数据。MySQL/PG 均走 information_schema，PG 索引信息额外用 pg_index/pg_class
 * 因为 information_schema 里没 column-level 的索引列。
 */
async function collectMetadata(): Promise<string> {
  const f = fam(props.conn.dialect)
  if (f === 'other') throw new Error(t('health.unsupported'))

  const sqls = buildSqls(f)
  const schemaExtra = props.conn.extra?.schema
  const opts = {
    database: props.conn.database,
    schema: typeof schemaExtra === 'string' ? schemaExtra : undefined,
  }
  const [colsR, idxR, fkR] = await Promise.all([
    client.connections.execute(props.conn.id, sqls.cols, [], opts),
    client.connections.execute(props.conn.id, sqls.idx, [], opts),
    client.connections.execute(props.conn.id, sqls.fk, [], opts),
  ])

  const cols = (colsR.rows as Record<string, unknown>[]).map(
    (r): ColRow => ({
      table: String(r.tbl ?? ''),
      name: String(r.name ?? ''),
      type: String(r.type ?? ''),
      nullable: String(r.nullable ?? ''),
      key: String(r.key ?? ''),
      default: r.default == null ? '' : String(r.default),
      comment: String(r.comment ?? ''),
    }),
  )
  const idxs = (idxR.rows as Record<string, unknown>[]).map(
    (r): IdxRow => ({
      table: String(r.tbl ?? ''),
      index: String(r.idx ?? ''),
      column: String(r.col ?? ''),
      nonUnique: Number(r.non_unique ?? 1),
    }),
  )
  const fks = (fkR.rows as Record<string, unknown>[]).map(
    (r): FkRow => ({
      table: String(r.tbl ?? ''),
      column: String(r.col ?? ''),
      refTable: String(r.ref_tbl ?? ''),
      refColumn: String(r.ref_col ?? ''),
    }),
  )

  const tables = new Set(cols.map((c) => c.table))
  tableCount.value = tables.size
  columnCount.value = cols.length

  return serialize(cols, idxs, fks)
}

function buildSqls(f: 'mysql' | 'pg'): { cols: string; idx: string; fk: string } {
  if (f === 'mysql') {
    return {
      cols: `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS name, COLUMN_TYPE AS type,
             IS_NULLABLE AS nullable, COLUMN_KEY AS \`key\`,
             COLUMN_DEFAULT AS \`default\`, COLUMN_COMMENT AS comment
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME, ORDINAL_POSITION
             LIMIT 5000`,
      idx: `SELECT TABLE_NAME AS tbl, INDEX_NAME AS idx, COLUMN_NAME AS col,
            NON_UNIQUE AS non_unique
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
            LIMIT 3000`,
      fk: `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col,
           REFERENCED_TABLE_NAME AS ref_tbl, REFERENCED_COLUMN_NAME AS ref_col
           FROM information_schema.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
           LIMIT 2000`,
    }
  }
  // PG family
  return {
    cols: `SELECT table_name AS tbl, column_name AS name,
           CASE
             WHEN character_maximum_length IS NOT NULL
               THEN data_type || '(' || character_maximum_length || ')'
             ELSE data_type
           END AS type,
           is_nullable AS nullable,
           '' AS key,
           column_default AS "default",
           COALESCE(pg_catalog.col_description(
             (quote_ident(table_schema)||'.'||quote_ident(table_name))::regclass::oid,
             ordinal_position), '') AS comment
           FROM information_schema.columns
           WHERE table_schema NOT IN ('pg_catalog','information_schema')
           ORDER BY table_name, ordinal_position
           LIMIT 5000`,
    idx: `SELECT t.relname AS tbl, i.relname AS idx, a.attname AS col,
          CASE WHEN ix.indisunique THEN 0 ELSE 1 END AS non_unique
          FROM pg_class t
          JOIN pg_index ix ON t.oid = ix.indrelid
          JOIN pg_class i ON i.oid = ix.indexrelid
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname NOT IN ('pg_catalog','information_schema')
          ORDER BY t.relname, i.relname
          LIMIT 3000`,
    fk: `SELECT kcu.table_name AS tbl, kcu.column_name AS col,
         ccu.table_name AS ref_tbl, ccu.column_name AS ref_col
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema NOT IN ('pg_catalog','information_schema')
         LIMIT 2000`,
  }
}

/**
 * 紧凑序列化：按表分组列出 columns + indexes + FKs，便于 AI 在一个 prompt 里
 * 看清全图；总长度兜底截断到 ~12K，避免某些大库爆 token。
 */
function serialize(cols: ColRow[], idxs: IdxRow[], fks: FkRow[]): string {
  const tables = new Map<string, { cols: ColRow[]; idxs: IdxRow[]; fks: FkRow[] }>()
  for (const c of cols) {
    if (!tables.has(c.table)) tables.set(c.table, { cols: [], idxs: [], fks: [] })
    tables.get(c.table)?.cols.push(c)
  }
  for (const i of idxs) tables.get(i.table)?.idxs.push(i)
  for (const k of fks) tables.get(k.table)?.fks.push(k)

  const out: string[] = []
  const MAX = 12000
  for (const [tbl, info] of tables) {
    const lines: string[] = []
    lines.push(`### table: ${tbl}`)
    lines.push('columns:')
    for (const c of info.cols) {
      const flags: string[] = []
      if (c.nullable === 'NO') flags.push('NOT NULL')
      if (c.key) flags.push(c.key)
      if (c.default) flags.push(`DEFAULT ${c.default}`)
      const cmt = c.comment ? ` // ${c.comment}` : ''
      lines.push(`  - ${c.name} ${c.type}${flags.length ? ` [${flags.join(', ')}]` : ''}${cmt}`)
    }
    if (info.idxs.length) {
      lines.push('indexes:')
      // 同 index_name 的列合并到一行
      const byIdx = new Map<string, { cols: string[]; unique: boolean }>()
      for (const i of info.idxs) {
        if (!byIdx.has(i.index)) byIdx.set(i.index, { cols: [], unique: i.nonUnique === 0 })
        byIdx.get(i.index)?.cols.push(i.column)
      }
      for (const [name, v] of byIdx) {
        lines.push(`  - ${v.unique ? 'UNIQUE ' : ''}${name}(${v.cols.join(', ')})`)
      }
    }
    if (info.fks.length) {
      lines.push('foreign keys:')
      for (const k of info.fks) {
        lines.push(`  - ${k.column} -> ${k.refTable}.${k.refColumn}`)
      }
    }
    const chunk = `${lines.join('\n')}\n`
    if (out.join('').length + chunk.length > MAX) {
      out.push('\n... (truncated; too many tables to fit in one prompt)\n')
      break
    }
    out.push(chunk)
  }
  return out.join('\n')
}

async function run(): Promise<void> {
  phase.value = 'collecting'
  error.value = null
  answer.value = ''
  try {
    if (!settings.aiProviders[settings.aiProvider]?.apiKey?.trim()) {
      error.value = t('ai.noKey')
      phase.value = 'error'
      return
    }
    const metaText = await collectMetadata()
    phase.value = 'analyzing'
    controller = new AbortController()
    const prompt = pHealthCheck({ dialect: props.conn.dialect }, metaText)
    const text = await askAiChat({
      messages: [{ role: 'user', content: prompt }],
      dialect: props.conn.dialect,
      extraSystem:
        'You are a senior DBA. Be concrete and only flag real issues; if a category has no findings, say so.',
      signal: controller.signal,
    })
    answer.value = text
    phase.value = 'done'
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      phase.value = 'error'
      error.value = t('health.cancelled')
      return
    }
    const msg = e instanceof Error ? e.message : String(e)
    error.value = msg === 'NO_API_KEY' ? t('ai.noKey') : msg
    phase.value = 'error'
  } finally {
    controller = null
  }
}

function stop(): void {
  controller?.abort()
}

/** 按 H2 拆 cards：H2 之间的内容为一段 markdown 渲染。 */
interface Section {
  title: string
  html: string
}
const sections = computed<Section[]>(() => {
  if (!answer.value) return []
  const text = answer.value
  // 分割：以行首的 "## " 为锚点
  const parts = text.split(/^##\s+/m)
  // parts[0] 是 H2 前的引言（多半为空）
  const intro = parts.shift()?.trim() ?? ''
  const out: Section[] = []
  if (intro) out.push({ title: '', html: renderMarkdown(intro) })
  for (const p of parts) {
    const nl = p.indexOf('\n')
    const title = (nl < 0 ? p : p.slice(0, nl)).trim()
    const body = nl < 0 ? '' : p.slice(nl + 1).trim()
    out.push({ title, html: renderMarkdown(body) })
  }
  return out
})

async function copyReport(): Promise<void> {
  if (!answer.value) return
  try {
    await navigator.clipboard?.writeText(answer.value)
    copied.value = true
    toast.success(t('health.copied'))
    setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

onMounted(() => {
  void run()
})
onUnmounted(() => controller?.abort())
</script>

<template>
  <Modal
    :title="t('health.title')"
    width="wide"
    fixed-height
    storage-key="ai-health-check"
    @close="emit('close')"
  >
    <div class="hc">
      <div class="bar">
        <span class="conn-name">{{ props.conn.name || props.conn.id }} · {{ props.conn.dialect }}</span>
        <span v-if="tableCount" class="meta">{{ t('health.scanned', { tables: tableCount, columns: columnCount }) }}</span>
        <span class="spacer"></span>
        <button v-if="phase === 'done'" class="ghost" @click="run">{{ t('health.rerun') }}</button>
        <button v-if="phase === 'done' && answer" :class="['ghost', { copied }]" @click="copyReport">
          {{ copied ? t('health.copied') : t('health.copyReport') }}
        </button>
        <button v-if="phase === 'analyzing'" class="ghost" @click="stop">{{ t('ai.stop') }}</button>
      </div>

      <div v-if="phase === 'collecting'" class="status">
        <div class="spinner"></div>
        <div>{{ t('health.collecting') }}</div>
      </div>
      <div v-else-if="phase === 'analyzing'" class="status">
        <div class="spinner"></div>
        <div>{{ t('health.loading') }}</div>
        <div class="status-hint">{{ t('health.loadingHint') }}</div>
      </div>
      <div v-else-if="phase === 'error'" class="status err">
        <div class="err-msg">✗ {{ error }}</div>
        <div class="err-actions">
          <button class="ghost" @click="run">{{ t('health.rerun') }}</button>
          <button v-if="error === t('ai.noKey')" class="link" @click="emit('openSettings')">
            {{ t('ai.configure') }}
          </button>
        </div>
      </div>
      <div v-else-if="!answer" class="status">{{ t('health.empty') }}</div>
      <div v-else class="cards">
        <article
          v-for="(s, i) in sections"
          :key="i"
          :class="['card', s.title ? 'h2-card' : 'intro-card']"
        >
          <h3 v-if="s.title">{{ s.title }}</h3>
          <div class="md" v-html="s.html"></div>
        </article>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.hc {
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
  font-family: var(--font-mono);
}
.spacer {
  flex: 1 1 auto;
}
.bar button {
  padding: 5px 12px;
  font-size: 12px;
}
.copied {
  color: var(--accent);
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
  font-family: var(--font-mono);
  font-size: 13px;
  max-width: 80%;
  word-break: break-word;
}
.err-actions {
  display: flex;
  gap: 8px;
}
.link {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
}
.status-hint {
  font-size: 12px;
  opacity: 0.7;
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
.cards {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}
.card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  background: var(--panel);
}
.intro-card {
  background: transparent;
  border-style: dashed;
}
.card h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--accent);
}
.md :deep(p) {
  margin: 6px 0;
  line-height: 1.55;
}
.md :deep(ul),
.md :deep(ol) {
  margin: 6px 0 6px 20px;
  padding: 0;
}
.md :deep(li) {
  margin: 3px 0;
}
.md :deep(code) {
  background: var(--bg);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.md :deep(pre) {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  overflow: auto;
  margin: 8px 0;
}
.md :deep(pre code) {
  background: transparent;
  padding: 0;
  font-size: 12px;
}
.md :deep(strong) {
  color: var(--text);
}
.md :deep(blockquote) {
  border-left: 3px solid var(--border);
  margin: 8px 0;
  padding: 4px 10px;
  color: var(--muted);
}
</style>
