<script setup lang="ts">
import type { QueryHistoryEntry } from '@db-tool/shared-types'
import { computed, ref } from 'vue'
import { t } from '../i18n'

const props = defineProps<{ entries: QueryHistoryEntry[] }>()
const emit = defineEmits<{ pick: [string]; clear: []; saveSnippet: [string] }>()

const q = ref('')
const filtered = computed(() => {
  const k = q.value.trim().toLowerCase()
  return k ? props.entries.filter((e) => e.sql.toLowerCase().includes(k)) : props.entries
})

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString()
}
</script>

<template>
  <div class="history">
    <div class="history-bar">
      <input v-model="q" class="hist-search" :placeholder="t('hist.searchPh')" />
      <span class="cnt">{{ filtered.length }} / {{ entries.length }}</span>
      <button class="ghost sm" :disabled="!entries.length" @click="emit('clear')">{{ t('hist.clear') }}</button>
    </div>
    <div class="history-list">
      <div v-if="!entries.length" class="history-empty">{{ t('hist.empty') }}</div>
      <div v-else-if="!filtered.length" class="history-empty">{{ t('hist.noMatch') }}</div>
      <div
        v-for="e in filtered"
        :key="e.id"
        class="history-item"
        :title="t('hist.loadEditor')"
        @dblclick="emit('pick', e.sql)"
      >
        <span class="dot" :class="e.success ? 'ok' : 'err'"></span>
        <code class="sql">{{ e.sql }}</code>
        <span class="ts">{{ fmtTime(e.executedAt) }}<template v-if="e.durationMs != null"> · {{ e.durationMs }}ms</template></span>
        <button class="star" :title="t('hist.saveSnippet')" @click.stop="emit('saveSnippet', e.sql)">★</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.history-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}
.history-list {
  flex: 1;
  overflow: auto;
}
.history-empty {
  padding: 16px;
  color: var(--muted);
}
.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.history-item:hover {
  background: rgba(124, 108, 255, 0.12);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.dot.ok {
  background: var(--ok);
}
.dot.err {
  background: var(--err);
}
.sql {
  flex: 1;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ts {
  font-size: 11px;
  color: var(--muted);
  flex: none;
}
.ghost.sm {
  padding: 2px 10px;
  font-size: 12px;
}
.hist-search {
  flex: 1;
  padding: 3px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
}
.history-bar .cnt {
  font-size: 11px;
  color: var(--muted);
  flex: none;
}
.star {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 14px;
  flex: none;
}
.star:hover {
  color: var(--accent);
}
</style>
