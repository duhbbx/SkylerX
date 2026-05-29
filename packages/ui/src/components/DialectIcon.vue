<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 数据库方言 logo 显示组件。
 *
 *  - 24×24 viewBox 的 SVG，单条 path，带品牌色
 *  - 用法：<DialectIcon :dialect="conn.dialect" :size="16" />
 *  - size 默认 16；inline-block，跟文字基线对齐；不占额外行高
 *  - 颜色直接来自 dialect-icon.ts 的 brand color，**不接受外部 prop**——
 *    这是 logo，不是图标字体，颜色受品牌规范保护
 *
 * 落地点（截至 v0.3.16）：
 *  - TreeItem.vue 连接节点（替代 🔌 emoji）
 *  - QueryTabs.vue tab 标签头（让用户一眼看出 tab 属于哪个 dialect）
 */
import { computed } from 'vue'
import { getDialectIcon } from '../dialect-icon'

const props = withDefaults(
  defineProps<{
    /** dialect 字符串（'mysql' / 'postgresql' 等），未识别走 GENERIC fallback */
    dialect: string
    /** 像素尺寸（正方形）。默认 16，建议 12 / 14 / 16 / 18 / 20 / 24 */
    size?: number
    /** 鼠标悬停 title；不传则用品牌名（'MySQL' / 'PostgreSQL' / …） */
    title?: string
  }>(),
  { size: 16, title: undefined },
)

const icon = computed(() => getDialectIcon(props.dialect))
</script>

<template>
  <svg
    class="dialect-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    role="img"
  >
    <title>{{ title ?? icon.label }}</title>
    <path :d="icon.path" :fill="icon.color" />
  </svg>
</template>

<style scoped>
.dialect-icon {
  display: inline-block;
  vertical-align: -2px;
  flex: none;
}
</style>
