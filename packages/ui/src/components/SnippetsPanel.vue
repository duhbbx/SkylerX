<script setup lang="ts">
import { computed, ref } from 'vue'
import { allTags, removeSnippet, snippets } from '../snippets'

const emit = defineEmits<{ pick: [string] }>()

const q = ref('')
const activeTag = ref<string | null>(null)
const tags = computed(() => allTags())

const filtered = computed(() => {
  const k = q.value.trim().toLowerCase()
  return snippets.filter(
    (s) =>
      (!activeTag.value || (s.tags ?? []).includes(activeTag.value)) &&
      (!k || `${s.name} ${s.sql} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(k)),
  )
})

function toggleTag(t: string): void {
  activeTag.value = activeTag.value === t ? null : t
}
</script>

<template>
  <div class="snip">
    <div class="snip-bar">
      <input v-model="q" class="snip-search" placeholder="🔍 搜索片段…" />
      <span class="cnt">{{ filtered.length }} / {{ snippets.length }}</span>
    </div>
    <div v-if="tags.length" class="tag-bar">
      <button
        v-for="t in tags"
        :key="t"
        class="tag-chip"
        :class="{ on: activeTag === t }"
        @click="toggleTag(t)"
      >
        #{{ t }}
      </button>
    </div>
    <div class="snip-list">
      <div v-if="!snippets.length" class="snip-empty">
        还没有片段。在编辑器里写好 SQL，点工具栏「存为片段」，或在历史里「★」收藏。
      </div>
      <div v-else-if="!filtered.length" class="snip-empty">无匹配片段</div>
      <div
        v-for="s in filtered"
        :key="s.id"
        class="snip-item"
        title="双击载入编辑器"
        @dblclick="emit('pick', s.sql)"
      >
        <div class="snip-main">
          <div class="snip-name">
            {{ s.name }}
            <span v-for="t in s.tags ?? []" :key="t" class="itag">#{{ t }}</span>
          </div>
          <code class="snip-sql">{{ s.sql }}</code>
        </div>
        <button class="x" title="删除片段" @click.stop="removeSnippet(s.id)">×</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.snip {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.snip-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
}
.snip-search {
  flex: 1;
  padding: 4px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
}
.snip-bar .cnt {
  font-size: 11px;
  color: var(--muted);
}
.tag-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
}
.tag-chip {
  font-size: 11px;
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  color: var(--muted);
  cursor: pointer;
}
.tag-chip.on {
  background: var(--accent, #7c6cff);
  border-color: var(--accent, #7c6cff);
  color: #fff;
}
.itag {
  font-size: 10px;
  color: var(--accent, #7c6cff);
  margin-left: 6px;
  font-weight: 400;
}
.snip-list {
  flex: 1;
  overflow: auto;
}
.snip-empty {
  padding: 16px;
  color: var(--muted);
  font-size: 13px;
}
.snip-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.snip-item:hover {
  background: rgba(124, 108, 255, 0.12);
}
.snip-main {
  flex: 1;
  min-width: 0;
}
.snip-name {
  font-size: 13px;
  font-weight: 600;
}
.snip-sql {
  display: block;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.x {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 16px;
  flex: none;
}
.x:hover {
  color: var(--err);
}
</style>
