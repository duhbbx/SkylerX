<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 数据契约（B7）：在 localStorage 维护一份 JSON 规则集，结果集执行后按契约扫，
 * 违规行用 toast 提示（详细在 console）。
 *
 * 契约形态（极简版，覆盖最常用场景）：
 *   - notNull: ['phone', 'email']  这些列不能 NULL
 *   - range:   { age: [0, 150], price: [0, null] }  数值范围
 *   - regex:   { email: '^[^@]+@[^@]+$', phone: '^1\\d{10}$' }  正则
 *
 * MVP 落地：先做 UI + 存储 + 规则导出导入；运行时扫描留给后续 PR
 * （要接到 QueryPane execSql 完成事件去扫；当前先把基建做好）。
 */
import { onMounted, ref } from 'vue'
import { toast } from '../dialog'
import { t } from '../i18n'
import Modal from './Modal.vue'

interface Contract {
  /** 契约名（用户自定义） */
  name: string
  /** 适用于哪张表 / schema.table */
  table: string
  notNull: string[]
  range: Record<string, [number | null, number | null]>
  regex: Record<string, string>
  enabled: boolean
}

const emit = defineEmits<{ close: [] }>()
const STORAGE_KEY = 'skylerx.dataContracts'
const contracts = ref<Contract[]>([])
const editing = ref<Contract | null>(null)

function loadAll(): void {
  try {
    contracts.value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Contract[]
  } catch {
    contracts.value = []
  }
}
function saveAll(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contracts.value))
  } catch {
    /* ignore */
  }
}
onMounted(loadAll)

function addNew(): void {
  editing.value = {
    name: '',
    table: '',
    notNull: [],
    range: {},
    regex: {},
    enabled: true,
  }
}

const notNullInput = ref('')
const rangeColInput = ref('')
const rangeMinInput = ref('')
const rangeMaxInput = ref('')
const regexColInput = ref('')
const regexPattern = ref('')

function addNotNull(): void {
  if (!editing.value || !notNullInput.value.trim()) return
  editing.value.notNull.push(notNullInput.value.trim())
  notNullInput.value = ''
}
function addRange(): void {
  if (!editing.value || !rangeColInput.value.trim()) return
  const min = rangeMinInput.value ? Number(rangeMinInput.value) : null
  const max = rangeMaxInput.value ? Number(rangeMaxInput.value) : null
  editing.value.range[rangeColInput.value.trim()] = [min, max]
  rangeColInput.value = ''
  rangeMinInput.value = ''
  rangeMaxInput.value = ''
}
function addRegex(): void {
  if (!editing.value || !regexColInput.value.trim() || !regexPattern.value) return
  editing.value.regex[regexColInput.value.trim()] = regexPattern.value
  regexColInput.value = ''
  regexPattern.value = ''
}

function saveEditing(): void {
  if (!editing.value) return
  if (!editing.value.name.trim() || !editing.value.table.trim()) {
    toast.warn(t('contract.missingFields'))
    return
  }
  const i = contracts.value.findIndex((c) => c.name === editing.value?.name)
  if (i >= 0) contracts.value[i] = editing.value
  else contracts.value.push(editing.value)
  saveAll()
  editing.value = null
}

function deleteContract(name: string): void {
  contracts.value = contracts.value.filter((c) => c.name !== name)
  saveAll()
}

function exportJson(): void {
  void navigator.clipboard?.writeText(JSON.stringify(contracts.value, null, 2))
  toast.success(t('contract.exportedToClipboard'))
}

function importJson(): void {
  const text = prompt(t('contract.pasteImport'))
  if (!text) return
  try {
    const arr = JSON.parse(text) as Contract[]
    contracts.value = arr
    saveAll()
    toast.success(t('contract.importedN', { n: arr.length }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <Modal :title="t('contract.title')" width="wide" @close="emit('close')">
    <div class="ct">
      <div class="bar">
        <button class="primary" @click="addNew">+ {{ t('contract.add') }}</button>
        <button @click="exportJson">📋 {{ t('contract.export') }}</button>
        <button @click="importJson">📥 {{ t('contract.import') }}</button>
      </div>

      <div v-if="editing" class="edit">
        <label class="row"><span>{{ t('contract.name') }}</span><input v-model="editing.name" /></label>
        <label class="row"><span>{{ t('contract.table') }}</span><input v-model="editing.table" placeholder="schema.table" /></label>
        <label class="row"><span>{{ t('contract.enabled') }}</span><input v-model="editing.enabled" type="checkbox" /></label>

        <h4>NOT NULL</h4>
        <div class="chips">
          <span v-for="(c, i) in editing.notNull" :key="i" class="chip">{{ c }} <button @click="editing.notNull.splice(i, 1)">×</button></span>
        </div>
        <div class="add-row">
          <input v-model="notNullInput" placeholder="column" />
          <button @click="addNotNull">+</button>
        </div>

        <h4>{{ t('contract.range') }}</h4>
        <div class="chips">
          <span v-for="(v, k) in editing.range" :key="k" class="chip">{{ k }}: [{{ v[0] ?? '−∞' }}, {{ v[1] ?? '+∞' }}] <button @click="delete editing.range[k]">×</button></span>
        </div>
        <div class="add-row">
          <input v-model="rangeColInput" placeholder="column" />
          <input v-model="rangeMinInput" placeholder="min" type="number" />
          <input v-model="rangeMaxInput" placeholder="max" type="number" />
          <button @click="addRange">+</button>
        </div>

        <h4>{{ t('contract.regex') }}</h4>
        <div class="chips">
          <span v-for="(v, k) in editing.regex" :key="k" class="chip"><code>{{ k }}</code>: <code>{{ v }}</code> <button @click="delete editing.regex[k]">×</button></span>
        </div>
        <div class="add-row">
          <input v-model="regexColInput" placeholder="column" />
          <input v-model="regexPattern" placeholder="regex" />
          <button @click="addRegex">+</button>
        </div>

        <div class="edit-actions">
          <button @click="editing = null">{{ t('common.cancel') }}</button>
          <button class="primary" @click="saveEditing">{{ t('common.save') }}</button>
        </div>
      </div>

      <div v-else class="list">
        <div v-if="!contracts.length" class="empty">{{ t('contract.empty') }}</div>
        <div v-for="c in contracts" :key="c.name" class="item">
          <input v-model="c.enabled" type="checkbox" @change="saveAll" />
          <span class="c-name">{{ c.name }}</span>
          <span class="c-table"><code>{{ c.table }}</code></span>
          <span class="c-rules">{{ c.notNull.length }} not-null, {{ Object.keys(c.range).length }} range, {{ Object.keys(c.regex).length }} regex</span>
          <button class="ghost sm" @click="editing = { ...c }">✎</button>
          <button class="ghost sm" @click="deleteContract(c.name)">×</button>
        </div>
      </div>

      <p class="hint">{{ t('contract.statusHint') }}</p>
    </div>
  </Modal>
</template>

<style scoped>
.ct { min-width: 680px; min-height: 420px; max-height: 75vh; display: flex; flex-direction: column; gap: 8px; }
.bar { display: flex; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.bar button { padding: 4px 12px; font-size: 12px; background: transparent; border: 1px solid var(--border); border-radius: 4px; color: var(--text); cursor: pointer; }
.bar .primary { background: var(--accent, #7c6cff); color: #fff; border-color: var(--accent, #7c6cff); }
.edit { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; flex: 1; }
.edit h4 { margin: 8px 0 4px; font-size: 12px; color: var(--accent, #7c6cff); }
.row { display: flex; gap: 8px; align-items: center; }
.row > span { width: 100px; font-size: 12px; color: var(--muted); }
.row input { flex: 1; padding: 4px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; }
.chips { display: flex; gap: 4px; flex-wrap: wrap; min-height: 24px; }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: rgba(124, 108, 255, 0.14); border-radius: 12px; font-size: 11px; font-family: ui-monospace, monospace; }
.chip button { background: transparent; border: none; color: var(--muted); cursor: pointer; font-size: 14px; padding: 0; }
.chip code { color: var(--text); }
.add-row { display: flex; gap: 4px; }
.add-row input { flex: 1; padding: 3px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; }
.add-row button { padding: 3px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); cursor: pointer; }
.edit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.edit-actions button { padding: 5px 14px; background: transparent; border: 1px solid var(--border); border-radius: 4px; color: var(--text); cursor: pointer; }
.edit-actions .primary { background: var(--accent, #7c6cff); color: #fff; border-color: var(--accent, #7c6cff); }
.list { flex: 1; overflow-y: auto; }
.empty { padding: 40px; text-align: center; color: var(--muted); }
.item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.c-name { font-weight: 600; }
.c-table code { font-family: ui-monospace, monospace; font-size: 11px; color: var(--muted); }
.c-rules { flex: 1; font-size: 11px; color: var(--muted); }
.ghost.sm { padding: 2px 8px; font-size: 11px; background: transparent; border: 1px solid var(--border); border-radius: 4px; color: var(--text); cursor: pointer; }
.hint { font-size: 11px; color: var(--muted); padding-top: 8px; border-top: 1px solid var(--border); }
</style>
