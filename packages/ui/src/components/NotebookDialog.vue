<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Notebook 模式 —— 多 cell 混排 SQL / Markdown,类 Jupyter。
 *
 * 每个 SQL cell 独立运行(在选定连接上),结果内联成表;Markdown cell 渲染成富文本。
 * 笔记本存 localStorage(../notebook/store,已单测),只存内容、不存结果。
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { reportError } from '../errorReporter'
import { locale } from '../i18n'
import { renderMarkdown } from '../markdown'
import {
  type CellKind,
  type Notebook,
  type NotebookSummary,
  deleteNotebook,
  listNotebooks,
  loadNotebook,
  newId,
  saveNotebook,
} from '../notebook/store'
import Modal from './Modal.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()
const L = (zh: string, en: string): string => (locale.value === 'en' ? en : zh)

const conns = ref<ConnectionConfig[]>([])
const savedList = ref<NotebookSummary[]>([])
type CellResult = {
  columns?: string[]
  rows?: Record<string, unknown>[]
  error?: string
  running?: boolean
  affected?: number
}
const results = ref<Record<string, CellResult>>({})

function blank(): Notebook {
  const now = Date.now()
  return {
    id: newId(now, Math.random()),
    title: L('未命名笔记本', 'Untitled notebook'),
    connId: '',
    cells: [{ id: newId(now, Math.random()), kind: 'sql', content: '' }],
    createdAt: now,
    updatedAt: now,
  }
}
const nb = ref<Notebook>(blank())

function refreshList(): void {
  savedList.value = listNotebooks()
}
function save(): void {
  nb.value.updatedAt = Date.now()
  saveNotebook(nb.value)
  refreshList()
}
function newNotebook(): void {
  nb.value = blank()
  results.value = {}
}
function openSaved(id: string): void {
  const n = loadNotebook(id)
  if (n) {
    nb.value = n
    results.value = {}
  }
}
function dropSaved(id: string): void {
  deleteNotebook(id)
  if (nb.value.id === id) newNotebook()
  refreshList()
}

function addCell(kind: CellKind, afterIdx: number): void {
  nb.value.cells.splice(afterIdx + 1, 0, {
    id: newId(Date.now(), Math.random()),
    kind,
    content: '',
  })
  save()
}
function removeCell(i: number): void {
  const id = nb.value.cells[i].id
  nb.value.cells.splice(i, 1)
  delete results.value[id]
  if (!nb.value.cells.length) addCell('sql', -1)
  else save()
}
function moveCell(i: number, dir: -1 | 1): void {
  const j = i + dir
  if (j < 0 || j >= nb.value.cells.length) return
  const cells = nb.value.cells
  ;[cells[i], cells[j]] = [cells[j], cells[i]]
  save()
}

async function runCell(cellId: string, sql: string): Promise<void> {
  if (!nb.value.connId) {
    toast.info(L('请先在顶部选连接', 'Pick a connection first'))
    return
  }
  if (!sql.trim()) return
  results.value[cellId] = { running: true }
  try {
    const r = await client.connections.execute(nb.value.connId, sql, [], { maxRows: 500 })
    results.value[cellId] = {
      columns: r.columns?.map((c) => c.name) ?? [],
      rows: r.rows ?? [],
      affected: r.affectedRows,
    }
  } catch (e) {
    results.value[cellId] = { error: e instanceof Error ? e.message : String(e) }
    reportError(e, { tag: 'notebook.run' })
  }
}
async function runAll(): Promise<void> {
  for (const c of nb.value.cells) if (c.kind === 'sql') await runCell(c.id, c.content)
}

const cell = (v: string): string => v
onMounted(async () => {
  try {
    conns.value = await client.connections.list()
  } catch {
    /* ignore */
  }
  refreshList()
})
</script>

<template>
  <Modal v-if="open" :title="L('Notebook', 'Notebook')" width="xl" @close="emit('close')">
    <div class="nb">
      <div class="top">
        <input v-model="nb.title" class="title" @change="save" />
        <select v-model="nb.connId" @change="save">
          <option value="">{{ L('选连接', 'connection') }}</option>
          <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} ({{ c.dialect }})</option>
        </select>
        <button class="primary" @click="runAll">{{ L('运行全部', 'Run all') }}</button>
        <button @click="save">{{ L('保存', 'Save') }}</button>
        <button @click="newNotebook">{{ L('新建', 'New') }}</button>
        <select v-if="savedList.length" @change="(e) => { const v = (e.target as HTMLSelectElement).value; if (v) openSaved(v); (e.target as HTMLSelectElement).value = '' }">
          <option value="">{{ L('打开…', 'Open…') }}</option>
          <option v-for="s in savedList" :key="s.id" :value="s.id">{{ s.title }} ({{ s.cells }})</option>
        </select>
        <button v-if="savedList.some((s) => s.id === nb.id)" class="del" @click="dropSaved(nb.id)">{{ L('删除本笔记本', 'Delete') }}</button>
      </div>

      <div v-for="(c, i) in nb.cells" :key="c.id" class="cell">
        <div class="cmeta">
          <span class="kind" :class="c.kind">{{ c.kind === 'sql' ? 'SQL' : 'MD' }}</span>
          <button v-if="c.kind === 'sql'" class="run" @click="runCell(c.id, c.content)">▶ {{ L('运行', 'Run') }}</button>
          <span class="sp" />
          <button @click="moveCell(i, -1)" :disabled="i === 0">↑</button>
          <button @click="moveCell(i, 1)" :disabled="i === nb.cells.length - 1">↓</button>
          <button @click="addCell('sql', i)">+SQL</button>
          <button @click="addCell('md', i)">+MD</button>
          <button class="del" @click="removeCell(i)">✕</button>
        </div>
        <textarea
          v-model="c.content"
          class="editor"
          :class="c.kind"
          :rows="Math.min(14, Math.max(2, c.content.split('\n').length + 1))"
          :placeholder="c.kind === 'sql' ? 'SELECT …' : L('Markdown 文本…', 'Markdown text…')"
          @change="save"
        ></textarea>

        <!-- Markdown 渲染 -->
        <div v-if="c.kind === 'md' && c.content.trim()" class="md" v-html="renderMarkdown(cell(c.content))"></div>

        <!-- SQL 结果 -->
        <div v-if="c.kind === 'sql' && results[c.id]" class="res">
          <p v-if="results[c.id].running" class="note">…</p>
          <p v-else-if="results[c.id].error" class="err">❌ {{ results[c.id].error }}</p>
          <template v-else>
            <p v-if="!results[c.id].columns?.length" class="note">
              {{ L('成功', 'OK') }}<template v-if="results[c.id].affected != null"> · {{ results[c.id].affected }} {{ L('行受影响', 'affected') }}</template>
            </p>
            <div v-else class="rscroll">
              <table class="rtbl">
                <thead><tr><th v-for="col in results[c.id].columns" :key="col">{{ col }}</th></tr></thead>
                <tbody>
                  <tr v-for="(row, ri) in results[c.id].rows!.slice(0, 200)" :key="ri">
                    <td v-for="col in results[c.id].columns" :key="col">{{ row[col] == null ? '' : String(row[col]) }}</td>
                  </tr>
                </tbody>
              </table>
              <span class="note">{{ results[c.id].rows!.length }} {{ L('行', 'rows') }}<template v-if="results[c.id].rows!.length > 200"> ({{ L('显示前 200', 'first 200') }})</template></span>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.nb { display: flex; flex-direction: column; gap: 10px; min-width: 820px; }
.top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; position: sticky; top: 0; background: var(--bg, #fff); padding-bottom: 6px; z-index: 1; }
.title { flex: 1 1 200px; font-weight: 600; }
.cell { border: 1px solid var(--border, #e3e3e3); border-radius: 8px; padding: 8px; }
.cmeta { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.cmeta .sp { flex: 1; }
.kind { font-size: 11px; padding: 1px 6px; border-radius: 4px; }
.kind.sql { background: #eef5ff; color: #2d7ff9; }
.kind.md { background: #f0f0f0; color: #888; }
.run { color: #1e7e34; }
.editor { width: 100%; font-size: 12px; }
.editor.sql { font-family: monospace; }
.md { border-left: 3px solid var(--accent, #2d7ff9); padding: 4px 10px; margin-top: 6px; font-size: 13px; }
.res { margin-top: 6px; }
.note { font-size: 12px; color: var(--fg-muted, #888); }
.err { font-size: 12px; color: #c0392b; }
.rscroll { max-height: 260px; overflow: auto; }
.rtbl { border-collapse: collapse; font-size: 12px; }
.rtbl th, .rtbl td { border: 1px solid var(--border, #e8e8e8); padding: 3px 8px; text-align: left; white-space: nowrap; }
.del { color: #c0392b; }
.primary { background: var(--accent, #2d7ff9); color: #fff; border: none; padding: 4px 12px; border-radius: 6px; cursor: pointer; }
</style>
