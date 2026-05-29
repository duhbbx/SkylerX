<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type DbDialect, MetaNodeKind, type MetadataNode } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { type TableContext, quoteId } from '../ddl'
import { t } from '../i18n'
import { buildInsertStatements, parseCSV, parseJSON } from '../io'
import Modal from './Modal.vue'
import type { TreeNode } from './treeNode'

const client = useDataClient()

const props = defineProps<{
  connId: string
  dialect: DbDialect
  ctx: TableContext
  node: TreeNode
}>()
const emit = defineEmits<{ done: [number]; close: [] }>()

// ── 多步向导：1 选文件 / 2 字段映射 / 3 选项与执行 ──
type StepId = 'pick' | 'map' | 'run'
const step = ref<StepId>('pick')
const STEPS: { id: StepId; key: string }[] = [
  { id: 'pick', key: 'import.step.pick' },
  { id: 'map', key: 'import.step.map' },
  { id: 'run', key: 'import.step.run' },
]
function stepIdx(s: StepId): number {
  return STEPS.findIndex((x) => x.id === s)
}

const tableCols = ref<string[]>([])
const fileName = ref('')
const csvRows = ref<string[][]>([])
const hasHeader = ref(true)
/** 目标表列 → CSV 列索引（-1 = 不导入该列） */
const mapping = ref<Record<string, number>>({})
const busy = ref(false)
const error = ref<string | null>(null)
const preTruncate = ref(false)
const chunkSize = ref(200)

const header = computed<string[]>(() => {
  const first = csvRows.value[0] ?? []
  return hasHeader.value ? first : first.map((_c, i) => t('import.colN', { n: i + 1 }))
})
const dataRows = computed<string[][]>(() =>
  hasHeader.value ? csvRows.value.slice(1) : csvRows.value,
)
const preview = computed(() => dataRows.value.slice(0, 5))
const mappedCols = computed(() => tableCols.value.filter((c) => (mapping.value[c] ?? -1) >= 0))

onMounted(async () => {
  try {
    const cols: MetadataNode[] = await client.connections.metadata(props.connId, {
      parentKind: MetaNodeKind.Group,
      path: [...props.node.path],
      group: 'columns',
    })
    tableCols.value = cols.map((c) => c.name)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

// 按列名（忽略大小写）自动配对
function autoMap(): void {
  const lower = header.value.map((h) => h.trim().toLowerCase())
  const m: Record<string, number> = {}
  for (const col of tableCols.value) m[col] = lower.indexOf(col.toLowerCase())
  mapping.value = m
}

async function pickFile(): Promise<void> {
  error.value = null
  const f = await client.files.openText([
    { name: t('import.dataFiles'), extensions: ['csv', 'txt', 'json'] },
    { name: t('common.allFiles'), extensions: ['*'] },
  ])
  if (!f) return
  fileName.value = f.name
  const trimmed = f.content.trimStart()
  const isJson = /\.json$/i.test(f.name) || trimmed.startsWith('[') || trimmed.startsWith('{')
  try {
    csvRows.value = isJson ? parseJSON(f.content) : parseCSV(f.content)
    if (isJson) hasHeader.value = true // JSON 首行即键名
  } catch (e) {
    error.value = t('import.parseFail', { msg: e instanceof Error ? e.message : String(e) })
    csvRows.value = []
    return
  }
  autoMap()
}

// Excel 走渲染端二进制读取（不经文本通道），按需动态加载 SheetJS
const xlsxInput = ref<HTMLInputElement>()
async function onXlsxPicked(e: Event): Promise<void> {
  error.value = null
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const buf = await file.arrayBuffer()
    const XLSX = await import('xlsx')
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    csvRows.value = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' })
    fileName.value = file.name
    hasHeader.value = true // Excel 首行作表头
    autoMap()
  } catch (err) {
    error.value = t('import.excelFail', { msg: err instanceof Error ? err.message : String(err) })
    csvRows.value = []
  } finally {
    if (xlsxInput.value) xlsxInput.value.value = '' // 允许重选同一文件
  }
}

/**
 * 类型推断：采样源 CSV 列的前 50 个非空值，按全部能解析为 number / ISO date / boolean 来归一。
 * 仅做提示（导入时仍按字符串插，DB 端按列定义转换）。
 */
type Inferred = 'number' | 'date' | 'boolean' | 'string'
function inferType(srcIdx: number): { type: Inferred; nullable: boolean; samples: number } {
  const N = 50
  let n = 0
  let nulls = 0
  let nums = 0
  let dates = 0
  let bools = 0
  const rows = dataRows.value
  for (const row of rows) {
    if (n >= N) break
    const v = (row[srcIdx] ?? '').trim()
    if (v === '') {
      nulls++
      continue
    }
    n++
    if (/^-?\d+(\.\d+)?$/.test(v)) nums++
    else if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?Z?$/i.test(v)) dates++
    else if (/^(true|false|t|f|y|n)$/i.test(v)) bools++
  }
  const nullable = nulls > 0
  if (n === 0) return { type: 'string', nullable, samples: 0 }
  if (nums === n) return { type: 'number', nullable, samples: n }
  if (dates === n) return { type: 'date', nullable, samples: n }
  if (bools === n) return { type: 'boolean', nullable, samples: n }
  return { type: 'string', nullable, samples: n }
}
const inferredByCol = computed(() => {
  const out: Record<string, ReturnType<typeof inferType>> = {}
  for (const col of tableCols.value) {
    const idx = mapping.value[col] ?? -1
    if (idx >= 0) out[col] = inferType(idx)
  }
  return out
})

function gotoStep(s: StepId): void {
  // 没文件不让走出 Step 1；没映射不让进 Step 3
  if (s !== 'pick' && !csvRows.value.length) return
  if (s === 'run' && !mappedCols.value.length) {
    error.value = t('import.needMap')
    return
  }
  error.value = null
  step.value = s
}

async function runImport(): Promise<void> {
  if (!mappedCols.value.length) {
    error.value = t('import.needMap')
    return
  }
  if (!dataRows.value.length) {
    error.value = t('import.noRows')
    return
  }
  busy.value = true
  error.value = null
  try {
    const tableRef = props.node.sqlName ?? quoteId(props.dialect, props.node.name)
    const stmts: string[] = []
    if (preTruncate.value) stmts.push(`TRUNCATE TABLE ${tableRef}`)
    const cols = mappedCols.value
    const aligned = dataRows.value.map((r) => cols.map((c) => r[mapping.value[c]] ?? ''))
    stmts.push(...buildInsertStatements(props.dialect, tableRef, cols, aligned, chunkSize.value))
    await client.connections.executeBatch(props.connId, stmts, {
      database: props.ctx.database,
      schema: props.ctx.schema,
    })
    emit('done', dataRows.value.length)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal :title="t('import.title', { name: node.name })" width="wide" fixed-height storage-key="import" @close="emit('close')">
    <div class="imp">
      <!-- 步骤指示 -->
      <ol class="steps">
        <li
          v-for="(s, i) in STEPS"
          :key="s.id"
          :class="{ on: step === s.id, done: stepIdx(step) > i }"
          @click="gotoStep(s.id)"
        >
          <span class="num">{{ i + 1 }}</span>
          <span class="lbl">{{ t(s.key) }}</span>
        </li>
      </ol>

      <!-- Step 1: 选文件 + 预览 -->
      <section v-if="step === 'pick'" class="content">
        <div class="row">
          <button class="primary" @click="pickFile">{{ t('import.pickFile') }}</button>
          <button @click="xlsxInput?.click()">Excel…</button>
          <input ref="xlsxInput" type="file" accept=".xlsx,.xls" style="display: none" @change="onXlsxPicked" />
          <span v-if="fileName" class="fname">{{ fileName }}</span>
          <label v-if="csvRows.length" class="chk">
            <input v-model="hasHeader" type="checkbox" @change="autoMap" /> {{ t('import.hasHeader') }}
          </label>
          <span v-if="csvRows.length" class="muted">{{ t('import.rowCount', { n: dataRows.length }) }}</span>
        </div>
        <div v-if="csvRows.length" class="prev">
          <div class="map-head">{{ t('import.preview') }}</div>
          <div class="scroll">
            <table class="grid">
              <thead>
                <tr>
                  <th v-for="(h, i) in header" :key="i">{{ h }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, ri) in preview" :key="ri">
                  <td v-for="(_h, ci) in header" :key="ci">{{ r[ci] }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Step 2: 字段映射 + 类型推断 -->
      <section v-else-if="step === 'map'" class="content">
        <div class="row">
          <button class="ghost" @click="autoMap">{{ t('import.autoMap') }}</button>
          <span class="muted">{{ t('import.mappedHint', { n: mappedCols.length, total: tableCols.length }) }}</span>
        </div>
        <div class="map">
          <div v-for="col in tableCols" :key="col" class="map-row">
            <span class="tcol">{{ col }}</span>
            <span class="arrow">←</span>
            <select v-model.number="mapping[col]">
              <option :value="-1">{{ t('import.skip') }}</option>
              <option v-for="(h, i) in header" :key="i" :value="i">{{ h }}</option>
            </select>
            <span v-if="inferredByCol[col]" class="badge" :class="'ty-' + inferredByCol[col].type">
              {{ t('import.ty.' + inferredByCol[col].type) }}
              <span v-if="inferredByCol[col].nullable" class="null-dot" :title="t('import.ty.nullable')">·∅</span>
            </span>
          </div>
        </div>
      </section>

      <!-- Step 3: 选项 + 执行 -->
      <section v-else class="content">
        <div class="opt-row">
          <label>
            <input v-model="preTruncate" type="checkbox" /> {{ t('import.preTruncate') }}
          </label>
          <span class="muted">{{ t('import.preTruncateHint') }}</span>
        </div>
        <div class="opt-row">
          <span class="lbl">{{ t('import.chunkSize') }}</span>
          <input v-model.number="chunkSize" type="number" min="1" max="2000" />
          <span class="muted">{{ t('import.chunkSizeHint') }}</span>
        </div>
        <div class="opt-row">
          <span class="muted">{{ t('import.summary', { rows: dataRows.length, cols: mappedCols.length }) }}</span>
        </div>
      </section>

      <div v-if="error" class="banner err">✗ {{ error }}</div>

      <!-- 底部导航 -->
      <div class="actions">
        <button class="ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
        <span class="spacer" />
        <button v-if="stepIdx(step) > 0" class="ghost" @click="gotoStep(STEPS[stepIdx(step) - 1].id)">
          {{ t('import.back') }}
        </button>
        <button
          v-if="stepIdx(step) < STEPS.length - 1"
          class="primary"
          :disabled="!csvRows.length"
          @click="gotoStep(STEPS[stepIdx(step) + 1].id)"
        >
          {{ t('import.next') }}
        </button>
        <button
          v-else
          class="primary"
          :disabled="busy || !mappedCols.length || !dataRows.length"
          @click="runImport"
        >
          {{ busy ? t('import.importing') : t('import.importN', { n: mappedCols.length }) }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.imp {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
}
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 10px;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 14px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
}
.steps li .num {
  display: inline-flex;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--border);
  align-items: center;
  justify-content: center;
  font-size: 11px;
}
.steps li.on {
  color: var(--text);
  border-color: var(--accent, #7c6cff);
  background: rgba(124, 108, 255, 0.12);
}
.steps li.on .num {
  background: var(--accent, #7c6cff);
  color: #fff;
  border-color: var(--accent, #7c6cff);
}
.steps li.done .num {
  background: rgba(76, 175, 80, 0.7);
  color: #fff;
  border-color: rgba(76, 175, 80, 0.7);
}
.content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.fname {
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
.chk {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.map-head {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
}
.map {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.map-row {
  display: grid;
  grid-template-columns: 1fr 24px 1.4fr 110px;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.tcol {
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
.arrow {
  text-align: center;
  color: var(--muted);
}
.map-row select {
  padding: 4px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(127, 127, 127, 0.18);
  color: var(--text);
  text-align: center;
}
.badge.ty-number {
  background: rgba(124, 108, 255, 0.18);
}
.badge.ty-date {
  background: rgba(76, 175, 80, 0.18);
}
.badge.ty-boolean {
  background: rgba(255, 152, 0, 0.18);
}
.badge.ty-string {
  background: rgba(127, 127, 127, 0.18);
}
.null-dot {
  color: var(--muted);
  margin-left: 2px;
}
.prev .scroll {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.grid {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;
}
.grid th,
.grid td {
  border: 1px solid var(--border);
  padding: 4px 8px;
  text-align: left;
  white-space: nowrap;
}
.grid th {
  color: var(--muted);
  position: sticky;
  top: 0;
  background: var(--panel);
}
.opt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.opt-row .lbl {
  width: 100px;
  color: var(--muted);
}
.opt-row input[type='number'] {
  width: 80px;
  padding: 5px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.actions {
  flex: none;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.actions .spacer {
  flex: 1;
}
.actions button {
  padding: 6px 16px;
}
.banner.err {
  white-space: pre-wrap;
}
</style>
