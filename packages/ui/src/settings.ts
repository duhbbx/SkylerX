import { reactive, watch } from 'vue'

export interface Settings {
  /** 结果集默认每页条数 */
  pageSize: number
  /** SQL 编辑器字号 */
  fontSize: number
  /** SQL 格式化关键字大小写 */
  keywordCase: 'upper' | 'lower' | 'preserve'
  /** 主题 */
  theme: 'dark' | 'light'
  /** 全局界面缩放（CSS zoom，1 = 100%） */
  uiZoom: number
  /** AI 助手：Anthropic API Key（仅存本地） */
  aiApiKey: string
  /** AI 助手：模型 ID */
  aiModel: string
  /** AI 助手：API Base URL（可指向代理） */
  aiBaseUrl: string
}

const KEY = 'skylerx.settings'
const DEFAULTS: Settings = {
  pageSize: 200,
  fontSize: 13,
  keywordCase: 'upper',
  theme: 'dark',
  uiZoom: 1,
  aiApiKey: '',
  aiModel: 'claude-sonnet-4-6',
  aiBaseUrl: 'https://api.anthropic.com',
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

/** 全局设置单例（任意组件 import 即用，改动自动持久化）。 */
export const settings = reactive<Settings>(load())

watch(
  settings,
  () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      /* 忽略持久化失败 */
    }
  },
  { deep: true },
)

const hasDom = typeof document !== 'undefined'

// 主题：应用到根元素的 data-theme（styles.css 据此切换变量）
function applyTheme(): void {
  if (hasDom) document.documentElement.setAttribute('data-theme', settings.theme)
}
applyTheme()
watch(() => settings.theme, applyTheme)

// 全局缩放：CSS zoom 作用于根元素（Chromium/Electron 渲染层支持）
const ZOOM_MIN = 0.6
const ZOOM_MAX = 1.6
function applyZoom(): void {
  if (hasDom) {
    ;(document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(settings.uiZoom)
  }
}
applyZoom()
watch(() => settings.uiZoom, applyZoom)

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))
}
export function zoomIn(): void {
  settings.uiZoom = clampZoom(settings.uiZoom + 0.1)
}
export function zoomOut(): void {
  settings.uiZoom = clampZoom(settings.uiZoom - 0.1)
}
export function zoomReset(): void {
  settings.uiZoom = 1
}

export function resetSettings(): void {
  Object.assign(settings, DEFAULTS)
}
