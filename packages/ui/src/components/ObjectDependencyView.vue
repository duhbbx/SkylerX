<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DbDialect } from '@db-tool/shared-types'
import { onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { dependencyQueries, deriveContext } from '../ddl'
import { reportInlineError } from '../errorReporter'
import { t } from '../i18n'
import type { TreeNode } from './treeNode'

const client = useDataClient()
const props = defineProps<{ connId: string; node: TreeNode; dialect: DbDialect }>()

interface DepRow {
  sch: string
  nm: string
  ty: string
}

const dependents = ref<DepRow[]>([]) // 被谁依赖（影响面）
const dependsOn = ref<DepRow[]>([]) // 依赖什么
const loading = ref(true)
const error = ref<string | null>(null)
const unsupported = ref(false)

function rows(raw: Record<string, unknown>[]): DepRow[] {
  return raw.map((r) => ({
    sch: String(r.sch ?? ''),
    nm: String(r.nm ?? ''),
    ty: String(r.ty ?? ''),
  }))
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  unsupported.value = false
  const ctx = deriveContext(props.dialect, props.node)
  const q = dependencyQueries(props.dialect, ctx, props.node.name)
  if (!q) {
    unsupported.value = true
    loading.value = false
    return
  }
  try {
    const opts = { database: ctx.database, schema: ctx.schema }
    const [dep, on] = await Promise.all([
      client.connections.execute(props.connId, q.dependents, [], opts),
      client.connections.execute(props.connId, q.dependsOn, [], opts),
    ])
    dependents.value = rows(dep.rows as Record<string, unknown>[])
    dependsOn.value = rows(on.rows as Record<string, unknown>[])
  } catch (e) {
    reportInlineError(error, e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="deps">
    <div class="head">
      <span class="title">{{ node.sqlName ?? node.name }}</span>
      <button class="ghost" :title="t('common.refresh')" @click="load">⟳</button>
    </div>

    <div v-if="loading" class="msg">{{ t('common.loading') }}</div>
    <div v-else-if="unsupported" class="msg">{{ t('deps.unsupported') }}</div>
    <div v-else-if="error" class="msg err">✗ {{ error }}</div>
    <div v-else class="cols">
      <!-- 被谁依赖（影响面）-->
      <section class="col">
        <h3>{{ t('deps.dependents') }}<span class="cnt">{{ dependents.length }}</span></h3>
        <p class="hint">{{ t('deps.dependentsHint') }}</p>
        <ul v-if="dependents.length">
          <li v-for="(r, i) in dependents" :key="i">
            <span class="ty">{{ r.ty }}</span>
            <span class="nm">{{ r.sch ? `${r.sch}.${r.nm}` : r.nm }}</span>
          </li>
        </ul>
        <p v-else class="empty">{{ t('deps.none') }}</p>
      </section>

      <!-- 依赖什么 -->
      <section class="col">
        <h3>{{ t('deps.dependsOn') }}<span class="cnt">{{ dependsOn.length }}</span></h3>
        <p class="hint">{{ t('deps.dependsOnHint') }}</p>
        <ul v-if="dependsOn.length">
          <li v-for="(r, i) in dependsOn" :key="i">
            <span class="ty">{{ r.ty }}</span>
            <span class="nm">{{ r.sch ? `${r.sch}.${r.nm}` : r.nm }}</span>
          </li>
        </ul>
        <p v-else class="empty">{{ t('deps.none') }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.deps {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.head .title {
  font-weight: 600;
  font-family: var(--font-mono);
}
.head .ghost {
  margin-left: auto;
}
.msg {
  padding: 16px;
  color: var(--muted);
}
.msg.err {
  color: #e04050;
}
.cols {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  min-height: 0;
  background: var(--border);
  overflow: hidden;
}
.col {
  background: var(--bg);
  overflow: auto;
  padding: 10px 14px;
}
.col h3 {
  margin: 0 0 2px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.col .cnt {
  font-size: 11px;
  color: var(--muted);
  background: var(--panel);
  border-radius: 8px;
  padding: 0 6px;
}
.col .hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--muted);
}
.col ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.col li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.col .ty {
  flex: none;
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  min-width: 64px;
}
.col .nm {
  font-family: var(--font-mono);
}
.col .empty {
  color: var(--muted);
  font-size: 12px;
}
</style>
