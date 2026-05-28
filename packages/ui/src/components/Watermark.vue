<script setup lang="ts">
import { computed } from 'vue'
import { settings } from '../settings'

/**
 * 生产环境水印：作为绝对定位的覆盖层放进查询页根容器，使用 SVG data URL 平铺。
 * 文案/颜色/透明度/角度/字号均来自全局设置，可在「设置 → 生产水印」实时调整。
 */
const props = defineProps<{ text?: string }>()

const styleObj = computed(() => {
  const w = 320
  const h = 160
  const text = props.text || settings.watermarkText || '生产环境'
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="50%" y="50%" fill="${settings.watermarkColor}" fill-opacity="${settings.watermarkOpacity}" font-size="${settings.watermarkSize}" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-weight="600" text-anchor="middle" dominant-baseline="middle" transform="rotate(${settings.watermarkAngle} ${w / 2} ${h / 2})">${safe}</text></svg>`
  return {
    backgroundImage: `url('data:image/svg+xml;utf8,${encodeURIComponent(xml)}')`,
  }
})
</script>

<template>
  <div class="watermark" :style="styleObj" aria-hidden="true"></div>
</template>

<style scoped>
/*
 * 不使用 mix-blend-mode：在深色主题里 multiply 会把红色水印融成几乎不可见的暗色块。
 * 这里只靠 fill 颜色 + 透明度本身（用户在「设置 → 生产水印」可调）来表达层次。
 */
.watermark {
  position: absolute;
  inset: 0;
  z-index: 50;
  pointer-events: none;
  background-repeat: repeat;
}
</style>
