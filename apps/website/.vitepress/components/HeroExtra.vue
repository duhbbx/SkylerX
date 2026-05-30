<script setup lang="ts">
/**
 * 首页 Hero 区下方补一行徽章/简短价值点.
 * 文案随 useData().lang 自动切换。
 */
import { computed } from 'vue'
import { useData } from 'vitepress'
import { getComponentLabels } from '../i18n'

const { lang } = useData()
const L = computed(() => getComponentLabels(lang.value))
const points = computed(() => [
  L.value.hero.dialects,
  L.value.hero.chinese,
  L.value.hero.multiAi,
  L.value.hero.license,
])
</script>

<template>
  <div class="hero-extra">
    <span v-for="p in points" :key="p" class="hep">{{ p }}</span>
  </div>
</template>

<style scoped>
.hero-extra {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: -1.2rem;
  margin-bottom: 2rem;
}
.hep {
  font-size: 0.85rem;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
}
</style>
