<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Excel/CSV 粘贴板智能导入:
 *  - 输入:剪贴板里复制的 Excel/飞书表格(TSV) 或 CSV
 *  - 自动识别表头(首行)
 *  - 让用户选 connection + database + table
 *  - 自动匹配现有列(同名 / 大小写不敏感 / 下划线规整),用户可调
 *  - 一键执行 INSERT
 *
 * 比 ImportDialog 快得多:不用选文件,粘进来就开始。
 */
import { type ConnectionConfig, DbDialect, dialectKind, DbKind } from '@db-tool/shared-types'
import { computed, onMounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { quoteId } from '../ddl'
import { confirm as appConfirm, toast } from '../dialog'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  /** 可选预选连接 id;不传则用户在弹窗内选 */
  preferConnId?: string
  /** 预解析好的 rows;不传时弹窗读 navigator.clipboard.readText() */
  prefillRows?: string[][]
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

const conns = ref<ConnectionConfig[]>([])
const connId = ref<string>('')
const database = ref('')
const tableName = ref('')
const rows = ref<string[][]>([])
const headerRow = ref(0) // 第几行作为表头(0-based);允许用户改
const hasHeader = ref(true)
const submitting = ref(false)

// 表列(从数据库读到的)
interface TableCol {
  name: string
  dataType?: string
}
const tableColumns = ref<TableCol[]>([])
const loadingCols = ref(false)

// 用户配置:每一列映射到的目标 column 名(空=跳过)
const mapping = ref<string[]>([])

async function loadConns(): Promise<void> {
  conns.value = (await client.connections.list()).filter(
    (c) => dialectKind(c.dialect) === DbKind.Sql,
  )
}

const currentConn = computed(() => conns.value.find((c) => c.id === connId.value) ?? null)

/** 把剪贴板文本解析成 rows。优先 TSV,失败 fallback CSV。 */
function parseClipboard(text: string): string[][] {
  // TSV(Excel 默认复制格式)
  if (text.includes('\t')) {
    return text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => l.split('\t'))
  }
  // CSV 简单解析(不处理嵌套引号 — 复杂场景用 ImportDialog)
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const out: string[] = []
      let cur = ''
      let inQ = false
      for (let i = 0; i < l.length; i++) {
        const c = l[i]
        if (c === '"') {
          if (inQ && l[i + 1] === '"') {
            cur += '"'
            i++
          } else inQ = !inQ
        } else if (c === ',' && !inQ) {
          out.push(cur)
          cur = ''
        } else cur += c
      }
      out.push(cur)
      return out
    })
}

async function loadFromClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) {
      toast.warn('剪贴板为空,请先复制 Excel/CSV 数据再打开本对话框')
      return
    }
    rows.value = parseClipboard(text)
  } catch (e) {
    toast.error(`读剪贴板失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 加载选中表的列(用于映射推荐)。 */
async function loadTableColumns(): Promise<void> {
  if (!connId.value || !tableName.value.trim()) {
    tableColumns.value = []
    return
  }
  const c = currentConn.value
  if (!c) return
  loadingCols.value = true
  try {
    const dbPart = database.value.trim()
    // 简单 information_schema 查询(MySQL/PG 都支持)
    const dialectFam = c.dialect
    let sql = ''
    if (
      [
        DbDialect.MySQL,
        DbDialect.MariaDB,
        DbDialect.OceanBase,
        DbDialect.TiDB,
        DbDialect.Doris,
        DbDialect.StarRocks,
      ].includes(dialectFam)
    ) {
      sql = `SELECT column_name AS name, data_type AS data_type FROM information_schema.columns
        WHERE table_schema = '${dbPart.replace(/'/g, "''")}'
          AND table_name = '${tableName.value.replace(/'/g, "''")}'
        ORDER BY ordinal_position`
    } else {
      // PG / others
      sql = `SELECT column_name AS name, data_type AS data_type FROM information_schema.columns
        WHERE table_name = '${tableName.value.replace(/'/g, "''")}'
        ${dbPart ? `AND table_catalog = '${dbPart.replace(/'/g, "''")}'` : ''}
        ORDER BY ordinal_position`
    }
    const r = await client.connections.execute(c.id, sql, [], dbPart ? { database: dbPart } : {})
    tableColumns.value = (r.rows as Array<Record<string, unknown>>).map((x) => ({
      name: String(x.name ?? x.NAME ?? ''),
      dataType: String(x.data_type ?? x.DATA_TYPE ?? ''),
    }))
    // 自动按表头推荐映射
    if (headers.value.length && tableColumns.value.length) {
      mapping.value = headers.value.map((h) => guessColumn(h))
    }
  } catch (e) {
    toast.error(`拉表结构失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    loadingCols.value = false
  }
}

/** 把粘贴的列名规整化(小写/去下划线)用于模糊匹配。 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, '')
}

function guessColumn(header: string): string {
  const n = normalize(header)
  // 精确同名
  let hit = tableColumns.value.find((c) => c.name.toLowerCase() === header.toLowerCase())
  if (hit) return hit.name
  // 规整后
  hit = tableColumns.value.find((c) => normalize(c.name) === n)
  if (hit) return hit.name
  return ''
}

const headers = computed<string[]>(() => {
  if (!rows.value.length) return []
  if (hasHeader.value) return rows.value[headerRow.value] ?? []
  // 没表头:用 col_1..col_N 占位
  return (rows.value[0] ?? []).map((_, i) => `col_${i + 1}`)
})

const dataRows = computed<string[][]>(() => {
  if (!rows.value.length) return []
  return hasHeader.value ? rows.value.slice(headerRow.value + 1) : rows.value
})

const insertPreview = computed<string>(() => {
  const conn = currentConn.value
  if (!conn || !tableName.value || !dataRows.value.length) return ''
  const cols: string[] = []
  const colIdx: number[] = []
  for (let i = 0; i < headers.value.length; i++) {
    const m = mapping.value[i]
    if (m) {
      cols.push(quoteId(conn.dialect, m))
      colIdx.push(i)
    }
  }
  if (!cols.length) return ''
  const tableQ = quoteId(conn.dialect, tableName.value)
  const tableRef = database.value
    ? `${quoteId(conn.dialect, database.value)}.${tableQ}`
    : tableQ
  const head = `INSERT INTO ${tableRef} (${cols.join(', ')}) VALUES`
  const sampleRows = dataRows.value.slice(0, 5)
  const values = sampleRows.map((r) => {
    const vals = colIdx.map((i) => sqlLiteral(r[i] ?? ''))
    return `(${vals.join(', ')})`
  })
  const more = dataRows.value.length > sampleRows.length ? `\n-- (... ${dataRows.value.length - sampleRows.length} more rows)` : ''
  return `${head}\n${values.join(',\n')}${more};`
})

function sqlLiteral(v: string): string {
  if (v === '') return 'NULL'
  // 数字直接,其余加引号
  if (/^-?\d+(\.\d+)?$/.test(v)) return v
  return `'${v.replace(/'/g, "''")}'`
}

async function execute(): Promise<void> {
  const conn = currentConn.value
  if (!conn) {
    toast.warn('请选连接')
    return
  }
  if (!tableName.value) {
    toast.warn('请填表名')
    return
  }
  if (!dataRows.value.length) {
    toast.warn('数据为空')
    return
  }
  const cols: string[] = []
  const colIdx: number[] = []
  for (let i = 0; i < headers.value.length; i++) {
    const m = mapping.value[i]
    if (m) {
      cols.push(quoteId(conn.dialect, m))
      colIdx.push(i)
    }
  }
  if (!cols.length) {
    toast.warn('请至少给一列设映射目标')
    return
  }
  if (
    !(await appConfirm({
      message: `执行 INSERT 共 ${dataRows.value.length} 行 到 ${conn.name}.${tableName.value}?`,
      variant: 'warn',
    }))
  )
    return

  submitting.value = true
  try {
    // 批量打散成 N 条 INSERT(简化;大量数据应该走 executeBatch)
    const tableQ = quoteId(conn.dialect, tableName.value)
    const tableRef = database.value
      ? `${quoteId(conn.dialect, database.value)}.${tableQ}`
      : tableQ
    const head = `INSERT INTO ${tableRef} (${cols.join(', ')}) VALUES`
    // 1k 行一个 batch
    const BATCH = 500
    const ctx = database.value ? { database: database.value } : {}
    let ok = 0
    for (let off = 0; off < dataRows.value.length; off += BATCH) {
      const chunk = dataRows.value.slice(off, off + BATCH)
      const vs = chunk.map((r) => {
        const vals = colIdx.map((i) => sqlLiteral(r[i] ?? ''))
        return `(${vals.join(', ')})`
      })
      const sql = `${head} ${vs.join(', ')}`
      await client.connections.execute(conn.id, sql, [], ctx)
      ok += chunk.length
    }
    toast.success(`成功插入 ${ok} 行`)
    emit('close')
  } catch (e) {
    toast.error(`插入失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await loadConns()
  if (props.preferConnId) connId.value = props.preferConnId
  if (props.prefillRows) rows.value = props.prefillRows
})
watch(
  () => props.open,
  async (op) => {
    if (op) {
      await loadConns()
      if (props.preferConnId) connId.value = props.preferConnId
      if (props.prefillRows?.length) rows.value = props.prefillRows
      else await loadFromClipboard()
    }
  },
)
watch([connId, database, tableName], () => {
  if (connId.value && tableName.value.trim()) void loadTableColumns()
})
</script>

<template>
  <Modal v-if="open" title="粘贴板 → INSERT" width="xl" fixed-height storage-key="paste-import" @close="emit('close')">
    <div class="form">
      <!-- 行 1:选目标 -->
      <div class="row two">
        <div>
          <label class="lbl">连接</label>
          <select v-model="connId" class="ip">
            <option value="">— 选连接 —</option>
            <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} ({{ c.dialect }})</option>
          </select>
        </div>
        <div>
          <label class="lbl">database / schema</label>
          <input v-model="database" class="ip" placeholder="可选" />
        </div>
      </div>
      <div class="row two">
        <div>
          <label class="lbl">表名</label>
          <input v-model="tableName" class="ip" placeholder="例如 users" />
        </div>
        <div>
          <label class="lbl">数据(已粘 {{ rows.length }} 行)</label>
          <button class="btn" @click="loadFromClipboard">📋 重新读剪贴板</button>
        </div>
      </div>

      <!-- 表头开关 -->
      <div class="row inline">
        <label class="lbl-inline">
          <input v-model="hasHeader" type="checkbox" /> 首行是表头
        </label>
        <label v-if="hasHeader" class="lbl-inline">
          表头在第
          <input v-model.number="headerRow" type="number" min="0" class="ip-mini" />
          行(0=第一行)
        </label>
      </div>

      <!-- 列映射 -->
      <div v-if="headers.length" class="map-section">
        <div class="lbl">列映射 — 把每个粘贴列指到目标表的列(留空 = 跳过)</div>
        <table class="map-tbl">
          <thead><tr><th>粘贴列名</th><th>→ 目标列</th><th>第一行示例</th></tr></thead>
          <tbody>
            <tr v-for="(h, i) in headers" :key="i">
              <td class="mono">{{ h }}</td>
              <td>
                <select v-model="mapping[i]" class="ip-mini">
                  <option value="">— 跳过 —</option>
                  <option v-for="col in tableColumns" :key="col.name" :value="col.name">
                    {{ col.name }}{{ col.dataType ? ` (${col.dataType})` : '' }}
                  </option>
                </select>
              </td>
              <td class="mono sample">{{ dataRows[0]?.[i] ?? '' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="loadingCols" class="meta">拉表结构中…</div>
        <div v-else-if="!tableColumns.length && tableName" class="meta">未读到该表列(请确认表名/库正确)</div>
      </div>

      <!-- SQL 预览 -->
      <div v-if="insertPreview" class="row">
        <label class="lbl">SQL 预览(前 5 行)</label>
        <pre class="sql">{{ insertPreview }}</pre>
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" :disabled="submitting" @click="emit('close')">关闭</button>
      <button class="btn-primary" :disabled="!insertPreview || submitting" @click="execute">
        {{ submitting ? '插入中…' : `▶ 插入 ${dataRows.length} 行` }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; flex-direction: column; gap: 4px; }
.row.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.row.inline { flex-direction: row; gap: 14px; align-items: center; }
.lbl { font-size: 11px; color: var(--muted); font-weight: 600; }
.lbl-inline { font-size: 11px; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
.ip { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; color: var(--text); font-size: 12px; font-family: var(--font-mono); }
.ip-mini { width: auto; min-width: 100px; padding: 2px 6px; background: var(--bg); border: 1px solid var(--border); border-radius: 3px; color: var(--text); font-size: 11px; font-family: var(--font-mono); }
.btn, .btn-primary, .btn-ghost { padding: 4px 12px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg); color: var(--text); }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-ghost { background: transparent; color: var(--muted); padding: 6px 14px; font-size: 13px; }
.map-section { max-height: 240px; overflow: auto; border: 1px solid var(--border); border-radius: 4px; padding: 6px; }
.map-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
.map-tbl th, .map-tbl td { padding: 3px 6px; border-bottom: 1px solid var(--border); text-align: left; }
.map-tbl th { background: var(--panel); color: var(--muted); }
.mono { font-family: var(--font-mono); word-break: break-all; }
.sample { color: var(--accent); }
.meta { font-size: 11px; color: var(--muted); margin-top: 4px; }
.sql { background: var(--panel); border: 1px solid var(--border); border-radius: 4px; padding: 8px 10px; font-family: var(--font-mono); font-size: 11px; max-height: 200px; overflow: auto; }
</style>
