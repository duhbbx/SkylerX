<script setup lang="ts">
/**
 * 首页 Hero 区下方补一行徽章/简短价值点.
 */
const points = [
  '✨ 17 SQL + 3 NoSQL 方言',
  '🇨🇳 国产信创全家桶',
  '🤖 多 provider AI 助手',
  '⚖️ Apache 2.0 开源',
]
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
