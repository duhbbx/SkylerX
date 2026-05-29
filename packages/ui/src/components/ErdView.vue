<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DbDialect } from '@db-tool/shared-types'
import { computed, onMounted, reactive, ref } from 'vue'
import { useDataClient } from '../data-client'
import { type TableContext, quoteId } from '../ddl'
import { alert as appAlert, confirm as appConfirm, toast } from '../dialog'
import { type ErdData, loadErd } from '../erd'
import { t } from '../i18n'

const props = defineProps<{ connId: string; dialect: DbDialect; ctx: TableContext }>()
const client = useDataClient()

const BOX_W = 220

interface EditCol {
  name: string
  type: string
  pk: boolean
}
interface NewTable {
  id: string
  name: string
  columns: EditCol[]
}
interface NewFk {
  fromId: string
  fromCol: string
  toId: string
  toCol: string
}

const data = ref<ErdData | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const pos = reactive<Record<string, { x: number; y: number }>>({})

const editMode = ref(false)
const newTables = ref<NewTable[]>([])
const newFks = ref<NewFk[]>([])
let seq = 0

// 统一的「框」视图：既有表（只读）+ 新建表（可编辑）
interface Box {
  id: string
  name: string
  editable: boolean
  columns: EditCol[]
}
const boxes = computed<Box[]>(() => {
  const existing: Box[] = (data.value?.tables ?? []).map((t) => ({
    id: t.name,
    name: t.name,
    editable: false,
    columns: t.columns,
  }))
  const created: Box[] = newTables.value.map((t) => ({
    id: t.id,
    name: t.name,
    editable: true,
    columns: t.columns,
  }))
  return [...existing, ...created]
})

// 缩放 / 平移
const zoom = ref(1)
const pan = reactive({ x: 16, y: 16 })
const canvasEl = ref<HTMLDivElement | null>(null)
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const d = await loadErd(client, props.connId, props.dialect, props.ctx)
    data.value = d
    newTables.value = []
    newFks.value = []
    layout(d)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function layout(d: ErdData): void {
  for (const k of Object.keys(pos)) delete pos[k]
  const perRow = Math.max(1, Math.ceil(Math.sqrt(d.tables.length)))
  d.tables.forEach((t, i) => {
    pos[t.name] = { x: (i % perRow) * (BOX_W + 60) + 24, y: Math.floor(i / perRow) * 300 + 24 }
  })
}
onMounted(load)

// 视图坐标 → 模型坐标
function toModel(clientX: number, clientY: number): { x: number; y: number } {
  const r = canvasEl.value?.getBoundingClientRect()
  return {
    x: (clientX - (r?.left ?? 0) - pan.x) / zoom.value,
    y: (clientY - (r?.top ?? 0) - pan.y) / zoom.value,
  }
}

function onWheel(e: WheelEvent): void {
  const nz = clamp(zoom.value * (e.deltaY < 0 ? 1.1 : 0.9), 0.2, 3)
  const r = canvasEl.value?.getBoundingClientRect()
  const cx = e.clientX - (r?.left ?? 0)
  const cy = e.clientY - (r?.top ?? 0)
  pan.x = cx - ((cx - pan.x) / zoom.value) * nz
  pan.y = cy - ((cy - pan.y) / zoom.value) * nz
  zoom.value = nz
}
function zoomBy(f: number): void {
  zoom.value = clamp(zoom.value * f, 0.2, 3)
}
function resetView(): void {
  zoom.value = 1
  pan.x = 16
  pan.y = 16
}

function panStart(e: MouseEvent): void {
  if ((e.target as HTMLElement).closest('.tbox')) return
  const sx = e.clientX
  const sy = e.clientY
  const ox = pan.x
  const oy = pan.y
  const move = (ev: MouseEvent): void => {
    pan.x = ox + (ev.clientX - sx)
    pan.y = oy + (ev.clientY - sy)
  }
  const up = (): void => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}

function startDrag(id: string, e: MouseEvent): void {
  const p = pos[id]
  if (!p) return
  const sx = e.clientX
  const sy = e.clientY
  const ox = p.x
  const oy = p.y
  // 不再用 Math.max(0, …) 钳制坐标 —— 那会导致节点只能往右下拖、无法往左上回拖。
  // 画布支持负坐标（pan 平移可显示左/上区域）；越界由 pan + zoom 处理。
  const move = (ev: MouseEvent): void => {
    pos[id] = {
      x: ox + (ev.clientX - sx) / zoom.value,
      y: oy + (ev.clientY - sy) / zoom.value,
    }
  }
  const up = (): void => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}

function anchor(id: string): { x: number; y: number } | null {
  const p = pos[id]
  return p ? { x: p.x + BOX_W / 2, y: p.y + 16 } : null
}

const edges = computed(() => {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = []
  const all = [
    ...(data.value?.fks ?? []).map((f) => ({ from: f.fromTable, to: f.toTable })),
    ...newFks.value.map((f) => ({ from: f.fromId, to: f.toId })),
  ]
  for (const e of all) {
    const a = anchor(e.from)
    const b = anchor(e.to)
    if (a && b) out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }
  return out
})

/**
 * 画布尺寸:同时跟踪左/上的负坐标(节点拖出初始区域到负向时)和右/下的正坐标。
 * - SVG.edges 用这个尺寸 + viewBox(offX, offY, w, h),让从负坐标到正向的连线不被 viewBox 裁
 * - canvas-inner 容器同样按这个尺寸+偏移,避免连线被父容器边界遮住
 */
const canvasSize = computed(() => {
  let minX = 0
  let minY = 0
  let maxX = 600
  let maxY = 400
  for (const p of Object.values(pos)) {
    minX = Math.min(minX, p.x - 60)
    minY = Math.min(minY, p.y - 60)
    maxX = Math.max(maxX, p.x + BOX_W + 60)
    maxY = Math.max(maxY, p.y + 360)
  }
  return { w: maxX - minX, h: maxY - minY, offX: minX, offY: minY }
})

// ── 编辑：新建表 / 列 ──
function addTable(): void {
  const id = `new:${++seq}`
  newTables.value.push({
    id,
    name: `new_table_${seq}`,
    columns: [{ name: 'id', type: 'int', pk: true }],
  })
  const c = toModel((canvasEl.value?.clientWidth ?? 400) / 2, 80)
  pos[id] = { x: c.x, y: c.y }
}
function addColumn(t: NewTable): void {
  t.columns.push({ name: 'col', type: 'varchar(255)', pk: false })
}
function removeColumn(t: NewTable, i: number): void {
  t.columns.splice(i, 1)
}
function removeTable(id: string): void {
  newTables.value = newTables.value.filter((t) => t.id !== id)
  newFks.value = newFks.value.filter((f) => f.fromId !== id && f.toId !== id)
  delete pos[id]
}

// ── 拖拽建外键 ──
const fkDrag = ref<{ fromId: string; fromCol: string; x: number; y: number } | null>(null)
function portDown(boxId: string, col: string, e: MouseEvent): void {
  const m = toModel(e.clientX, e.clientY)
  fkDrag.value = { fromId: boxId, fromCol: col, x: m.x, y: m.y }
  const move = (ev: MouseEvent): void => {
    const mm = toModel(ev.clientX, ev.clientY)
    if (fkDrag.value) fkDrag.value = { ...fkDrag.value, x: mm.x, y: mm.y }
  }
  const up = (ev: MouseEvent): void => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
    const tgt = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest(
      '[data-col]',
    ) as HTMLElement | null
    const cur = fkDrag.value
    fkDrag.value = null
    if (!cur || !tgt) return
    const toId = tgt.getAttribute('data-box') ?? ''
    const toCol = tgt.getAttribute('data-col') ?? ''
    if (toId && toCol && toId !== cur.fromId) {
      newFks.value.push({ fromId: cur.fromId, fromCol: cur.fromCol, toId, toCol })
    }
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}
const fkDragLine = computed(() => {
  if (!fkDrag.value) return null
  const a = anchor(fkDrag.value.fromId)
  return a ? { x1: a.x, y1: a.y, x2: fkDrag.value.x, y2: fkDrag.value.y } : null
})

function nameOf(id: string): string {
  return boxes.value.find((b) => b.id === id)?.name ?? id
}

// ── 生成 DDL（整库：既有 + 新建）──
function buildDdl(onlyNew: boolean): string {
  const q = (s: string): string => quoteId(props.dialect, s)
  const parts: string[] = []
  const tables = onlyNew
    ? newTables.value.map((t) => ({ name: t.name, columns: t.columns }))
    : [
        ...(data.value?.tables ?? []),
        ...newTables.value.map((t) => ({ name: t.name, columns: t.columns })),
      ]
  for (const t of tables) {
    const lines = t.columns.map((c) => `  ${q(c.name)} ${c.type}`)
    const pks = t.columns.filter((c) => c.pk).map((c) => q(c.name))
    if (pks.length) lines.push(`  PRIMARY KEY (${pks.join(', ')})`)
    parts.push(`CREATE TABLE ${q(t.name)} (\n${lines.join(',\n')}\n);`)
  }
  const fks = onlyNew
    ? newFks.value.map((f) => ({
        ft: nameOf(f.fromId),
        fc: f.fromCol,
        tt: nameOf(f.toId),
        tc: f.toCol,
      }))
    : [
        ...(data.value?.fks ?? []).map((f) => ({
          ft: f.fromTable,
          fc: f.fromCol,
          tt: f.toTable,
          tc: f.toCol,
        })),
        ...newFks.value.map((f) => ({
          ft: nameOf(f.fromId),
          fc: f.fromCol,
          tt: nameOf(f.toId),
          tc: f.toCol,
        })),
      ]
  for (const f of fks) {
    parts.push(
      `ALTER TABLE ${q(f.ft)} ADD FOREIGN KEY (${q(f.fc)}) REFERENCES ${q(f.tt)} (${q(f.tc)});`,
    )
  }
  return `${parts.join('\n\n')}\n`
}

async function generateDdl(): Promise<void> {
  if (!client.files) {
    await appAlert({ message: t('erd.fileNotReady'), variant: 'warn' })
    return
  }
  try {
    await client.files.saveText({
      defaultName: `${props.ctx.schema || props.ctx.database || 'schema'}.sql`,
      content: buildDdl(false),
      filters: [{ name: 'SQL', extensions: ['sql'] }],
    })
  } catch (e) {
    toast.error(t('erd.ddlFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

const applying = ref(false)
async function applyChanges(): Promise<void> {
  if (!newTables.value.length && !newFks.value.length) {
    await appAlert({ message: t('erd.noNew'), variant: 'info' })
    return
  }
  const ddl = buildDdl(true)
  if (
    !(await appConfirm({
      title: t('erd.applyTitle'),
      message: t('erd.applyConfirm', { ddl }),
      variant: 'warn',
    }))
  )
    return
  applying.value = true
  try {
    const stmts = ddl
      .split(';\n')
      .map((s) => s.trim())
      .filter(Boolean)
    await client.connections.executeBatch(props.connId, stmts, {
      database: props.ctx.database,
      schema: props.ctx.schema,
    })
    await load()
    editMode.value = false
  } catch (e) {
    await appAlert({
      title: t('erd.applyFailTitle'),
      message: t('erd.applyFail', { msg: e instanceof Error ? e.message : String(e) }),
      variant: 'danger',
    })
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <div class="erd">
    <div class="erd-head">
      <span class="title">{{ t('erd.title', { name: ctx.schema || ctx.database || '' }) }}</span>
      <span v-if="data" class="sub">{{ t('erd.stats', { tables: boxes.length, edges: edges.length }) }}</span>
      <button class="ghost sm" :title="t('erd.zoomOut')" @click="zoomBy(0.9)">－</button>
      <span class="zoom-pct">{{ Math.round(zoom * 100) }}%</span>
      <button class="ghost sm" :title="t('erd.zoomIn')" @click="zoomBy(1.1)">＋</button>
      <button class="ghost sm" :title="t('erd.reset')" @click="resetView">1:1</button>
      <button class="ghost sm" :title="t('common.refresh')" @click="load">⟳</button>
      <button class="ghost sm" :class="{ on: editMode }" @click="editMode = !editMode">
        {{ editMode ? t('erd.editing') : t('erd.edit') }}
      </button>
      <template v-if="editMode">
        <button class="ghost sm" @click="addTable">{{ t('erd.addTable') }}</button>
        <button class="ghost sm" :disabled="applying" @click="applyChanges">{{ t('erd.applyToDb') }}</button>
      </template>
      <button v-if="data?.tables.length || newTables.length" class="ghost sm" @click="generateDdl">{{ t('erd.genDdl') }}</button>
      <span class="hint">{{ editMode ? t('erd.hintEdit') : t('erd.hintView') }}</span>
    </div>

    <div v-if="loading" class="msg">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="msg err">✗ {{ error }}</div>
    <div v-else-if="data && !data.supported" class="msg">{{ t('erd.unsupported') }}</div>

    <div
      v-else-if="data"
      ref="canvasEl"
      class="erd-canvas"
      :style="{
        backgroundSize: `${24 * zoom}px ${24 * zoom}px, ${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px`,
      }"
      @wheel.prevent="onWheel"
      @mousedown="panStart"
    >
      <!--
        canvas-inner 是节点 + 连线共享的逻辑坐标空间;
        ▸ width/height 取的是 canvasSize.maxX/maxY,负坐标的节点 absolute 出 (0,0) 时不需要扩 canvas-inner 自身
        ▸ canvas-inner 必须 overflow:visible(默认就是,但显式声明),不裁负方向的卡片
        ▸ SVG 加 overflow=visible 让 line 超出 width/height 也能显示,避免 viewBox 切线
      -->
      <div
        class="canvas-inner"
        :style="{
          width: `${canvasSize.w}px`,
          height: `${canvasSize.h}px`,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }"
      >
        <svg class="edges" :width="canvasSize.w" :height="canvasSize.h" overflow="visible">
          <line v-for="(e, i) in edges" :key="i" :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2" class="edge" />
          <line
            v-if="fkDragLine"
            :x1="fkDragLine.x1"
            :y1="fkDragLine.y1"
            :x2="fkDragLine.x2"
            :y2="fkDragLine.y2"
            class="edge dragging"
          />
        </svg>

        <div
          v-for="b in boxes"
          :key="b.id"
          class="tbox"
          :class="{ 'is-new': b.editable }"
          :style="{ left: `${pos[b.id]?.x ?? 0}px`, top: `${pos[b.id]?.y ?? 0}px`, width: `${BOX_W}px` }"
          @mousedown.prevent="startDrag(b.id, $event)"
        >
          <div class="tbox-head">
            <template v-if="b.editable && editMode">
              <input
                v-model="newTables[newTables.findIndex((t) => t.id === b.id)].name"
                class="tname-input"
                @mousedown.stop
              />
              <button class="tx" :title="t('erd.delTable')" @mousedown.stop @click="removeTable(b.id)">×</button>
            </template>
            <span v-else>{{ b.name }}</span>
          </div>
          <div class="tbox-cols">
            <div v-for="(c, ci) in b.columns" :key="ci" class="tcol" :data-box="b.id" :data-col="c.name">
              <template v-if="b.editable && editMode">
                <input v-model="c.name" class="ci ci-n" @mousedown.stop />
                <input v-model="c.type" class="ci ci-t" @mousedown.stop />
                <input v-model="c.pk" type="checkbox" :title="t('designer.pk')" @mousedown.stop />
                <button class="tx" :title="t('erd.delCol')" @mousedown.stop @click="removeColumn(newTables[newTables.findIndex((t) => t.id === b.id)], ci)">×</button>
              </template>
              <template v-else>
                <span class="cn" :class="{ pk: c.pk }">{{ c.pk ? '🔑 ' : '' }}{{ c.name }}</span>
                <span class="ct">{{ c.type }}</span>
              </template>
              <span
                v-if="editMode"
                class="port"
                :title="t('erd.fkDrag')"
                @mousedown.stop.prevent="portDown(b.id, c.name, $event)"
              />
            </div>
            <div v-if="b.editable && editMode" class="add-col" @mousedown.stop @click="addColumn(newTables[newTables.findIndex((t) => t.id === b.id)])">
              {{ t('erd.addCol') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.erd {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}
.erd-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-wrap: wrap;
}
.erd-head .title {
  font-weight: 600;
}
.erd-head .sub {
  font-size: 12px;
  color: var(--muted);
}
.erd-head .ghost.sm {
  padding: 3px 9px;
  font-size: 12px;
}
.erd-head .ghost.sm.on {
  border-color: var(--accent);
  color: var(--accent);
}
.erd-head .hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}
.zoom-pct {
  font-size: 12px;
  color: var(--muted);
  min-width: 40px;
  text-align: center;
}
.msg {
  padding: 20px;
  color: var(--muted);
}
.msg.err {
  color: var(--err);
  white-space: pre-wrap;
}
.erd-canvas {
  flex: 1;
  overflow: hidden;
  background-color: var(--bg);
  /* 无限网格：铺满视口，位置/尺寸随 pan/zoom 由内联样式驱动 */
  background-image:
    linear-gradient(var(--border) 1px, transparent 1px),
    linear-gradient(90deg, var(--border) 1px, transparent 1px);
  cursor: grab;
}
.erd-canvas:active {
  cursor: grabbing;
}
.canvas-inner {
  position: relative;
  /* 拖到负方向(左/上)的卡片必须能溢出可见;edges SVG 也靠这层不被裁 */
  overflow: visible;
}
.edges {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  /* SVG 默认 viewport 裁切自身宽高外的内容,这里关掉,保证负坐标 line 也能画 */
  overflow: visible;
}
.edge {
  stroke: var(--accent);
  stroke-width: 1.5;
  opacity: 0.7;
}
.edge.dragging {
  stroke-dasharray: 4 3;
}
.tbox {
  position: absolute;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  cursor: move;
}
.tbox.is-new {
  border-color: var(--accent);
}
.tbox-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  font-weight: 600;
  font-size: 13px;
  background: var(--accent);
  color: #fff;
  cursor: move;
  user-select: none;
}
.tname-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.2);
  border: none;
  border-radius: 4px;
  color: #fff;
  padding: 2px 6px;
  font-size: 13px;
}
.tbox-cols {
  max-height: 260px;
  overflow-y: auto;
}
.tcol {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 10px;
  font-size: 12px;
  border-top: 1px solid var(--border);
}
.tcol .cn {
  font-family: ui-monospace, monospace;
}
.tcol .cn.pk {
  font-weight: 600;
}
.tcol .ct {
  color: var(--muted);
  white-space: nowrap;
}
.tcol .ci {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  padding: 2px 5px;
  font-size: 12px;
}
.tcol .ci-n {
  width: 80px;
}
.tcol .ci-t {
  width: 80px;
}
.port {
  position: absolute;
  right: -4px;
  top: 50%;
  width: 9px;
  height: 9px;
  margin-top: -4px;
  border-radius: 50%;
  background: var(--accent);
  cursor: crosshair;
}
.add-col {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--accent);
  cursor: pointer;
  border-top: 1px dashed var(--border);
}
.add-col:hover {
  background: var(--bg);
}
.tx {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  opacity: 0.7;
}
.tx:hover {
  opacity: 1;
}
</style>
