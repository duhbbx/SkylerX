<script setup lang="ts">
/**
 * 全局点击放大:
 *  - 监听 document 上的 click,识别 .VPHero / .vp-doc 范围内的 <img>
 *  - 弹出 fixed 全屏遮罩 + 等比放大原图
 *  - 点击遮罩 / ✕ / Esc 关闭
 *
 * 不依赖第三方 npm 包,避开 medium-zoom 等的样式覆盖问题。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useData } from 'vitepress'
import { getComponentLabels } from '../i18n'

const { lang } = useData()
const L = computed(() => getComponentLabels(lang.value))

const open = ref(false)
const src = ref('')
const alt = ref('')

function onDocClick(e: MouseEvent): void {
  const t = e.target as HTMLElement | null
  if (!t || t.tagName !== 'IMG') return
  // 只放大 Hero 区域 + Markdown 内容里的图片;站点 logo / 头像不参与
  const heroOk = !!t.closest('.VPHero')
  const docOk = !!t.closest('.vp-doc') && !t.closest('a')
  if (!heroOk && !docOk) return
  e.preventDefault()
  const img = t as HTMLImageElement
  src.value = img.currentSrc || img.src
  alt.value = img.alt || ''
  open.value = true
  // 锁滚动
  document.documentElement.style.overflow = 'hidden'
}

function close(): void {
  open.value = false
  document.documentElement.style.overflow = ''
}

function onKey(e: KeyboardEvent): void {
  if (open.value && e.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
  document.documentElement.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="lb">
      <div v-if="open" class="lb-overlay" @click.self="close">
        <button class="lb-close" :aria-label="L.lightbox.close" @click="close">✕</button>
        <img :src="src" :alt="alt" class="lb-img" @click="close" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lb-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
}
.lb-img {
  max-width: 92vw;
  max-height: 92vh;
  border-radius: 8px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  display: block;
}
.lb-close {
  position: absolute;
  top: 18px;
  right: 20px;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: none;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  font-size: 16px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.lb-close:hover {
  background: rgba(255, 255, 255, 0.18);
}
.lb-enter-active,
.lb-leave-active {
  transition: opacity 0.18s ease;
}
.lb-enter-from,
.lb-leave-to {
  opacity: 0;
}
</style>
