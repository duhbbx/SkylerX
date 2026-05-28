<script setup lang="ts">
import { type DbDialect, type MetadataNode, MetaNodeKind } from '@db-tool/shared-types'
import { computed, onMounted, reactive, ref } from 'vue'
import { useDataClient } from '../data-client'
import {
  type ColumnDef,
  type ForeignKeyDef,
  type IndexDef,
  type TableContext,
  buildAlterTable,
  buildCreateTable,
  emptyColumn,
  emptyTableSpec,
  existingForeignKeysQuery,
  existingIndexesQuery,
  parseType,
  typeOptions,
} from '../ddl'
import { t } from '../i18n'
import { splitStatements } from '../sqlSplit'
import type { TreeNode } from './treeNode'
import SqlEditor from './SqlEditor.vue'

const client = useDataClient()

const props = withDefaults(
  defineProps<{
    connId: string
    dialect: DbDialect
    ctx: TableContext
    /** 'create' 新建表（默认）；'alter' 修改现有表（需 node）。 */
    mode?: 'create' | 'alter'
    node?: TreeNode
  }>(),
  { mode: 'create', node: undefined },
)
const emit = defineEmits<{ created: []; cancel: [] }>()

const isAlter = computed(() => props.mode === 'alter')
const tableName = ref('')
const spec = reactive(emptyTableSpec())
const original = ref<ColumnDef[]>([]) // 改表模式：加载时的列快照，用于 diff
const originalIndexes = ref<IndexDef[]>([]) // 现有索引快照
const originalForeignKeys = ref<ForeignKeyDef[]>([]) // 现有外键快照
const loading = ref(false)
const types = typeOptions(props.dialect)
const isMysql = ['mysql', 'mariadb', 'oceanbase'].includes(props.dialect)
const tableRef = computed(() => props.node?.sqlName ?? props.node?.name ?? tableName.value)

// tab 标签经 t('designer.tab.<key>') 渲染（随语言切换）
const INNER = [
  'fields',
  'indexes',
  'fk',
  'unique',
  'check',
  'trigger',
  'options',
  'storage',
  'comment',
  'sql',
] as const
const inner = ref<(typeof INNER)[number]>('fields')
const selected = ref(0)
const selCol = computed(() => spec.columns[selected.value])
const isPg = ['postgresql', 'kingbase'].includes(props.dialect)
const indexTypes = isMysql
  ? ['BTREE', 'HASH', 'FULLTEXT', 'SPATIAL']
  : isPg
    ? ['btree', 'hash', 'gin', 'gist']
    : []

const busy = ref(false)
const error = ref<string | null>(null)

const alterStmts = computed(() =>
  isAlter.value
    ? buildAlterTable(props.dialect, tableRef.value, original.value, spec, {
        indexes: originalIndexes.value,
        foreignKeys: originalForeignKeys.value,
      })
    : [],
)
const ddl = computed(() => {
  if (isAlter.value)
    return alterStmts.value.length
      ? alterStmts.value.map((s) => `${s};`).join('\n')
      : t('designer.noChanges')
  return buildCreateTable(props.dialect, props.ctx, tableName.value, spec)
})
const target = [props.ctx.database, props.ctx.schema].filter(Boolean).join(' / ')

/** 改表模式：载入现有列结构作为初始值，并留存原始快照用于 diff。 */
async function loadExisting(): Promise<void> {
  if (!isAlter.value || !props.node) return
  loading.value = true
  error.value = null
  try {
    const cols: MetadataNode[] = await client.connections.metadata(props.connId, {
      parentKind: MetaNodeKind.Group,
      path: [...props.node.path],
      group: 'columns',
    })
    const mapped: ColumnDef[] = cols.map((c) => {
      const pt = parseType(c.detail?.dataType ?? '')
      const def = c.detail?.defaultValue
      return {
        name: c.name,
        type: pt.type,
        length: pt.length,
        scale: pt.scale,
        nullable: c.detail?.nullable ?? true,
        primaryKey: c.detail?.primaryKey ?? false,
        defaultValue: def == null ? '' : String(def),
        comment: c.detail?.comment ?? '',
        originalName: c.name,
      }
    })
    spec.columns = mapped.length ? mapped : [emptyColumn()]
    spec.uniques = []
    spec.checks = []
    original.value = mapped.map((c) => ({ ...c }))
    // 载入现有索引 / 外键（用于查看 + diff 出新增/删除；失败则留空，仅支持新增）
    spec.indexes = await loadIndexes()
    spec.foreignKeys = await loadForeignKeys()
    originalIndexes.value = spec.indexes.map((x) => ({ ...x }))
    originalForeignKeys.value = spec.foreignKeys.map((x) => ({ ...x }))
    tableName.value = props.node.name
    selected.value = 0
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 't'

async function loadIndexes(): Promise<IndexDef[]> {
  if (!props.node) return []
  const sql = existingIndexesQuery(props.dialect, props.ctx, props.node.name)
  if (!sql) return []
  try {
    const r = await client.connections.execute(props.connId, sql, [], {
      database: props.ctx.database,
      schema: props.ctx.schema,
    })
    return (r.rows as Record<string, unknown>[]).map((row) => ({
      name: String(row.name ?? ''),
      columns: String(row.cols ?? ''),
      unique: truthy(row.uniq),
    }))
  } catch {
    return []
  }
}

async function loadForeignKeys(): Promise<ForeignKeyDef[]> {
  if (!props.node) return []
  const sql = existingForeignKeysQuery(props.dialect, props.ctx, props.node.name)
  if (!sql) return []
  try {
    const r = await client.connections.execute(props.connId, sql, [], {
      database: props.ctx.database,
      schema: props.ctx.schema,
    })
    return (r.rows as Record<string, unknown>[]).map((row) => ({
      name: String(row.name ?? ''),
      columns: String(row.cols ?? ''),
      refTable: String(row.reftab ?? ''),
      refColumns: String(row.refcols ?? ''),
      onDelete: '',
      onUpdate: '',
    }))
  } catch {
    return []
  }
}

onMounted(loadExisting)

// ── 字段工具栏操作 ──
function gotoFields(): void {
  inner.value = 'fields'
}
function addField(): void {
  gotoFields()
  spec.columns.push(emptyColumn())
  selected.value = spec.columns.length - 1
}
function insertField(): void {
  gotoFields()
  const at = Math.min(selected.value, spec.columns.length)
  spec.columns.splice(at, 0, emptyColumn())
  selected.value = at
}
function deleteField(): void {
  gotoFields()
  if (!spec.columns.length) return
  spec.columns.splice(selected.value, 1)
  selected.value = Math.max(0, selected.value - 1)
}
function togglePk(): void {
  gotoFields()
  const c = spec.columns[selected.value]
  if (c) c.primaryKey = !c.primaryKey
}
function move(dir: -1 | 1): void {
  gotoFields()
  const i = selected.value
  const j = i + dir
  if (j < 0 || j >= spec.columns.length) return
  const arr = spec.columns
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  selected.value = j
}

function resetTable(): void {
  Object.assign(spec, emptyTableSpec())
  tableName.value = ''
  selected.value = 0
  inner.value = 'fields'
  error.value = null
}

async function run(stmts: string[]): Promise<void> {
  busy.value = true
  error.value = null
  try {
    for (const stmt of stmts) {
      await client.connections.execute(props.connId, stmt, [], {
        database: props.ctx.database,
        schema: props.ctx.schema,
      })
    }
    emit('created')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    inner.value = 'sql'
  } finally {
    busy.value = false
  }
}

async function save(): Promise<void> {
  if (isAlter.value) {
    if (!alterStmts.value.length) {
      error.value = t('designer.noApply')
      inner.value = 'sql'
      return
    }
    await run(alterStmts.value)
    return
  }
  if (!tableName.value.trim()) {
    error.value = t('designer.needName')
    gotoFields()
    return
  }
  if (!spec.columns.some((c) => c.name.trim() && c.type.trim())) {
    error.value = t('designer.needField')
    gotoFields()
    return
  }
  await run(splitStatements(buildCreateTable(props.dialect, props.ctx, tableName.value, spec)))
}

// 另存为：用当前结构 CREATE 一张新表（改表模式下相当于「复制结构为新表」）。
function saveAs(): void {
  const n = window.prompt(t('designer.saveAsPrompt'), tableName.value)
  if (!n || !n.trim()) return
  void run(splitStatements(buildCreateTable(props.dialect, props.ctx, n.trim(), spec)))
}
</script>

<template>
  <div class="designer">
    <div class="toolbar">
      <span v-if="isAlter" class="mode-badge">{{ t('designer.alterBadge') }}</span>
      <button v-if="!isAlter" @click="resetTable">{{ t('designer.new') }}</button>
      <button class="primary" :disabled="busy || loading" @click="save">{{ busy ? t('designer.saving') : t('designer.save') }}</button>
      <button :disabled="busy || loading" @click="saveAs">{{ t('designer.saveAs') }}</button>
      <span class="sep" />
      <button @click="addField">{{ t('designer.addField') }}</button>
      <button @click="insertField">{{ t('designer.insertField') }}</button>
      <button @click="deleteField">{{ t('designer.deleteField') }}</button>
      <button @click="togglePk">{{ t('designer.pk') }}</button>
      <button @click="move(-1)">{{ t('designer.up') }}</button>
      <button @click="move(1)">{{ t('designer.down') }}</button>
      <span class="name-box">
        <label>{{ t('designer.tableName') }}</label>
        <input v-model="tableName" :readonly="isAlter" :placeholder="t('designer.newTableName')" />
      </span>
      <span v-if="loading" class="target">{{ t('designer.loadingStruct') }}</span>
      <span v-else-if="target" class="target">{{ target }}</span>
    </div>

    <div class="inner-tabs">
      <button
        v-for="key in INNER"
        :key="key"
        class="itab"
        :class="{ active: inner === key }"
        @click="inner = key"
      >
        {{ t('designer.tab.' + key) }}
      </button>
    </div>

    <div class="inner-body">
      <!-- 字段 -->
      <table v-if="inner === 'fields'" class="grid">
        <thead>
          <tr>
            <th>{{ t('designer.h.fieldName') }}</th>
            <th>{{ t('designer.h.type') }}</th>
            <th>{{ t('designer.h.length') }}</th>
            <th>{{ t('designer.h.scale') }}</th>
            <th :title="t('designer.h.allowNull')">NULL</th>
            <th :title="t('designer.h.pk')">{{ t('designer.h.pk') }}</th>
            <th>{{ t('designer.h.default') }}</th>
            <th>{{ t('designer.h.comment') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(c, i) in spec.columns"
            :key="i"
            :class="{ sel: selected === i }"
            @click="selected = i"
          >
            <td><input v-model="c.name" /></td>
            <td><input v-model="c.type" list="type-list" /></td>
            <td><input v-model="c.length" class="w-xs" /></td>
            <td><input v-model="c.scale" class="w-xs" /></td>
            <td class="c"><input v-model="c.nullable" type="checkbox" /></td>
            <td class="c"><input v-model="c.primaryKey" type="checkbox" /></td>
            <td><input v-model="c.defaultValue" class="w-sm" /></td>
            <td><input v-model="c.comment" /></td>
          </tr>
        </tbody>
      </table>
      <div v-if="inner === 'fields' && selCol" class="field-props">
        <div class="fp-title">{{ t('designer.fieldProps', { name: selCol.name || '—' }) }}</div>
        <label v-if="isMysql" class="fp"><input v-model="selCol.unsigned" type="checkbox" /> {{ t('designer.unsigned') }}</label>
        <label v-if="isMysql" class="fp"><input v-model="selCol.autoIncrement" type="checkbox" /> {{ t('designer.autoInc') }}</label>
        <label v-if="isMysql" class="fp"><input v-model="selCol.onUpdateNow" type="checkbox" /> {{ t('designer.onUpdateNow') }}</label>
        <label v-if="isMysql" class="fp fp-gen">{{ t('designer.colCharset') }}
          <input v-model="selCol.charset" :placeholder="t('designer.colCharsetPh')" />
        </label>
        <label v-if="isMysql" class="fp fp-gen">{{ t('designer.colCollation') }}
          <input v-model="selCol.collation" :placeholder="t('designer.colCollationPh')" />
        </label>
        <label class="fp fp-gen">{{ t('designer.generated') }}
          <input v-model="selCol.generated" :placeholder="t('designer.generatedPh')" />
        </label>
      </div>

      <!-- 索引 -->
      <div v-else-if="inner === 'indexes'" class="sub">
        <button class="ghost sm" @click="spec.indexes.push({ name: '', columns: '', unique: false, type: '' })">{{ t('designer.addIndex') }}</button>
        <table class="grid">
          <thead><tr><th>{{ t('designer.h.name') }}</th><th>{{ t('designer.h.colsComma') }}</th><th>{{ t('designer.h.indexType') }}</th><th>{{ t('designer.h.unique') }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(ix, i) in spec.indexes" :key="i">
              <td><input v-model="ix.name" /></td>
              <td><input v-model="ix.columns" /></td>
              <td>
                <select v-model="ix.type">
                  <option value="">—</option>
                  <option v-for="ty in indexTypes" :key="ty" :value="ty">{{ ty }}</option>
                </select>
              </td>
              <td class="c"><input v-model="ix.unique" type="checkbox" /></td>
              <td class="c"><button class="x" @click="spec.indexes.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 外键 -->
      <div v-else-if="inner === 'fk'" class="sub">
        <button class="ghost sm" @click="spec.foreignKeys.push({ name: '', columns: '', refTable: '', refColumns: '', onDelete: '', onUpdate: '', match: '', deferrable: false })">{{ t('designer.addFk') }}</button>
        <table class="grid">
          <thead><tr><th>{{ t('designer.h.name') }}</th><th>{{ t('designer.h.cols') }}</th><th>{{ t('designer.h.refTable') }}</th><th>{{ t('designer.h.refCols') }}</th><th>ON DELETE</th><th>ON UPDATE</th><th v-if="isPg">MATCH</th><th v-if="isPg">DEFER</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(fk, i) in spec.foreignKeys" :key="i">
              <td><input v-model="fk.name" /></td>
              <td><input v-model="fk.columns" /></td>
              <td><input v-model="fk.refTable" /></td>
              <td><input v-model="fk.refColumns" /></td>
              <td>
                <select v-model="fk.onDelete">
                  <option value="">—</option>
                  <option>CASCADE</option><option>SET NULL</option><option>RESTRICT</option><option>NO ACTION</option>
                </select>
              </td>
              <td>
                <select v-model="fk.onUpdate">
                  <option value="">—</option>
                  <option>CASCADE</option><option>SET NULL</option><option>RESTRICT</option><option>NO ACTION</option>
                </select>
              </td>
              <td v-if="isPg">
                <select v-model="fk.match">
                  <option value="">—</option>
                  <option>FULL</option><option>PARTIAL</option><option>SIMPLE</option>
                </select>
              </td>
              <td v-if="isPg" class="c"><input v-model="fk.deferrable" type="checkbox" /></td>
              <td class="c"><button class="x" @click="spec.foreignKeys.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 唯一键 -->
      <div v-else-if="inner === 'unique'" class="sub">
        <button class="ghost sm" @click="spec.uniques.push({ name: '', columns: '' })">{{ t('designer.addUnique') }}</button>
        <table class="grid">
          <thead><tr><th>{{ t('designer.h.name') }}</th><th>{{ t('designer.h.colsComma') }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(u, i) in spec.uniques" :key="i">
              <td><input v-model="u.name" /></td>
              <td><input v-model="u.columns" /></td>
              <td class="c"><button class="x" @click="spec.uniques.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 检查 -->
      <div v-else-if="inner === 'check'" class="sub">
        <button class="ghost sm" @click="spec.checks.push({ name: '', expression: '' })">{{ t('designer.addCheck') }}</button>
        <table class="grid">
          <thead><tr><th>{{ t('designer.h.name') }}</th><th>{{ t('designer.h.expr') }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(ck, i) in spec.checks" :key="i">
              <td><input v-model="ck.name" /></td>
              <td><input v-model="ck.expression" :placeholder="t('designer.exprPh')" /></td>
              <td class="c"><button class="x" @click="spec.checks.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 触发器 -->
      <div v-else-if="inner === 'trigger'" class="hint-pane">
        {{ t('designer.triggerNote') }}
      </div>

      <!-- 选项 -->
      <div v-else-if="inner === 'options'" class="sub">
        <template v-if="isMysql">
          <div class="opt-row"><label>{{ t('designer.engine') }}</label><input v-model="spec.engine" placeholder="InnoDB" /></div>
          <div class="opt-row"><label>{{ t('designer.charset') }}</label><input v-model="spec.charset" placeholder="utf8mb4" /></div>
        </template>
        <div v-else class="hint-pane">{{ t('designer.noOptions') }}</div>
      </div>

      <!-- 存储 -->
      <div v-else-if="inner === 'storage'" class="hint-pane">
        {{ t('designer.storageNote') }}
      </div>

      <!-- 注释 -->
      <div v-else-if="inner === 'comment'" class="sub">
        <textarea v-model="spec.comment" rows="5" :placeholder="t('designer.commentPh')" class="comment-area" />
      </div>

      <!-- SQL 预览（只读 Monaco，带语法高亮） -->
      <div v-else class="preview-wrap">
        <SqlEditor :model-value="ddl" readonly />
      </div>

      <!-- 字段类型自动补全（始终存在，不参与上面的 v-if 链） -->
      <datalist id="type-list">
        <option v-for="t in types" :key="t" :value="t" />
      </datalist>
    </div>

    <div v-if="error" class="banner err">✗ {{ error }}</div>
  </div>
</template>

<style scoped>
.designer {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-wrap: wrap;
}
.toolbar button {
  padding: 4px 10px;
  font-size: 12px;
}
.toolbar .sep {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 2px;
}
.name-box {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
}
.name-box label {
  font-size: 12px;
  color: var(--muted);
}
.name-box input {
  width: 180px;
  padding: 4px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.toolbar .target {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}
.mode-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(124, 108, 255, 0.18);
  color: var(--accent);
}
.name-box input[readonly] {
  opacity: 0.7;
  cursor: default;
}
.inner-tabs {
  display: flex;
  gap: 2px;
  padding: 4px 8px 0;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
.itab {
  background: transparent;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  color: var(--muted);
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.itab.active {
  background: var(--bg);
  color: var(--text);
}
.inner-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.grid th,
.grid td {
  border: 1px solid var(--border);
  padding: 2px 4px;
  text-align: left;
}
.grid th {
  color: var(--muted);
  font-weight: 500;
  padding: 5px 6px;
}
.grid td.c {
  text-align: center;
}
.grid tr.sel {
  background: rgba(124, 108, 255, 0.16);
}
.grid input:not([type='checkbox']),
.grid select {
  width: 100%;
  background-color: transparent;
  border: none;
  color: var(--text);
  padding: 4px;
  font-size: 13px;
}
.grid select {
  padding-right: 20px;
  cursor: pointer;
}
.grid input.w-xs {
  width: 60px;
}
.grid input.w-sm {
  width: 90px;
}
.grid input:focus,
.grid select:focus {
  outline: 1px solid var(--accent);
}
.x {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 15px;
}
.x:hover {
  color: var(--err);
}
.sub .ghost.sm {
  margin-bottom: 8px;
  padding: 4px 10px;
  font-size: 12px;
}
.opt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.opt-row label {
  width: 60px;
  color: var(--muted);
  font-size: 13px;
}
.opt-row input {
  flex: 0 0 220px;
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.comment-area {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 8px 10px;
  font-family: inherit;
}
.hint-pane {
  color: var(--muted);
  font-size: 13px;
  padding: 10px 4px;
}
.field-props {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 10px 8px;
  margin-top: 8px;
  border-top: 1px solid var(--border);
}
.field-props .fp-title {
  width: 100%;
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
}
.field-props .fp {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
}
.field-props .fp-gen {
  flex: 1;
  min-width: 240px;
}
.field-props .fp-gen input {
  flex: 1;
  padding: 4px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.preview-wrap {
  height: 100%;
  min-height: 320px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.banner.err {
  margin: 0;
  border-radius: 0;
}
</style>
