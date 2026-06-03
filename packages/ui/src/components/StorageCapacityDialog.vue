<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 存储容量趋势 + 预测
 *
 * 定期对当前连接库「拍快照」(总大小,存 localStorage)→ 画增长曲线 →
 * 线性回归预测 7/30/90 天后的大小,以及到容量阈值还有多少天。
 * 逻辑全在 ../capacity/*(已单测 + 活库验证)。
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { LineChart } from 'echarts/charts'
import { GridComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { project } from '../capacity/project'
import type { SizeSnapshot } from '../capacity/project'
import { canMeasureSize, dbSizeQuery, parseSize } from '../capacity/sizeQuery'
import { addSnapshot, clearSnapshots, loadSnapshots } from '../capacity/store'
import { useDataClient } from '../data-client'
import { formatBytes } from '../ddl'
import { toast } from '../dialog'
import { reportError } from '../errorReporter'
import { locale } from '../i18n'
import Modal from './Modal.vue'

echarts.use([LineChart, GridComponent, TitleComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{ conn: ConnectionConfig; open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()
const L = (zh: string, en: string): string => (locale.value === 'en' ? en : zh)

const snapshots = ref<SizeSnapshot[]>(loadSnapshots(props.conn.id))
const taking = ref(false)
const thresholdGb = ref<number | null>(null)
const measurable = canMeasureSize(props.conn.dialect)

const thresholdBytes = computed(() =>
  thresholdGb.value && thresholdGb.value > 0 ? thresholdGb.value * 1024 ** 3 : undefined,
)
const proj = computed(() =>
  project(snapshots.value, { thresholdBytes: thresholdBytes.value, nowMs: Date.now() }),
)
const latest = computed(() => snapshots.value.at(-1)?.bytes ?? 0)
const fmtDay = (d: number | undefined): string =>
  d == null ? '—' : d <= 0 ? L('已超阈值', 'over') : `${Math.round(d)} ${L('天', 'd')}`

async function takeSnapshot(): Promise<void> {
  if (!measurable) return
  taking.value = true
  try {
    const r = await client.connections.execute(props.conn.id, dbSizeQuery(props.conn.dialect))
    const bytes = parseSize(r.rows[0])
    snapshots.value = addSnapshot(props.conn.id, { at: Date.now(), bytes })
    toast.success(L('已记录快照', 'Snapshot recorded'))
    render()
  } catch (e) {
    reportError(e, { tag: 'capacity.snapshot' })
  } finally {
    taking.value = false
  }
}

function clearAll(): void {
  clearSnapshots(props.conn.id)
  snapshots.value = []
  render()
}

// ── ECharts ─────────────────────────────────────────────────────
const chartEl = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null
const DAY = 86_400_000

function buildOption(): echarts.EChartsCoreOption {
  const hist = snapshots.value.map((s) => [s.at, s.bytes] as [number, number])
  const series: Array<Record<string, unknown>> = [
    { name: L('实测', 'actual'), type: 'line', showSymbol: true, data: hist },
  ]
  const p = proj.value
  if (p && snapshots.value.length >= 2) {
    const last = snapshots.value.at(-1)?.at ?? Date.now()
    series.push({
      name: L('预测', 'projection'),
      type: 'line',
      lineStyle: { type: 'dashed' },
      showSymbol: false,
      data: [
        [last, p.current],
        [last + 90 * DAY, p.in90d],
      ],
    })
  }
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 64, right: 16, top: 24, bottom: 28 },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatBytes(v) } },
    series,
  } as echarts.EChartsCoreOption
}
function render(): void {
  if (chart) chart.setOption(buildOption(), { notMerge: true })
}
function onResize(): void {
  chart?.resize()
}
watch(
  () => props.open,
  async (o) => {
    if (o) {
      snapshots.value = loadSnapshots(props.conn.id)
      await nextTick()
      if (chartEl.value && !chart) {
        chart = echarts.init(chartEl.value)
        window.addEventListener('resize', onResize)
      }
      render()
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <Modal v-if="open" :title="`${L('存储容量趋势', 'Storage capacity trend')} · ${conn.name}`" width="wide" @close="emit('close')">
    <div class="cap">
      <div class="bar">
        <button class="primary" :disabled="taking || !measurable" @click="takeSnapshot">
          {{ taking ? '…' : L('拍快照(记录当前大小)', 'Take snapshot') }}
        </button>
        <span class="cur">{{ L('当前', 'current') }}: <b>{{ formatBytes(latest) }}</b></span>
        <label class="th">{{ L('容量阈值', 'threshold') }}
          <input type="number" v-model.number="thresholdGb" min="0" step="1" style="width: 80px" /> GB
        </label>
        <button v-if="snapshots.length" @click="clearAll">{{ L('清空', 'Clear') }}</button>
        <span v-if="!measurable" class="note">{{ L('该方言不支持容量统计', 'capacity not supported for this dialect') }}</span>
      </div>

      <p v-if="snapshots.length < 2" class="note hint">
        {{ L('需要至少 2 个不同时间的快照才能预测——每天/每周回来拍一次,曲线和预测就出来了。',
              'Needs at least 2 snapshots at different times — come back and take one daily/weekly to build the trend.') }}
      </p>

      <div v-if="proj && snapshots.length >= 2" class="proj">
        <span class="card">{{ L('增长', 'growth') }}: <b>{{ formatBytes(Math.abs(proj.perDayBytes)) }}/{{ L('天', 'd') }}</b>{{ proj.perDayBytes < 0 ? ' ↓' : ' ↑' }}</span>
        <span class="card">+7d: <b>{{ formatBytes(proj.in7d) }}</b></span>
        <span class="card">+30d: <b>{{ formatBytes(proj.in30d) }}</b></span>
        <span class="card">+90d: <b>{{ formatBytes(proj.in90d) }}</b></span>
        <span v-if="thresholdBytes" class="card eta">{{ L('到阈值', 'to threshold') }}: <b>{{ fmtDay(proj.etaDays) }}</b></span>
      </div>

      <div ref="chartEl" class="chart"></div>

      <table v-if="snapshots.length" class="tbl">
        <thead><tr><th>{{ L('时间', 'Time') }}</th><th>{{ L('大小', 'Size') }}</th></tr></thead>
        <tbody>
          <tr v-for="(s, i) in [...snapshots].reverse().slice(0, 30)" :key="i">
            <td>{{ new Date(s.at).toLocaleString() }}</td>
            <td>{{ formatBytes(s.bytes) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </Modal>
</template>

<style scoped>
.cap { display: flex; flex-direction: column; gap: 12px; min-width: 640px; }
.bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.cur b { color: var(--accent, #2d7ff9); }
.th { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.note { font-size: 12px; color: var(--fg-muted, #888); }
.hint { background: var(--bg-subtle, #f7f7f7); padding: 8px 10px; border-radius: 6px; }
.proj { display: flex; gap: 10px; flex-wrap: wrap; }
.card { font-size: 13px; background: var(--bg-subtle, #f3f3f3); padding: 4px 10px; border-radius: 6px; }
.card.eta b { color: #c0392b; }
.chart { width: 100%; height: 280px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th, .tbl td { border: 1px solid var(--border, #e8e8e8); padding: 4px 8px; text-align: left; }
.primary { background: var(--accent, #2d7ff9); color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
.primary:disabled { opacity: .5; cursor: default; }
</style>
