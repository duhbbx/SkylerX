<script setup lang="ts">
import { type ConnectionConfig, type DbDialect, MetaNodeKind } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { type TableContext, quoteId } from '../ddl'
import { rowInserts } from '../io'
import Modal from './Modal.vue'
import type { TreeNode } from './treeNode'

const props = defineProps<{
  connId: string
  dialect: DbDialect
  node: TreeNode
  ctx: TableContext
}>()
const emit = defineEmits<{ done: [number]; close: [] }>()

const conns = ref<ConnectionConfig[]>([])
const cols = ref<string[]>([])
const targetConnId = ref(props.connId)
const targetDb = ref(props.ctx.database ?? '')
const targetSchema = ref(props.ctx.schema ?? '')
const targetTable = ref(props.node.name)
const truncateFirst = ref(false)
const chunkSize = ref(500)

const busy = ref(false)
const done = ref(0)
const error = ref<string | null>(null)

const targetConn = computed(() => conns.value.find((c) => c.id === targetConnId.value))

onMounted(async () => {
  try {
    conns.value = await window.api.connections.list()
    const meta = await window.api.connections.metadata(props.connId, {
      parentKind: MetaNodeKind.Group,
      path: [...props.node.path],
      group: 'columns',
    })
    cols.value = meta.map((c) => c.name)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

function targetRef(dialect: DbDialect): string {
  const q = (s: string) => quoteId(dialect, s)
  const t = targetTable.value.trim()
  return targetSchema.value.trim() ? `${q(targetSchema.value.trim())}.${q(t)}` : q(t)
}

async function run(): Promise<void> {
  const tc = targetConn.value
  if (!tc) {
    error.value = '请选择目标连接'
    return
  }
  if (!targetTable.value.trim()) {
    error.value = '请填写目标表名'
    return
  }
  busy.value = true
  error.value = null
  done.value = 0
  const srcRef = props.node.sqlName ?? props.node.name
  const dstRef = targetRef(tc.dialect)
  const dstOpts = { database: targetDb.value || undefined, schema: targetSchema.value || undefined }
  try {
    if (truncateFirst.value) {
      await window.api.connections.execute(tc.id, `DELETE FROM ${dstRef}`, [], dstOpts)
    }
    const size = Math.max(1, chunkSize.value)
    for (let page = 0; page < 100000; page++) {
      const res = await window.api.connections.execute(props.connId, `SELECT * FROM ${srcRef}`, [], {
        database: props.ctx.database,
        schema: props.ctx.schema,
        limit: size,
        offset: page * size,
      })
      const rows = res.rows
      if (!rows.length) break
      const stmts = rowInserts(tc.dialect, dstRef, cols.value, rows)
      await window.api.connections.executeBatch(tc.id, stmts, dstOpts)
      done.value += rows.length
      if (rows.length < size) break
    }
    emit('done', done.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal :title="`数据传输 · ${node.name}`" wide @close="emit('close')">
    <div class="dt">
      <div class="src">源：<b>{{ node.sqlName ?? node.name }}</b>（{{ cols.length }} 列）</div>

      <div class="grid">
        <label>目标连接</label>
        <select v-model="targetConnId">
          <option v-for="c in conns" :key="c.id" :value="c.id">
            {{ c.name || c.dialect }}{{ c.id === connId ? '（当前）' : '' }}
          </option>
        </select>

        <label>目标库</label>
        <input v-model="targetDb" placeholder="database" />

        <label>目标 schema</label>
        <input v-model="targetSchema" placeholder="（PG/SQLServer 需要）" />

        <label>目标表</label>
        <input v-model="targetTable" placeholder="表名（需已存在且列匹配）" />

        <label>每批行数</label>
        <input v-model.number="chunkSize" type="number" min="1" class="w-sm" />

        <label>先清空目标</label>
        <input v-model="truncateFirst" type="checkbox" class="chk" />
      </div>

      <div v-if="busy || done" class="progress">已传输 {{ done }} 行{{ busy ? '…' : ' ✓' }}</div>
      <div v-if="error" class="banner err">✗ {{ error }}</div>
      <p class="note">
        按主键/列名对齐插入，要求目标表已存在且列兼容；跨方言时类型/布尔/日期为尽力转换。大表分批读写。
      </p>

      <div class="actions">
        <button class="ghost" :disabled="busy" @click="emit('close')">取消</button>
        <button class="primary" :disabled="busy || !cols.length" @click="run">
          {{ busy ? '传输中…' : '开始传输' }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.dt {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.src {
  font-size: 13px;
}
.grid {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 10px 14px;
  align-items: center;
}
.grid input:not([type='checkbox']),
.grid select {
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.grid .w-sm {
  width: 100px;
}
.grid .chk {
  justify-self: start;
  width: 16px;
  height: 16px;
}
.progress {
  font-size: 13px;
  color: var(--accent);
}
.note {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.banner.err {
  white-space: pre-wrap;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.actions button {
  padding: 7px 16px;
}
</style>
