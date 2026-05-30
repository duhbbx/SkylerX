<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '../i18n'

type Width = 'normal' | 'medium' | 'wide' | 'xl'

// 全局自增 z-index：每次新 Modal 挂载时拿一个比之前都高的层级，
// 这样后打开的 modal 自动盖在前面的之上（比如从 AI 助手里打开「配置」时不被反盖）。
//
// 层级规划(跟 AppDialogs / Toasts 等固定 z-index 错开):
//   2000-2999 普通 Modal (modalZBase + seq)
//   2900     Toast(右下角通知, 不阻挡操作)
//   3000     AppDialogs 系统级 confirm/alert/prompt(故意比普通 Modal 高)
//   3200     SavedCard
//   9999     ThemedSelect.ts-panel(teleport popup)
//   ≥10000   topmost Modal — 强制在最顶,等同 OS 原生文件对话框
//             代表"用户必须先处理这个,其它一切都被遮"的最高优先级,
//             目前只有 SaveFileDialog 用(folder chooser 性质上等同原生 file dialog)
const modalZBase = 2000
const modalZTopmost = 10000
let modalZSeq = 0
let modalZTopmostSeq = 0

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
  /**
   * 关闭前钩子：返回 false（或 Promise 解析为 false）则阻止关闭。
   * 用于「未保存修改」类提示——脏表单关闭时弹 confirm，用户取消即不关。
   */
  beforeClose?: () => boolean | Promise<boolean>
  /**
   * 最顶层模式: z-index ≥ 10000, 强制盖在所有其它 Modal / appConfirm / ThemedSelect popup 之上.
   * 仅用于"文件对话框"这类等同于 OS 原生 modal 的场景(SaveFileDialog 等),
   * 普通业务弹窗不要开,会破坏正常的层级语义.
   */
  topmost?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

async function tryClose(): Promise<void> {
  if (props.beforeClose) {
    const ok = await props.beforeClose()
    if (!ok) return
  }
  emit('close')
}

function onKey(e: KeyboardEvent): void {
  // Esc 视为用户主动关闭：仍走 beforeClose 钩子，脏表单照样会提示
  if (e.key === 'Escape') {
    e.preventDefault()
    void tryClose()
  }
}

const widthClass = computed(() => `w-${props.width ?? 'normal'}`)
const modalEl = ref<HTMLDivElement>()
const myZ = ref(props.topmost ? modalZTopmost + ++modalZTopmostSeq : modalZBase + ++modalZSeq)

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
  window.addEventListener('keydown', onKey)
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
  window.removeEventListener('keydown', onKey)
  ro?.disconnect()
  ro = null
})
</script>

<template>
  <!--
    背景遮罩不再绑定 click 关闭：用户点空白处不应误关弹窗（防止刚写到一半的表单丢失）。
    关闭路径仅剩三条：① 标题栏 ✕ 按钮、② Esc 键、③ 调用方主动设为 null。
    每条都会走 beforeClose 钩子，脏表单可以拦截。
  -->
  <div class="modal-backdrop" :style="{ zIndex: myZ }">
    <div ref="modalEl" class="modal" :class="[widthClass, { fixed: fixedHeight }]">
      <div class="modal-head">
        <span>{{ title }}</span>
        <button class="x" :title="t('common.close')" @click="tryClose">×</button>
      </div>
      <div class="modal-body">
        <slot />
      </div>
      <!-- footer slot:有传 #footer 内容时显示底部按钮区(取消/保存等);
           内容自身管 z-index 不被 body overflow 裁;固定高度,贴底,默认 sticky 视觉 -->
      <div v-if="$slots.footer" class="modal-foot">
        <slot name="footer" />
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
/* footer:固定贴底,与 body 用 border-top 分隔,按钮右对齐 */
.modal-foot {
  flex: none;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 10px 18px;
  border-top: 1px solid var(--border);
  background: var(--panel, transparent);
  border-radius: 0 0 8px 8px;
}
</style>
