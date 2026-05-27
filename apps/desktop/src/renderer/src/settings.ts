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
}

const KEY = 'skylerx.settings'
const DEFAULTS: Settings = { pageSize: 200, fontSize: 13, keywordCase: 'upper', theme: 'dark' }

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

// 主题：应用到根元素的 data-theme（styles.css 据此切换变量）
function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', settings.theme)
}
applyTheme()
watch(() => settings.theme, applyTheme)

export function resetSettings(): void {
  Object.assign(settings, DEFAULTS)
}
