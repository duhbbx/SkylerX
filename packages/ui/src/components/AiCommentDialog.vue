<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * G2 「AI 写表/列注释 + 落回数据库」对话框
 *
 * 业务流程：
 *   1) 拉该表 columns（MySQL/PG 走 information_schema）+ 现有 comments
 *      - MySQL：用 `SHOW FULL COLUMNS FROM tbl` 一把抓 type + comment，避免对 information_schema 再拼一次
 *      - PG：information_schema.columns + pg_description/pg_attribute 取 col_description
 *   2) 「让 AI 生成」→ 调 askAiChat()，prompt 由 ai-prompts.pComment 拼
 *   3) 解析 ```json``` 代码块拿到 [{ col, comment }]，与「现状」对比 → 表格渲染
 *   4) 每行复选框，决定要不要采用；用户编辑「AI 建议」一栏后可手工微调
 *   5) 「应用所选」→ 生成 ALTER 语句（MySQL 用 ALTER TABLE ... MODIFY；PG 用 COMMENT ON COLUMN）
 *      → emit('runSql', sql)，由上层塞进 QueryPane 一键执行
 *   6) 还能为表本身写一句表注释（MySQL: ALTER TABLE COMMENT='...'；PG: COMMENT ON TABLE）
 *
 * 仅支持 MySQL/PG 家族；其它方言直接灰按钮提示不支持。
 */
import { type ConnectionConfig, DbDialect } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { askAiChat } from '../ai'
import { pComment } from '../ai-prompts'
import { useDataClient } from '../data-client'
import { quoteId } from '../ddl'
import { toast } from '../dialog'
import { t } from '../i18n'
import { settings } from '../settings'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig; table: string }>()
const emit = defineEmits<{ close: []; runSql: [string] }>()

const client = useDataClient()

interface ColRow {
  name: string
  /** 完整类型串，如 `varchar(64)` / `int unsigned` / `text` — 用于 MySQL 的 MODIFY 需要带回 */
  type: string
  /** NO / YES — 用于 MySQL 改注释保留 NULL 性 */
  nullable: 'YES' | 'NO'
  /** 列默认值（保留以便 MySQL MODIFY 时拼回，避免 DEFAULT 丢失） */
  defaultValue: string | null
  /** 库里现有 comment 文本 */
  current: string
}

interface Suggestion {
  col: string
  comment: string
  /** 是否被用户勾选采用 */
  adopt: boolean
}

const rows = ref<ColRow[]>([])
const sugByCol = ref<Record<string, Suggestion>>({})
/** 表级 AI 建议 */
const tableSug = ref<{ comment: string; adopt: boolean } | null>(null)

const loadingCols = ref(false)
const asking = ref(false)
const error = ref<string | null>(null)
let controller: AbortController | null = null

const fam = computed<'mysql' | 'pg' | 'other'>(() => {
  const d = props.conn.dialect
  if ([DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase, DbDialect.TiDB].includes(d))
    return 'mysql'
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
})

/** 取裸表名（去 schema/db 前缀和反引号 / 引号），用于 information_schema WHERE TABLE_NAME 比对 */
function bareTable(): string {
  return props.table
    .split('.')
    .pop()!
    .replace(/[`"\[\]]/g, '')
}
/** PG 取 schema 名（若 table 是 schema.tbl 形式），否则用连接 extra.schema 或 public */
function pgSchema(): string {
  const parts = props.table.split('.')
  if (parts.length >= 2) return parts[parts.length - 2].replace(/["\[\]]/g, '')
  const ex = props.conn.extra?.schema
  return typeof ex === 'string' && ex ? ex : 'public'
}

/** 单引号转义（用于注释字面量） */
function esc(s: string): string {
  return s.replace(/'/g, "''")
}

async function loadColumns(): Promise<void> {
  loadingCols.value = true
  error.value = null
  try {
    if (fam.value === 'other') {
      throw new Error('Only MySQL / PostgreSQL families are supported for now.')
    }
    const tbl = bareTable()
    if (fam.value === 'mysql') {
      // 用 information_schema.COLUMNS 一把抓，比 SHOW FULL COLUMNS 更稳（结果列名固定可序列化）
      const sql = `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type,
                          IS_NULLABLE AS nullable, COLUMN_DEFAULT AS \`default\`,
                          COLUMN_COMMENT AS comment
                   FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${esc(tbl)}'
                   ORDER BY ORDINAL_POSITION`
      const r = await client.connections.execute(props.conn.id, sql, [], {
        database: props.conn.database,
      })
      rows.value = (r.rows as Record<string, unknown>[]).map((row) => ({
        name: String(row.name ?? ''),
        type: String(row.type ?? ''),
        nullable: String(row.nullable ?? 'YES') === 'NO' ? 'NO' : 'YES',
        defaultValue: row.default == null ? null : String(row.default),
        current: String(row.comment ?? ''),
      }))
    } else {
      // PG：information_schema.columns 取类型 + 默认值，col_description 取注释
      const schema = pgSchema()
      const sql = `SELECT c.column_name AS name,
                          CASE
                            WHEN c.character_maximum_length IS NOT NULL
                              THEN c.data_type || '(' || c.character_maximum_length || ')'
                            ELSE c.data_type
                          END AS type,
                          c.is_nullable AS nullable,
                          c.column_default AS "default",
                          COALESCE(
                            pg_catalog.col_description(
                              (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass::oid,
                              c.ordinal_position
                            ),
                            ''
                          ) AS comment
                   FROM information_schema.columns c
                   WHERE c.table_schema = '${esc(schema)}' AND c.table_name = '${esc(tbl)}'
                   ORDER BY c.ordinal_position`
      const r = await client.connections.execute(props.conn.id, sql, [], {
        database: props.conn.database,
        schema,
      })
      rows.value = (r.rows as Record<string, unknown>[]).map((row) => ({
        name: String(row.name ?? ''),
        type: String(row.type ?? ''),
        nullable: String(row.nullable ?? 'YES') === 'NO' ? 'NO' : 'YES',
        defaultValue: row.default == null ? null : String(row.default),
        current: String(row.comment ?? ''),
      }))
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingCols.value = false
  }
}

/** 把 rows 序列化成 columnsCsv（pComment 的输入约定，与 pDataDictDoc 一致） */
function columnsCsv(): string {
  return rows.value
    .map(
      (r) =>
        `- ${r.name} ${r.type}${r.nullable === 'NO' ? ' NOT NULL' : ''}${r.defaultValue != null ? ` DEFAULT ${r.defaultValue}` : ''}`,
    )
    .join('\n')
}

/**
 * 从 AI 返回里抽 ```json 代码块（首选），解析失败再退一步把整段当 JSON 试一次。
 * 必须返回 [{ col, comment }] 形态；其它形态视为解析失败。
 */
function parseSuggestion(text: string): { col: string; comment: string }[] {
  const re = /```(?:json)?\s*([\s\S]*?)```/i
  const m = re.exec(text)
  const raw = (m ? m[1] : text).trim()
  if (!raw) throw new Error(t('aicmt.parseFailed'))
  const obj: unknown = JSON.parse(raw)
  if (!Array.isArray(obj)) throw new Error(t('aicmt.parseFailed'))
  const out: { col: string; comment: string }[] = []
  for (const it of obj) {
    if (!it || typeof it !== 'object') continue
    const rec = it as Record<string, unknown>
    const col = typeof rec.col === 'string' ? rec.col : ''
    const comment = typeof rec.comment === 'string' ? rec.comment : ''
    if (col) out.push({ col, comment })
  }
  if (!out.length) throw new Error(t('aicmt.parseFailed'))
  return out
}

async function askAi(): Promise<void> {
  if (!rows.value.length) return
  if (!settings.aiProviders[settings.aiProvider]?.apiKey?.trim()) {
    error.value = 'No API key configured for current AI provider.'
    return
  }
  asking.value = true
  error.value = null
  controller = new AbortController()
  try {
    const prompt = pComment({ tableRef: props.table, dialect: props.conn.dialect }, columnsCsv())
    const text = await askAiChat({
      messages: [{ role: 'user', content: prompt }],
      dialect: props.conn.dialect,
      extraSystem:
        'You are a senior DBA writing column comments. Output ONLY one ```json code block as instructed; no extra text.',
      signal: controller.signal,
    })
    if (!text.trim()) {
      error.value = t('aicmt.empty')
      return
    }
    const parsed = parseSuggestion(text)
    const m: Record<string, Suggestion> = {}
    for (const p of parsed) {
      // 默认勾选 AI 给的有内容、且与现状不同的行
      const cur = rows.value.find((r) => r.name === p.col)?.current ?? ''
      const meaningful = !!p.comment && !p.comment.startsWith('?') && p.comment !== cur
      m[p.col] = { col: p.col, comment: p.comment, adopt: meaningful }
    }
    sugByCol.value = m
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    asking.value = false
    controller = null
  }
}

/** 为表本身写一句表注释（独立调用一次 AI，prompt 走 askAiChat 直拼，短小不必再加 ai-prompts 函数） */
async function askForTable(): Promise<void> {
  if (!rows.value.length) return
  if (!settings.aiProviders[settings.aiProvider]?.apiKey?.trim()) {
    error.value = 'No API key configured for current AI provider.'
    return
  }
  asking.value = true
  error.value = null
  controller = new AbortController()
  try {
    const prompt = `请用**中文一句话（≤ 40 字）**说清下表 \`${props.table}\` 是干嘛的，只输出**一行纯文本**，不要任何引号 / 解释 / 代码块。

字段清单：
${columnsCsv()}`
    const text = await askAiChat({
      messages: [{ role: 'user', content: prompt }],
      dialect: props.conn.dialect,
      signal: controller.signal,
    })
    const line = text
      .trim()
      .split(/\r?\n/)[0]
      .replace(/^['"`]|['"`]$/g, '')
      .trim()
    if (!line) {
      error.value = t('aicmt.empty')
      return
    }
    tableSug.value = { comment: line, adopt: true }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    asking.value = false
    controller = null
  }
}

function stop(): void {
  controller?.abort()
}

/** 一行 MySQL ALTER：MODIFY 需带完整列定义，否则会把 NULL / DEFAULT 清掉 */
function alterMysqlColumn(row: ColRow, comment: string): string {
  const q = (s: string) => quoteId(props.conn.dialect, s)
  let s = `ALTER TABLE ${q(bareTable())} MODIFY ${q(row.name)} ${row.type}`
  s += row.nullable === 'NO' ? ' NOT NULL' : ' NULL'
  if (row.defaultValue != null) {
    // MySQL information_schema 返回的 DEFAULT 可能是字面量或函数表达式（如 CURRENT_TIMESTAMP）
    // 简单启发式：纯数字/CURRENT_*/NULL 不加引号，其它当字符串
    const dv = row.defaultValue
    const isExpr =
      /^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|NULL)$/i.test(dv) || /^-?\d+(\.\d+)?$/.test(dv)
    s += ` DEFAULT ${isExpr ? dv : `'${esc(dv)}'`}`
  }
  s += ` COMMENT '${esc(comment)}'`
  return `${s};`
}

/** 计算最终要执行的 ALTER 列表（点 「应用所选」时调用） */
function buildAlterSqls(): string[] {
  const out: string[] = []
  if (fam.value === 'mysql') {
    for (const r of rows.value) {
      const sug = sugByCol.value[r.name]
      if (!sug?.adopt || !sug.comment.trim()) continue
      if (sug.comment === r.current) continue
      out.push(alterMysqlColumn(r, sug.comment.trim()))
    }
    if (tableSug.value?.adopt && tableSug.value.comment.trim()) {
      const tbl = quoteId(props.conn.dialect, bareTable())
      out.push(`ALTER TABLE ${tbl} COMMENT = '${esc(tableSug.value.comment.trim())}';`)
    }
  } else if (fam.value === 'pg') {
    const tableRef = props.table.includes('.')
      ? props.table
          .split('.')
          .map((p) => quoteId(props.conn.dialect, p.replace(/["\[\]]/g, '')))
          .join('.')
      : quoteId(props.conn.dialect, bareTable())
    for (const r of rows.value) {
      const sug = sugByCol.value[r.name]
      if (!sug?.adopt || !sug.comment.trim()) continue
      if (sug.comment === r.current) continue
      const col = quoteId(props.conn.dialect, r.name)
      out.push(`COMMENT ON COLUMN ${tableRef}.${col} IS '${esc(sug.comment.trim())}';`)
    }
    if (tableSug.value?.adopt && tableSug.value.comment.trim()) {
      out.push(`COMMENT ON TABLE ${tableRef} IS '${esc(tableSug.value.comment.trim())}';`)
    }
  }
  return out
}

function apply(): void {
  const sqls = buildAlterSqls()
  if (!sqls.length) {
    toast.warn(t('aicmt.empty'))
    return
  }
  emit('runSql', sqls.join('\n'))
  emit('close')
}

/** 选/反选所有 AI 建议（不含空建议） */
const allAdopt = computed({
  get: () => {
    const ks = Object.keys(sugByCol.value)
    if (!ks.length) return false
    return ks.every((k) => sugByCol.value[k].adopt)
  },
  set: (v: boolean) => {
    for (const k of Object.keys(sugByCol.value)) sugByCol.value[k].adopt = v
  },
})

const hasAnySuggestion = computed(() => Object.keys(sugByCol.value).length > 0)
const canApply = computed(() => {
  if (tableSug.value?.adopt && tableSug.value.comment.trim()) return true
  return Object.values(sugByCol.value).some((s) => s.adopt && s.comment.trim())
})

onMounted(() => {
  void loadColumns()
})

defineExpose({ ask: askAi })
</script>

<template>
  <Modal
    :title="t('aicmt.title', { table: props.table })"
    width="wide"
    fixed-height
    storage-key="ai-comment"
    @close="emit('close')"
  >
    <div class="cmt">
      <div class="bar">
        <span class="conn">{{ props.conn.name || props.conn.id }} · {{ props.conn.dialect }}</span>
        <span class="spacer"></span>
        <button
          class="ghost"
          :disabled="!rows.length || asking || loadingCols"
          @click="askAi"
        >
          {{ asking ? t('aicmt.loading') : '✨ ' + t('aitool.submit') }}
        </button>
        <button
          class="ghost"
          :disabled="!rows.length || asking || loadingCols"
          @click="askForTable"
        >
          {{ t('aicmt.generateForTable') }}
        </button>
        <button v-if="asking" class="ghost" @click="stop">{{ t('common.cancel') }}</button>
        <button class="primary" :disabled="!canApply" @click="apply">
          {{ t('aicmt.apply') }}
        </button>
      </div>

      <div v-if="error" class="err">✗ {{ error }}</div>

      <div v-if="loadingCols" class="status">
        <div class="spinner"></div>
        <div>{{ t('common.loading') }}</div>
      </div>

      <div v-else-if="!rows.length" class="status">{{ t('aicmt.empty') }}</div>

      <div v-else class="content">
        <!-- 表级注释行 -->
        <div v-if="tableSug" class="table-cmt">
          <label class="adopt">
            <input v-model="tableSug.adopt" type="checkbox" />
            {{ t('aicmt.adopt') }}
          </label>
          <strong>{{ props.table }}</strong>
          <span class="dim">→</span>
          <input v-model="tableSug.comment" class="cmt-input" type="text" />
        </div>

        <!-- 列对比表 -->
        <table class="grid">
          <thead>
            <tr>
              <th class="chk">
                <input
                  v-if="hasAnySuggestion"
                  type="checkbox"
                  :checked="allAdopt"
                  @change="allAdopt = ($event.target as HTMLInputElement).checked"
                />
              </th>
              <th>{{ t('aicmt.colName') }}</th>
              <th>{{ t('aicmt.type') }}</th>
              <th>{{ t('aicmt.currentComment') }}</th>
              <th>{{ t('aicmt.suggested') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.name">
              <td class="chk">
                <input
                  v-if="sugByCol[r.name]"
                  v-model="sugByCol[r.name].adopt"
                  type="checkbox"
                />
              </td>
              <td class="mono">{{ r.name }}</td>
              <td class="mono dim">{{ r.type }}</td>
              <td class="dim">{{ r.current || '—' }}</td>
              <td>
                <input
                  v-if="sugByCol[r.name]"
                  v-model="sugByCol[r.name].comment"
                  type="text"
                  class="cmt-input"
                />
                <span v-else class="dim">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.cmt {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.conn {
  font-weight: 600;
  color: var(--text);
}
.spacer {
  flex: 1 1 auto;
}
.bar button {
  padding: 5px 12px;
  font-size: 12px;
}
.primary {
  background: var(--accent);
  color: #fff;
  border: 1px solid var(--accent);
  border-radius: 4px;
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.err {
  border: 1px solid var(--err, #e04050);
  color: var(--err, #e04050);
  background: rgba(224, 64, 80, 0.08);
  padding: 8px 12px;
  border-radius: 6px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  word-break: break-word;
}
.status {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--muted);
}
.spinner {
  width: 24px;
  height: 24px;
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
.content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.table-cmt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  background: var(--panel);
}
.table-cmt .cmt-input {
  flex: 1 1 auto;
}
.adopt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.grid th,
.grid td {
  border-bottom: 1px solid var(--border);
  padding: 6px 8px;
  text-align: left;
  vertical-align: middle;
}
.grid th {
  position: sticky;
  top: 0;
  background: var(--panel);
  font-weight: 600;
  font-size: 12px;
  color: var(--muted);
}
.grid .chk {
  width: 32px;
  text-align: center;
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.dim {
  color: var(--muted);
}
.cmt-input {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
}
.cmt-input:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
