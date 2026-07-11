<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 数据库方言 logo 显示组件。
 *
 *  - 优先渲染品牌 PNG，未知方言走 DB fallback
 *  - 用法：<DialectIcon :dialect="conn.dialect" :size="16" />
 *  - size 默认 16；inline-block，跟文字基线对齐；不占额外行高
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
  <img
    v-if="icon.src"
    class="dialect-icon"
    :src="icon.src"
    alt=""
    aria-hidden="true"
    :title="title ?? icon.label"
    :width="size"
    :height="size"
  />
  <span
    v-else
    class="dialect-icon dialect-icon-fallback"
    aria-hidden="true"
    :title="title ?? icon.label"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      backgroundColor: icon.color,
      fontSize: `${Math.max(7, Math.round(size * 0.42))}px`,
    }"
  >
    {{ icon.initials ?? 'DB' }}
  </span>
</template>

<style scoped>
.dialect-icon {
  display: inline-block;
  vertical-align: -2px;
  flex: none;
  object-fit: contain;
  object-position: center;
}
.dialect-icon-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: #fff;
  font-weight: 700;
  line-height: 1;
  user-select: none;
}
</style>
