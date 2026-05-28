<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '../i18n'

type Width = 'normal' | 'medium' | 'wide' | 'xl'

const props = defineProps<{
  title?: string
  /** 'normal' 600 / 'medium' 720 / 'wide' 880 / 'xl' 1100；缺省 = normal */
  width?: Width
  /**
   * 高度固定：弹窗保持稳定的初始宽高，切 tab/分区时窗体不跳；
   * 同时启用 CSS resize: both 让用户可拖右下角自由调整宽高。
   * 配合 storageKey 时尺寸自动持久化（localStorage `skylerx.modal.<key>`）。
   */
  fixedHeight?: boolean
  /**
   * 尺寸持久化键：传该 key 后，本次拖出的宽高会写入 localStorage，下次打开同 key 弹窗恢复。
   * 不同 key 互不干扰。仅在 fixedHeight 模式下生效。
   */
  storageKey?: string
}>()
const emit = defineEmits<{ close: [] }>()

const widthClass = computed(() => `w-${props.width ?? 'normal'}`)
const modalEl = ref<HTMLDivElement>()

/** 持久化的尺寸（仅 fixedHeight + storageKey 时启用）。 */
function loadSize(): { width?: number; height?: number } {
  if (!props.storageKey) return {}
  try {
    const raw = localStorage.getItem(`skylerx.modal.${props.storageKey}`)
    if (!raw) return {}
    return JSON.parse(raw) as { width?: number; height?: number }
  } catch {
    return {}
  }
}
function saveSize(width: number, height: number): void {
  if (!props.storageKey) return
  try {
    localStorage.setItem(`skylerx.modal.${props.storageKey}`, JSON.stringify({ width, height }))
  } catch {
    /* 忽略 */
  }
}

let ro: ResizeObserver | null = null

onMounted(() => {
  if (!props.fixedHeight || !modalEl.value) return
  // 恢复上次保存的尺寸（覆盖默认 CSS 宽高）
  const saved = loadSize()
  if (saved.width) modalEl.value.style.width = `${saved.width}px`
  if (saved.height) modalEl.value.style.height = `${saved.height}px`
  // 监听拖拽变化 → 持久化
  if (props.storageKey && 'ResizeObserver' in window) {
    let raf = 0
    ro = new ResizeObserver((entries) => {
      const e = entries[0]
      if (!e) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const { width, height } = e.contentRect
        saveSize(Math.round(width), Math.round(height))
      })
    })
    ro.observe(modalEl.value)
  }
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div ref="modalEl" class="modal" :class="[widthClass, { fixed: fixedHeight }]">
      <div class="modal-head">
        <span>{{ title }}</span>
        <button class="x" :title="t('common.close')" @click="emit('close')">×</button>
      </div>
      <div class="modal-body">
        <slot />
      </div>
      <span v-if="fixedHeight" class="resize-grip" :title="t('common.resizeHint')" />
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  overflow: hidden; /* 强制截断横向溢出，避免子内容把弹窗撑出横向滚动条 */
  position: relative;
}
.modal.w-normal {
  width: 600px;
}
.modal.w-medium {
  width: 720px;
}
.modal.w-wide {
  width: 880px;
}
.modal.w-xl {
  width: 1100px;
}
/*
 * fixedHeight：弹窗有稳定的初始宽高（切 tab 不跳），同时允许用户拖右下角自由调整宽高。
 * 最小 480 × 360 保证可用；最大 = 视口减边距；恢复保存尺寸由脚本写 inline style。
 */
.modal.fixed {
  height: min(640px, 86vh);
  resize: both;
  min-width: 480px;
  min-height: 360px;
}
/* 视觉化 resize 把手：右下角双线小三角，鼠标悬停时显示 nwse-resize 光标 */
.resize-grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
  pointer-events: none; /* 不抢点击；浏览器原生 resize 区域仍在 .modal.fixed 角 */
  background:
    linear-gradient(
      135deg,
      transparent 0 8px,
      var(--muted) 8px 9px,
      transparent 9px 11px,
      var(--muted) 11px 12px,
      transparent 12px 14px,
      var(--muted) 14px 15px,
      transparent 15px
    );
  opacity: 0.7;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  flex: none;
}
.modal-head .x {
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.modal-head .x:hover {
  color: var(--text);
}
.modal-body {
  padding: 18px;
  overflow-y: auto;
  overflow-x: hidden; /* 内容超宽改为换行/截断而非横向滚动 */
  flex: 1 1 auto;
  min-height: 0;
}
/*
 * fixedHeight 模式下：modal-body 本身改为 flex 列、自身不滚动；
 * 由内部子组件（如 SettingsDialog 的 cfg）通过 flex:1 + overflow-y:auto 接管滚动，
 * 这样左侧导航/底部按钮固定可见，只让中间内容滚。
 */
.modal.fixed .modal-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 14px 18px;
}
</style>
