<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ConnectionConfig, DbDialect, type QueryResult } from '@db-tool/shared-types'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { type ChatMessage, askAiChat, extractAllSql, fmtOracleType } from '../ai'
import { onChatSqlExecuted } from '../chat-bus'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, toast } from '../dialog'
import { reportInlineError } from '../errorReporter'
import { t } from '../i18n'
import { renderMarkdown } from '../markdown'
import { autoExtractFacts, buildMemorySection, rememberVector } from '../memory'
import { monaco } from '../monaco-setup'
import {
  AI_PROVIDER_LABEL,
  AI_PROVIDER_ORDER,
  type AiProvider,
  isActiveAiConfigured,
  isLocalAiProvider,
  settings,
} from '../settings'
import { isSystemSchemaName } from './tree-actions'

/**
 * 右侧 AI 聊天侧边栏（类 Cursor 体验）。
 *
 * 「AI 怎么知道本地数据和 schema」：
 *   - schema：勾选「附带库结构」后，按当前选的连接查 information_schema 拉表+列，
 *     在 system prompt 中附上压缩后的 `table(col type, ...)` 列表（最多 6KB）。
 *   - data：不主动喂数据；用户可以「把当前 SQL 当上下文」、把执行结果一段贴进对话。
 *   - 用户也可以多轮追问，模型会基于完整对话历史 + schema 上下文回答。
 */
const props = defineProps<{ activeConnId?: string }>()
const emit = defineEmits<{
  close: []
  /** 插入 SQL 到当前查询页（或新草稿）；带 connId 表示要切到那个连接的草稿页 */
  insertSql: [sql: string, connId: string]
  /** 直接执行（带二次确认） */
  runSql: [sql: string, connId: string]
  /** 打开设置弹窗（默认跳到 AI 助手 section） */
  openSettings: []
}>()

// 仅显示已配置的 provider，避免「切到一个没填 key 的就报 NO_API_KEY」。
// 本地 provider（Ollama）不需要 key，有 baseUrl 即算已配置。
const configuredProviders = computed<AiProvider[]>(() =>
  AI_PROVIDER_ORDER.filter((p) => {
    const cfg = settings.aiProviders[p]
    if (!cfg) return false
    return isLocalAiProvider(p) ? !!cfg.baseUrl?.trim() : !!cfg.apiKey?.trim()
  }),
)

// SQL 代码块按内容哈希缓存高亮后的 HTML，避免每帧重复 colorize
const sqlHtml = ref<Record<string, string>>({})
async function highlightSql(code: string): Promise<void> {
  if (sqlHtml.value[code]) return
  try {
    sqlHtml.value[code] = await monaco.editor.colorize(code, 'sql', { tabSize: 2 })
  } catch {
    /* 走 fallback：plain pre */
  }
}

// ── SQL 执行标记（按 SQL 原文为 key 持久化）──
// 用户点了「运行」之后，对应的 SQL 块上会出现一个小徽章：
//   pending：派发了，等结果；ok：成功（绿）；error：失败（红，hover 看错误）
const RUN_MARKS_KEY = 'skylerx.aiChat.runMarks'
interface RunMark {
  at: number
  state: 'pending' | 'ok' | 'error'
  error?: string
}
const runMarks = ref<Record<string, RunMark>>({})
function loadRunMarks(): void {
  try {
    const raw = localStorage.getItem(RUN_MARKS_KEY)
    if (raw) runMarks.value = JSON.parse(raw) as Record<string, RunMark>
  } catch {
    /* ignore */
  }
}
function saveRunMarks(): void {
  try {
    // 防止持续增长：最多保留 200 条最近记录
    const entries = Object.entries(runMarks.value)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 200)
    localStorage.setItem(RUN_MARKS_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* ignore */
  }
}
/** 给 Workspace 回调：执行完后告知本面板成功/失败，更新徽章。 */
function notifyExecuted(sql: string, ok: boolean, error?: string): void {
  runMarks.value[sql] = { at: Date.now(), state: ok ? 'ok' : 'error', error }
  saveRunMarks()
}
/**
 * 外部调用：把「SQL 执行报错」整合成一条用户消息直接发起新一轮提问。
 * 流程：1) 中断当前对话 2) 切到出错的连接 3) 强制启用 schema 上下文 4) 等 schema 拉好后发送
 */
async function askAboutError(p: {
  connId: string
  connName?: string
  sql: string
  error: string
}): Promise<void> {
  controller?.abort() // 1) 打断正在进行的 chat
  // 等当前 send() 的 finally 跑完把 running 复位，避免下面 send() 被早早判否
  for (let i = 0; i < 30 && running.value; i++) {
    await new Promise<void>((r) => setTimeout(r, 50))
  }
  const switching = connId.value !== p.connId
  connId.value = p.connId // 2) 切到出错的连接（会触发 watch → loadDbList）
  useSchema.value = true // 3) 把库结构带上，AI 才能定位是哪张表/字段错
  saveToStorage()
  // 拼出问题：连接 / SQL / 报错 三部分清楚分块，再加一句通用引导
  const msg = `${t('aichat.askAiPrompt')}\n\n**${t('aichat.conn')}**: ${p.connName || p.connId}\n\n**SQL**\n\`\`\`sql\n${p.sql}\n\`\`\`\n\n**Error**\n\`\`\`\n${p.error}\n\`\`\``
  input.value = msg
  toast.info(t('aichat.askingAi'))
  // 4) 切连接时 dbList/schemaText 会异步刷新；等一帧 + 主动触发 schema 加载
  if (switching) await new Promise<void>((r) => setTimeout(r, 200))
  if (!schemaText.value) await loadSchema().catch(() => {})
  await send()
}
/**
 * 通用 AI 入口（#9 写 migration / #10 优化 SQL / #17 解读 EXPLAIN / #18 测试数据 /
 * #19 NL→SQL / #20 文档化 / #21 解释表）。
 *
 * 流程跟 askAboutError 一样：abort 当前 → 切连接 → 启用 schema → 等 schema → send。
 * 调用方负责把已经拼好的 prompt 传进来，本面板只负责"打开 + 发"。
 */
async function askPredefined(p: {
  /** 完整用户消息，Markdown 形式（含表名/SQL/EXPLAIN 等上下文都拼在 prompt 里） */
  prompt: string
  /** 目标连接（缺省 → 不切，用当前的） */
  connId?: string
  connName?: string
  /** 是否要把 information_schema 表/列一起送出去，默认 true */
  withSchema?: boolean
}): Promise<void> {
  controller?.abort()
  for (let i = 0; i < 30 && running.value; i++) {
    await new Promise<void>((r) => setTimeout(r, 50))
  }
  const switching = p.connId && connId.value !== p.connId
  if (p.connId) connId.value = p.connId
  if (p.withSchema !== false) useSchema.value = true
  saveToStorage()
  input.value = p.prompt
  toast.info(t('aichat.askingAi'))
  if (switching) await new Promise<void>((r) => setTimeout(r, 200))
  if (useSchema.value && !schemaText.value) await loadSchema().catch(() => {})
  await send()
}
defineExpose({ notifyExecuted, askAboutError, askPredefined })

function runMarkLabel(m: RunMark): string {
  const dt = new Date(m.at)
  const hh = String(dt.getHours()).padStart(2, '0')
  const mm = String(dt.getMinutes()).padStart(2, '0')
  if (m.state === 'pending') return t('aichat.runPending', { time: `${hh}:${mm}` })
  if (m.state === 'ok') return t('aichat.runOk', { time: `${hh}:${mm}` })
  return t('aichat.runErr', { time: `${hh}:${mm}` })
}

const client = useDataClient()

const conns = ref<ConnectionConfig[]>([])
const connId = ref<string>(props.activeConnId ?? '')

// ── 宽度可拖拽 + 持久化 ──
const WIDTH_KEY = 'skylerx.aiChat.width'
const MIN_W = 280
const MAX_W = 800
const DEFAULT_W = 380
function loadWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(saved) && saved >= MIN_W) return Math.min(MAX_W, saved)
  } catch {
    /* ignore */
  }
  return DEFAULT_W
}
const panelWidth = ref<number>(loadWidth())
let dragStartX = 0
let dragStartW = 0
function onResizeDown(e: PointerEvent): void {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragStartX = e.clientX
  dragStartW = panelWidth.value
  document.body.style.cursor = 'col-resize'
}
function onResizeMove(e: PointerEvent): void {
  if (!e.buttons) return
  // 面板在右边，往左拖（clientX 减小）→ 变宽
  const w = dragStartW + (dragStartX - e.clientX)
  panelWidth.value = Math.max(MIN_W, Math.min(MAX_W, Math.round(w)))
}
function onResizeUp(e: PointerEvent): void {
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  document.body.style.cursor = ''
  try {
    localStorage.setItem(WIDTH_KEY, String(panelWidth.value))
  } catch {
    /* ignore */
  }
}
const useSchema = ref(false)
const schemaText = ref('')
const schemaLoading = ref(false)
/**
 * 当前要扫的容器名（MySQL = database 名；PG = schema 名）。
 * 缺省时按连接的默认库/schema（MySQL: conn.database / PG: 'public'）。
 * 用户也可以在面板里手动切。
 */
const dbList = ref<string[]>([])
const selectedDb = ref<string>('')
const dbLoading = ref(false)

const messages = ref<ChatMessage[]>([])
const input = ref('')
const running = ref(false)
const elapsed = ref(0) // 思考中计时（秒），便于发现「卡住」
let elapsedTimer: ReturnType<typeof setInterval> | null = null
const error = ref<string | null>(null)
let controller: AbortController | null = null

// 持久化：每应用一份，避免会话间丢失
const STORAGE_KEY = 'skylerx.aiChat.messages'
const SCHEMA_TOGGLE_KEY = 'skylerx.aiChat.useSchema'

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) messages.value = JSON.parse(raw) as ChatMessage[]
    useSchema.value = localStorage.getItem(SCHEMA_TOGGLE_KEY) === '1'
  } catch {
    /* ignore */
  }
}
function saveToStorage(): void {
  try {
    // 只存最近 50 条，避免无限增长
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.value.slice(-50)))
    localStorage.setItem(SCHEMA_TOGGLE_KEY, useSchema.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const listEl = ref<HTMLDivElement>()
function scrollToBottom(): void {
  void nextTick(() => {
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

let unsubExec: (() => void) | null = null
onMounted(async () => {
  loadFromStorage()
  loadRunMarks()
  // QueryPane 执行完聊天派发的 SQL 后会广播；这里把状态打回到对应代码块上。
  unsubExec = onChatSqlExecuted((e) => {
    if (!(e.sql in runMarks.value)) return // 这次执行不是从聊天里派发的
    runMarks.value[e.sql] = {
      at: Date.now(),
      state: e.ok ? 'ok' : 'error',
      error: e.error ?? undefined,
    }
    saveRunMarks()
  })
  conns.value = await client.connections.list()
  if (!connId.value) connId.value = props.activeConnId ?? conns.value[0]?.id ?? ''
  await loadDbList()
  scrollToBottom()
})
onBeforeUnmount(() => {
  unsubExec?.()
})

watch(
  () => props.activeConnId,
  (v) => {
    if (v) connId.value = v
  },
)
// 新增/变化消息时：把里面所有 ```sql 块送进 Monaco colorize 异步高亮
watch(
  () => messages.value,
  (msgs) => {
    for (const m of msgs) {
      if (m.role !== 'assistant') continue
      for (const p of splitParts(m.content)) {
        if (p.type === 'sql') void highlightSql(p.content)
      }
    }
  },
  { deep: true, immediate: true },
)
// 切连接 → 重新拉 database/schema 列表 + 重置 schema 缓存
watch(connId, async () => {
  schemaText.value = ''
  selectedDb.value = ''
  await loadDbList()
  if (useSchema.value) void loadSchema()
})
// 切库 → 旧 schema 文本作废
watch(selectedDb, () => {
  schemaText.value = ''
  if (useSchema.value) void loadSchema()
})

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
const connOf = (id: string): ConnectionConfig | undefined => conns.value.find((c) => c.id === id)

/** 拉「当前连接的所有 database / schema 列表」用于下拉。系统库过滤掉。 */
async function loadDbList(): Promise<void> {
  const c = connOf(connId.value)
  dbList.value = []
  if (!c) return
  const f = fam(c.dialect)
  if (f === 'other') return
  dbLoading.value = true
  try {
    // Oracle/DM：schema = 用户，all_users 列全部 owner，系统 schema 客户端过滤。
    const sql =
      f === 'mysql'
        ? `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA
           WHERE SCHEMA_NAME NOT IN ('mysql','information_schema','performance_schema','sys')
           ORDER BY SCHEMA_NAME`
        : f === 'pg'
          ? `SELECT nspname AS name FROM pg_namespace
             WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
             ORDER BY nspname`
          : 'SELECT username AS name FROM all_users ORDER BY username'
    const res = (await client.connections.execute(c.id, sql, [])) as QueryResult
    let names = (res.rows as { name: string }[]).map((r) => r.name)
    if (f === 'oracle') names = names.filter((n) => !isSystemSchemaName(n))
    dbList.value = names
    // 默认选项：连接默认库（mysql=database / oracle=当前用户=c.database）/ public（pg）/ 列表第一个
    const def = f === 'pg' ? 'public' : c.database || dbList.value[0]
    if (!selectedDb.value && def && dbList.value.includes(def)) selectedDb.value = def
    if (!selectedDb.value) selectedDb.value = dbList.value[0] ?? ''
  } catch {
    /* 拉不到就允许用户手动输入 / 留空走默认库 */
  } finally {
    dbLoading.value = false
  }
}

async function loadSchema(): Promise<void> {
  const c = connOf(connId.value)
  if (!c) return
  const f = fam(c.dialect)
  if (f === 'other') {
    schemaText.value = ''
    error.value = t('aichat.schemaUnsupported')
    return
  }
  schemaLoading.value = true
  error.value = null
  try {
    // 用户选的容器名优先；没选时回退到连接默认（pg=public / 其余=连接默认库/当前用户）
    const target = selectedDb.value || (f === 'pg' ? 'public' : c.database || '')
    if (!target) {
      schemaText.value = ''
      error.value = t('aichat.schemaNoTarget')
      return
    }
    const lit = target.replace(/'/g, "''")
    // Oracle/DM：all_tab_columns（owner=schema）；ROWNUM 子查询限行，兼容 Oracle 9i+ / 所有 DM。
    const sql =
      f === 'mysql'
        ? `SELECT TABLE_NAME tbl, COLUMN_NAME col, COLUMN_TYPE ty FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = '${lit}' ORDER BY TABLE_NAME, ORDINAL_POSITION LIMIT 2000`
        : f === 'pg'
          ? `SELECT table_name tbl, column_name col, data_type ty FROM information_schema.columns
             WHERE table_schema = '${lit}' ORDER BY table_name, ordinal_position LIMIT 2000`
          : `SELECT "tbl","col","ty","len","prec","scale" FROM (
               SELECT table_name "tbl", column_name "col", data_type "ty",
                      data_length "len", data_precision "prec", data_scale "scale"
               FROM all_tab_columns WHERE owner = '${lit}'
               ORDER BY table_name, column_id
             ) WHERE ROWNUM <= 2000`
    const res = (await client.connections.execute(c.id, sql, [], {
      database: f === 'mysql' ? target : c.database,
      schema: f === 'pg' || f === 'oracle' ? target : undefined,
    })) as QueryResult
    const byTable = new Map<string, string[]>()
    for (const r of res.rows as Record<string, unknown>[]) {
      const tbl = String(r.tbl)
      if (!byTable.has(tbl)) byTable.set(tbl, [])
      const ty = f === 'oracle' ? fmtOracleType(r.ty, r.len, r.prec, r.scale) : String(r.ty)
      byTable.get(tbl)?.push(`${String(r.col)} ${ty}`)
    }
    const lines: string[] = [`-- ${target}`]
    for (const [tbl, cols] of byTable) {
      lines.push(`${tbl}(${cols.join(', ')})`)
      if (lines.join('\n').length > 6000) {
        lines.push('-- (truncated)')
        break
      }
    }
    schemaText.value = byTable.size ? lines.join('\n') : ''
    if (!byTable.size) error.value = t('aichat.schemaEmpty', { name: target })
  } catch (e) {
    reportInlineError(error, e)
  } finally {
    schemaLoading.value = false
  }
}

function toggleSchema(): void {
  useSchema.value = !useSchema.value
  if (useSchema.value && !schemaText.value) void loadSchema()
  saveToStorage()
}

async function send(): Promise<void> {
  const text = input.value.trim()
  if (!text || running.value) return
  if (!isActiveAiConfigured()) {
    error.value = t('ai.noKey')
    return
  }
  const userMsg: ChatMessage = { role: 'user', content: text }
  messages.value.push(userMsg)
  input.value = ''
  saveToStorage()
  scrollToBottom()

  error.value = null
  running.value = true
  elapsed.value = 0
  const startT = Date.now()
  elapsedTimer = setInterval(() => {
    elapsed.value = Math.round((Date.now() - startT) / 1000)
  }, 1000)
  controller = new AbortController()
  try {
    // 注入 A/B/C 三档记忆段（A：自定义画像；B：事实清单；C：相关向量记忆 top-K）
    const memorySection = await buildMemorySection(text)
    const reply = await askAiChat({
      messages: messages.value,
      dialect: connOf(connId.value)?.dialect,
      schema: useSchema.value ? schemaText.value || undefined : undefined,
      memorySection,
      signal: controller.signal,
    })
    messages.value.push({ role: 'assistant', content: reply })
    saveToStorage()
    scrollToBottom()
    // 后台任务：把这轮对话喂给 B 档（事实抽取）与 C 档（向量记忆），失败静默
    void autoExtractFacts({ user: text, assistant: reply })
    void rememberVector(`Q: ${text}\nA: ${reply}`)
  } catch (e) {
    const err = e as Error & { aiAborted?: boolean }
    // 用户主动取消 vs 网络/超时 abort 分流；主动取消静默退出
    if (err.name === 'AbortError' || (err.aiAborted && controller?.signal.aborted)) return
    const msg = err.message || String(e)
    if (msg === 'NO_API_KEY') error.value = t('ai.noKey')
    else if (/abort|timeout/i.test(msg))
      error.value = t('aichat.timeoutHint', { secs: elapsed.value })
    else error.value = msg
  } finally {
    if (elapsedTimer) {
      clearInterval(elapsedTimer)
      elapsedTimer = null
    }
    running.value = false
    controller = null
  }
}

function stop(): void {
  controller?.abort()
}

async function clearAll(): Promise<void> {
  if (!messages.value.length) return
  if (!(await appConfirm({ message: t('aichat.clearConfirm'), variant: 'warn' }))) return
  messages.value = []
  error.value = null
  saveToStorage()
}

interface MsgPart {
  type: 'text' | 'sql'
  content: string
}
/** 把 AI 回复按 ```sql 代码块切片，方便给 SQL 块单独挂插入/运行按钮。 */
function splitParts(content: string): MsgPart[] {
  const out: MsgPart[] = []
  const re = /```(\w*)\s*([\s\S]*?)```/g
  let last = 0
  for (;;) {
    const m = re.exec(content)
    if (!m) break
    if (m.index > last) out.push({ type: 'text', content: content.slice(last, m.index) })
    const lang = m[1].toLowerCase()
    const code = m[2].trim()
    out.push({ type: lang === 'sql' || lang === '' ? 'sql' : 'text', content: code })
    last = m.index + m[0].length
  }
  if (last < content.length) out.push({ type: 'text', content: content.slice(last) })
  return out
}

function copyText(s: string): void {
  void navigator.clipboard?.writeText(s)
}

function emitInsert(sql: string): void {
  if (!connId.value) return
  emit('insertSql', sql, connId.value)
}
async function emitRun(sql: string): Promise<void> {
  if (!connId.value) return
  if (!(await appConfirm({ message: t('aichat.runConfirm'), variant: 'warn' }))) return
  // 立即写入「已派发」标记；执行完后 Workspace 会回调更新 ok/error
  runMarks.value[sql] = { at: Date.now(), state: 'pending' }
  saveRunMarks()
  emit('runSql', sql, connId.value)
}

const allSqls = computed(() => {
  const last = messages.value[messages.value.length - 1]
  if (last?.role !== 'assistant') return []
  return extractAllSql(last.content)
})

// 输入框：Enter 发送，Shift+Enter 换行
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send()
  }
}
</script>

<template>
  <aside class="chat" :style="{ width: panelWidth + 'px' }">
    <!-- 左边沿拖拽把手：调整面板宽度（持久化到 localStorage） -->
    <div
      class="resize-handle"
      :title="t('aichat.resizeHint')"
      @pointerdown="onResizeDown"
      @pointermove="onResizeMove"
      @pointerup="onResizeUp"
    />
    <header class="head">
      <span class="title">✨ {{ t('aichat.title') }}</span>
      <button class="x" :title="t('common.close')" @click="emit('close')">×</button>
    </header>

    <!-- 上下文选择栏：紧凑两行布局，文字 white-space:nowrap 不再 wrap -->
    <div class="bar">
      <div class="bar-row">
        <span class="bar-lbl">{{ t('aichat.conn') }}</span>
        <select v-model="connId" class="sel" :title="t('aichat.connFor')">
          <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name || c.id }} · {{ c.dialect }}</option>
        </select>
      </div>
      <div class="bar-row">
        <span class="bar-lbl">{{ t('aichat.db') }}</span>
        <select v-model="selectedDb" class="sel" :disabled="dbLoading || !dbList.length" :title="t('aichat.dbTitle')">
          <option v-if="!dbList.length" value="">{{ dbLoading ? '…' : t('aichat.dbNone') }}</option>
          <option v-for="d in dbList" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
      <div class="bar-row">
        <label class="schk" :title="t('aichat.useSchemaTitle')">
          <input type="checkbox" :checked="useSchema" @change="toggleSchema" />
          <span class="schk-lbl">{{ t('aichat.useSchema') }}</span>
          <span v-if="schemaLoading" class="mini">…</span>
          <span v-else-if="useSchema && schemaText" class="mini" :title="schemaText">✓</span>
        </label>
        <button class="ghost sm clear-btn" :disabled="!messages.length" @click="clearAll">{{ t('aichat.clear') }}</button>
      </div>
    </div>

    <div ref="listEl" class="list">
      <div v-if="!messages.length" class="empty">
        <div class="empty-title">{{ t('aichat.welcomeTitle') }}</div>
        <div class="empty-tips">{{ t('aichat.welcomeTip') }}</div>
      </div>
      <div v-for="(msg, idx) in messages" :key="idx" class="msg" :class="msg.role">
        <template v-if="msg.role === 'user'">
          <pre>{{ msg.content }}</pre>
        </template>
        <template v-else>
          <template v-for="(p, pi) in splitParts(msg.content)" :key="pi">
            <!-- 文本部分：用 marked 渲染 markdown（粗体 / 引用 / 列表 / 行内代码） -->
            <div v-if="p.type === 'text'" class="md" v-html="renderMarkdown(p.content)"></div>
            <div v-else class="part-sql">
              <!-- 若 Monaco colorize 完成则用高亮 HTML；否则降级到 plain pre 等异步完成 -->
              <pre v-if="sqlHtml[p.content]" class="hl" v-html="sqlHtml[p.content]"></pre>
              <pre v-else>{{ p.content }}</pre>
              <div class="part-actions">
                <!-- 执行徽章：pending / ok / error，error 状态 hover 显示错误信息 -->
                <span
                  v-if="runMarks[p.content]"
                  class="run-mark"
                  :class="'rm-' + runMarks[p.content].state"
                  :title="runMarks[p.content].error || runMarkLabel(runMarks[p.content])"
                >
                  {{
                    runMarks[p.content].state === 'pending' ? '⌛'
                    : runMarks[p.content].state === 'ok' ? '✓'
                    : '✗'
                  }}
                  {{ runMarkLabel(runMarks[p.content]) }}
                </span>
                <button @click="copyText(p.content)">{{ t('common.copy') }}</button>
                <button @click="emitInsert(p.content)">{{ t('aichat.insertDraft') }}</button>
                <button class="run" @click="emitRun(p.content)">▶ {{ t('aichat.run') }}</button>
              </div>
            </div>
          </template>
        </template>
      </div>
      <div v-if="running" class="thinking">
        {{ t('aichat.thinking') }} <span class="elapsed">{{ elapsed }}s</span>
        <span v-if="elapsed >= 20" class="hint-stuck">{{ t('aichat.maybeStuck') }}</span>
      </div>
    </div>

    <div v-if="error" class="err">{{ error }}</div>

    <footer class="foot">
      <textarea
        v-model="input"
        :placeholder="t('aichat.inputPh')"
        rows="3"
        @keydown="onKeydown"
      ></textarea>
      <div class="foot-bar">
        <!-- 只列已配 apiKey 的 provider；没配 → 显示「未配置」+ ⚙ 按钮跳到设置 -->
        <template v-if="configuredProviders.length">
          <select v-model="settings.aiProvider" class="provider-sel" :title="t('aichat.switchProvider')">
            <option v-for="p in configuredProviders" :key="p" :value="p">
              {{ AI_PROVIDER_LABEL[p] }} · {{ settings.aiProviders[p].model || '?' }}
            </option>
          </select>
        </template>
        <span v-else class="model unconf">{{ t('aichat.noneConfigured') }}</span>
        <button class="cfg" :title="t('aichat.openSettings')" @click="emit('openSettings')">⚙</button>
        <span v-if="allSqls.length" class="hint">{{ t('aichat.lastSqlHint', { n: allSqls.length }) }}</span>
        <button v-if="!running" class="primary" :disabled="!input.trim() || !configuredProviders.length" @click="send">{{ t('aichat.send') }}</button>
        <button v-else class="ghost" @click="stop">{{ t('aichat.stop') }}</button>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--panel);
  border-left: 1px solid var(--border);
  position: relative;
  flex: none;
}
.resize-handle {
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 5;
}
.resize-handle:hover {
  background: var(--accent, #7c6cff);
  opacity: 0.4;
}
.head {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.title {
  font-weight: 600;
  font-size: 14px;
}
.x {
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.x:hover {
  color: var(--text);
}
.bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.bar-lbl {
  flex: none;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  width: 44px;
}
.sel {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
}
.sel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.schk {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.schk-lbl {
  white-space: nowrap;
}
.clear-btn {
  flex: none;
}
.mini {
  color: var(--accent);
}
.ghost.sm {
  font-size: 11px;
  padding: 3px 8px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--muted);
  cursor: pointer;
}
.ghost.sm:disabled {
  opacity: 0.4;
  cursor: default;
}
.list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.empty {
  margin: auto;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
}
.empty-title {
  font-size: 13px;
  margin-bottom: 4px;
  color: var(--text);
}
.empty-tips {
  line-height: 1.6;
}
.msg {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.msg.user {
  align-items: flex-end;
}
.msg.user pre {
  max-width: 86%;
  background: rgba(124, 108, 255, 0.18);
  color: var(--text);
  padding: 8px 10px;
  border-radius: 8px 8px 0 8px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
}
.msg.assistant {
  align-items: flex-start;
}
.part-text {
  background: var(--bg);
  color: var(--text);
  padding: 8px 10px;
  border-radius: 8px 8px 8px 0;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
}
/* ── Markdown 渲染：紧凑排版，跟我们的暗色主题协调 ── */
.md {
  background: var(--bg);
  color: var(--text);
  padding: 8px 12px;
  border-radius: 8px 8px 8px 0;
  font-size: 13px;
  line-height: 1.55;
  word-break: break-word;
}
/* marked 输出的标签都是无 scope 的（v-html）→ 用 :deep 才能命中 */
.md :deep(p) { margin: 0 0 6px; }
.md :deep(p:last-child) { margin-bottom: 0; }
.md :deep(strong) { color: var(--text); font-weight: 600; }
.md :deep(em) { color: var(--text); }
.md :deep(ul), .md :deep(ol) { margin: 4px 0 6px; padding-left: 22px; }
.md :deep(li) { margin: 2px 0; }
.md :deep(blockquote) {
  margin: 4px 0;
  padding: 4px 10px;
  border-left: 3px solid var(--accent, #7c6cff);
  background: rgba(124, 108, 255, 0.08);
  color: var(--muted);
  border-radius: 0 4px 4px 0;
}
.md :deep(blockquote p) { margin: 0; }
.md :deep(code) {
  background: rgba(124, 108, 255, 0.14);
  color: var(--text);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.md :deep(pre) {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 4px 0;
  overflow-x: auto;
}
.md :deep(pre code) {
  background: transparent;
  padding: 0;
  font-size: 12px;
}
.md :deep(a) { color: var(--accent, #7c6cff); text-decoration: none; }
.md :deep(a:hover) { text-decoration: underline; }
.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4) {
  margin: 8px 0 4px;
  font-weight: 600;
  font-size: 14px;
}
.md :deep(table) {
  border-collapse: collapse;
  margin: 4px 0;
  font-size: 12px;
}
.md :deep(th), .md :deep(td) {
  border: 1px solid var(--border);
  padding: 4px 8px;
  text-align: left;
}
.md :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 8px 0;
}
.part-sql {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
}
.part-sql pre {
  margin: 0;
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text);
}
/* Monaco colorize 输出的 token 类名 mtkX 是 monaco 全局 CSS 注入的，scoped 不能覆盖 */
.part-sql pre.hl {
  white-space: pre;
  overflow-x: auto;
  word-break: normal;
  line-height: 1.5;
}
.part-actions {
  display: flex;
  gap: 6px;
  padding: 4px 6px;
  border-top: 1px solid var(--border);
}
.part-actions button {
  font-size: 11px;
  padding: 3px 8px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
}
.part-actions button:hover {
  background: rgba(124, 108, 255, 0.14);
}
.part-actions .run {
  color: var(--accent, #7c6cff);
  border-color: var(--accent, #7c6cff);
}
/* SQL 执行徽章：占左边空间，按钮自然挤到右侧 */
.run-mark {
  margin-right: auto;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: default;
}
.run-mark.rm-pending { color: var(--muted); background: rgba(180, 180, 180, 0.12); }
.run-mark.rm-ok { color: #4caf50; background: rgba(76, 175, 80, 0.14); }
.run-mark.rm-error { color: var(--err, #e04050); background: rgba(224, 64, 80, 0.14); cursor: help; }
.thinking {
  color: var(--muted);
  font-size: 12px;
  font-style: italic;
  display: flex;
  align-items: center;
  gap: 8px;
}
.elapsed {
  font-family: var(--font-mono);
  font-size: 11px;
  font-style: normal;
  color: var(--accent, #7c6cff);
}
.hint-stuck {
  font-size: 11px;
  color: var(--err, #e04050);
  font-style: normal;
}
.err {
  background: rgba(224, 64, 80, 0.14);
  color: var(--err, #e04050);
  padding: 6px 12px;
  font-size: 12px;
  flex: none;
  white-space: pre-wrap;
}
.foot {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  flex: none;
}
.foot textarea {
  border: none;
  background: var(--bg);
  color: var(--text);
  padding: 8px 12px;
  font-family: inherit;
  font-size: 13px;
  resize: none;
  outline: none;
}
.foot-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--panel);
}
.model {
  font-size: 10px;
  color: var(--muted);
  font-family: var(--font-mono);
}
.model.unconf {
  color: var(--err, #e04050);
}
.provider-sel {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text);
  font-size: 11px;
}
.cfg {
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.cfg:hover {
  color: var(--text);
  border-color: var(--accent, #7c6cff);
}
.hint {
  font-size: 10px;
  color: var(--muted);
  margin-left: auto;
}
.foot-bar .primary,
.foot-bar .ghost {
  padding: 4px 12px;
  font-size: 12px;
  margin-left: auto;
}
.foot-bar .hint + .primary,
.foot-bar .hint + .ghost {
  margin-left: 0;
}
</style>
