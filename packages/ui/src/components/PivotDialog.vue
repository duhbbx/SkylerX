<script setup lang="ts">
/**
 * 数据透视表（A4）：在内存里对当前结果集做 pivot，不重跑 SQL。
 *
 * 用户三轴：rowFields（行分组）/ colField（列展开）/ valueField + agg（聚合）。
 * 算法：先把行按 (rowFields...) 分组 → 每组里再按 colField 分桶 → 桶内做 agg。
 *
 * 不支持：多 value field、有序列名（pivot 列按字典序）、过滤；这些可以下一版补。
 */
import type { QueryResult } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ result: QueryResult }>()
const emit = defineEmits<{ close: [] }>()

type Agg = 'count' | 'sum' | 'avg' | 'min' | 'max'
const cols = computed(() => props.result.columns.map((c) => c.name))

const rowFields = ref<string[]>([])
const colField = ref<string>('')
const valueField = ref<string>('')
const agg = ref<Agg>('count')

watch(
  () => props.result,
  () => {
    rowFields.value = cols.value[0] ? [cols.value[0]] : []
    colField.value = cols.value[1] ?? ''
    valueField.value = cols.value[2] ?? cols.value[0] ?? ''
  },
  { immediate: true },
)

function toggleRowField(name: string): void {
  const i = rowFields.value.indexOf(name)
  if (i >= 0) rowFields.value.splice(i, 1)
  else rowFields.value.push(name)
}

function aggregate(values: number[]): number {
  if (!values.length) return 0
  if (agg.value === 'count') return values.length
  if (agg.value === 'sum') return values.reduce((s, v) => s + v, 0)
  if (agg.value === 'avg') return values.reduce((s, v) => s + v, 0) / values.length
  if (agg.value === 'min') return Math.min(...values)
  return Math.max(...values)
}

const pivot = computed(() => {
  // colValue → 列；rowKey → 行；用 Map<rowKey, Map<colVal, agg>> 表示
  const rowMap = new Map<string, Map<string, number[]>>()
  const colVals = new Set<string>()
  for (const row of props.result.rows) {
    const rowKey = rowFields.value.map((f) => String(row[f] ?? 'NULL')).join('|')
    const colKey = colField.value ? String(row[colField.value] ?? 'NULL') : '*'
    colVals.add(colKey)
    if (!rowMap.has(rowKey)) rowMap.set(rowKey, new Map())
    const cell = rowMap.get(rowKey)!
    if (!cell.has(colKey)) cell.set(colKey, [])
    const v = valueField.value ? Number(row[valueField.value]) : 1
    if (Number.isFinite(v) || agg.value === 'count')
      cell.get(colKey)!.push(Number.isFinite(v) ? v : 0)
  }
  const colArr = [...colVals].sort()
  const rows = [...rowMap.entries()].map(([k, cells]) => {
    const rowVals: Record<string, number> = {}
    for (const c of colArr) rowVals[c] = aggregate(cells.get(c) ?? [])
    return { key: k, vals: rowVals }
  })
  return { columns: colArr, rows }
})

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return ''
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
</script>

<template>
  <Modal :title="t('pivot.title')" @close="emit('close')">
    <div class="piv">
      <div class="cfg">
        <div class="cfg-block">
          <span class="lbl">{{ t('pivot.rows') }}</span>
          <div class="chips">
            <button
              v-for="c in cols" :key="c"
              :class="{ on: rowFields.includes(c) }"
              @click="toggleRowField(c)"
            >{{ c }}</button>
          </div>
        </div>
        <div class="cfg-block">
          <span class="lbl">{{ t('pivot.col') }}</span>
          <select v-model="colField">
            <option value="">—</option>
            <option v-for="c in cols" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="cfg-block">
          <span class="lbl">{{ t('pivot.value') }}</span>
          <select v-model="valueField">
            <option v-for="c in cols" :key="c" :value="c">{{ c }}</option>
          </select>
          <select v-model="agg">
            <option value="count">COUNT</option>
            <option value="sum">SUM</option>
            <option value="avg">AVG</option>
            <option value="min">MIN</option>
            <option value="max">MAX</option>
          </select>
        </div>
      </div>

      <div class="tbl-wrap">
        <table class="piv-tbl">
          <thead>
            <tr>
              <th>{{ rowFields.join(' / ') || '—' }}</th>
              <th v-for="c in pivot.columns" :key="c">{{ c }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pivot.rows" :key="r.key">
              <td class="row-key">{{ r.key }}</td>
              <td v-for="c in pivot.columns" :key="c">{{ fmtNum(r.vals[c]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.piv { min-width: 760px; min-height: 480px; max-height: 75vh; display: flex; flex-direction: column; gap: 10px; }
.cfg { display: flex; gap: 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.cfg-block { display: flex; align-items: center; gap: 6px; }
.lbl { font-size: 12px; color: var(--muted); }
.chips { display: flex; gap: 4px; flex-wrap: wrap; }
.chips button {
  padding: 3px 10px; font-size: 11px;
  background: transparent; border: 1px solid var(--border); border-radius: 12px;
  color: var(--text); cursor: pointer;
}
.chips button.on { background: var(--accent, #7c6cff); color: #fff; border-color: var(--accent, #7c6cff); }
.cfg select {
  padding: 3px 8px; font-size: 12px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text);
}
.tbl-wrap { flex: 1; overflow: auto; }
.piv-tbl { border-collapse: collapse; font-size: 12px; font-family: ui-monospace, monospace; }
.piv-tbl th, .piv-tbl td { border: 1px solid var(--border); padding: 4px 10px; text-align: right; }
.piv-tbl th { background: var(--panel); font-weight: 600; position: sticky; top: 0; }
.piv-tbl td.row-key { text-align: left; font-weight: 600; background: var(--bg); }
</style>
