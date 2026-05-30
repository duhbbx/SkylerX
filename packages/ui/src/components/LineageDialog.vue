<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 列血缘（A10 启发式版本）：还没有真 SQL parser，先用最简启发式 —— 在历史 SQL 文本里
 * 出现「<table>.<column>」或裸 <column>（前提是 SQL 里 FROM 了 <table>）的视为相关。
 *
 * 准确度有限：会漏（别名 / 子查询）、会误报（同名列）。明确告诉用户这是「heuristic」版本，
 * 等 SQL parser 上线后会替换为真正的血缘分析。
 */
import type { ConnectionConfig, QueryHistoryEntry } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig; table: string; column: string }>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()

const entries = ref<QueryHistoryEntry[]>([])
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    entries.value = await client.connections.history(props.conn.id, 500)
  } finally {
    loading.value = false
  }
})

const tableShort = computed(() => props.table.replace(/^.*\./, ''))
const hits = computed(() => {
  const sources: QueryHistoryEntry[] = []
  const sinks: QueryHistoryEntry[] = []
  const both: QueryHistoryEntry[] = []
  // 命中规则：
  //  - sink：SQL 形如 INSERT INTO <table> ... <column> 或 UPDATE <table> SET <column> = ...
  //  - source：SQL 形如 SELECT ... <column> ... FROM ... <table>
  //  - both：CREATE TABLE ... AS / WITH 之类 + 既 FROM 又写本表的
  const tabRe = new RegExp(`\\b${tableShort.value}\\b`, 'i')
  const colRe = new RegExp(`\\b${props.column}\\b`, 'i')
  for (const e of entries.value) {
    if (!tabRe.test(e.sql) || !colRe.test(e.sql)) continue
    if (/^\s*(insert|update)/i.test(e.sql)) sinks.push(e)
    else if (/^\s*(select|with)/i.test(e.sql)) sources.push(e)
    else both.push(e)
  }
  return { sources, sinks, both }
})

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString()
}
</script>

<template>
  <Modal :title="t('lineage.title', { col: column, table })" width="wide" @close="emit('close')">
    <div class="lin">
      <p class="hint">{{ t('lineage.hint') }}</p>
      <div v-if="loading" class="empty">{{ t('lineage.loading') }}</div>
      <div v-else class="cols">
        <div class="col">
          <h4>← {{ t('lineage.sinks') }} ({{ hits.sinks.length }})</h4>
          <p v-if="!hits.sinks.length" class="muted">{{ t('lineage.noHits') }}</p>
          <div v-for="e in hits.sinks" :key="e.id" class="entry">
            <span class="ts">{{ fmtTime(e.executedAt) }}</span>
            <code class="sql">{{ e.sql.slice(0, 120) }}{{ e.sql.length > 120 ? '…' : '' }}</code>
          </div>
        </div>
        <div class="col">
          <h4>→ {{ t('lineage.sources') }} ({{ hits.sources.length }})</h4>
          <p v-if="!hits.sources.length" class="muted">{{ t('lineage.noHits') }}</p>
          <div v-for="e in hits.sources" :key="e.id" class="entry">
            <span class="ts">{{ fmtTime(e.executedAt) }}</span>
            <code class="sql">{{ e.sql.slice(0, 120) }}{{ e.sql.length > 120 ? '…' : '' }}</code>
          </div>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.lin { min-width: 720px; min-height: 360px; max-height: 70vh; display: flex; flex-direction: column; gap: 8px; }
.hint { font-size: 12px; color: var(--muted); padding: 6px 8px; background: rgba(224, 160, 32, 0.08); border-left: 3px solid #e0a020; border-radius: 0 4px 4px 0; }
.empty { padding: 40px; text-align: center; color: var(--muted); }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; flex: 1; overflow: hidden; }
.col { overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
.col h4 { margin: 0 0 6px; font-size: 12px; color: var(--accent, #7c6cff); }
.muted { color: var(--muted); font-size: 11px; }
.entry { padding: 4px 0; border-bottom: 1px solid var(--border); display: flex; gap: 6px; align-items: center; }
.ts { font-size: 10px; color: var(--muted); font-family: var(--font-mono); flex: none; }
.sql { font-family: var(--font-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
