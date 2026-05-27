<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../i18n'
import { type PlanNode, flattenPlan } from '../plan'

const props = defineProps<{ tree: PlanNode | null; text: string | null }>()

const rows = computed(() => (props.tree ? flattenPlan(props.tree) : []))
const maxCost = computed(() => rows.value.reduce((m, r) => Math.max(m, r.node.cost), 0) || 1)
</script>

<template>
  <div class="plan">
    <div v-if="tree" class="plan-tree">
      <div class="plan-head">{{ t('plan.head') }}</div>
      <div
        v-for="(r, i) in rows"
        :key="i"
        class="pnode"
        :style="{ paddingLeft: `${12 + r.depth * 18}px` }"
      >
        <span class="bar" :style="{ width: `${Math.round((r.node.cost / maxCost) * 60)}px` }" />
        <span class="plabel">{{ r.node.label }}</span>
        <span v-if="r.node.detail" class="pdetail">{{ r.node.detail }}</span>
        <span class="pcost">cost {{ r.node.cost.toFixed(2) }} · rows {{ r.node.rows }}</span>
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
.pdetail {
  color: var(--muted);
}
.pcost {
  margin-left: auto;
  color: var(--muted);
  white-space: nowrap;
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
