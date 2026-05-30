<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type DbDialect, MetaNodeKind, type MetadataNode } from '@db-tool/shared-types'
import { onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { deriveContext } from '../ddl'
import { buildCreateFromColumns } from '../dump'
import { t } from '../i18n'
import SqlEditor from './SqlEditor.vue'
import type { TreeNode } from './treeNode'

const client = useDataClient()

const props = defineProps<{ connId: string; node: TreeNode; dialect: DbDialect }>()

// 标签经 t('struct.tab.<key>') 渲染
const TABS = ['columns', 'indexes', 'keys', 'ddl'] as const
const tab = ref<(typeof TABS)[number]>('columns')

const cols = ref<MetadataNode[]>([])
const indexes = ref<MetadataNode[]>([])
const keys = ref<MetadataNode[]>([])
const ddl = ref('')
const error = ref<string | null>(null)
const loading = ref(true)

const isMysql = ['mysql', 'mariadb', 'oceanbase'].includes(props.dialect)

function meta(group: string): Promise<MetadataNode[]> {
  return client.connections.metadata(props.connId, {
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
    const r = await client.connections.execute(props.connId, `SHOW CREATE TABLE ${ref0}`, [], {
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
      <button class="ghost" :title="t('common.refresh')" @click="load">⟳</button>
    </div>

    <div class="tabs">
      <button v-for="tk in TABS" :key="tk" class="tab" :class="{ active: tab === tk }" @click="tab = tk">
        {{ t('struct.tab.' + tk)
        }}<span v-if="tk === 'columns'" class="cnt">{{ cols.length }}</span
        ><span v-else-if="tk === 'indexes'" class="cnt">{{ indexes.length }}</span
        ><span v-else-if="tk === 'keys'" class="cnt">{{ keys.length }}</span>
      </button>
    </div>

    <div v-if="loading" class="msg">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="msg err">✗ {{ error }}</div>
    <div v-else class="body">
      <!-- 字段 -->
      <table v-if="tab === 'columns'" class="grid">
        <thead>
          <tr><th>{{ t('struct.h.field') }}</th><th>{{ t('struct.h.type') }}</th><th>{{ t('struct.h.nullable') }}</th><th>{{ t('struct.h.pk') }}</th><th>{{ t('struct.h.default') }}</th><th>{{ t('struct.h.comment') }}</th></tr>
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
        <thead><tr><th>{{ t('struct.indexName') }}</th></tr></thead>
        <tbody>
          <tr v-for="x in indexes" :key="x.name"><td>{{ x.name }}</td></tr>
          <tr v-if="!indexes.length"><td class="muted">{{ t('common.none') }}</td></tr>
        </tbody>
      </table>

      <!-- 键 -->
      <table v-else-if="tab === 'keys'" class="grid">
        <thead><tr><th>{{ t('struct.constraintName') }}</th></tr></thead>
        <tbody>
          <tr v-for="x in keys" :key="x.name"><td>{{ x.name }}</td></tr>
          <tr v-if="!keys.length"><td class="muted">{{ t('common.none') }}</td></tr>
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
  font-family: var(--font-mono);
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
