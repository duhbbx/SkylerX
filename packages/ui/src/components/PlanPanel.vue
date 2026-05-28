<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../i18n'
import { type PlanNode, estimateSkew, flattenPlan } from '../plan'

const props = defineProps<{ tree: PlanNode | null; text: string | null }>()

const rows = computed(() => (props.tree ? flattenPlan(props.tree) : []))
const maxCost = computed(() => rows.value.reduce((m, r) => Math.max(m, r.node.cost), 0) || 1)
// 顶部摘要：总成本 / 总实际耗时（若有 ANALYZE）/ 最重节点
const summary = computed(() => {
  const arr = rows.value
  if (!arr.length) return null
  let heaviest = arr[0]
  for (const r of arr) if (r.node.cost > heaviest.node.cost) heaviest = r
  const hasActual = arr.some((r) => r.node.actualMs != null)
  const totalActual = hasActual ? arr.reduce((s, r) => s + (r.node.actualMs ?? 0), 0) : null
  // 找估算偏差最大的节点（>10x = 优化器统计过时的强信号）
  let skewWorst: { node: PlanNode; depth: number; skew: number } | null = null
  for (const r of arr) {
    const sk = estimateSkew(r.node)
    if (sk == null) continue
    if (!skewWorst || sk > skewWorst.skew) {
      skewWorst = { node: r.node, depth: r.depth, skew: sk }
    }
  }
  return { heaviest, totalActual, totalCost: heaviest.node.cost, skewWorst }
})

function fmtSkew(sk: number): string {
  if (!Number.isFinite(sk)) return '∞'
  if (sk >= 100) return `${Math.round(sk)}×`
  return `${sk.toFixed(1)}×`
}
function isSlow(node: PlanNode): boolean {
  // 把"最贵的 1 / 3"标红，让眼睛立刻看到要优化哪里
  return node.cost >= maxCost.value * 0.33 && maxCost.value > 0
}
function isSkewed(node: PlanNode): boolean {
  const sk = estimateSkew(node)
  return sk != null && sk >= 10
}
</script>

<template>
  <div class="plan">
    <div v-if="tree" class="plan-tree">
      <!-- 摘要条：总成本 / 实际耗时 / 估算偏差最严重的点 -->
      <div v-if="summary" class="plan-summary">
        <div class="sum-item">
          <span class="sum-lbl">{{ t('plan.totalCost') }}</span>
          <b>{{ summary.totalCost.toFixed(0) }}</b>
        </div>
        <div v-if="summary.totalActual != null" class="sum-item">
          <span class="sum-lbl">{{ t('plan.actualMs') }}</span>
          <b>{{ summary.totalActual.toFixed(1) }} ms</b>
        </div>
        <div class="sum-item">
          <span class="sum-lbl">{{ t('plan.heaviest') }}</span>
          <b>{{ summary.heaviest.node.label }}</b>
        </div>
        <div v-if="summary.skewWorst" class="sum-item warn" :title="t('plan.skewHelp')">
          <span class="sum-lbl">{{ t('plan.skew') }}</span>
          <b>{{ fmtSkew(summary.skewWorst.skew) }}</b>
          <span class="sum-sub">{{ summary.skewWorst.node.label }}</span>
        </div>
      </div>

      <div class="plan-head">{{ t('plan.head') }}</div>
      <div
        v-for="(r, i) in rows"
        :key="i"
        class="pnode"
        :class="{ slow: isSlow(r.node), skewed: isSkewed(r.node) }"
        :style="{ paddingLeft: `${12 + r.depth * 18}px` }"
      >
        <span class="bar" :style="{ width: `${Math.round((r.node.cost / maxCost) * 60)}px` }" />
        <span class="plabel">{{ r.node.label }}</span>
        <span v-if="r.node.detail" class="pdetail">{{ r.node.detail }}</span>
        <span class="pcost">
          cost {{ r.node.cost.toFixed(2) }} · est {{ r.node.rows }}
          <template v-if="r.node.actualRows != null"> · act {{ r.node.actualRows }}</template>
          <template v-if="r.node.actualMs != null"> · {{ r.node.actualMs.toFixed(1) }}ms</template>
          <span v-if="isSkewed(r.node)" class="skew-tag" :title="t('plan.skewHelp')">
            ⚠ {{ fmtSkew(estimateSkew(r.node) ?? 0) }}
          </span>
        </span>
      </div>
    </div>
    <pre v-else-if="text" class="plan-text">{{ text }}</pre>
    <div v-else class="plan-empty">{{ t('plan.empty') }}</div>
  </div>
</template>

<style scoped>
.plan {
  height: 100%;
  overflow: auto;
}
.plan-summary {
  display: flex;
  gap: 14px;
  padding: 8px 12px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  flex-wrap: wrap;
}
.sum-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sum-item.warn b { color: #e0a020; }
.sum-lbl { color: var(--muted); }
.sum-sub { color: var(--muted); font-size: 11px; }
.plan-head {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}
.pnode {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.pnode.slow { background: rgba(224, 64, 80, 0.06); }
.pnode.skewed { box-shadow: inset 3px 0 0 #e0a020; }
.bar {
  flex: none;
  height: 8px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--ok), var(--err));
  min-width: 2px;
}
.plabel {
  font-weight: 600;
  font-family: ui-monospace, monospace;
}
.pnode.slow .plabel { color: var(--err, #e04050); }
.pdetail {
  color: var(--muted);
}
.pcost {
  margin-left: auto;
  color: var(--muted);
  white-space: nowrap;
}
.skew-tag {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 3px;
  background: rgba(224, 160, 32, 0.16);
  color: #e0a020;
  font-weight: 600;
}
.plan-text {
  margin: 0;
  padding: 12px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre;
  overflow: auto;
}
.plan-empty {
  padding: 16px;
  color: var(--muted);
}
</style>
