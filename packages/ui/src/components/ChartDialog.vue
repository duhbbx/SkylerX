<script setup lang="ts">
/**
 * 结果集图表化（#2）：选标签列 + 数值列 → 柱 / 折线 / 饼图。
 *
 * 没引 ECharts，自己手写 SVG（柱/折线 + 饼图各百来行），原因：
 *  - 桌面 app 体积敏感；图表只是 result grid 的"小工具"，不是主舞台
 *  - 三种图覆盖 90% 临时看数据的场景；要更花哨再升级 ECharts 不迟
 *  - SVG 渲染容易导出 PNG（toDataURL via <canvas>）
 *
 * 数据规则：
 *  - 标签列：任意；用 .toString() 拿 label
 *  - 数值列：Number(v)；NaN 跳过整行
 *  - 行数超过 50 → 默认只取前 50（柱图 / 饼图）；折线图取前 200
 */
import type { QueryResult } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { toast } from '../dialog'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ result: QueryResult }>()
const emit = defineEmits<{ close: [] }>()

type ChartKind = 'bar' | 'line' | 'pie'
const kind = ref<ChartKind>('bar')

// 数值列嗅探：第一行中能 Number() 出有限值的列优先选作 yCol
function isNumericColumn(col: string): boolean {
  for (const row of props.result.rows.slice(0, 20)) {
    const v = row[col]
    if (v == null) continue
    const n = Number(v)
    if (Number.isFinite(n)) return true
  }
  return false
}
const columns = computed(() => props.result.columns.map((c) => c.name))
const numericColumns = computed(() => columns.value.filter(isNumericColumn))

const labelCol = ref<string>(columns.value[0] ?? '')
const valueCol = ref<string>(numericColumns.value[0] ?? columns.value[1] ?? columns.value[0] ?? '')

// 切结果集时重置默认列选择
watch(
  () => props.result,
  () => {
    labelCol.value = columns.value[0] ?? ''
    valueCol.value = numericColumns.value[0] ?? columns.value[1] ?? columns.value[0] ?? ''
  },
)

interface Point {
  label: string
  value: number
}

const points = computed<Point[]>(() => {
  const lc = labelCol.value
  const vc = valueCol.value
  if (!lc || !vc) return []
  const out: Point[] = []
  const cap = kind.value === 'line' ? 200 : 50
  for (const row of props.result.rows) {
    if (out.length >= cap) break
    const n = Number(row[vc])
    if (!Number.isFinite(n)) continue
    out.push({ label: String(row[lc] ?? ''), value: n })
  }
  return out
})

// ── SVG 渲染参数 ──
const W = 720
const H = 360
const PAD = { l: 60, r: 20, t: 24, b: 60 }
const innerW = W - PAD.l - PAD.r
const innerH = H - PAD.t - PAD.b

const yMax = computed(() => {
  const m = points.value.reduce((a, p) => Math.max(a, p.value), 0)
  if (m === 0) return 1
  // 取一个稍稍 round 的上限
  const exp = Math.floor(Math.log10(m))
  const step = 10 ** exp
  return Math.ceil(m / step) * step
})
const yMin = computed(() => {
  const m = points.value.reduce((a, p) => Math.min(a, p.value), 0)
  return Math.min(0, m)
})

// ── 柱图 ──
interface BarRect {
  x: number
  y: number
  w: number
  h: number
  label: string
  value: number
}
const bars = computed<BarRect[]>(() => {
  const n = points.value.length
  if (!n) return []
  const slot = innerW / n
  const barW = Math.max(2, slot * 0.7)
  return points.value.map((p, i) => {
    const ratio = (p.value - yMin.value) / (yMax.value - yMin.value || 1)
    const h = innerH * ratio
    return {
      x: PAD.l + i * slot + (slot - barW) / 2,
      y: PAD.t + innerH - h,
      w: barW,
      h,
      label: p.label,
      value: p.value,
    }
  })
})

// ── 折线图 ──
const linePath = computed(() => {
  const n = points.value.length
  if (!n) return ''
  const slot = innerW / Math.max(1, n - 1)
  return points.value
    .map((p, i) => {
      const ratio = (p.value - yMin.value) / (yMax.value - yMin.value || 1)
      const x = PAD.l + i * slot
      const y = PAD.t + innerH - innerH * ratio
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})

// Y 轴刻度（4 段）
const yTicks = computed(() => {
  const steps = 4
  const arr: { y: number; label: string }[] = []
  for (let i = 0; i <= steps; i++) {
    const v = yMin.value + ((yMax.value - yMin.value) * i) / steps
    arr.push({
      y: PAD.t + innerH - (innerH * i) / steps,
      label: formatNum(v),
    })
  }
  return arr
})

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (abs >= 1e4) return (n / 1e3).toFixed(1) + 'k'
  if (abs >= 1 || n === 0) return Number.isInteger(n) ? String(n) : n.toFixed(2)
  return n.toPrecision(2)
}

// ── 饼图 ──
interface PieSlice {
  path: string
  color: string
  label: string
  value: number
  percent: number
  midAngle: number // for label
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
  '#ff7c8e',
  '#1ab3a7',
]
const pieSlices = computed<PieSlice[]>(() => {
  const total = points.value.reduce((a, p) => a + Math.max(0, p.value), 0)
  if (total <= 0) return []
  const cx = W / 2
  const cy = H / 2 + 10
  const r = Math.min(innerH / 2, 130)
  let start = -Math.PI / 2
  return points.value
    .filter((p) => p.value > 0)
    .map((p, i) => {
      const angle = (p.value / total) * Math.PI * 2
      const end = start + angle
      const x1 = cx + r * Math.cos(start)
      const y1 = cy + r * Math.sin(start)
      const x2 = cx + r * Math.cos(end)
      const y2 = cy + r * Math.sin(end)
      const largeArc = angle > Math.PI ? 1 : 0
      const path = `M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${largeArc} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`
      const mid = start + angle / 2
      start = end
      return {
        path,
        color: PALETTE[i % PALETTE.length],
        label: p.label,
        value: p.value,
        percent: p.value / total,
        midAngle: mid,
      }
    })
})

// ── 导出 PNG（SVG → 序列化 → Image → canvas → toDataURL） ──
const svgEl = ref<SVGSVGElement>()
async function exportPng(): Promise<void> {
  const svg = svgEl.value
  if (!svg) return
  try {
    const xml = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('image load failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = W * 2
    canvas.height = H * 2
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d ctx')
    ctx.fillStyle = '#1d1e22'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `chart-${kind.value}-${Date.now()}.png`
    a.click()
    toast.success(t('chart.exported'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <Modal :title="t('chart.title')" @close="emit('close')">
    <div class="chart-wrap">
      <div class="chart-toolbar">
        <div class="ctrl">
          <span class="lbl">{{ t('chart.label') }}</span>
          <select v-model="labelCol">
            <option v-for="c in columns" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="ctrl">
          <span class="lbl">{{ t('chart.value') }}</span>
          <select v-model="valueCol">
            <option v-for="c in columns" :key="c" :value="c">{{ c }}{{ numericColumns.includes(c) ? '' : ' (?)' }}</option>
          </select>
        </div>
        <div class="ctrl">
          <span class="lbl">{{ t('chart.kind') }}</span>
          <div class="kind-tabs">
            <button :class="{ on: kind === 'bar' }" @click="kind = 'bar'">📊 {{ t('chart.bar') }}</button>
            <button :class="{ on: kind === 'line' }" @click="kind = 'line'">📈 {{ t('chart.line') }}</button>
            <button :class="{ on: kind === 'pie' }" @click="kind = 'pie'">🥧 {{ t('chart.pie') }}</button>
          </div>
        </div>
        <span class="grow" />
        <button class="ghost sm" :disabled="!points.length" @click="exportPng">⬇ {{ t('chart.exportPng') }}</button>
      </div>

      <div v-if="!points.length" class="chart-empty">{{ t('chart.noData') }}</div>

      <svg
        v-else
        ref="svgEl"
        :viewBox="`0 0 ${W} ${H}`"
        :width="W"
        :height="H"
        class="chart-svg"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect :width="W" :height="H" fill="#1d1e22" />

        <!-- 柱图 + 折线 共用 Y 轴刻度 -->
        <template v-if="kind === 'bar' || kind === 'line'">
          <line
            v-for="(tk, i) in yTicks" :key="'g' + i"
            :x1="PAD.l" :x2="W - PAD.r" :y1="tk.y" :y2="tk.y"
            stroke="#3a3b41" stroke-dasharray="2 4"
          />
          <text
            v-for="(tk, i) in yTicks" :key="'yt' + i"
            :x="PAD.l - 8" :y="tk.y + 4" text-anchor="end" fill="#9b9ca1" font-size="10"
            font-family="ui-monospace, monospace"
          >{{ tk.label }}</text>
          <line :x1="PAD.l" :x2="PAD.l" :y1="PAD.t" :y2="PAD.t + innerH" stroke="#5b5c63" />
          <line :x1="PAD.l" :x2="W - PAD.r" :y1="PAD.t + innerH" :y2="PAD.t + innerH" stroke="#5b5c63" />
        </template>

        <!-- 柱 -->
        <template v-if="kind === 'bar'">
          <rect
            v-for="(b, i) in bars" :key="i"
            :x="b.x" :y="b.y" :width="b.w" :height="b.h"
            fill="#7c6cff" opacity="0.85"
          >
            <title>{{ b.label }}: {{ b.value }}</title>
          </rect>
          <text
            v-for="(b, i) in bars" :key="'l' + i"
            :x="b.x + b.w / 2" :y="H - PAD.b + 16" text-anchor="middle"
            fill="#cfd0d5" font-size="10"
          >{{ b.label.slice(0, 8) }}{{ b.label.length > 8 ? '…' : '' }}</text>
        </template>

        <!-- 折线 -->
        <template v-if="kind === 'line'">
          <path :d="linePath" stroke="#7c6cff" stroke-width="2" fill="none" />
          <circle
            v-for="(b, i) in bars" :key="'p' + i"
            :cx="b.x + b.w / 2" :cy="b.y" r="3" fill="#7c6cff"
          >
            <title>{{ b.label }}: {{ b.value }}</title>
          </circle>
        </template>

        <!-- 饼图 -->
        <template v-if="kind === 'pie'">
          <path
            v-for="(s, i) in pieSlices" :key="'s' + i"
            :d="s.path" :fill="s.color" stroke="#1d1e22" stroke-width="1"
          >
            <title>{{ s.label }}: {{ s.value }} ({{ (s.percent * 100).toFixed(1) }}%)</title>
          </path>
          <g v-for="(s, i) in pieSlices" :key="'pt' + i">
            <text
              v-if="s.percent >= 0.04"
              :x="W / 2 + 90 * Math.cos(s.midAngle)"
              :y="H / 2 + 10 + 90 * Math.sin(s.midAngle)"
              text-anchor="middle"
              fill="#fff" font-size="10"
              font-family="ui-monospace, monospace"
            >{{ (s.percent * 100).toFixed(0) }}%</text>
          </g>
          <!-- 图例 -->
          <g>
            <g v-for="(s, i) in pieSlices" :key="'lg' + i" :transform="`translate(20, ${24 + i * 18})`">
              <rect width="12" height="12" :fill="s.color" />
              <text x="18" y="10" fill="#cfd0d5" font-size="11">
                {{ s.label.slice(0, 18) }}{{ s.label.length > 18 ? '…' : '' }}
              </text>
            </g>
          </g>
        </template>
      </svg>

      <div class="chart-footer">
        <span class="muted">{{ t('chart.rowsHint', { n: points.length, total: result.rows.length }) }}</span>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.chart-wrap {
  min-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chart-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.ctrl { display: inline-flex; align-items: center; gap: 6px; }
.lbl { font-size: 12px; color: var(--muted); }
.ctrl select {
  padding: 3px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
  max-width: 140px;
}
.kind-tabs {
  display: inline-flex;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.kind-tabs button {
  padding: 3px 10px;
  font-size: 12px;
  background: transparent;
  border: none;
  border-right: 1px solid var(--border);
  color: var(--muted);
  cursor: pointer;
}
.kind-tabs button:last-child { border-right: none; }
.kind-tabs button.on { color: var(--accent); background: rgba(124, 108, 255, 0.14); }
.grow { flex: 1; }
.ghost.sm { padding: 4px 10px; font-size: 12px; }
.chart-empty { padding: 40px; text-align: center; color: var(--muted); }
.chart-svg {
  background: #1d1e22;
  border: 1px solid var(--border);
  border-radius: 6px;
  display: block;
  margin: 0 auto;
}
.chart-footer {
  font-size: 11px;
  color: var(--muted);
  text-align: right;
}
.muted { color: var(--muted); }
</style>
