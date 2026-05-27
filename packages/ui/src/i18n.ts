import { ref } from 'vue'

/**
 * 轻量 i18n（不引第三方）：响应式当前语言 + 扁平 key 字典 + {name} 插值 + localStorage 持久化。
 *
 * 用法（组件 `<script setup>` 内）：
 *   import { t } from '../i18n'
 *   ...模板里直接 {{ t('nav.title') }}
 * `t()` 读取 `locale.value`，语言切换时使用它的模板/计算属性会自动重算。
 *
 * 迁移策略：新文案一律走 `t()`；存量组件可按本字典 key 增量替换，无需一次性改完。
 */
export type Locale = 'zh' | 'en'

const STORAGE_KEY = 'skylerx.locale'

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* localStorage 不可用时忽略 */
  }
  if (typeof navigator !== 'undefined' && !/^zh/i.test(navigator.language)) return 'en'
  return 'zh' // 默认中文（主要用户群）
}

export const locale = ref<Locale>(detect())

export const LOCALE_LABEL: Record<Locale, string> = { zh: '简体中文', en: 'English' }

export function setLocale(l: Locale): void {
  locale.value = l
  try {
    localStorage.setItem(STORAGE_KEY, l)
  } catch {
    /* 忽略写入失败 */
  }
}

const zh: Record<string, string> = {
  'nav.title': '导航',
  'nav.newConn': '新建连接',
  'nav.refresh': '刷新',
  'nav.settings': '设置',
  'nav.empty': '还没有连接，点上方 + 新建',
  'nav.loading': '加载中…',
  'bulk.selected': '已选 {n} 项',
  'bulk.delete': '批量删除',
  'bulk.copyNames': '复制名',
  'common.cancel': '取消',
  'common.done': '完成',
  'common.delete': '删除',
  'common.confirm': '确定',
  'common.resetDefault': '恢复默认',
  'settings.title': '设置',
  'settings.language': '语言',
  'settings.theme': '主题',
  'settings.theme.dark': '深色',
  'settings.theme.light': '浅色',
  'settings.pageSize': '默认每页条数',
  'settings.fontSize': '编辑器字号',
  'settings.keywordCase': 'SQL 格式化关键字',
  'settings.keywordCase.upper': '大写 UPPER',
  'settings.keywordCase.lower': '小写 lower',
  'settings.keywordCase.preserve': '保持原样',
  'settings.note': '设置即时生效并本地保存；字号对新打开的编辑器生效。',
}

const en: Record<string, string> = {
  'nav.title': 'Navigator',
  'nav.newConn': 'New connection',
  'nav.refresh': 'Refresh',
  'nav.settings': 'Settings',
  'nav.empty': 'No connections yet — click + above to add one',
  'nav.loading': 'Loading…',
  'bulk.selected': '{n} selected',
  'bulk.delete': 'Delete selected',
  'bulk.copyNames': 'Copy names',
  'common.cancel': 'Cancel',
  'common.done': 'Done',
  'common.delete': 'Delete',
  'common.confirm': 'OK',
  'common.resetDefault': 'Reset to defaults',
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.theme': 'Theme',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.pageSize': 'Default rows per page',
  'settings.fontSize': 'Editor font size',
  'settings.keywordCase': 'SQL keyword case',
  'settings.keywordCase.upper': 'UPPER',
  'settings.keywordCase.lower': 'lower',
  'settings.keywordCase.preserve': 'Preserve',
  'settings.note': 'Changes apply instantly and are saved locally; font size affects newly opened editors.',
}

const messages: Record<Locale, Record<string, string>> = { zh, en }

/** 翻译：取当前语言文案，缺失回退中文、再回退 key；支持 {name} 插值。 */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = messages[locale.value][key] ?? zh[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return s
}
