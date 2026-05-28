<script setup lang="ts">
/**
 * Dashboard（#12）：把若干常用查询拼成一面小盘子，一眼能看出"今天怎么了"。
 *
 * MVP 走最小可用：
 *   - 卡片 = { id, title, connId, sql, lastRunAt, lastResult }
 *   - 编辑卡片：弹小表单填三个字段
 *   - 刷新：单卡片 + 一键全刷
 *   - 持久化：localStorage（JSON，全 dashboard 共享一份）
 *   - 显示：每卡顶部标题 + 连接名 + 行数；下面 5 行预览（更多让用户跳查询页）
 *
 * 没做：定时刷新（自己手动按就行；定时容易被忘后台跑死）、图表（点 → 跳 ChartDialog
 * 是更清晰的"想看就看"路径）、共享/导出（v0.5 再说）。
 */
import type { ConnectionConfig, QueryResult } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { alert as appAlert, confirm as appConfirm, toast } from '../dialog'
import { t } from '../i18n'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: [] }>()
const client = useDataClient()

interface Card {
  id: string
  title: string
  connId: string
  sql: string
  lastRunAt?: number
  lastResult?: QueryResult | null
  lastError?: string | null
}

const DASH_KEY = 'skylerx.dashboard.cards'
const cards = ref<Card[]>([])
const conns = ref<ConnectionConfig[]>([])
const editing = ref<Card | null>(null) // 非 null 即在「编辑卡片」表单

function loadCards(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(DASH_KEY) ?? '[]') as Card[]
    // 不持久化 lastResult（可能很大），重新打开时清掉
    cards.value = raw.map((c) => ({ ...c, lastResult: null, lastError: null }))
  } catch {
    cards.value = []
  }
}
function saveCards(): void {
  try {
    const lean = cards.value.map((c) => ({
      id: c.id,
      title: c.title,
      connId: c.connId,
      sql: c.sql,
      lastRunAt: c.lastRunAt,
    }))
    localStorage.setItem(DASH_KEY, JSON.stringify(lean))
  } catch {
    /* ignore */
  }
}

onMounted(async () => {
  loadCards()
  conns.value = await client.connections.list()
})

const connName = (id: string): string => conns.value.find((c) => c.id === id)?.name ?? id

async function addCard(): Promise<void> {
  if (!conns.value.length) {
    await appAlert({ message: t('dash.noConn'), variant: 'warn' })
    return
  }
  editing.value = {
    id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: '',
    connId: conns.value[0]?.id ?? '',
    sql: '',
  }
}

function saveEditing(): void {
  const e = editing.value
  if (!e) return
  if (!e.title.trim() || !e.connId || !e.sql.trim()) {
    toast.warn(t('dash.missingFields'))
    return
  }
  const i = cards.value.findIndex((c) => c.id === e.id)
  if (i >= 0) cards.value[i] = { ...cards.value[i], ...e }
  else cards.value.push({ ...e })
  saveCards()
  editing.value = null
}

async function removeCard(card: Card): Promise<void> {
  if (
    !(await appConfirm({
      message: t('dash.removeConfirm', { title: card.title }),
      variant: 'warn',
    }))
  )
    return
  cards.value = cards.value.filter((c) => c.id !== card.id)
  saveCards()
}

async function runCard(card: Card): Promise<void> {
  card.lastError = null
  card.lastResult = null
  try {
    card.lastResult = await client.connections.execute(card.connId, card.sql)
    card.lastRunAt = Date.now()
    saveCards()
  } catch (e) {
    card.lastError = e instanceof Error ? e.message : String(e)
  }
}
async function runAll(): Promise<void> {
  await Promise.all(cards.value.map((c) => runCard(c)))
}

function fmtTime(ts: number | undefined): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString()
}
const previewRows = computed(() => (card: Card) => (card.lastResult?.rows ?? []).slice(0, 5))
function previewCols(card: Card): string[] {
  return (card.lastResult?.columns ?? []).map((c) => c.name)
}
</script>

<template>
  <Modal :title="t('dash.title')" @close="emit('close')">
    <div class="dash">
      <div class="dash-bar">
        <button class="primary" @click="addCard">+ {{ t('dash.addCard') }}</button>
        <button :disabled="!cards.length" @click="runAll">↻ {{ t('dash.refreshAll') }}</button>
        <span class="muted">{{ cards.length }} {{ t('dash.cards') }}</span>
      </div>

      <!-- 编辑卡片表单 -->
      <div v-if="editing" class="edit-pane">
        <label class="row">
          <span class="lbl">{{ t('dash.cardTitle') }}</span>
          <input v-model="editing.title" :placeholder="t('dash.titlePh')" />
        </label>
        <label class="row">
          <span class="lbl">{{ t('aichat.conn') }}</span>
          <select v-model="editing.connId">
            <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name || c.dialect }}</option>
          </select>
        </label>
        <label class="row col">
          <span class="lbl">SQL</span>
          <textarea v-model="editing.sql" rows="4" spellcheck="false" placeholder="SELECT count(*) FROM users WHERE created_at > now() - interval '1 day'" />
        </label>
        <div class="edit-actions">
          <button class="ghost" @click="editing = null">{{ t('common.cancel') }}</button>
          <button class="primary" @click="saveEditing">{{ t('common.save') }}</button>
        </div>
      </div>

      <!-- 卡片网格 -->
      <div v-if="!editing" class="cards-grid">
        <div v-if="!cards.length" class="empty">{{ t('dash.empty') }}</div>
        <div v-for="card in cards" :key="card.id" class="card">
          <div class="card-head">
            <span class="card-title">{{ card.title }}</span>
            <span class="card-conn">{{ connName(card.connId) }}</span>
            <span class="grow" />
            <button class="ghost sm" :title="t('dash.refresh')" @click="runCard(card)">↻</button>
            <button class="ghost sm" :title="t('common.edit')" @click="editing = { ...card }">✎</button>
            <button class="ghost sm" :title="t('common.remove')" @click="removeCard(card)">×</button>
          </div>
          <pre class="card-sql">{{ card.sql.slice(0, 200) }}{{ card.sql.length > 200 ? '…' : '' }}</pre>
          <div v-if="card.lastError" class="card-err">✗ {{ card.lastError.slice(0, 200) }}</div>
          <div v-else-if="card.lastResult" class="card-result">
            <div class="card-meta">
              <span>{{ t('dash.rows', { n: card.lastResult.rowCount }) }}</span>
              <span class="muted">{{ fmtTime(card.lastRunAt) }} · {{ card.lastResult.executionTimeMs }}ms</span>
            </div>
            <table v-if="card.lastResult.rows.length" class="mini-tbl">
              <thead>
                <tr><th v-for="c in previewCols(card)" :key="c">{{ c }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in previewRows(card)" :key="i">
                  <td v-for="c in previewCols(card)" :key="c">{{ row[c] == null ? '' : String(row[c]).slice(0, 60) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="card-stale">{{ t('dash.notRunYet') }}</div>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.dash {
  min-width: 760px;
  min-height: 500px;
  max-height: 75vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dash-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.dash-bar button {
  padding: 5px 14px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.dash-bar .primary { background: var(--accent, #7c6cff); color: #fff; border-color: var(--accent, #7c6cff); }
.dash-bar button:disabled { opacity: 0.5; cursor: not-allowed; }
.dash-bar .muted { font-size: 11px; color: var(--muted); margin-left: auto; }

.edit-pane { display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; gap: 8px; }
.row.col { flex-direction: column; gap: 4px; }
.row .lbl { width: 100px; flex: none; font-size: 12px; color: var(--muted); }
.row.col .lbl { width: auto; }
.row input, .row select, .row textarea {
  flex: 1;
  padding: 4px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.row textarea { font-family: ui-monospace, monospace; resize: vertical; }
.edit-actions { display: flex; justify-content: flex-end; gap: 8px; }
.edit-actions button {
  padding: 5px 14px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid var(--border);
  cursor: pointer;
}
.edit-actions .ghost { background: transparent; color: var(--text); }
.edit-actions .primary { background: var(--accent, #7c6cff); color: #fff; border-color: var(--accent, #7c6cff); }

.cards-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  overflow-y: auto;
}
.empty { grid-column: 1 / -1; padding: 32px; text-align: center; color: var(--muted); }
.card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 140px;
}
.card-head { display: flex; align-items: center; gap: 6px; }
.card-title { font-weight: 600; font-size: 13px; }
.card-conn { font-size: 11px; color: var(--muted); padding: 1px 6px; background: var(--panel); border-radius: 3px; }
.grow { flex: 1; }
.ghost.sm { padding: 2px 6px; font-size: 11px; background: transparent; border: 1px solid var(--border); border-radius: 4px; color: var(--text); cursor: pointer; }
.card-sql {
  margin: 0;
  padding: 6px 8px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--muted);
  max-height: 60px;
  overflow-y: auto;
}
.card-err {
  padding: 6px 8px;
  font-size: 11px;
  background: rgba(224, 64, 80, 0.10);
  color: var(--err, #e04050);
  border-radius: 4px;
  font-family: ui-monospace, monospace;
}
.card-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}
.card-stale { font-size: 11px; color: var(--muted); font-style: italic; }
.mini-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.mini-tbl th, .mini-tbl td {
  border: 1px solid var(--border);
  padding: 2px 6px;
  text-align: left;
  font-family: ui-monospace, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}
.mini-tbl th { background: var(--panel); font-weight: 600; }
.muted { color: var(--muted); }
</style>
