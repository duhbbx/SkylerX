<script setup lang="ts">
import { type ConnectionConfig, DbDialect, type QueryResult } from '@db-tool/shared-types'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { type ChatMessage, askAiChat, extractAllSql } from '../ai'
import { useDataClient } from '../data-client'
import { t } from '../i18n'
import { settings } from '../settings'

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
}>()

const client = useDataClient()

const conns = ref<ConnectionConfig[]>([])
const connId = ref<string>(props.activeConnId ?? '')
const useSchema = ref(false)
const schemaText = ref('')
const schemaLoading = ref(false)

const messages = ref<ChatMessage[]>([])
const input = ref('')
const running = ref(false)
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

onMounted(async () => {
  loadFromStorage()
  conns.value = await client.connections.list()
  if (!connId.value) connId.value = props.activeConnId ?? conns.value[0]?.id ?? ''
  scrollToBottom()
})

watch(
  () => props.activeConnId,
  (v) => {
    if (v) connId.value = v
  },
)

function fam(d: DbDialect | undefined): 'mysql' | 'pg' | 'other' {
  if (d && [DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase].includes(d)) return 'mysql'
  if (d && [DbDialect.PostgreSQL, DbDialect.KingbaseES].includes(d)) return 'pg'
  return 'other'
}
const connOf = (id: string): ConnectionConfig | undefined => conns.value.find((c) => c.id === id)

async function loadSchema(): Promise<void> {
  const c = connOf(connId.value)
  if (!c) return
  const f = fam(c.dialect)
  if (f === 'other') {
    schemaText.value = ''
    return
  }
  schemaLoading.value = true
  try {
    const sql =
      f === 'mysql'
        ? `SELECT TABLE_NAME tbl, COLUMN_NAME col, COLUMN_TYPE ty FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION LIMIT 2000`
        : `SELECT table_name tbl, column_name col, data_type ty FROM information_schema.columns
           WHERE table_schema = 'public' ORDER BY table_name, ordinal_position LIMIT 2000`
    const res = (await client.connections.execute(c.id, sql, [], { database: c.database })) as QueryResult
    const byTable = new Map<string, string[]>()
    for (const r of res.rows as Record<string, unknown>[]) {
      const tbl = String(r.tbl)
      if (!byTable.has(tbl)) byTable.set(tbl, [])
      byTable.get(tbl)?.push(`${String(r.col)} ${String(r.ty)}`)
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
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
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
  if (!settings.aiProviders[settings.aiProvider]?.apiKey?.trim()) {
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
  controller = new AbortController()
  try {
    const reply = await askAiChat({
      messages: messages.value,
      dialect: connOf(connId.value)?.dialect,
      schema: useSchema.value ? schemaText.value || undefined : undefined,
      signal: controller.signal,
    })
    messages.value.push({ role: 'assistant', content: reply })
    saveToStorage()
    scrollToBottom()
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    const msg = e instanceof Error ? e.message : String(e)
    error.value = msg === 'NO_API_KEY' ? t('ai.noKey') : msg
  } finally {
    running.value = false
    controller = null
  }
}

function stop(): void {
  controller?.abort()
}

function clearAll(): void {
  if (!messages.value.length) return
  if (!window.confirm(t('aichat.clearConfirm'))) return
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
function emitRun(sql: string): void {
  if (!connId.value) return
  if (!window.confirm(t('aichat.runConfirm'))) return
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
  <aside class="chat">
    <header class="head">
      <span class="title">✨ {{ t('aichat.title') }}</span>
      <button class="x" :title="t('common.close')" @click="emit('close')">×</button>
    </header>

    <div class="bar">
      <select v-model="connId" class="sel" :title="t('aichat.connFor')">
        <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name || c.id }}</option>
      </select>
      <label class="schk" :title="t('aichat.useSchemaTitle')">
        <input type="checkbox" :checked="useSchema" @change="toggleSchema" />
        <span class="schk-lbl">{{ t('aichat.useSchema') }}</span>
        <span v-if="schemaLoading" class="mini">…</span>
        <span v-else-if="useSchema && schemaText" class="mini" :title="schemaText">✓</span>
      </label>
      <button class="ghost sm" :disabled="!messages.length" @click="clearAll">{{ t('aichat.clear') }}</button>
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
            <pre v-if="p.type === 'text'" class="part-text">{{ p.content }}</pre>
            <div v-else class="part-sql">
              <pre>{{ p.content }}</pre>
              <div class="part-actions">
                <button @click="copyText(p.content)">{{ t('common.copy') }}</button>
                <button @click="emitInsert(p.content)">{{ t('aichat.insertDraft') }}</button>
                <button class="run" @click="emitRun(p.content)">▶ {{ t('aichat.run') }}</button>
              </div>
            </div>
          </template>
        </template>
      </div>
      <div v-if="running" class="thinking">{{ t('aichat.thinking') }}</div>
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
        <span class="model">{{ settings.aiProvider }} · {{ settings.aiProviders[settings.aiProvider]?.model || '?' }}</span>
        <span v-if="allSqls.length" class="hint">{{ t('aichat.lastSqlHint', { n: allSqls.length }) }}</span>
        <button v-if="!running" class="primary" :disabled="!input.trim()" @click="send">{{ t('aichat.send') }}</button>
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
  min-width: 320px;
  background: var(--panel);
  border-left: 1px solid var(--border);
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
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex: none;
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
.schk {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
}
.schk-lbl {
  white-space: nowrap;
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
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text);
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
.thinking {
  color: var(--muted);
  font-size: 12px;
  font-style: italic;
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
  font-family: ui-monospace, monospace;
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
