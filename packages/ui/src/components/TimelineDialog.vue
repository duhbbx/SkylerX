<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 时间轴查看器（A7）：按时间列把结果集渲染为时间线上的散点。
 *
 * 智能默认：扫列名找带 _at / _time / date / time / created / updated 的列。
 * 时间值兼容：字符串（YYYY-MM-DD HH:MM:SS）、ISO、Date 对象、Unix 秒/毫秒。
 */
import type { QueryResult } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ result: QueryResult }>()
const emit = defineEmits<{ close: [] }>()

const cols = computed(() => props.result.columns.map((c) => c.name))
const timeCol = ref<string>('')
const labelCol = ref<string>('')
const colorCol = ref<string>('') // 可选：按这列着色（分类）

watch(
  () => props.result,
  () => {
    timeCol.value =
      cols.value.find((c) => /at$|_time$|date|time|created|updated/i.test(c)) ?? cols.value[0] ?? ''
    labelCol.value = cols.value.find((c) => /^(name|title|label|id|user|action)$/i.test(c)) ?? ''
    colorCol.value = ''
  },
  { immediate: true },
)

function toMs(v: unknown): number | null {
  if (v == null) return null
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') {
    // 启发式：> 1e12 视为 ms，否则视为 s
    return v > 1e12 ? v : v * 1000
  }
  const s = String(v)
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? null : ms
}

interface Pt {
  t: number
  row: Record<string, unknown>
  label: string
  color: string
}

const PALETTE = [
  '#7c6cff',
  '#4caf50',
  '#e0a020',
  '#e04050',
  '#3aa1ff',
  '#b48cff',
  '#67c23a',
  '#ff9966',
]
const colorMap = computed(() => {
  if (!colorCol.value) return new Map<string, string>()
  const vals = new Set<string>()
  for (const r of props.result.rows) vals.add(String(r[colorCol.value] ?? 'NULL'))
  const arr = [...vals]
  return new Map(arr.map((v, i) => [v, PALETTE[i % PALETTE.length]]))
})

const points = computed<Pt[]>(() => {
  const out: Pt[] = []
  const cm = colorMap.value
  for (const r of props.result.rows) {
    const ms = toMs(r[timeCol.value])
    if (ms == null) continue
    const colorKey = colorCol.value ? String(r[colorCol.value] ?? 'NULL') : ''
    out.push({
      t: ms,
      row: r,
      label: labelCol.value ? String(r[labelCol.value] ?? '') : '',
      color: cm.get(colorKey) ?? '#7c6cff',
    })
  }
  return out.sort((a, b) => a.t - b.t)
})

const W = 720
const H = 240
const PAD = { l: 24, r: 24, t: 30, b: 50 }

const range = computed(() => {
  if (!points.value.length) return { min: 0, max: 1 }
  const min = points.value[0].t
  const max = points.value[points.value.length - 1].t
  return min === max ? { min: min - 86400000, max: max + 86400000 } : { min, max }
})

function px(t: number): number {
  return PAD.l + ((t - range.value.min) / (range.value.max - range.value.min)) * (W - PAD.l - PAD.r)
}

// 等距 tick 5 段
const ticks = computed(() => {
  const arr: { x: number; label: string }[] = []
  for (let i = 0; i <= 5; i++) {
    const t = range.value.min + ((range.value.max - range.value.min) * i) / 5
    arr.push({ x: px(t), label: new Date(t).toLocaleDateString() })
  }
  return arr
})

const focused = ref<Pt | null>(null)
const legend = computed(() => [...colorMap.value.entries()])
</script>

<template>
  <Modal :title="t('timeline.title')" @close="emit('close')">
    <div class="tl">
      <div class="cfg">
        <label><span>time</span><select v-model="timeCol"><option v-for="c in cols" :key="c" :value="c">{{ c }}</option></select></label>
        <label><span>label</span><select v-model="labelCol"><option value="">—</option><option v-for="c in cols" :key="c" :value="c">{{ c }}</option></select></label>
        <label><span>color</span><select v-model="colorCol"><option value="">—</option><option v-for="c in cols" :key="c" :value="c">{{ c }}</option></select></label>
        <span class="muted">{{ t('timeline.events', { n: points.length }) }}</span>
      </div>

      <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" class="tl-svg">
        <rect :width="W" :height="H" fill="#1d1e22" />
        <line :x1="PAD.l" :x2="W - PAD.r" :y1="H / 2" :y2="H / 2" stroke="#5b5c63" stroke-width="1" />
        <g v-for="(tk, i) in ticks" :key="i">
          <line :x1="tk.x" :x2="tk.x" :y1="H / 2 - 5" :y2="H / 2 + 5" stroke="#9b9ca1" />
          <text :x="tk.x" :y="H - 10" text-anchor="middle" fill="#9b9ca1" font-size="10">{{ tk.label }}</text>
        </g>
        <circle
          v-for="(p, i) in points" :key="i"
          :cx="px(p.t)" :cy="H / 2 - (i % 2 === 0 ? 16 : -16)"
          r="4" :fill="p.color" opacity="0.8"
          @mouseenter="focused = p" @mouseleave="focused = null"
        >
          <title>{{ p.label || new Date(p.t).toLocaleString() }}</title>
        </circle>
      </svg>

      <div v-if="legend.length" class="legend">
        <span v-for="[k, c] in legend" :key="k">
          <span class="dot" :style="{ background: c }" />
          {{ k }}
        </span>
      </div>
      <div v-if="focused" class="focus">
        <span>{{ new Date(focused.t).toLocaleString() }}</span>
        <span v-if="focused.label">· {{ focused.label }}</span>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.tl { display: flex; flex-direction: column; gap: 8px; }
.cfg { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.cfg label { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; color: var(--muted); }
.cfg select { padding: 3px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; }
.muted { color: var(--muted); font-size: 11px; margin-left: auto; }
.tl-svg { display: block; border: 1px solid var(--border); border-radius: 6px; }
.legend { display: flex; gap: 12px; font-size: 11px; }
.legend span { display: inline-flex; align-items: center; gap: 4px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.focus { font-size: 11px; color: var(--text); padding: 4px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; }
</style>
