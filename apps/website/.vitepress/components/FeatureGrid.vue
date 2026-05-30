<script setup lang="ts">
/**
 * 首页"主要功能"九宫格.
 * 9 项 feature 的完整翻译在 i18n.ts 的 ComponentLabels.features 里。
 */
import { computed } from 'vue'
import { useData } from 'vitepress'
import { getComponentLabels } from '../i18n'

const { lang } = useData()
const L = computed(() => getComponentLabels(lang.value))
const features = computed(() => L.value.features)
</script>

<template>
  <div class="fg-grid">
    <div v-for="f in features" :key="f.title" class="fg-card">
      <div class="fg-icon">{{ f.icon }}</div>
      <div class="fg-title">{{ f.title }}</div>
      <div class="fg-desc">{{ f.desc }}</div>
    </div>
  </div>
</template>

<style scoped>
.fg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin: 1.6rem 0;
}
.fg-card {
  padding: 18px 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  transition: transform 0.18s, border-color 0.18s, box-shadow 0.18s;
}
.fg-card:hover {
  transform: translateY(-3px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 10px 24px rgba(124, 108, 255, 0.18);
}
.fg-icon {
  font-size: 1.6rem;
  margin-bottom: 6px;
}
.fg-title {
  font-weight: 700;
  font-size: 1.05rem;
  margin-bottom: 6px;
}
.fg-desc {
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
  line-height: 1.55;
}
</style>
