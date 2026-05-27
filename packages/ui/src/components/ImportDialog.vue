<script setup lang="ts">
import { type DbDialect, type MetadataNode, MetaNodeKind } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import type { TableContext } from '../ddl'
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

const tableCols = ref<string[]>([])
const fileName = ref('')
const csvRows = ref<string[][]>([])
const hasHeader = ref(true)
/** 目标表列 → CSV 列索引（-1 = 不导入该列） */
const mapping = ref<Record<string, number>>({})
const busy = ref(false)
const error = ref<string | null>(null)

const header = computed<string[]>(() => {
  const first = csvRows.value[0] ?? []
  return hasHeader.value ? first : first.map((_c, i) => t('import.colN', { n: i + 1 }))
})
const dataRows = computed<string[][]>(() => (hasHeader.value ? csvRows.value.slice(1) : csvRows.value))
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
    const cols = mappedCols.value
    const aligned = dataRows.value.map((r) => cols.map((c) => r[mapping.value[c]] ?? ''))
    const stmts = buildInsertStatements(props.dialect, props.node.sqlName ?? props.node.name, cols, aligned)
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
  <Modal :title="t('import.title', { name: node.name })" wide @close="emit('close')">
    <div class="imp">
      <div class="row">
        <button class="primary" @click="pickFile">{{ t('import.pickFile') }}</button>
        <button @click="xlsxInput?.click()">Excel…</button>
        <input
          ref="xlsxInput"
          type="file"
          accept=".xlsx,.xls"
          style="display: none"
          @change="onXlsxPicked"
        />
        <span v-if="fileName" class="fname">{{ fileName }}</span>
        <label v-if="csvRows.length" class="chk">
          <input v-model="hasHeader" type="checkbox" @change="autoMap" /> {{ t('import.hasHeader') }}
        </label>
        <span v-if="csvRows.length" class="muted">{{ t('import.rowCount', { n: dataRows.length }) }}</span>
      </div>

      <template v-if="csvRows.length">
        <div class="map">
          <div class="map-head">{{ t('import.mapHead') }}</div>
          <div v-for="col in tableCols" :key="col" class="map-row">
            <span class="tcol">{{ col }}</span>
            <span class="arrow">←</span>
            <select v-model.number="mapping[col]">
              <option :value="-1">{{ t('import.skip') }}</option>
              <option v-for="(h, i) in header" :key="i" :value="i">{{ h }}</option>
            </select>
          </div>
        </div>

        <div class="prev">
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
      </template>

      <div v-if="error" class="banner err">✗ {{ error }}</div>

      <div class="actions">
        <button class="ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="primary" :disabled="busy || !csvRows.length" @click="runImport">
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
  max-height: 220px;
  overflow-y: auto;
}
.map-row {
  display: grid;
  grid-template-columns: 1fr 24px 1.4fr;
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
.prev .scroll {
  max-height: 180px;
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
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.actions button {
  padding: 7px 16px;
}
.banner.err {
  white-space: pre-wrap;
}
</style>
