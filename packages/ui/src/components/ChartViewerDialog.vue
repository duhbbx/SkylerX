<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * #B Result-set 图表 viewer (ECharts).
 *
 * 输入 = QueryResult 的 rows + columns; 用户挑 X 列 + 一个或多个 Y 列 + 图表类型,
 * 实时渲染. 没有持久状态 — 关掉就丢, 重开重选 (跟 SQL 编辑器的草稿语义一致).
 *
 * 支持图表:
 *   - 折线 line     (X = 时间/有序 X, Y = 数值)
 *   - 柱状 bar      (X = 类别, Y = 数值)
 *   - 饼图 pie      (X = 类别, Y = 数值, 仅取第一个 Y 列)
 *   - 散点 scatter  (X 数值, Y 数值)
 *
 * 数据类型推断:
 *   - 数字列: 适合 Y
 *   - 字符串/时间列: 适合 X
 *   - 自动给 X 选择第一个非数字列, Y 选择所有数字列, 让 80% 场景下"开了就有图".
 *
 * 性能: ECharts 自带的 dataset + tooltip + zoom 够用; 数据量大 (>10000 行) 时
 * 退化为 sampling, 暂用 head-N (N=5000), 后续可加均匀采样.
 */
import type { QueryResult } from '@db-tool/shared-types'
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import {
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Modal from './Modal.vue'

// tree-shaking 注册 — 只装我们需要的, 减小最终包
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
])

type ChartKind = 'line' | 'bar' | 'pie' | 'scatter'

const props = defineProps<{ result: QueryResult | null }>()
const emit = defineEmits<{ close: [] }>()

const ROW_CAP = 5000 // ECharts 超过 1w 行会卡, 5k 行手感稳

const chartType = ref<ChartKind>('line')
const xField = ref<string>('')
const yFields = ref<string[]>([])

const chartEl = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

const columns = computed(() => props.result?.columns ?? [])
const truncated = computed(() => (props.result?.rows?.length ?? 0) > ROW_CAP)
const dataset = computed(() => {
  const rows = props.result?.rows ?? []
  return rows.length > ROW_CAP ? rows.slice(0, ROW_CAP) : rows
})

/** 列是否数字 — 看前 10 行采样, 全 number(或可解析数字) 就当数值列. */
function isNumericCol(name: string): boolean {
  const sample = dataset.value.slice(0, 10)
  if (sample.length === 0) return false
  return sample.every((r) => {
    const v = r[name]
    if (v == null || v === '') return true // null 不否决, 全 null 在后续过滤
    if (typeof v === 'number') return Number.isFinite(v)
    if (typeof v === 'string') return !Number.isNaN(Number(v))
    return false
  })
}
const numericCols = computed(() => columns.value.filter((c) => isNumericCol(c.name)))
const nonNumericCols = computed(() => columns.value.filter((c) => !isNumericCol(c.name)))

// 默认选列: X = 第一个非数字列 (没有就用第一个数字列), Y = 所有数字列
watch(
  columns,
  (cols) => {
    if (cols.length === 0) return
    if (!xField.value) {
      xField.value = nonNumericCols.value[0]?.name ?? cols[0].name
    }
    if (yFields.value.length === 0) {
      yFields.value = numericCols.value.map((c) => c.name)
    }
  },
  { immediate: true },
)

function buildOption(): echarts.EChartsCoreOption {
  const rows = dataset.value
  const xs = rows.map((r) => r[xField.value])
  const series = yFields.value.map((y) => {
    const data = rows.map((r) => {
      const v = r[y]
      if (typeof v === 'number') return v
      if (typeof v === 'string') {
        const n = Number(v)
        return Number.isNaN(n) ? null : n
      }
      return null
    })
    return { name: y, type: chartType.value, data, smooth: chartType.value === 'line' }
  })

  if (chartType.value === 'pie') {
    const firstY = yFields.value[0] ?? ''
    const pieData = rows.map((r) => {
      const v = r[firstY]
      const num = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) || 0 : 0
      return { name: String(r[xField.value] ?? ''), value: num }
    })
    return {
      tooltip: { trigger: 'item' },
      legend: { type: 'scroll', top: 0 },
      series: [
        {
          name: firstY,
          type: 'pie',
          radius: ['30%', '65%'],
          center: ['50%', '55%'],
          data: pieData,
          label: { formatter: '{b}: {d}%' },
        },
      ],
    }
  }

  if (chartType.value === 'scatter') {
    // scatter 取首两 Y (或 X 数字 + Y 数字)
    return {
      tooltip: { trigger: 'item' },
      legend: { type: 'scroll', top: 0 },
      xAxis: { type: 'value', name: xField.value },
      yAxis: { type: 'value' },
      grid: { top: 36, left: 50, right: 20, bottom: 50 },
      dataZoom: [{ type: 'inside' }, { type: 'slider' }],
      series: yFields.value.map((y) => ({
        name: y,
        type: 'scatter',
        data: rows.map((r) => [Number(r[xField.value]) || 0, Number(r[y]) || 0]),
      })),
    }
  }

  return {
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', top: 0 },
    xAxis: {
      type: 'category',
      data: xs.map((x) => String(x ?? '')),
      axisLabel: { interval: 0, rotate: xs.length > 12 ? 30 : 0 },
    },
    yAxis: { type: 'value' },
    grid: { top: 36, left: 50, right: 20, bottom: 60 },
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
    series,
  }
}

function render(): void {
  if (!chart) return
  if (yFields.value.length === 0 || !xField.value) {
    chart.clear()
    return
  }
  chart.setOption(buildOption(), { notMerge: true })
}

watch([chartType, xField, yFields, dataset], () => render(), { deep: true })

function onResize(): void {
  chart?.resize()
}

onMounted(async () => {
  await nextTick()
  if (chartEl.value) {
    chart = echarts.init(chartEl.value)
    render()
    window.addEventListener('resize', onResize)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
})

function toggleY(name: string): void {
  const i = yFields.value.indexOf(name)
  if (i >= 0) yFields.value = yFields.value.filter((_, j) => j !== i)
  else yFields.value = [...yFields.value, name]
}
</script>

<template>
  <Modal
    title="结果集图表"
    width="xl"
    fixed-height
    storage-key="chart-viewer"
    @close="emit('close')"
  >
    <div class="layout">
      <div class="controls">
        <label class="row">
          <span class="lbl">类型</span>
          <select v-model="chartType" class="ctl">
            <option value="line">📈 折线</option>
            <option value="bar">📊 柱状</option>
            <option value="pie">🥧 饼</option>
            <option value="scatter">⋯ 散点</option>
          </select>
        </label>
        <label class="row">
          <span class="lbl">X 轴</span>
          <select v-model="xField" class="ctl">
            <option v-for="c in columns" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
        </label>
        <div class="row">
          <span class="lbl">{{ chartType === 'pie' ? '值列(取第一个)' : 'Y 轴 / 系列' }}</span>
        </div>
        <div class="ys">
          <label v-for="c in columns" :key="c.name" class="y-row">
            <input
              type="checkbox"
              :checked="yFields.includes(c.name)"
              @change="toggleY(c.name)"
            />
            <span class="y-name">{{ c.name }}</span>
            <span v-if="!isNumericCol(c.name)" class="y-warn" title="该列非数值, 系列可能为空">?</span>
          </label>
        </div>
        <div v-if="truncated" class="hint">
          数据 {{ result?.rows?.length ?? 0 }} 行 · 图表只渲染前 {{ ROW_CAP }} 行
        </div>
      </div>
      <div ref="chartEl" class="chart"></div>
    </div>

    <template #footer>
      <button class="ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.layout {
  display: flex;
  gap: 12px;
  height: 100%;
  min-height: 0;
}
.controls {
  width: 240px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.row .lbl {
  color: var(--muted);
  min-width: 60px;
}
.ctl {
  flex: 1;
  padding: 4px 8px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
}
.ys {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  max-height: 320px;
  overflow-y: auto;
}
.y-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 2px 0;
  cursor: pointer;
}
.y-row:hover {
  background: rgba(124, 108, 255, 0.06);
}
.y-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.y-warn {
  color: var(--muted);
  font-size: 10px;
  font-style: italic;
}
.hint {
  font-size: 11px;
  color: var(--muted);
  padding-top: 4px;
}
.chart {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
}
button.ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 5px 14px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
button.ghost:hover {
  background: rgba(124, 108, 255, 0.08);
}
</style>
