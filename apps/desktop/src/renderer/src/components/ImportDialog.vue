<script setup lang="ts">
import { type DbDialect, type MetadataNode, MetaNodeKind } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import type { TableContext } from '../ddl'
import { buildInsertStatements, parseCSV } from '../io'
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
  return hasHeader.value ? first : first.map((_c, i) => `列 ${i + 1}`)
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
    { name: 'CSV', extensions: ['csv', 'txt'] },
    { name: '所有文件', extensions: ['*'] },
  ])
  if (!f) return
  fileName.value = f.name
  csvRows.value = parseCSV(f.content)
  autoMap()
}

async function runImport(): Promise<void> {
  if (!mappedCols.value.length) {
    error.value = '请至少映射一列'
    return
  }
  if (!dataRows.value.length) {
    error.value = '没有可导入的数据行'
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
  <Modal :title="`导入数据 → ${node.name}`" wide @close="emit('close')">
    <div class="imp">
      <div class="row">
        <button class="primary" @click="pickFile">选择 CSV 文件…</button>
        <span v-if="fileName" class="fname">{{ fileName }}</span>
        <label v-if="csvRows.length" class="chk">
          <input v-model="hasHeader" type="checkbox" @change="autoMap" /> 首行为表头
        </label>
        <span v-if="csvRows.length" class="muted">共 {{ dataRows.length }} 行数据</span>
      </div>

      <template v-if="csvRows.length">
        <div class="map">
          <div class="map-head">列映射（目标列 ← CSV 列）</div>
          <div v-for="col in tableCols" :key="col" class="map-row">
            <span class="tcol">{{ col }}</span>
            <span class="arrow">←</span>
            <select v-model.number="mapping[col]">
              <option :value="-1">（不导入）</option>
              <option v-for="(h, i) in header" :key="i" :value="i">{{ h }}</option>
            </select>
          </div>
        </div>

        <div class="prev">
          <div class="map-head">预览（前 5 行）</div>
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
        <button class="ghost" @click="emit('close')">取消</button>
        <button class="primary" :disabled="busy || !csvRows.length" @click="runImport">
          {{ busy ? '导入中…' : `导入 ${mappedCols.length} 列` }}
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
