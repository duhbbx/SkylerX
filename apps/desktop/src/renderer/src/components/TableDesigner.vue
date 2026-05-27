<script setup lang="ts">
import type { DbDialect } from '@db-tool/shared-types'
import { computed, reactive, ref } from 'vue'
import {
  type TableContext,
  buildCreateTable,
  emptyColumn,
  emptyTableSpec,
  typeOptions,
} from '../ddl'
import { splitStatements } from '../sqlSplit'
import SqlEditor from './SqlEditor.vue'

const props = defineProps<{ connId: string; dialect: DbDialect; ctx: TableContext }>()
const emit = defineEmits<{ created: []; cancel: [] }>()

const tableName = ref('')
const spec = reactive(emptyTableSpec())
const types = typeOptions(props.dialect)
const isMysql = ['mysql', 'mariadb', 'oceanbase'].includes(props.dialect)

const INNER = [
  { key: 'fields', label: '字段' },
  { key: 'indexes', label: '索引' },
  { key: 'fk', label: '外键' },
  { key: 'unique', label: '唯一键' },
  { key: 'check', label: '检查' },
  { key: 'trigger', label: '触发器' },
  { key: 'options', label: '选项' },
  { key: 'storage', label: '存储' },
  { key: 'comment', label: '注释' },
  { key: 'sql', label: 'SQL 预览' },
] as const
const inner = ref<(typeof INNER)[number]['key']>('fields')
const selected = ref(0)

const busy = ref(false)
const error = ref<string | null>(null)

const ddl = computed(() => buildCreateTable(props.dialect, props.ctx, tableName.value, spec))
const target = [props.ctx.database, props.ctx.schema].filter(Boolean).join(' / ')

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

async function save(): Promise<void> {
  if (!tableName.value.trim()) {
    error.value = '请输入表名'
    gotoFields()
    return
  }
  if (!spec.columns.some((c) => c.name.trim() && c.type.trim())) {
    error.value = '至少需要一个有效字段'
    gotoFields()
    return
  }
  busy.value = true
  error.value = null
  try {
    for (const stmt of splitStatements(ddl.value)) {
      await window.api.connections.execute(props.connId, stmt, [], {
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

function saveAs(): void {
  const n = window.prompt('另存为（新表名）', tableName.value)
  if (n && n.trim()) {
    tableName.value = n.trim()
    void save()
  }
}
</script>

<template>
  <div class="designer">
    <div class="toolbar">
      <button @click="resetTable">新建</button>
      <button class="primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存' }}</button>
      <button @click="saveAs">另存为</button>
      <span class="sep" />
      <button @click="addField">添加字段</button>
      <button @click="insertField">插入字段</button>
      <button @click="deleteField">删除字段</button>
      <button @click="togglePk">主键</button>
      <button @click="move(-1)">上移</button>
      <button @click="move(1)">下移</button>
      <span class="name-box">
        <label>表名</label>
        <input v-model="tableName" placeholder="新表名" />
      </span>
      <span v-if="target" class="target">{{ target }}</span>
    </div>

    <div class="inner-tabs">
      <button
        v-for="t in INNER"
        :key="t.key"
        class="itab"
        :class="{ active: inner === t.key }"
        @click="inner = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="inner-body">
      <!-- 字段 -->
      <table v-if="inner === 'fields'" class="grid">
        <thead>
          <tr>
            <th>字段名</th>
            <th>类型</th>
            <th>长度</th>
            <th>小数点</th>
            <th title="允许 NULL">NULL</th>
            <th title="主键">主键</th>
            <th>默认值</th>
            <th>注释</th>
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

      <!-- 索引 -->
      <div v-else-if="inner === 'indexes'" class="sub">
        <button class="ghost sm" @click="spec.indexes.push({ name: '', columns: '', unique: false })">+ 添加索引</button>
        <table class="grid">
          <thead><tr><th>名称</th><th>字段(逗号分隔)</th><th>唯一</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(ix, i) in spec.indexes" :key="i">
              <td><input v-model="ix.name" /></td>
              <td><input v-model="ix.columns" /></td>
              <td class="c"><input v-model="ix.unique" type="checkbox" /></td>
              <td class="c"><button class="x" @click="spec.indexes.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 外键 -->
      <div v-else-if="inner === 'fk'" class="sub">
        <button class="ghost sm" @click="spec.foreignKeys.push({ name: '', columns: '', refTable: '', refColumns: '', onDelete: '', onUpdate: '' })">+ 添加外键</button>
        <table class="grid">
          <thead><tr><th>名称</th><th>字段</th><th>引用表</th><th>引用字段</th><th>ON DELETE</th><th>ON UPDATE</th><th></th></tr></thead>
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
              <td class="c"><button class="x" @click="spec.foreignKeys.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 唯一键 -->
      <div v-else-if="inner === 'unique'" class="sub">
        <button class="ghost sm" @click="spec.uniques.push({ name: '', columns: '' })">+ 添加唯一键</button>
        <table class="grid">
          <thead><tr><th>名称</th><th>字段(逗号分隔)</th><th></th></tr></thead>
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
        <button class="ghost sm" @click="spec.checks.push({ name: '', expression: '' })">+ 添加检查</button>
        <table class="grid">
          <thead><tr><th>名称</th><th>表达式</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(ck, i) in spec.checks" :key="i">
              <td><input v-model="ck.name" /></td>
              <td><input v-model="ck.expression" placeholder="如 age >= 0" /></td>
              <td class="c"><button class="x" @click="spec.checks.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 触发器 -->
      <div v-else-if="inner === 'trigger'" class="hint-pane">
        触发器需在表创建后单独管理（CREATE TRIGGER）。可在表创建完后用查询页添加。
      </div>

      <!-- 选项 -->
      <div v-else-if="inner === 'options'" class="sub">
        <template v-if="isMysql">
          <div class="opt-row"><label>引擎</label><input v-model="spec.engine" placeholder="InnoDB" /></div>
          <div class="opt-row"><label>字符集</label><input v-model="spec.charset" placeholder="utf8mb4" /></div>
        </template>
        <div v-else class="hint-pane">当前方言无额外表选项。</div>
      </div>

      <!-- 存储 -->
      <div v-else-if="inner === 'storage'" class="hint-pane">
        表空间 / 存储参数（方言相关，暂未提供 UI）。
      </div>

      <!-- 注释 -->
      <div v-else-if="inner === 'comment'" class="sub">
        <textarea v-model="spec.comment" rows="5" placeholder="表注释" class="comment-area" />
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
