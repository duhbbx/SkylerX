<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * SQL 血缘图(表级)
 *
 * 粘 SQL → 解析出「源表 → 目标」的有向图,跨语句自动串联(一条的目标是下一条的源)。
 * 解析在 ../lineage/parse(已单测);本组件只渲染 echarts 有向图。
 * 与 LineageDialog(按列查历史用法)不同:这个是把一段 SQL/ETL 画成血缘图。
 */
import { GraphChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { locale } from '../i18n'
import { lineageGraph } from '../lineage/parse'
import Modal from './Modal.vue'

echarts.use([GraphChart, TooltipComponent, CanvasRenderer])

const props = defineProps<{ open: boolean; initialSql?: string }>()
const emit = defineEmits<{ close: [] }>()
const L = (zh: string, en: string): string => (locale.value === 'en' ? en : zh)

const sql = ref(
  props.initialSql ||
    'INSERT INTO mart.daily\nSELECT * FROM stg.orders o JOIN dim.cust c ON o.cid = c.id;',
)
const stats = ref({ nodes: 0, edges: 0 })

const chartEl = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null
const COLOR = { table: '#2d7ff9', cte: '#999', result: '#1e7e34' } as const

function analyze(): void {
  const statements = sql.value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  const g = lineageGraph(statements)
  stats.value = { nodes: g.nodes.length, edges: g.edges.length }
  if (!chart) return
  chart.setOption(
    {
      tooltip: {},
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          label: { show: true, fontSize: 11 },
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: 8,
          force: { repulsion: 220, edgeLength: 130, gravity: 0.05 },
          lineStyle: { color: '#bbb', curveness: 0.1 },
          data: g.nodes.map((n) => ({
            name: n.id,
            symbolSize: n.kind === 'result' ? 22 : 34,
            itemStyle: { color: COLOR[n.kind] },
          })),
          links: g.edges.map((e) => ({ source: e.from, target: e.to })),
        },
      ],
    },
    { notMerge: true },
  )
}

function onResize(): void {
  chart?.resize()
}
watch(
  () => props.open,
  async (o) => {
    if (o) {
      await nextTick()
      if (chartEl.value && !chart) {
        chart = echarts.init(chartEl.value)
        window.addEventListener('resize', onResize)
      }
      analyze()
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
  <Modal v-if="open" :title="L('SQL 血缘图(表级)', 'SQL lineage (table-level)')" width="wide" @close="emit('close')">
    <div class="lin">
      <textarea v-model="sql" rows="4" class="ta" :placeholder="L('粘 SQL(可多条,用 ; 分隔)', 'paste SQL (multiple, separated by ;)')"></textarea>
      <div class="bar">
        <button class="primary" @click="analyze">{{ L('分析血缘', 'Analyze') }}</button>
        <span class="note">{{ stats.nodes }} {{ L('节点', 'nodes') }} · {{ stats.edges }} {{ L('边', 'edges') }}</span>
        <span class="legend"><i class="dot" style="background:#2d7ff9" />{{ L('表', 'table') }}</span>
        <span class="legend"><i class="dot" style="background:#999" />CTE</span>
        <span class="legend"><i class="dot" style="background:#1e7e34" />{{ L('结果', 'result') }}</span>
        <span class="note">{{ L('表级血缘,正则启发;列级需真 parser,本版未做', 'table-level (heuristic); column-level not in this version') }}</span>
      </div>
      <div ref="chartEl" class="graph"></div>
    </div>
  </Modal>
</template>

<style scoped>
.lin { display: flex; flex-direction: column; gap: 10px; min-width: 720px; }
.ta { width: 100%; font-family: monospace; font-size: 12px; }
.bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.note { font-size: 12px; color: var(--fg-muted, #888); }
.legend { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.graph { width: 100%; height: 420px; }
.primary { background: var(--accent, #2d7ff9); color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
</style>
