<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type DbDialect, MetaNodeKind, type MetadataNode } from '@db-tool/shared-types'
import { computed, onMounted, reactive, ref, watch } from 'vue'
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
import { prompt as appPrompt } from '../dialog'
import { reportInlineError } from '../errorReporter'
import { t } from '../i18n'
import { splitStatements } from '../sqlSplit'
import SqlEditor from './SqlEditor.vue'
import ThemedSelect from './ThemedSelect.vue'
import type { TreeNode } from './treeNode'

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
/**
 * created 事件携带 `keepOpen` 标记:
 *  - true (新建保存成功): tab 不关,内部转 alter 模式让用户继续改
 *  - false / 未传 (改表保存成功 / 新建出错等): 沿用旧行为,父组件决定关不关
 */
const emit = defineEmits<{ created: [opts?: { keepOpen?: boolean }]; cancel: [] }>()

/**
 * runtimeMode: 创建模式保存成功后会切到 'alter',让 tab 直接转为"修改表",而不是被关掉。
 * 之所以不直接用 props.mode (会随父组件 tab.mode 变化), 是因为我们想让 tab 维持原样,
 * 仅在本地维持一个状态过渡。父组件接收 'created' 事件后做相应 refreshTarget 即可。
 */
const runtimeMode = ref<'create' | 'alter'>(props.mode === 'alter' ? 'alter' : 'create')
const isAlter = computed(() => runtimeMode.value === 'alter')
const tableName = ref('')
const spec = reactive(emptyTableSpec())
const original = ref<ColumnDef[]>([]) // 改表模式：加载时的列快照，用于 diff
const originalIndexes = ref<IndexDef[]>([]) // 现有索引快照
const originalForeignKeys = ref<ForeignKeyDef[]>([]) // 现有外键快照
const loading = ref(false)
const types = typeOptions(props.dialect)
const isMysql = ['mysql', 'mariadb', 'oceanbase'].includes(props.dialect)
const tableRef = computed(() => props.node?.sqlName ?? props.node?.name ?? tableName.value)

/**
 * 脏检查：以「最近一次载入/初始化的整体快照」为基线，比对当前 spec + tableName。
 * 关闭设计器 tab 时父组件可调用 isDirty() 决定是否弹未保存提示。
 */
const dirtyBaseline = ref('')
function snapshotDesigner(): string {
  return JSON.stringify({ tableName: tableName.value, spec })
}
function resetDirtyBaseline(): void {
  dirtyBaseline.value = snapshotDesigner()
}
function isDirty(): boolean {
  return dirtyBaseline.value !== '' && snapshotDesigner() !== dirtyBaseline.value
}
defineExpose({ isDirty })

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
const isPg = ['postgresql', 'kingbase', 'vastbase'].includes(props.dialect)
const indexTypes = isMysql
  ? ['BTREE', 'HASH', 'FULLTEXT', 'SPATIAL']
  : isPg
    ? ['btree', 'hash', 'gin', 'gist']
    : []

// 静态下拉选项 — 抽到顶层避免每次 render 重新建数组(ThemedSelect prop 引用稳定)
const FK_ACTION_OPTS = [
  { value: '', label: '—' },
  { value: 'CASCADE', label: 'CASCADE' },
  { value: 'SET NULL', label: 'SET NULL' },
  { value: 'RESTRICT', label: 'RESTRICT' },
  { value: 'NO ACTION', label: 'NO ACTION' },
]
const FK_MATCH_OPTS = [
  { value: '', label: '—' },
  { value: 'FULL', label: 'FULL' },
  { value: 'PARTIAL', label: 'PARTIAL' },
  { value: 'SIMPLE', label: 'SIMPLE' },
]
const ROW_FORMAT_OPTS = [
  { value: '', label: '(default)' },
  { value: 'DYNAMIC', label: 'DYNAMIC' },
  { value: 'COMPRESSED', label: 'COMPRESSED' },
  { value: 'COMPACT', label: 'COMPACT' },
  { value: 'REDUNDANT', label: 'REDUNDANT' },
]

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
  // 预览前先看有没有不完整的列(只 name 没 type 之类). 用户报告:
  // 预览看到的 SQL 看似正常但实际丢了未完整列, 误以为"SQL 不对".
  // 在预览顶部用 SQL 注释列出被跳过的列,让用户立刻意识到.
  const skipped: string[] = []
  spec.columns.forEach((c, i) => {
    const hasName = c.name.trim() !== ''
    const hasType = c.type.trim() !== ''
    if ((hasName || hasType) && !(hasName && hasType)) {
      skipped.push(t('designer.col.skippedHint', { row: i + 1, name: c.name.trim() || '?' }))
    }
  })
  const warning =
    skipped.length > 0
      ? `${t('designer.preview.warningHeader')}\n${skipped.map((s) => `--   ${s}`).join('\n')}\n\n`
      : ''
  if (isAlter.value)
    return (
      warning +
      (alterStmts.value.length
        ? alterStmts.value.map((s) => `${s};`).join('\n')
        : t('designer.noChanges'))
    )
  return warning + buildCreateTable(props.dialect, props.ctx, tableName.value, spec)
})
const target = [props.ctx.database, props.ctx.schema].filter(Boolean).join(' / ')
const previewText = ref('')
watch(
  ddl,
  (v) => {
    previewText.value = v
  },
  { immediate: true },
)
async function copyDdl(): Promise<void> {
  await navigator.clipboard?.writeText(previewText.value)
}
function compressDdl(): void {
  previewText.value = previewText.value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

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
    resetDirtyBaseline() // 改表模式：以载入的现有结构作为脏检测基线
  } catch (e) {
    reportInlineError(error, e)
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

onMounted(async () => {
  await loadExisting()
  // 新建模式不会进 loadExisting；仍要把「空表初始状态」当成基线，
  // 否则一打开 tab 就处于 dirty 状态。
  if (!isAlter.value) resetDirtyBaseline()
})

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
  const wasCreate = !isAlter.value // 记录本次保存前的模式,用于决定是否要"转 alter"
  try {
    for (const stmt of stmts) {
      await client.connections.execute(props.connId, stmt, [], {
        database: props.ctx.database,
        schema: props.ctx.schema,
      })
    }
    resetDirtyBaseline() // 保存成功 → 基线对齐,关闭 tab 时不再提示
    if (wasCreate) {
      // ── 新建模式保存成功 → tab 不关,直接切到 alter 让用户继续改 ──
      // 把刚写入的列/索引/外键作为 "original" 快照,后续编辑用作 diff 基线。
      runtimeMode.value = 'alter'
      original.value = spec.columns.map((c) => ({ ...c, originalName: c.name }))
      // 标记每个 column 的 originalName,让 buildAlterTable 把它认成"现有列",不再重复 ADD COLUMN
      spec.columns = spec.columns.map((c) => ({ ...c, originalName: c.name }))
      originalIndexes.value = spec.indexes.map((x) => ({ ...x }))
      originalForeignKeys.value = spec.foreignKeys.map((x) => ({ ...x }))
      resetDirtyBaseline()
      emit('created', { keepOpen: true })
    } else {
      emit('created')
    }
  } catch (e) {
    reportInlineError(error, e)
    inner.value = 'sql'
  } finally {
    busy.value = false
  }
}

/**
 * 校验字段列表是否完整可生成 SQL.
 * 用户报告:之前用 some(至少 1 列完整)校验,其他半截行被 buildCreateTable 静默丢弃,
 * 用户以为它们入库了 → 实际 SQL 缺列.
 * 规则:
 *  - 完全空白行(name + type 都空) → 跳过(initial empty row)
 *  - 部分填(name 或 type 任一缺失) → 报错列出
 *  - 至少要有 1 行完整
 */
function validateColumns(): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  spec.columns.forEach((c, i) => {
    const hasName = c.name.trim() !== ''
    const hasType = c.type.trim() !== ''
    if (!hasName && !hasType) return // 整行空白,跳过
    if (!hasName) issues.push(t('designer.col.missingName', { row: i + 1 }))
    if (!hasType)
      issues.push(t('designer.col.missingType', { row: i + 1, name: c.name.trim() || '?' }))
  })
  const complete = spec.columns.filter((c) => c.name.trim() && c.type.trim())
  if (!complete.length) issues.push(t('designer.needField'))
  return { ok: !issues.length, issues }
}

async function save(): Promise<void> {
  if (isAlter.value) {
    const v = validateColumns()
    if (!v.ok) {
      error.value = v.issues.join('\n')
      gotoFields()
      return
    }
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
  const v = validateColumns()
  if (!v.ok) {
    error.value = v.issues.join('\n')
    gotoFields()
    return
  }
  await run(splitStatements(buildCreateTable(props.dialect, props.ctx, tableName.value, spec)))
}

// 另存为：用当前结构 CREATE 一张新表（改表模式下相当于「复制结构为新表」）。
async function saveAs(): Promise<void> {
  const n = await appPrompt({ message: t('designer.saveAsPrompt'), defaultValue: tableName.value })
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

    <div class="inner-body" :class="{ 'fields-tab': inner === 'fields' }">
      <!-- 字段: 表格独立滚动区, 字段属性 sticky 在底部 -->
      <div v-if="inner === 'fields'" class="fields-scroll">
        <table class="grid">
          <thead>
            <tr>
              <th>{{ t('designer.h.fieldName') }}</th>
              <th>{{ t('designer.h.type') }}</th>
              <th style="width: 80px">{{ t('designer.h.length') }}</th>
              <th style="width: 80px">{{ t('designer.h.scale') }}</th>
              <th style="width: 50px" :title="t('designer.h.allowNull')">NULL</th>
              <th style="width: 50px" :title="t('designer.h.pk')">{{ t('designer.h.pk') }}</th>
              <th style="width: 130px">{{ t('designer.h.default') }}</th>
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
      </div>
      <div v-if="inner === 'fields' && selCol" class="field-props">
        <div class="fp-title">{{ t('designer.fieldProps', { name: selCol.name || '—' }) }}</div>
        <label v-if="isMysql" class="fp"><input v-model="selCol.unsigned" type="checkbox" /> {{ t('designer.unsigned') }}</label>
        <label v-if="isMysql" class="fp"><input v-model="selCol.zerofill" type="checkbox" /> {{ t('designer.zerofill') }}</label>
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
          <thead><tr>
            <th>{{ t('designer.h.name') }}</th>
            <th>{{ t('designer.h.colsComma') }}</th>
            <th>{{ t('designer.h.indexType') }}</th>
            <th>{{ t('designer.h.unique') }}</th>
            <th v-if="isPg">WHERE</th>
            <th v-if="isPg" :title="t('designer.concurrentTitle')">CONC</th>
            <th></th>
          </tr></thead>
          <tbody>
            <tr v-for="(ix, i) in spec.indexes" :key="i">
              <td><input v-model="ix.name" /></td>
              <td><input v-model="ix.columns" :placeholder="t('designer.idxColsPh')" :title="t('designer.idxColsTitle')" /></td>
              <td>
                <ThemedSelect
                  :model-value="ix.type ?? ''"
                  :options="[{ value: '', label: '—' }, ...indexTypes.map((ty) => ({ value: ty, label: ty }))]"
                  :width="110"
                  @update:model-value="(v) => (ix.type = v)"
                />
              </td>
              <td class="c"><input v-model="ix.unique" type="checkbox" /></td>
              <td v-if="isPg"><input v-model="ix.where" :placeholder="t('designer.wherePh')" /></td>
              <td v-if="isPg" class="c"><input v-model="ix.concurrent" type="checkbox" :title="t('designer.concurrentTitle')" /></td>
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
                <ThemedSelect
                  :model-value="fk.onDelete ?? ''"
                  :options="FK_ACTION_OPTS"
                  :width="120"
                  @update:model-value="(v) => (fk.onDelete = v)"
                />
              </td>
              <td>
                <ThemedSelect
                  :model-value="fk.onUpdate ?? ''"
                  :options="FK_ACTION_OPTS"
                  :width="120"
                  @update:model-value="(v) => (fk.onUpdate = v)"
                />
              </td>
              <td v-if="isPg">
                <ThemedSelect
                  :model-value="fk.match ?? ''"
                  :options="FK_MATCH_OPTS"
                  :width="100"
                  @update:model-value="(v) => (fk.match = v)"
                />
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
          <div class="opt-row"><label>{{ t('designer.colCollation') }}</label><input v-model="spec.collation" placeholder="utf8mb4_unicode_ci" /></div>
          <div class="opt-row">
            <label>{{ t('designer.rowFormat') }}</label>
            <ThemedSelect
              :model-value="spec.rowFormat ?? ''"
              :options="ROW_FORMAT_OPTS"
              :width="180"
              @update:model-value="(v) => (spec.rowFormat = v)"
            />
          </div>
          <div class="opt-row"><label>{{ t('designer.autoIncStart') }}</label><input v-model="spec.autoIncStart" placeholder="1" type="text" /></div>
        </template>
        <template v-else-if="isPg">
          <div class="opt-row"><label>TABLESPACE</label><input v-model="spec.tablespace" placeholder="pg_default" /></div>
          <div class="opt-row"><label>FILLFACTOR</label><input v-model="spec.fillfactor" placeholder="100" type="text" /></div>
          <div class="opt-row"><label>INHERITS</label><input v-model="spec.inherits" :placeholder="t('designer.inheritsPh')" /></div>
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
        <div class="preview-bar">
          <button class="ghost" :title="t('designer.copyDdl')" @click="copyDdl">{{ t('designer.copyDdl') }}</button>
          <button class="ghost" :title="t('designer.compressDdl')" @click="compressDdl">{{ t('designer.compressDdl') }}</button>
        </div>
        <SqlEditor :model-value="previewText" readonly />
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
/*
 * 字段 tab 特殊布局:表格区独立滚动,字段属性面板固定在底部不随滚动.
 *  - inner-body.fields-tab → flex 列, padding: 0(由内部子元素负责)
 *  - .fields-scroll        → flex 1 + overflow:auto, 只让 grid 滚
 *  - .field-props          → flex-none, 沉在底部, 边框/背景跟主题
 */
.inner-body.fields-tab {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}
.inner-body.fields-tab .fields-scroll {
  flex: 1 1 auto;
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
/* 单元格无缝输入:input/select 撑满 td,等高等宽,边距由 td 控制,
   不让 width:60px 之类把控件挤成"卡片"独立浮在 cell 内 */
.grid input:not([type='checkbox']),
.grid select {
  width: 100%;
  height: 100%;
  min-height: 28px;
  box-sizing: border-box;
  background-color: transparent;
  border: none;
  color: var(--text);
  padding: 4px 6px;
  font-size: 13px;
  font-family: inherit;
}
.grid select {
  padding-right: 20px;
  cursor: pointer;
}
/* 长度 / 小数点列:不再写死宽度,改让 input 占满 td;
   td 宽度由 th 上的 style 控制(见 thead) */
.grid input.w-xs,
.grid input.w-sm {
  width: 100%;
  padding: 4px 6px;
}
.grid td {
  padding: 0; /* 内部 input 已经有 padding,td 不再叠加,避免出现内白边 */
  vertical-align: middle;
}
.grid input:focus,
.grid select:focus {
  outline: none;
  background-color: rgba(124, 108, 255, 0.10);
  box-shadow: inset 0 0 0 1px var(--accent);
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
  /* 之前写死 width:60px,PG 的 'TABLESPACE'/'FILLFACTOR'/'INHERITS'
     全被截断 → 改 min-width + white-space 保证 label 完整,各对齐良好 */
  min-width: 140px;
  flex-shrink: 0;
  color: var(--muted);
  font-size: 13px;
  white-space: nowrap;
}
.opt-row input,
.opt-row select {
  flex: 1 1 260px;
  max-width: 320px;
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  /* 覆盖前面 .grid input 的全局规则,避免 height:100%/min-height:28px
     在 options 面板里把控件拉扁 */
  height: auto;
  min-height: 0;
  width: auto;
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
  padding: 10px 14px;
  margin-top: 0;
  border-top: 1px solid var(--border);
  background: var(--panel);
  flex: none; /* 沉在底部,不参与滚动 */
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
  display: flex;
  flex-direction: column;
}
.preview-bar {
  display: flex;
  gap: 6px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}
.preview-bar button {
  font-size: 11px;
  padding: 2px 10px;
}
.banner.err {
  margin: 0;
  border-radius: 0;
}
</style>
