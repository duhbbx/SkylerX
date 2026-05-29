<script setup lang="ts">/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ConnectionConfig, type DbDialect, MetaNodeKind } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { type TableContext, quoteId } from '../ddl'
import { t } from '../i18n'
import { rowInserts } from '../io'
import Modal from './Modal.vue'
import type { TreeNode } from './treeNode'

const client = useDataClient()

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
    conns.value = await client.connections.list()
    const meta = await client.connections.metadata(props.connId, {
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
  const tbl = targetTable.value.trim()
  return targetSchema.value.trim() ? `${q(targetSchema.value.trim())}.${q(tbl)}` : q(tbl)
}

async function run(): Promise<void> {
  const tc = targetConn.value
  if (!tc) {
    error.value = t('transfer.needTarget')
    return
  }
  if (!targetTable.value.trim()) {
    error.value = t('transfer.needTable')
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
      await client.connections.execute(tc.id, `DELETE FROM ${dstRef}`, [], dstOpts)
    }
    const size = Math.max(1, chunkSize.value)
    for (let page = 0; page < 100000; page++) {
      const res = await client.connections.execute(props.connId, `SELECT * FROM ${srcRef}`, [], {
        database: props.ctx.database,
        schema: props.ctx.schema,
        limit: size,
        offset: page * size,
      })
      const rows = res.rows
      if (!rows.length) break
      const stmts = rowInserts(tc.dialect, dstRef, cols.value, rows)
      await client.connections.executeBatch(tc.id, stmts, dstOpts)
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
  <Modal :title="t('transfer.title', { name: node.name })" width="wide" @close="emit('close')">
    <div class="dt">
      <div class="src">{{ t('transfer.sourceLabel') }}<b>{{ node.sqlName ?? node.name }}</b>{{ t('transfer.colsCount', { n: cols.length }) }}</div>

      <div class="grid">
        <label>{{ t('transfer.targetConn') }}</label>
        <select v-model="targetConnId">
          <option v-for="c in conns" :key="c.id" :value="c.id">
            {{ c.name || c.dialect }}{{ c.id === connId ? t('transfer.current') : '' }}
          </option>
        </select>

        <label>{{ t('transfer.targetDb') }}</label>
        <input v-model="targetDb" placeholder="database" />

        <label>{{ t('transfer.targetSchema') }}</label>
        <input v-model="targetSchema" :placeholder="t('transfer.schemaPh')" />

        <label>{{ t('transfer.targetTable') }}</label>
        <input v-model="targetTable" :placeholder="t('transfer.tablePh')" />

        <label>{{ t('transfer.batchRows') }}</label>
        <input v-model.number="chunkSize" type="number" min="1" class="w-sm" />

        <label>{{ t('transfer.truncateFirst') }}</label>
        <input v-model="truncateFirst" type="checkbox" class="chk" />
      </div>

      <div v-if="busy || done" class="progress">{{ t('transfer.progress', { n: done }) }}{{ busy ? '…' : ' ✓' }}</div>
      <div v-if="error" class="banner err">✗ {{ error }}</div>
      <p class="note">
        {{ t('transfer.note') }}
      </p>

      <div class="actions">
        <button class="ghost" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="primary" :disabled="busy || !cols.length" @click="run">
          {{ busy ? t('transfer.transferring') : t('transfer.start') }}
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
