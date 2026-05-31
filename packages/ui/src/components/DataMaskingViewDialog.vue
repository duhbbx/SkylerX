<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 数据脱敏视图生成:
 *  - 选库.表 → 列出所有列
 *  - 用户对每列选 mask 策略(原样 / MD5 / 前N后M / 全替换 / 截断 / NULL)
 *  - 自动按列名启发推荐策略(用 masking.ts 的 DEFAULT_MASK_RULES)
 *  - 生成 CREATE VIEW SQL,可编辑 + 执行
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { familyOf } from '../ddl'
import { confirm as appConfirm, toast } from '../dialog'
import { reportError, reportInlineError } from '../errorReporter'
import { DEFAULT_MASK_RULES } from '../masking'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  database?: string
  schema?: string
  table?: string
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

type MaskStrategy = 'raw' | 'md5' | 'partial' | 'fixed' | 'truncate' | 'null'
interface ColumnDef {
  name: string
  dataType: string
  strategy: MaskStrategy
  /** partial: 前 N 后 M */
  prefixLen: number
  suffixLen: number
  /** fixed: 替换为 */
  fixedValue: string
  /** truncate: 最大长度 */
  maxLen: number
}

const dbName = ref(props.database ?? '')
const schemaName = ref(props.schema ?? '')
const tableName = ref(props.table ?? '')
const viewName = ref('')
const cols = ref<ColumnDef[]>([])
const loading = ref(false)
const submitting = ref(false)
const errMsg = ref<string | null>(null)

async function execSql(sql: string, database?: string): Promise<Record<string, unknown>[]> {
  const ctx = database ? { database } : {}
  const r = await client.connections.execute(props.conn.id, sql, [], ctx)
  return (r.rows as Record<string, unknown>[]) ?? []
}

function quoteId(n: string): string {
  if (familyOf(props.conn.dialect) === 'mysql') return `\`${n.replace(/`/g, '``')}\``
  return `"${n.replace(/"/g, '""')}"`
}

function quoteStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function recommendStrategy(colName: string): MaskStrategy {
  for (const r of DEFAULT_MASK_RULES) {
    try {
      if (new RegExp(r.columnPattern, 'i').test(colName)) {
        switch (r.kind) {
          case 'phone':
            return 'partial'
          case 'email':
            return 'partial'
          case 'idCard':
          case 'bankCard':
            return 'partial'
          case 'name':
            return 'partial'
          case 'address':
            return 'truncate'
          case 'default':
            return 'md5'
        }
      }
    } catch {
      /* ignore */
    }
  }
  return 'raw'
}

async function loadColumns(): Promise<void> {
  if (!tableName.value) return
  loading.value = true
  errMsg.value = null
  try {
    const fam = familyOf(props.conn.dialect)
    let sql: string
    if (fam === 'pg') {
      sql = `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = '${(schemaName.value || 'public').replace(/'/g, "''")}'
          AND table_name = '${tableName.value.replace(/'/g, "''")}'
        ORDER BY ordinal_position`
    } else {
      sql = `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = '${dbName.value.replace(/'/g, "''")}'
          AND table_name = '${tableName.value.replace(/'/g, "''")}'
        ORDER BY ordinal_position`
    }
    const rows = await execSql(sql, dbName.value || undefined)
    cols.value = rows.map((r) => {
      const name = String(r.column_name ?? r.COLUMN_NAME ?? '')
      const dataType = String(r.data_type ?? r.DATA_TYPE ?? '')
      return {
        name,
        dataType,
        strategy: recommendStrategy(name),
        prefixLen: 3,
        suffixLen: 4,
        fixedValue: '***',
        maxLen: 10,
      }
    })
    if (!viewName.value) viewName.value = `${tableName.value}_masked`
  } catch (e) {
    reportInlineError(errMsg, e)
  } finally {
    loading.value = false
  }
}

/** 按方言生成列脱敏表达式。 */
function exprFor(col: ColumnDef): string {
  const fam = familyOf(props.conn.dialect)
  const c = quoteId(col.name)
  switch (col.strategy) {
    case 'raw':
      return `${c} AS ${c}`
    case 'md5':
      // MySQL MD5(); PG md5(); MSSQL HASHBYTES('MD5', ..)
      if (fam === 'mysql' || fam === 'pg') return `md5(CAST(${c} AS char(4000))) AS ${c}`
      if (fam === 'sqlserver')
        return `LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(${c} AS varchar(4000))), 2)) AS ${c}`
      return `md5(${c}) AS ${c}`
    case 'partial': {
      // CONCAT(LEFT(c, prefix), '***', RIGHT(c, suffix))
      const pre = col.prefixLen
      const suf = col.suffixLen
      if (fam === 'mysql') return `CONCAT(LEFT(${c}, ${pre}), '***', RIGHT(${c}, ${suf})) AS ${c}`
      if (fam === 'pg')
        return `LEFT(${c}::text, ${pre}) || '***' || RIGHT(${c}::text, ${suf}) AS ${c}`
      if (fam === 'sqlserver') return `LEFT(${c}, ${pre}) + '***' + RIGHT(${c}, ${suf}) AS ${c}`
      return `LEFT(${c}, ${pre}) || '***' || RIGHT(${c}, ${suf}) AS ${c}`
    }
    case 'fixed':
      return `${quoteStr(col.fixedValue)} AS ${c}`
    case 'truncate':
      if (fam === 'mysql' || fam === 'sqlserver') return `LEFT(${c}, ${col.maxLen}) AS ${c}`
      return `LEFT(${c}::text, ${col.maxLen}) AS ${c}`
    case 'null':
      return `NULL AS ${c}`
  }
}

const sqlPreview = computed(() => {
  if (!viewName.value || !cols.value.length) return ''
  const schemaPart = schemaName.value
    ? `${quoteId(schemaName.value)}.${quoteId(viewName.value)}`
    : quoteId(viewName.value)
  const fromTable = schemaName.value
    ? `${quoteId(schemaName.value)}.${quoteId(tableName.value)}`
    : quoteId(tableName.value)
  const selectList = cols.value.map((c) => `  ${exprFor(c)}`).join(',\n')
  return `CREATE OR REPLACE VIEW ${schemaPart} AS\nSELECT\n${selectList}\nFROM ${fromTable};`
})

const sqlText = ref('')
watch(sqlPreview, (s) => {
  sqlText.value = s
})

async function execute(): Promise<void> {
  if (
    !(await appConfirm({
      message: `执行 CREATE VIEW ${viewName.value} ?`,
      variant: 'warn',
    }))
  )
    return
  submitting.value = true
  try {
    await client.connections.execute(
      props.conn.id,
      sqlText.value.replace(/;$/, ''),
      [],
      dbName.value ? { database: dbName.value } : {},
    )
    toast.success(`视图 ${viewName.value} 已创建`)
    emit('close')
  } catch (e) {
    reportError(e)
  } finally {
    submitting.value = false
  }
}

watch(
  () => props.open,
  async (op) => {
    if (op && tableName.value) await loadColumns()
  },
)
</script>

<template>
  <Modal v-if="open" :title="`脱敏视图生成  ·  ${conn.name || conn.dialect}`" width="xl" fixed-height storage-key="data-masking" @close="emit('close')">
    <div class="ctrl">
      <input v-model="dbName" class="ip" placeholder="database" />
      <input v-model="schemaName" class="ip" placeholder="schema(PG)" />
      <input v-model="tableName" class="ip" placeholder="table" />
      <input v-model="viewName" class="ip" placeholder="view 名(默认 _masked)" />
      <button class="btn" :disabled="loading || !tableName" @click="loadColumns">🔄 拉列</button>
    </div>

    <div v-if="errMsg" class="err-banner">✗ {{ errMsg }}</div>

    <div class="body">
      <table v-if="cols.length" class="grid">
        <thead>
          <tr>
            <th>列</th>
            <th style="width: 100px">类型</th>
            <th style="width: 120px">策略</th>
            <th>参数</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in cols" :key="c.name" :class="{ 'no-mask': c.strategy === 'raw' }">
            <td class="mono"><b>{{ c.name }}</b></td>
            <td>{{ c.dataType }}</td>
            <td>
              <select v-model="c.strategy" class="ip-mini">
                <option value="raw">原样</option>
                <option value="md5">MD5</option>
                <option value="partial">前N后M</option>
                <option value="fixed">替换</option>
                <option value="truncate">截断</option>
                <option value="null">NULL</option>
              </select>
            </td>
            <td>
              <template v-if="c.strategy === 'partial'">
                前 <input v-model.number="c.prefixLen" type="number" min="0" class="ip-tiny" /> · 后 <input v-model.number="c.suffixLen" type="number" min="0" class="ip-tiny" />
              </template>
              <template v-else-if="c.strategy === 'fixed'">
                替换为 <input v-model="c.fixedValue" class="ip-mini" />
              </template>
              <template v-else-if="c.strategy === 'truncate'">
                最大长度 <input v-model.number="c.maxLen" type="number" min="0" class="ip-tiny" />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="!loading" class="empty">输入库/表 → 点拉列</div>
    </div>

    <div v-if="cols.length" class="sql-pane">
      <div class="lbl">SQL 预览(可编辑)</div>
      <textarea v-model="sqlText" class="sql" spellcheck="false" rows="10" />
    </div>

    <template #footer>
      <button class="btn-ghost" :disabled="submitting" @click="emit('close')">关闭</button>
      <button v-if="cols.length" class="btn-primary" :disabled="submitting" @click="execute">
        {{ submitting ? '执行中…' : '▶ 创建视图' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.ctrl { display: flex; align-items: center; gap: 6px; padding: 0 0 8px; border-bottom: 1px solid var(--border); margin-bottom: 8px; }
.ip { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; color: var(--text); font-size: 12px; font-family: var(--font-mono); }
.ip-mini { width: 100px; padding: 2px 6px; background: var(--bg); border: 1px solid var(--border); border-radius: 3px; color: var(--text); font-size: 11px; }
.ip-tiny { width: 50px; padding: 2px 4px; background: var(--bg); border: 1px solid var(--border); border-radius: 3px; color: var(--text); font-size: 11px; }
.btn, .btn-primary, .btn-ghost { padding: 4px 12px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg); color: var(--text); }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-ghost { background: transparent; color: var(--muted); padding: 6px 14px; font-size: 13px; }
.body { flex: 1; overflow: auto; max-height: 35vh; margin-bottom: 8px; }
.empty { padding: 40px; text-align: center; color: var(--muted); }
.err-banner { padding: 10px; background: rgba(224, 64, 80, 0.08); border: 1px solid rgba(224, 64, 80, 0.4); border-radius: 6px; color: var(--err, #e04050); font-size: 12px; margin-bottom: 8px; }
.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
.grid th, .grid td { border-bottom: 1px solid var(--border); padding: 4px 8px; text-align: left; }
.grid th { background: var(--panel); color: var(--muted); position: sticky; top: 0; }
.mono { font-family: var(--font-mono); }
tr.no-mask td { color: var(--muted); }
.sql-pane { display: flex; flex-direction: column; gap: 4px; }
.lbl { font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; }
.sql { width: 100%; padding: 8px 12px; background: var(--bg); border: 1px solid var(--accent); border-radius: 6px; font-family: var(--font-mono); font-size: 12px; color: var(--text); resize: vertical; }
</style>
