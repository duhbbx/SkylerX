<script setup lang="ts">
import { type DbDialect, type MetadataNode, MetaNodeKind } from '@db-tool/shared-types'
import { onMounted, ref } from 'vue'
import { deriveContext } from '../ddl'
import { buildCreateFromColumns } from '../dump'
import SqlEditor from './SqlEditor.vue'
import type { TreeNode } from './treeNode'

const props = defineProps<{ connId: string; node: TreeNode; dialect: DbDialect }>()

const TABS = [
  { key: 'columns', label: '字段' },
  { key: 'indexes', label: '索引' },
  { key: 'keys', label: '键' },
  { key: 'ddl', label: 'DDL' },
] as const
const tab = ref<(typeof TABS)[number]['key']>('columns')

const cols = ref<MetadataNode[]>([])
const indexes = ref<MetadataNode[]>([])
const keys = ref<MetadataNode[]>([])
const ddl = ref('')
const error = ref<string | null>(null)
const loading = ref(true)

const isMysql = ['mysql', 'mariadb', 'oceanbase'].includes(props.dialect)

function meta(group: string): Promise<MetadataNode[]> {
  return window.api.connections.metadata(props.connId, {
    parentKind: MetaNodeKind.Group,
    path: [...props.node.path],
    group,
  })
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [c, i, k] = await Promise.all([meta('columns'), meta('indexes'), meta('keys')])
    cols.value = c
    indexes.value = i
    keys.value = k
    ddl.value = await loadDdl(c)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function loadDdl(columns: MetadataNode[]): Promise<string> {
  const ref0 = props.node.sqlName ?? props.node.name
  if (isMysql) {
    const ctx = deriveContext(props.dialect, props.node)
    const r = await window.api.connections.execute(props.connId, `SHOW CREATE TABLE ${ref0}`, [], {
      database: ctx.database,
      schema: ctx.schema,
    })
    const row = r.rows[0] as Record<string, unknown> | undefined
    const key = row && Object.keys(row).find((k) => /create table/i.test(k))
    if (row && key) return `${String(row[key])};`
  }
  // 非 MySQL（或取不到）：由列重建
  return buildCreateFromColumns(props.dialect, ref0, columns)
}

onMounted(load)
</script>

<template>
  <div class="struct">
    <div class="head">
      <span class="title">{{ node.sqlName ?? node.name }}</span>
      <button class="ghost" title="刷新" @click="load">⟳</button>
    </div>

    <div class="tabs">
      <button v-for="t in TABS" :key="t.key" class="tab" :class="{ active: tab === t.key }" @click="tab = t.key">
        {{ t.label
        }}<span v-if="t.key === 'columns'" class="cnt">{{ cols.length }}</span
        ><span v-else-if="t.key === 'indexes'" class="cnt">{{ indexes.length }}</span
        ><span v-else-if="t.key === 'keys'" class="cnt">{{ keys.length }}</span>
      </button>
    </div>

    <div v-if="loading" class="msg">加载中…</div>
    <div v-else-if="error" class="msg err">✗ {{ error }}</div>
    <div v-else class="body">
      <!-- 字段 -->
      <table v-if="tab === 'columns'" class="grid">
        <thead>
          <tr><th>字段</th><th>类型</th><th>可空</th><th>主键</th><th>默认值</th><th>注释</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in cols" :key="c.name">
            <td>{{ c.name }}</td>
            <td class="muted">{{ c.detail?.dataType }}</td>
            <td class="c">{{ c.detail?.nullable ? 'YES' : 'NO' }}</td>
            <td class="c">{{ c.detail?.primaryKey ? '🔑' : '' }}</td>
            <td class="muted">{{ c.detail?.defaultValue ?? '' }}</td>
            <td class="muted">{{ c.detail?.comment ?? '' }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 索引 -->
      <table v-else-if="tab === 'indexes'" class="grid">
        <thead><tr><th>索引名</th></tr></thead>
        <tbody>
          <tr v-for="x in indexes" :key="x.name"><td>{{ x.name }}</td></tr>
          <tr v-if="!indexes.length"><td class="muted">（无）</td></tr>
        </tbody>
      </table>

      <!-- 键 -->
      <table v-else-if="tab === 'keys'" class="grid">
        <thead><tr><th>约束名</th></tr></thead>
        <tbody>
          <tr v-for="x in keys" :key="x.name"><td>{{ x.name }}</td></tr>
          <tr v-if="!keys.length"><td class="muted">（无）</td></tr>
        </tbody>
      </table>

      <!-- DDL -->
      <div v-else class="ddl-wrap">
        <SqlEditor :model-value="ddl" readonly />
      </div>
    </div>
  </div>
</template>

<style scoped>
.struct {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.head .title {
  font-family: ui-monospace, monospace;
  font-weight: 600;
}
.head .ghost {
  margin-left: auto;
}
.tabs {
  display: flex;
  gap: 2px;
  padding: 4px 8px 0;
  border-bottom: 1px solid var(--border);
}
.tab {
  background: transparent;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  color: var(--muted);
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.tab.active {
  background: var(--bg);
  color: var(--text);
}
.tab .cnt {
  margin-left: 5px;
  font-size: 11px;
  opacity: 0.7;
}
.msg {
  padding: 16px;
  color: var(--muted);
}
.msg.err {
  color: var(--err);
  white-space: pre-wrap;
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.ddl-wrap {
  height: 100%;
  min-height: 320px;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.grid th,
.grid td {
  border: 1px solid var(--border);
  padding: 5px 10px;
  text-align: left;
  white-space: nowrap;
}
.grid th {
  position: sticky;
  top: 0;
  background: var(--panel);
  color: var(--muted);
  font-weight: 500;
}
.grid td.c {
  text-align: center;
}
.grid td.muted {
  color: var(--muted);
}
</style>
