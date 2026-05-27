<script setup lang="ts">
import type { DbDialect } from '@db-tool/shared-types'
import { computed, onMounted, reactive, ref } from 'vue'
import type { TableContext } from '../ddl'
import { type ErdData, loadErd } from '../erd'

const props = defineProps<{ connId: string; dialect: DbDialect; ctx: TableContext }>()

const BOX_W = 220
const data = ref<ErdData | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const pos = reactive<Record<string, { x: number; y: number }>>({})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const d = await loadErd(props.connId, props.dialect, props.ctx)
    data.value = d
    layout(d)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

/** 初始网格布局。 */
function layout(d: ErdData): void {
  for (const k of Object.keys(pos)) delete pos[k]
  const perRow = Math.max(1, Math.ceil(Math.sqrt(d.tables.length)))
  d.tables.forEach((t, i) => {
    pos[t.name] = { x: (i % perRow) * (BOX_W + 60) + 24, y: Math.floor(i / perRow) * 300 + 24 }
  })
}

onMounted(load)

// ── 拖拽 ──
function startDrag(name: string, e: MouseEvent): void {
  const p = pos[name]
  if (!p) return
  const sx = e.clientX
  const sy = e.clientY
  const ox = p.x
  const oy = p.y
  const onMove = (ev: MouseEvent): void => {
    pos[name] = { x: Math.max(0, ox + ev.clientX - sx), y: Math.max(0, oy + ev.clientY - sy) }
  }
  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// 锚点：框顶部中心偏下（表头），用于连线
function anchor(name: string): { x: number; y: number } | null {
  const p = pos[name]
  return p ? { x: p.x + BOX_W / 2, y: p.y + 16 } : null
}

const edges = computed(() => {
  if (!data.value) return []
  const out: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const fk of data.value.fks) {
    const a = anchor(fk.fromTable)
    const b = anchor(fk.toTable)
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
</script>

<template>
  <div class="erd">
    <div class="erd-head">
      <span class="title">ER 图 · {{ ctx.schema || ctx.database }}</span>
      <span v-if="data" class="sub">{{ data.tables.length }} 表 · {{ data.fks.length }} 外键</span>
      <button class="ghost" title="重新布局/刷新" @click="load">⟳</button>
      <span class="hint">拖拽表头可调整位置</span>
    </div>

    <div v-if="loading" class="msg">加载中…</div>
    <div v-else-if="error" class="msg err">✗ {{ error }}</div>
    <div v-else-if="data && !data.supported" class="msg">当前方言暂不支持 ER 图（目前支持 MySQL / PostgreSQL 系）</div>
    <div v-else-if="data && !data.tables.length" class="msg">该库/schema 下没有表</div>

    <div v-else-if="data" class="erd-canvas">
      <div class="canvas-inner" :style="{ width: `${canvasSize.w}px`, height: `${canvasSize.h}px` }">
        <svg class="edges" :width="canvasSize.w" :height="canvasSize.h">
          <line
            v-for="(e, i) in edges"
            :key="i"
            :x1="e.x1"
            :y1="e.y1"
            :x2="e.x2"
            :y2="e.y2"
            class="edge"
          />
        </svg>
        <div
          v-for="t in data.tables"
          :key="t.name"
          class="tbox"
          :style="{ left: `${pos[t.name]?.x ?? 0}px`, top: `${pos[t.name]?.y ?? 0}px`, width: `${BOX_W}px` }"
        >
          <div class="tbox-head" @mousedown.prevent="startDrag(t.name, $event)">{{ t.name }}</div>
          <div class="tbox-cols">
            <div v-for="c in t.columns" :key="c.name" class="tcol">
              <span class="cn" :class="{ pk: c.pk }">{{ c.pk ? '🔑 ' : '' }}{{ c.name }}</span>
              <span class="ct">{{ c.type }}</span>
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
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.erd-head .title {
  font-weight: 600;
}
.erd-head .sub {
  font-size: 12px;
  color: var(--muted);
}
.erd-head .hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
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
  overflow: auto;
  background:
    linear-gradient(var(--border) 1px, transparent 1px) 0 0 / 24px 24px,
    linear-gradient(90deg, var(--border) 1px, transparent 1px) 0 0 / 24px 24px;
  background-color: var(--bg);
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
.tbox {
  position: absolute;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.tbox-head {
  padding: 6px 10px;
  font-weight: 600;
  font-size: 13px;
  background: var(--accent);
  color: #fff;
  cursor: grab;
  user-select: none;
}
.tbox-head:active {
  cursor: grabbing;
}
.tbox-cols {
  max-height: 240px;
  overflow-y: auto;
}
.tcol {
  display: flex;
  justify-content: space-between;
  gap: 10px;
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
</style>
