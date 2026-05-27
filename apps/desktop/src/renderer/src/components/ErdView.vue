<script setup lang="ts">
import type { DbDialect } from '@db-tool/shared-types'
import { computed, onMounted, reactive, ref } from 'vue'
import { type TableContext, quoteId } from '../ddl'
import { type ErdData, loadErd } from '../erd'

const props = defineProps<{ connId: string; dialect: DbDialect; ctx: TableContext }>()

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
    const d = await loadErd(props.connId, props.dialect, props.ctx)
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
    x: ((clientX - (r?.left ?? 0)) - pan.x) / zoom.value,
    y: ((clientY - (r?.top ?? 0)) - pan.y) / zoom.value,
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
  const move = (ev: MouseEvent): void => {
    pos[id] = {
      x: Math.max(0, ox + (ev.clientX - sx) / zoom.value),
      y: Math.max(0, oy + (ev.clientY - sy) / zoom.value),
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

const canvasSize = computed(() => {
  let w = 600
  let h = 400
  for (const p of Object.values(pos)) {
    w = Math.max(w, p.x + BOX_W + 60)
    h = Math.max(h, p.y + 360)
  }
  return { w, h }
})

// ── 编辑：新建表 / 列 ──
function addTable(): void {
  const id = `new:${++seq}`
  newTables.value.push({ id, name: `new_table_${seq}`, columns: [{ name: 'id', type: 'int', pk: true }] })
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
    : [...(data.value?.tables ?? []), ...newTables.value.map((t) => ({ name: t.name, columns: t.columns }))]
  for (const t of tables) {
    const lines = t.columns.map((c) => `  ${q(c.name)} ${c.type}`)
    const pks = t.columns.filter((c) => c.pk).map((c) => q(c.name))
    if (pks.length) lines.push(`  PRIMARY KEY (${pks.join(', ')})`)
    parts.push(`CREATE TABLE ${q(t.name)} (\n${lines.join(',\n')}\n);`)
  }
  const fks = onlyNew
    ? newFks.value.map((f) => ({ ft: nameOf(f.fromId), fc: f.fromCol, tt: nameOf(f.toId), tc: f.toCol }))
    : [
        ...(data.value?.fks ?? []).map((f) => ({ ft: f.fromTable, fc: f.fromCol, tt: f.toTable, tc: f.toCol })),
        ...newFks.value.map((f) => ({ ft: nameOf(f.fromId), fc: f.fromCol, tt: nameOf(f.toId), tc: f.toCol })),
      ]
  for (const f of fks) {
    parts.push(`ALTER TABLE ${q(f.ft)} ADD FOREIGN KEY (${q(f.fc)}) REFERENCES ${q(f.tt)} (${q(f.tc)});`)
  }
  return `${parts.join('\n\n')}\n`
}

async function generateDdl(): Promise<void> {
  if (!window.api.files) {
    window.alert('文件接口未就绪：请完整重启应用（preload 更新需重启，非热更新）。')
    return
  }
  try {
    await window.api.files.saveText({
      defaultName: `${props.ctx.schema || props.ctx.database || 'schema'}.sql`,
      content: buildDdl(false),
      filters: [{ name: 'SQL', extensions: ['sql'] }],
    })
  } catch (e) {
    window.alert(`生成 DDL 失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

const applying = ref(false)
async function applyChanges(): Promise<void> {
  if (!newTables.value.length && !newFks.value.length) {
    window.alert('没有新增的表或外键')
    return
  }
  const ddl = buildDdl(true)
  if (!window.confirm(`将对数据库执行以下 DDL：\n\n${ddl}`)) return
  applying.value = true
  try {
    const stmts = ddl.split(';\n').map((s) => s.trim()).filter(Boolean)
    await window.api.connections.executeBatch(props.connId, stmts, {
      database: props.ctx.database,
      schema: props.ctx.schema,
    })
    await load()
    editMode.value = false
  } catch (e) {
    window.alert(`应用失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <div class="erd">
    <div class="erd-head">
      <span class="title">ER 图 · {{ ctx.schema || ctx.database }}</span>
      <span v-if="data" class="sub">{{ boxes.length }} 表 · {{ edges.length }} 外键</span>
      <button class="ghost sm" title="缩小" @click="zoomBy(0.9)">－</button>
      <span class="zoom-pct">{{ Math.round(zoom * 100) }}%</span>
      <button class="ghost sm" title="放大" @click="zoomBy(1.1)">＋</button>
      <button class="ghost sm" title="重置视图" @click="resetView">1:1</button>
      <button class="ghost sm" title="刷新" @click="load">⟳</button>
      <button class="ghost sm" :class="{ on: editMode }" @click="editMode = !editMode">
        {{ editMode ? '✓ 编辑中' : '编辑' }}
      </button>
      <template v-if="editMode">
        <button class="ghost sm" @click="addTable">+ 表</button>
        <button class="ghost sm" :disabled="applying" @click="applyChanges">应用到库</button>
      </template>
      <button v-if="data?.tables.length || newTables.length" class="ghost sm" @click="generateDdl">生成 DDL</button>
      <span class="hint">{{ editMode ? '拖列圆点到目标列建外键 · 拖表框移动' : '滚轮缩放 · 拖表框移动 · 拖空白平移' }}</span>
    </div>

    <div v-if="loading" class="msg">加载中…</div>
    <div v-else-if="error" class="msg err">✗ {{ error }}</div>
    <div v-else-if="data && !data.supported" class="msg">当前方言暂不支持 ER 图（目前支持 MySQL / PostgreSQL 系）</div>

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
      <div
        class="canvas-inner"
        :style="{
          width: `${canvasSize.w}px`,
          height: `${canvasSize.h}px`,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }"
      >
        <svg class="edges" :width="canvasSize.w" :height="canvasSize.h">
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
              <button class="tx" title="删除表" @mousedown.stop @click="removeTable(b.id)">×</button>
            </template>
            <span v-else>{{ b.name }}</span>
          </div>
          <div class="tbox-cols">
            <div v-for="(c, ci) in b.columns" :key="ci" class="tcol" :data-box="b.id" :data-col="c.name">
              <template v-if="b.editable && editMode">
                <input v-model="c.name" class="ci ci-n" @mousedown.stop />
                <input v-model="c.type" class="ci ci-t" @mousedown.stop />
                <input v-model="c.pk" type="checkbox" title="主键" @mousedown.stop />
                <button class="tx" title="删除列" @mousedown.stop @click="removeColumn(newTables[newTables.findIndex((t) => t.id === b.id)], ci)">×</button>
              </template>
              <template v-else>
                <span class="cn" :class="{ pk: c.pk }">{{ c.pk ? '🔑 ' : '' }}{{ c.name }}</span>
                <span class="ct">{{ c.type }}</span>
              </template>
              <span
                v-if="editMode"
                class="port"
                title="拖到目标列建外键"
                @mousedown.stop.prevent="portDown(b.id, c.name, $event)"
              />
            </div>
            <div v-if="b.editable && editMode" class="add-col" @mousedown.stop @click="addColumn(newTables[newTables.findIndex((t) => t.id === b.id)])">
              + 列
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
}
.edges {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
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
