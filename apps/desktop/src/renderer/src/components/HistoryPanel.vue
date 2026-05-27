<script setup lang="ts">
import type { QueryHistoryEntry } from '@db-tool/shared-types'

defineProps<{ entries: QueryHistoryEntry[] }>()
const emit = defineEmits<{ pick: [string]; clear: [] }>()

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString()
}
</script>

<template>
  <div class="history">
    <div class="history-bar">
      <span>{{ entries.length }} 条历史</span>
      <button class="ghost sm" :disabled="!entries.length" @click="emit('clear')">清空</button>
    </div>
    <div class="history-list">
      <div v-if="!entries.length" class="history-empty">还没有执行记录</div>
      <div
        v-for="e in entries"
        :key="e.id"
        class="history-item"
        :title="'双击载入编辑器'"
        @dblclick="emit('pick', e.sql)"
      >
        <span class="dot" :class="e.success ? 'ok' : 'err'"></span>
        <code class="sql">{{ e.sql }}</code>
        <span class="ts">{{ fmtTime(e.executedAt) }}<template v-if="e.durationMs != null"> · {{ e.durationMs }}ms</template></span>
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
</style>
