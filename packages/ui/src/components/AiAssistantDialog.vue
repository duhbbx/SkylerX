<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ConnectionConfig, DbDialect, type QueryResult } from '@db-tool/shared-types'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { type AiMode, askAi, extractSql, fmtOracleType } from '../ai'
import { useDataClient } from '../data-client'
import type { TableContext } from '../ddl'
import { reportInlineError } from '../errorReporter'
import { t } from '../i18n'
import {
  resolveBoundContainer,
  retrieveCodeDetailed,
  type CodeRetrievalResult,
} from '../rag/codeRepo'
import { isActiveAiConfigured, settings } from '../settings'
import Modal from './Modal.vue'

const props = defineProps<{
  initialMode?: AiMode
  initialSql?: string
  initialConnId?: string
  initialError?: string
}>()
const emit = defineEmits<{ close: []; insert: [string, string]; openSettings: [] }>()

const client = useDataClient()
const conns = ref<ConnectionConfig[]>([])
const connId = ref('')
const mode = ref<AiMode>(props.initialMode ?? 'nl2sql')
const input = ref(props.initialSql ?? '')
const errInput = ref(props.initialError ?? '')
const useSchema = ref(false)
// 「代码库」开关：附带当前连接默认容器绑定代码库里最相关的片段作为上下文
const useCode = ref(false)
type CodeRetrievalStatus = CodeRetrievalResult | { mode: 'error'; message: string }
const codeRetrieval = ref<CodeRetrievalStatus | null>(null)
const schemaText = ref('')
const schemaLoading = ref(false)
const answer = ref('')
const running = ref(false)
const error = ref<string | null>(null)
let controller: AbortController | null = null
let requestSequence = 0
let activeRequestId = 0

interface AssistantRequestSnapshot {
  id: number
  connId: string
  dialect: DbDialect | undefined
  mode: AiMode
  input: string
  error: string | undefined
  schema: string | undefined
  useCode: boolean
}

const MODES: { id: AiMode; label: () => string }[] = [
  { id: 'nl2sql', label: () => t('ai.modeNl2sql') },
  { id: 'explain', label: () => t('ai.modeExplain') },
  { id: 'optimize', label: () => t('ai.modeOptimize') },
  { id: 'diagnose', label: () => t('ai.modeDiagnose') },
]

function fam(d: DbDialect | undefined): 'mysql' | 'pg' | 'oracle' | 'other' {
  if (d && [DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase, DbDialect.GBase8a].includes(d))
    return 'mysql'
  if (
    d &&
    [
      DbDialect.PostgreSQL,
      DbDialect.KingbaseES,
      DbDialect.Vastbase,
      DbDialect.MogDB,
      DbDialect.HighGo,
    ].includes(d)
  )
    return 'pg'
  if (d && [DbDialect.Oracle, DbDialect.DM].includes(d)) return 'oracle'
  return 'other'
}
const connOf = (id: string) => conns.value.find((c) => c.id === id)

/**
 * 当前连接默认容器的 {database, schema}，与代码库绑定时的容器键同构。
 * 本弹窗不让用户单独选库，跟 loadSchema 一样落到默认库/schema（mysql=DATABASE() /
 * pg='public' / oracle=当前用户）。
 */
function currentCtx(c: ConnectionConfig): TableContext {
  const f = fam(c.dialect)
  if (f === 'pg') return { database: c.database, schema: 'public' }
  if (f === 'oracle') return { schema: c.database || '' }
  return { database: c.database || '' }
}

onMounted(async () => {
  conns.value = await client.connections.list()
  connId.value = props.initialConnId ?? conns.value[0]?.id ?? ''
})

function cancelActiveRequestForConnectionChange(): void {
  codeRetrieval.value = null
  answer.value = ''
  error.value = null
  if (!activeRequestId) return
  activeRequestId = 0
  controller?.abort()
  controller = null
  running.value = false
}

watch(connId, () => {
  cancelActiveRequestForConnectionChange()
  schemaText.value = ''
  if (useSchema.value) void loadSchema()
}, { flush: 'sync' })

async function loadSchema(): Promise<void> {
  const c = connOf(connId.value)
  if (!c) return
  const f = fam(c.dialect)
  if (f === 'other') {
    schemaText.value = ''
    error.value = t('ai.schemaUnsupported')
    return
  }
  schemaLoading.value = true
  error.value = null
  try {
    // Oracle/DM：当前 schema（SYS_CONTEXT CURRENT_SCHEMA）下的表/列；ROWNUM 子查询限行兼容老版本。
    const sql =
      f === 'mysql'
        ? `SELECT TABLE_NAME tbl, COLUMN_NAME col, COLUMN_TYPE ty FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION LIMIT 2000`
        : f === 'pg'
          ? `SELECT table_name tbl, column_name col, data_type ty FROM information_schema.columns
             WHERE table_schema = 'public' ORDER BY table_name, ordinal_position LIMIT 2000`
          : `SELECT "tbl","col","ty","len","prec","scale" FROM (
               SELECT table_name "tbl", column_name "col", data_type "ty",
                      data_length "len", data_precision "prec", data_scale "scale"
               FROM all_tab_columns WHERE owner = SYS_CONTEXT('USERENV','CURRENT_SCHEMA')
               ORDER BY table_name, column_id
             ) WHERE ROWNUM <= 2000`
    const res = (await client.connections.execute(c.id, sql, [], {
      database: c.database,
    })) as QueryResult
    const byTable = new Map<string, string[]>()
    for (const r of res.rows as Record<string, unknown>[]) {
      const tbl = String(r.tbl)
      if (!byTable.has(tbl)) byTable.set(tbl, [])
      const ty = f === 'oracle' ? fmtOracleType(r.ty, r.len, r.prec, r.scale) : String(r.ty)
      byTable.get(tbl)?.push(`${String(r.col)} ${ty}`)
    }
    const lines: string[] = []
    for (const [tbl, cols] of byTable) {
      lines.push(`${tbl}(${cols.join(', ')})`)
      if (lines.join('\n').length > 6000) {
        lines.push('-- (truncated)')
        break
      }
    }
    schemaText.value = lines.join('\n')
    if (!schemaText.value) error.value = t('ai.schemaEmpty')
  } catch (e) {
    reportInlineError(error, e)
  } finally {
    schemaLoading.value = false
  }
}

function toggleSchema(): void {
  useSchema.value = !useSchema.value
  if (useSchema.value && !schemaText.value) void loadSchema()
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error && signal.reason.name === 'AbortError'
    ? signal.reason
    : new DOMException('Request aborted', 'AbortError')
}

function isCurrentRequest(snapshot: AssistantRequestSnapshot): boolean {
  return activeRequestId === snapshot.id && connId.value === snapshot.connId
}

function throwIfRequestStale(snapshot: AssistantRequestSnapshot, signal: AbortSignal): void {
  throwIfAborted(signal)
  if (!isCurrentRequest(snapshot)) throw new DOMException('Request superseded', 'AbortError')
}

function codeRetrievalLabel(): string {
  const result = codeRetrieval.value
  if (!result) return ''
  if (result.mode === 'error') return t('code.statusError')
  if (result.mode === 'none') return t('code.statusNone')
  if (!result.hitCount) return t('code.statusNoHit', { mode: result.mode })
  return t('code.statusHits', { mode: result.mode, n: result.hitCount })
}

function codeRetrievalTitle(): string {
  const result = codeRetrieval.value
  if (!result) return ''
  if (result.mode === 'error') return result.message
  return result.sources.join('\n')
}

async function retrieveCodeContext(
  snapshot: AssistantRequestSnapshot,
  signal: AbortSignal,
): Promise<{ context: string | undefined; conn: ConnectionConfig | undefined }> {
  if (!snapshot.useCode) return { context: undefined, conn: undefined }
  if (!snapshot.connId) {
    throwIfRequestStale(snapshot, signal)
    codeRetrieval.value = { context: '', mode: 'none', hitCount: 0, sources: [] }
    return { context: undefined, conn: undefined }
  }
  let freshConn: ConnectionConfig | undefined
  try {
    // Repository bindings may have changed after the selector's cached connection list loaded.
    freshConn = await client.connections.get(snapshot.connId)
    throwIfRequestStale(snapshot, signal)
    const container = resolveBoundContainer(freshConn, currentCtx(freshConn))
    if (!container) {
      throwIfRequestStale(snapshot, signal)
      codeRetrieval.value = { context: '', mode: 'none', hitCount: 0, sources: [] }
      return { context: undefined, conn: freshConn }
    }
    const result = await retrieveCodeDetailed(
      freshConn.id,
      container,
      snapshot.input,
      settings.aiVectorTopK,
      signal,
    )
    throwIfRequestStale(snapshot, signal)
    codeRetrieval.value = result
    return { context: result.context || undefined, conn: freshConn }
  } catch (e) {
    throwIfRequestStale(snapshot, signal)
    if ((e as Error).name === 'AbortError') throw e
    codeRetrieval.value = {
      mode: 'error',
      message: e instanceof Error ? e.message : String(e),
    }
    return { context: undefined, conn: freshConn }
  }
}

async function run(): Promise<void> {
  if (!input.value.trim() || running.value) return
  if (!isActiveAiConfigured()) {
    error.value = t('ai.noKey')
    return
  }
  const cachedConn = connOf(connId.value)
  const snapshot: AssistantRequestSnapshot = {
    id: ++requestSequence,
    connId: connId.value,
    dialect: cachedConn?.dialect,
    mode: mode.value,
    input: input.value,
    error: errInput.value || undefined,
    schema: useSchema.value ? schemaText.value || undefined : undefined,
    useCode: useCode.value,
  }
  activeRequestId = snapshot.id
  codeRetrieval.value = null
  answer.value = ''
  error.value = null
  running.value = true
  const requestController = new AbortController()
  controller = requestController
  try {
    const codeRetrievalResult = await retrieveCodeContext(snapshot, requestController.signal)
    throwIfRequestStale(snapshot, requestController.signal)
    const result = await askAi({
      mode: snapshot.mode,
      dialect: codeRetrievalResult.conn?.dialect ?? snapshot.dialect,
      input: snapshot.input,
      error: snapshot.error,
      schema: snapshot.schema,
      codeContext: codeRetrievalResult.context,
      signal: requestController.signal,
    })
    throwIfRequestStale(snapshot, requestController.signal)
    answer.value = result
  } catch (e) {
    if ((e as Error).name === 'AbortError' || requestController.signal.aborted || !isCurrentRequest(snapshot)) return
    const msg = e instanceof Error ? e.message : String(e)
    error.value = msg === 'NO_API_KEY' ? t('ai.noKey') : msg
  } finally {
    if (activeRequestId === snapshot.id) {
      running.value = false
      controller = null
      activeRequestId = 0
    }
  }
}

function stop(): void {
  if (activeRequestId) controller?.abort()
}

function insertSql(): void {
  const sql = extractSql(answer.value)
  if (sql) emit('insert', sql, connId.value)
}

async function copyAnswer(): Promise<void> {
  await navigator.clipboard?.writeText(answer.value)
}

onUnmounted(() => controller?.abort())
</script>

<template>
  <Modal :title="t('ai.title')" width="wide" fixed-height storage-key="ai-assistant" @close="emit('close')">
    <div class="ai">
      <div class="modes">
        <button
          v-for="m in MODES"
          :key="m.id"
          class="mtab"
          :class="{ on: mode === m.id }"
          @click="mode = m.id"
        >{{ m.label() }}</button>
      </div>

      <div class="bar">
        <select v-model="connId" class="sel">
          <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name || c.id }} · {{ c.dialect }}</option>
        </select>
        <label class="schk">
          <input type="checkbox" :checked="useSchema" @change="toggleSchema" />
          <span class="schk-lbl">{{ t('ai.useSchema') }}</span>
          <span v-if="schemaLoading" class="mini">…</span>
          <span v-else-if="useSchema && schemaText" class="mini">✓</span>
        </label>
        <label class="schk" :title="t('ai.useCodeTitle')">
          <input type="checkbox" v-model="useCode" />
          <span class="schk-lbl">{{ t('ai.useCode') }}</span>
          <span
            v-if="useCode && codeRetrieval"
            class="code-status"
            :class="'code-' + codeRetrieval.mode"
            :title="codeRetrievalTitle()"
          >{{ codeRetrievalLabel() }}</span>
        </label>
      </div>

      <textarea
        v-model="input"
        class="ta"
        :placeholder="mode === 'nl2sql' ? t('ai.phNl') : t('ai.phSql')"
        rows="4"
      ></textarea>
      <textarea
        v-if="mode === 'diagnose'"
        v-model="errInput"
        class="ta err-ta"
        :placeholder="t('ai.phError')"
        rows="2"
      ></textarea>

      <div class="actions">
        <button v-if="!running" class="primary" :disabled="!input.trim()" @click="run">{{ t('ai.ask') }}</button>
        <button v-else class="ghost" @click="stop">{{ t('ai.stop') }}</button>
        <span class="model">{{ settings.aiProvider }} · {{ settings.aiProviders[settings.aiProvider]?.model || '?' }}</span>
        <button class="link" @click="emit('openSettings')">{{ t('ai.configure') }}</button>
      </div>

      <div v-if="error" class="hint err">{{ error }}</div>
      <div v-if="answer" class="answer">
        <pre>{{ answer }}</pre>
        <div class="ans-actions">
          <button @click="insertSql">{{ t('ai.insert') }}</button>
          <button @click="copyAnswer">{{ t('common.copy') }}</button>
        </div>
      </div>
      <p class="foot">{{ t('ai.foot') }}</p>
    </div>
  </Modal>
</template>

<style scoped>
.ai {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}
.modes {
  display: flex;
  gap: 4px;
}
.mtab {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
}
.mtab.on {
  color: var(--text);
  border-color: var(--accent);
  background: rgba(124, 108, 255, 0.14);
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.sel {
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  flex: 1 1 auto;
  min-width: 0;
}
.schk {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
  flex: none;
}
.schk-lbl {
  white-space: nowrap;
}
.code-status {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 10px;
  color: var(--accent);
  cursor: help;
}
.code-none,
.code-error {
  color: var(--muted);
}
.code-error {
  color: var(--err, #e04050);
}
.mini {
  color: var(--accent);
}
.ta {
  width: 100%;
  resize: vertical;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  box-sizing: border-box;
}
.err-ta {
  color: var(--err, #e04050);
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.actions .primary,
.actions .ghost {
  padding: 6px 16px;
}
.actions .primary:disabled {
  opacity: 0.5;
  cursor: default;
}
.model {
  font-size: 11px;
  color: var(--muted);
  font-family: var(--font-mono);
}
.link {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
}
.hint.err {
  color: var(--err, #e04050);
  font-size: 13px;
}
.answer {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.answer pre {
  margin: 0;
  padding: 12px;
  flex: 1 1 auto;
  min-height: 120px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  font-size: 13px;
}
.ans-actions {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
}
.ans-actions button {
  padding: 4px 12px;
  font-size: 12px;
}
.foot {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
</style>
