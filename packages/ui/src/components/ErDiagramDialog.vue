<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * ER 关系图:选连接 + schema → 读结构 → 画「表 + 外键」有向图(子表 → 父表)。
 * 节点大小按列数,主键表高亮;模型在 ../er/model(已单测),本组件只渲染 echarts。
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { type ErModel, erModel, focusModel } from '../er/model'
import { reportError } from '../errorReporter'
import { locale } from '../i18n'
import { canIntrospect, readSchema } from '../migrate/introspect'
import { saveFileWithDialog } from '../saveFile'
import Modal from './Modal.vue'

echarts.use([GraphChart, TooltipComponent, CanvasRenderer, SVGRenderer])

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()
const L = (zh: string, en: string): string => (locale.value === 'en' ? en : zh)

const conns = ref<ConnectionConfig[]>([])
const connId = ref('')
const schemaName = ref('')
const loading = ref(false)
const model = ref<ErModel | null>(null) // 完整模型
const focus = ref('') // 聚焦表名(子串)
const shown = ref<ErModel | null>(null) // 实际渲染的(可能是聚焦子集)
const chartEl = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null
let lastOption: unknown = null // 最近一次的 echarts option,导出时复用

const dialectOf = (): ConnectionConfig['dialect'] | undefined =>
  conns.value.find((c) => c.id === connId.value)?.dialect

async function render(): Promise<void> {
  const dialect = dialectOf()
  if (!connId.value || !schemaName.value || !dialect) return
  if (!canIntrospect(dialect)) {
    toast.info(L('该方言暂不支持读结构', 'introspection not supported for this dialect'))
    return
  }
  loading.value = true
  try {
    const exec = (sql: string): Promise<Array<Record<string, unknown>>> =>
      client.connections.execute(connId.value, sql).then((r) => r.rows)
    const si = await readSchema(exec, dialect, schemaName.value)
    const m = erModel(si)
    model.value = m
    if (!m.nodes.length) {
      toast.info(L('该 schema 没有表', 'no tables in this schema'))
      return
    }
    await nextTick()
    if (chartEl.value && !chart) chart = echarts.init(chartEl.value)
    applyFocus()
  } catch (e) {
    reportError(e, { tag: 'er.render' })
  } finally {
    loading.value = false
  }
}

/** 按 focus 过滤完整模型并重绘(focus 空 = 全部)。 */
function applyFocus(): void {
  if (!model.value) return
  shown.value = focusModel(model.value, focus.value, 1)
  draw(shown.value)
}

function draw(m: ErModel): void {
  if (!chart) return
  const option = {
    tooltip: {},
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        label: { show: true, fontSize: 11, position: 'right' },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 9,
        force: { repulsion: 260, edgeLength: 150, gravity: 0.04 },
        lineStyle: { color: '#bbb', curveness: 0.12 },
        emphasis: { focus: 'adjacency' },
        data: m.nodes.map((n) => ({
          name: n.id,
          symbolSize: Math.min(56, 18 + n.columns * 2.5),
          itemStyle: { color: n.pk.length ? '#2d7ff9' : '#9aa7b5' },
          tooltip: {
            formatter: `<b>${n.id}</b>${n.comment ? ` — ${n.comment}` : ''}<br/>${n.columns} ${L('列', 'cols')}${n.pk.length ? `<br/>PK: ${n.pk.join(', ')}` : ''}`,
          },
        })),
        links: m.edges.map((e) => ({
          source: e.from,
          target: e.to,
          tooltip: { formatter: `${e.from} → ${e.to}<br/>FK: ${e.columns.join(', ')}` },
        })),
      },
    ],
  }
  lastOption = option
  chart.setOption(option, { notMerge: true })
  chart.resize()
}

/** dataURL → 字节数组(保存 PNG 用)。 */
function dataUrlToBytes(url: string): Uint8Array {
  const bin = atob(url.split(',')[1] ?? '')
  const a = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i)
  return a
}

async function exportPng(): Promise<void> {
  if (!chart) return
  try {
    const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
    await saveFileWithDialog({
      defaultName: `er-${schemaName.value || 'schema'}-${Date.now()}.png`,
      content: dataUrlToBytes(url),
      filters: [{ name: 'PNG', extensions: ['png'] }],
    })
    toast.success(L('已导出 PNG', 'Exported PNG'))
  } catch (e) {
    reportError(e, { tag: 'er.exportPng' })
  }
}

async function exportSvg(): Promise<void> {
  if (!lastOption || !chartEl.value) return
  // ER 主图用 canvas 渲染;SVG 导出另起一个临时 svg-renderer 图渲一遍同样的 option。
  const tmp = document.createElement('div')
  tmp.style.cssText = `position:fixed;left:-99999px;width:${chartEl.value.clientWidth || 900}px;height:${chartEl.value.clientHeight || 460}px`
  document.body.appendChild(tmp)
  const t = echarts.init(tmp, undefined, { renderer: 'svg' })
  try {
    t.setOption(lastOption as Parameters<typeof t.setOption>[0])
    const svg = t.renderToSVGString()
    await saveFileWithDialog({
      defaultName: `er-${schemaName.value || 'schema'}-${Date.now()}.svg`,
      content: svg,
      filters: [{ name: 'SVG', extensions: ['svg'] }],
    })
    toast.success(L('已导出 SVG', 'Exported SVG'))
  } catch (e) {
    reportError(e, { tag: 'er.exportSvg' })
  } finally {
    t.dispose()
    tmp.remove()
  }
}

function onResize(): void {
  chart?.resize()
}

onMounted(async () => {
  window.addEventListener('resize', onResize)
  try {
    conns.value = (await client.connections.list()).filter((c) => canIntrospect(c.dialect))
  } catch {
    /* ignore */
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <Modal v-if="open" :title="L('ER 关系图', 'ER diagram')" width="wide" @close="emit('close')">
    <div class="er">
      <div class="bar">
        <select v-model="connId">
          <option value="">{{ L('选连接', 'connection') }}</option>
          <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} ({{ c.dialect }})</option>
        </select>
        <input v-model="schemaName" :placeholder="L('schema(如 public / HR / dbo)', 'schema')" style="width: 160px" @keyup.enter="render" />
        <button class="primary" :disabled="loading || !connId || !schemaName" @click="render">
          {{ loading ? '…' : L('生成 ER 图', 'Generate') }}
        </button>
        <input v-if="model" v-model="focus" :placeholder="L('聚焦表名(+邻居)', 'focus table (+neighbors)')" style="width: 150px" @input="applyFocus" />
        <span v-if="shown" class="note">{{ shown.nodes.length }}<template v-if="model && shown.nodes.length !== model.nodes.length">/{{ model.nodes.length }}</template> {{ L('表', 'tables') }} · {{ shown.edges.length }} {{ L('外键', 'FKs') }}<template v-if="shown.externalRefs"> · {{ shown.externalRefs }} {{ L('隐藏关联', 'hidden links') }}</template></span>
        <span class="legend"><i class="dot" style="background:#2d7ff9" />{{ L('有主键', 'has PK') }}</span>
        <span class="legend"><i class="dot" style="background:#9aa7b5" />{{ L('无主键', 'no PK') }}</span>
        <span v-if="model" class="exports">
          <button class="ghost" @click="exportPng">{{ L('导出 PNG', 'PNG') }}</button>
          <button class="ghost" @click="exportSvg">{{ L('导出 SVG', 'SVG') }}</button>
        </span>
      </div>
      <p v-if="!model" class="note hint">{{ L('选连接 + schema → 生成。子表 → 父表的箭头即外键;可拖拽/缩放。', 'Pick a connection + schema. Arrows go child → parent (FK); drag and zoom freely.') }}</p>
      <div ref="chartEl" class="graph"></div>
    </div>
  </Modal>
</template>

<style scoped>
.er { display: flex; flex-direction: column; gap: 10px; min-width: 760px; }
.bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.note { font-size: 12px; color: var(--fg-muted, #888); }
.hint { background: var(--bg-subtle, #f7f7f7); padding: 8px 10px; border-radius: 6px; }
.legend { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.graph { width: 100%; height: 460px; }
.primary { background: var(--accent, #2d7ff9); color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
.primary:disabled { opacity: .5; }
.exports { display: inline-flex; gap: 6px; margin-left: auto; }
.ghost { background: transparent; border: 1px solid var(--border, #ddd); padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
</style>
