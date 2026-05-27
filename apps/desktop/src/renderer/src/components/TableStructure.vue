<script setup lang="ts">
import { type MetadataNode, MetaNodeKind } from '@db-tool/shared-types'
import { onMounted, ref } from 'vue'
import type { TreeNode } from './treeNode'

const props = defineProps<{ connId: string; node: TreeNode }>()

const cols = ref<MetadataNode[]>([])
const error = ref<string | null>(null)
const loading = ref(true)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    cols.value = await window.api.connections.metadata(props.connId, {
      parentKind: MetaNodeKind.Group,
      path: [...props.node.path],
      group: 'columns',
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <div class="struct">
    <div class="head">
      <span class="title">{{ node.sqlName ?? node.name }}</span>
      <span class="sub">结构 · {{ cols.length }} 列</span>
      <button class="ghost" title="刷新" @click="load">⟳</button>
    </div>
    <div v-if="loading" class="msg">加载中…</div>
    <div v-else-if="error" class="msg err">✗ {{ error }}</div>
    <div v-else class="scroll">
      <table class="grid">
        <thead>
          <tr>
            <th>字段</th>
            <th>类型</th>
            <th>可空</th>
            <th>主键</th>
            <th>默认值</th>
            <th>注释</th>
          </tr>
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
.head .sub {
  font-size: 12px;
  color: var(--muted);
}
.head .ghost {
  margin-left: auto;
}
.msg {
  padding: 16px;
  color: var(--muted);
}
.msg.err {
  color: var(--err);
  white-space: pre-wrap;
}
.scroll {
  flex: 1;
  overflow: auto;
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
