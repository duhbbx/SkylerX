<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { QueryHistoryEntry } from '@db-tool/shared-types'
import { computed, ref } from 'vue'
import { useDataClient } from '../data-client'
import { prompt as appPrompt } from '../dialog'
import { reportError } from '../errorReporter'
import { t } from '../i18n'

const props = defineProps<{ entries: QueryHistoryEntry[] }>()
const emit = defineEmits<{
  pick: [string]
  clear: []
  saveSnippet: [string]
  /** 通知外层重新拉取 entries(meta 改变后) */
  refresh: []
}>()

const client = useDataClient()

const q = ref('')
// #4 慢查询面板：默认按时间倒序；可切「按耗时降序」；可设阈值过滤
type SortBy = 'time' | 'duration'
const sortBy = ref<SortBy>('time')
const slowOnly = ref(false)
const slowThresholdMs = ref<number>(500) // 阈值，单位毫秒；超过这个值标红

/** 仅显示置顶 */
const pinnedOnly = ref(false)

const filtered = computed(() => {
  const k = q.value.trim().toLowerCase()
  let arr = k
    ? props.entries.filter(
        (e) =>
          e.sql.toLowerCase().includes(k) ||
          (e.tags ?? '').toLowerCase().includes(k) ||
          (e.note ?? '').toLowerCase().includes(k),
      )
    : [...props.entries]
  if (slowOnly.value) arr = arr.filter((e) => (e.durationMs ?? 0) >= slowThresholdMs.value)
  if (pinnedOnly.value) arr = arr.filter((e) => e.pinned === 1)
  // pinned 永远最上,然后按用户选的排序
  arr.sort((a, b) => {
    const pinDiff = (b.pinned ?? 0) - (a.pinned ?? 0)
    if (pinDiff !== 0) return pinDiff
    if (sortBy.value === 'duration') return (b.durationMs ?? 0) - (a.durationMs ?? 0)
    return b.executedAt - a.executedAt
  })
  return arr
})

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString()
}
function isSlow(durationMs: number | undefined | null): boolean {
  return (durationMs ?? 0) >= slowThresholdMs.value
}

/** 切换置顶。 */
async function togglePin(e: QueryHistoryEntry): Promise<void> {
  const next = e.pinned === 1 ? 0 : 1
  try {
    await (
      client.connections as unknown as {
        historyMeta: (
          id: number,
          patch: { pinned?: number; tags?: string | null; note?: string | null },
        ) => Promise<void>
      }
    ).historyMeta(e.id, { pinned: next })
    e.pinned = next
    emit('refresh')
  } catch (err) {
    reportError(err)
  }
}

/** 改 tags(逗号分隔)。 */
async function editTags(e: QueryHistoryEntry): Promise<void> {
  const input = await appPrompt({
    message: '标签(逗号分隔,如 daily,prod,join):',
    defaultValue: e.tags ?? '',
  })
  if (input == null) return
  const next = input.trim() || null
  try {
    await (
      client.connections as unknown as {
        historyMeta: (id: number, patch: { tags?: string | null }) => Promise<void>
      }
    ).historyMeta(e.id, { tags: next })
    e.tags = next
    emit('refresh')
  } catch (err) {
    reportError(err)
  }
}

/** 改 note。 */
async function editNote(e: QueryHistoryEntry): Promise<void> {
  const input = await appPrompt({ message: '备注:', defaultValue: e.note ?? '' })
  if (input == null) return
  const next = input.trim() || null
  try {
    await (
      client.connections as unknown as {
        historyMeta: (id: number, patch: { note?: string | null }) => Promise<void>
      }
    ).historyMeta(e.id, { note: next })
    e.note = next
    emit('refresh')
  } catch (err) {
    reportError(err)
  }
}
</script>

<template>
  <div class="history">
    <div class="history-bar">
      <input v-model="q" class="hist-search" :placeholder="t('hist.searchPh')" />
      <span class="cnt">{{ filtered.length }} / {{ entries.length }}</span>
      <!-- #4：排序模式 + 慢查询过滤 + 阈值（持久化跟 settings 走） -->
      <select v-model="sortBy" class="hist-sel" :title="t('hist.sortBy')">
        <option value="time">{{ t('hist.sortTime') }}</option>
        <option value="duration">{{ t('hist.sortDuration') }}</option>
      </select>
      <label class="hist-chk" :title="t('hist.slowOnlyTitle')">
        <input v-model="slowOnly" type="checkbox" />
        <span>≥</span>
        <input v-model.number="slowThresholdMs" type="number" min="0" step="100" class="hist-num" />
        <span>ms</span>
      </label>
      <label class="hist-chk" title="只看置顶">
        <input v-model="pinnedOnly" type="checkbox" />
        <span>📌</span>
      </label>
      <button class="ghost sm" :disabled="!entries.length" @click="emit('clear')">{{ t('hist.clear') }}</button>
    </div>
    <div class="history-list">
      <div v-if="!entries.length" class="history-empty">{{ t('hist.empty') }}</div>
      <div v-else-if="!filtered.length" class="history-empty">{{ t('hist.noMatch') }}</div>
      <div
        v-for="e in filtered"
        :key="e.id"
        class="history-item"
        :class="{ slow: isSlow(e.durationMs), pinned: e.pinned === 1 }"
        :title="t('hist.loadEditor')"
        @dblclick="emit('pick', e.sql)"
      >
        <button
          class="pin-btn"
          :class="{ on: e.pinned === 1 }"
          :title="e.pinned === 1 ? '已置顶,点取消' : '置顶'"
          @click.stop="togglePin(e)"
        >📌</button>
        <span class="dot" :class="e.success ? 'ok' : 'err'"></span>
        <code class="sql">{{ e.sql }}</code>
        <span v-if="e.tags" class="tag-list">
          <span v-for="(tg, ti) in e.tags.split(',').map(s => s.trim()).filter(Boolean)" :key="ti" class="tag">{{ tg }}</span>
        </span>
        <span v-if="e.note" class="note" :title="e.note">💬</span>
        <span class="ts">
          {{ fmtTime(e.executedAt) }}<template v-if="e.durationMs != null">
            · <span :class="{ slowms: isSlow(e.durationMs) }">{{ e.durationMs }}ms</span>
          </template>
        </span>
        <button class="ico-btn" title="加 / 改标签" @click.stop="editTags(e)">🏷</button>
        <button class="ico-btn" title="加 / 改备注" @click.stop="editNote(e)">📝</button>
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
  font-family: var(--font-mono);
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
.hist-sel {
  padding: 2px 6px;
  font-size: 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
}
.hist-chk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--muted);
}
.hist-num {
  width: 64px;
  padding: 2px 6px;
  font-size: 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-family: var(--font-mono);
}
.history-item.slow {
  background: rgba(224, 64, 80, 0.06);
}
.history-item.slow:hover {
  background: rgba(224, 64, 80, 0.16);
}
.slowms {
  color: var(--err, #e04050);
  font-weight: 600;
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
.pin-btn, .ico-btn {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  flex: none;
  opacity: 0.55;
}
.history-item:hover .pin-btn, .history-item:hover .ico-btn { opacity: 1; }
.pin-btn.on { opacity: 1; color: var(--accent); }
.history-item.pinned { background: rgba(124, 108, 255, 0.06); }
.history-item.pinned:hover { background: rgba(124, 108, 255, 0.18); }
.tag-list { display: inline-flex; gap: 3px; flex: none; }
.tag {
  display: inline-block;
  padding: 0 5px;
  background: rgba(124, 108, 255, 0.18);
  border-radius: 2px;
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--accent);
}
.note { font-size: 11px; flex: none; }
</style>
