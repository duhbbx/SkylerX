<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../i18n'

type Width = 'normal' | 'medium' | 'wide' | 'xl'

const props = defineProps<{
  title?: string
  /** 'normal' 600 / 'medium' 720 / 'wide' 880 / 'xl' 1100；缺省 = normal */
  width?: Width
  /** 高度固定：弹窗整体保持 min(640px, 86vh)，内容超出时 body 内部上下滚动；防止切 tab/分区导致高度跳变 */
  fixedHeight?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const widthClass = computed(() => `w-${props.width ?? 'normal'}`)
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal" :class="[widthClass, { fixed: fixedHeight }]">
      <div class="modal-head">
        <span>{{ title }}</span>
        <button class="x" :title="t('common.close')" @click="emit('close')">×</button>
      </div>
      <div class="modal-body">
        <slot />
      </div>
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
 * fixedHeight：弹窗本身有稳定的初始宽高，切 tab/分区时窗体不跳；同时允许用户拖右下角自由调整宽高
 * （CSS resize: both）。最小尺寸保证可用，最大尺寸 = 视口减边距。
 */
.modal.fixed {
  height: min(640px, 86vh);
  resize: both;
  min-width: 480px;
  min-height: 360px;
}
/* 让右下角的浏览器原生 resize 把手更显眼一点 */
.modal.fixed::after {
  content: '';
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 12px;
  height: 12px;
  background:
    linear-gradient(135deg, transparent 0 6px, var(--muted) 6px 7px, transparent 7px 9px, var(--muted) 9px 10px, transparent 10px);
  pointer-events: none;
  opacity: 0.6;
}
.modal.fixed {
  position: relative;
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
