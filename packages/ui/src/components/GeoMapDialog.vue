<script setup lang="ts">
/**
 * 地理数据查看器（A6）：SVG 散点图渲染 lat/lng 列；不引 leaflet，保持轻量。
 *
 * 智能默认：扫列名找 lat / lng / latitude / longitude / geo / location；找不到让用户手动选。
 * 投影：等距等距投影（Mercator 视觉变形小，本地数据用经纬度直绘也够看，不做复杂坐标系）。
 *
 * 没做：底图（不引 tiles）、聚类（点太多会糊但可拖拽 zoom 解）；这些下一版补。
 */
import type { QueryResult } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ result: QueryResult }>()
const emit = defineEmits<{ close: [] }>()

const cols = computed(() => props.result.columns.map((c) => c.name))
const latCol = ref<string>('')
const lngCol = ref<string>('')
const labelCol = ref<string>('')

watch(
  () => props.result,
  () => {
    latCol.value = cols.value.find((c) => /^(lat|latitude|y)$/i.test(c)) ?? cols.value[0] ?? ''
    lngCol.value =
      cols.value.find((c) => /^(lng|lon|long|longitude|x)$/i.test(c)) ?? cols.value[1] ?? ''
    labelCol.value = cols.value.find((c) => /^(name|title|label|id)$/i.test(c)) ?? ''
  },
  { immediate: true },
)

interface Pt {
  x: number
  y: number
  raw: Record<string, unknown>
  label: string
}

const W = 720
const H = 420
const PAD = 30

const points = computed<Pt[]>(() => {
  const out: Pt[] = []
  for (const r of props.result.rows) {
    const lat = Number(r[latCol.value])
    const lng = Number(r[lngCol.value])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
    out.push({
      x: lng,
      y: lat,
      raw: r,
      label: labelCol.value ? String(r[labelCol.value] ?? '') : '',
    })
  }
  return out
})

const bounds = computed(() => {
  if (!points.value.length) return { minX: -180, maxX: 180, minY: -90, maxY: 90 }
  let minX = Number.POSITIVE_INFINITY,
    maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY,
    maxY = Number.NEGATIVE_INFINITY
  for (const p of points.value) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  // 留 5% 边距，避免点贴边
  const dx = Math.max(0.001, (maxX - minX) * 0.05)
  const dy = Math.max(0.001, (maxY - minY) * 0.05)
  return { minX: minX - dx, maxX: maxX + dx, minY: minY - dy, maxY: maxY + dy }
})

function project(p: Pt): { sx: number; sy: number } {
  const { minX, maxX, minY, maxY } = bounds.value
  const sx = PAD + ((p.x - minX) / (maxX - minX)) * (W - 2 * PAD)
  const sy = H - PAD - ((p.y - minY) / (maxY - minY)) * (H - 2 * PAD)
  return { sx, sy }
}

const projected = computed(() => points.value.map((p) => ({ ...p, ...project(p) })))
const focused = ref<Pt | null>(null)
</script>

<template>
  <Modal :title="t('geo.title')" @close="emit('close')">
    <div class="geo">
      <div class="cfg">
        <label><span>lat</span><select v-model="latCol"><option v-for="c in cols" :key="c" :value="c">{{ c }}</option></select></label>
        <label><span>lng</span><select v-model="lngCol"><option v-for="c in cols" :key="c" :value="c">{{ c }}</option></select></label>
        <label><span>label</span><select v-model="labelCol"><option value="">—</option><option v-for="c in cols" :key="c" :value="c">{{ c }}</option></select></label>
        <span class="muted">{{ t('geo.points', { n: points.length }) }}</span>
      </div>
      <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" class="map-svg">
        <rect :width="W" :height="H" fill="#1d1e22" />
        <line :x1="PAD" :x2="W - PAD" :y1="H - PAD" :y2="H - PAD" stroke="#5b5c63" />
        <line :x1="PAD" :x2="PAD" :y1="PAD" :y2="H - PAD" stroke="#5b5c63" />
        <text :x="PAD" :y="H - 8" fill="#9b9ca1" font-size="9">{{ bounds.minX.toFixed(3) }}</text>
        <text :x="W - PAD - 40" :y="H - 8" fill="#9b9ca1" font-size="9">{{ bounds.maxX.toFixed(3) }}</text>
        <text :x="4" :y="H - PAD" fill="#9b9ca1" font-size="9">{{ bounds.minY.toFixed(3) }}</text>
        <text :x="4" :y="PAD + 8" fill="#9b9ca1" font-size="9">{{ bounds.maxY.toFixed(3) }}</text>
        <circle
          v-for="(p, i) in projected" :key="i"
          :cx="p.sx" :cy="p.sy" r="4"
          fill="#7c6cff" opacity="0.7"
          @mouseenter="focused = p"
          @mouseleave="focused = null"
        >
          <title>{{ p.label || `(${p.y.toFixed(4)}, ${p.x.toFixed(4)})` }}</title>
        </circle>
      </svg>
      <div v-if="focused" class="focus">
        <span>{{ focused.label || '—' }}</span>
        <span class="muted">lat={{ focused.y.toFixed(5) }} lng={{ focused.x.toFixed(5) }}</span>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.geo { display: flex; flex-direction: column; gap: 8px; }
.cfg { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.cfg label { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; color: var(--muted); }
.cfg select { padding: 3px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; }
.muted { color: var(--muted); font-size: 11px; margin-left: auto; }
.map-svg { display: block; border: 1px solid var(--border); border-radius: 6px; }
.focus { display: flex; gap: 12px; padding: 4px 8px; font-size: 11px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; }
</style>
