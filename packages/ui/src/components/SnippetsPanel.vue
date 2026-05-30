<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DbDialect } from '@db-tool/shared-types'
import { computed, ref } from 'vue'
import { prompt as appPrompt } from '../dialog'
import { t } from '../i18n'
import {
  allTags,
  applySnippetVars,
  extractSnippetVars,
  removeSnippet,
  snippets,
  snippetsForDialect,
} from '../snippets'

const props = defineProps<{
  /** 当前编辑器所连的方言;snippet 限定 dialects 时按此筛选 */
  dialect?: DbDialect | null
}>()
const emit = defineEmits<{ pick: [string] }>()

const q = ref('')
const activeTag = ref<string | null>(null)
const tags = computed(() => allTags())

const filtered = computed(() => {
  const k = q.value.trim().toLowerCase()
  // 先按当前方言筛(unset/通用 + 命中)
  return snippetsForDialect(props.dialect).filter(
    (s) =>
      (!activeTag.value || (s.tags ?? []).includes(activeTag.value)) &&
      (!k || `${s.name} ${s.sql} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(k)),
  )
})

function toggleTag(t: string): void {
  activeTag.value = activeTag.value === t ? null : t
}

/** 选中 snippet:遇到 {{var}} 占位符 → 依次弹 prompt 填值 → 替换后 emit。 */
async function applyAndPick(sql: string): Promise<void> {
  const vars = extractSnippetVars(sql)
  if (!vars.length) {
    emit('pick', sql)
    return
  }
  const values: Record<string, string> = {}
  for (const name of vars) {
    const v = await appPrompt({ message: `参数 {{${name}}}:`, defaultValue: '' })
    if (v == null) return // 取消任意一个 → 整个放弃
    values[name] = v
  }
  emit('pick', applySnippetVars(sql, values))
}
</script>

<template>
  <div class="snip">
    <div class="snip-bar">
      <input v-model="q" class="snip-search" :placeholder="t('snip.searchPh')" />
      <span class="cnt">{{ filtered.length }} / {{ snippets.length }}</span>
    </div>
    <div v-if="tags.length" class="tag-bar">
      <button
        v-for="tag in tags"
        :key="tag"
        class="tag-chip"
        :class="{ on: activeTag === tag }"
        @click="toggleTag(tag)"
      >
        #{{ tag }}
      </button>
    </div>
    <div class="snip-list">
      <div v-if="!snippets.length" class="snip-empty">
        {{ t('snip.empty') }}
      </div>
      <div v-else-if="!filtered.length" class="snip-empty">{{ t('snip.noMatch') }}</div>
      <div
        v-for="s in filtered"
        :key="s.id"
        class="snip-item"
        :title="t('snip.loadEditor')"
        @dblclick="applyAndPick(s.sql)"
      >
        <div class="snip-main">
          <div class="snip-name">
            {{ s.name }}
            <span v-for="tag in s.tags ?? []" :key="tag" class="itag">#{{ tag }}</span>
          </div>
          <code class="snip-sql">{{ s.sql }}</code>
        </div>
        <button class="x" :title="t('snip.del')" @click.stop="removeSnippet(s.id)">×</button>
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
