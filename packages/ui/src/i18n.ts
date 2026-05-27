import { ref } from 'vue'

/**
 * 轻量 i18n（不引第三方）：响应式当前语言 + 词条字典 + {name} 插值 + localStorage 持久化。
 *
 * 词条按 `key: [中文, English]` 成对维护，避免两套字典漂移。
 * 用法（组件 `<script setup>` 内）：import { t } from '../i18n'，模板里 {{ t('nav.title') }}。
 * `t()` 读取 `locale.value`，语言切换时使用它的模板/计算属性会自动重算。
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

// key: [中文, English]
const DICT: Record<string, [string, string]> = {
  // ── 导航 / 通用 ──
  'nav.title': ['导航', 'Navigator'],
  'nav.newConn': ['新建连接', 'New connection'],
  'nav.refresh': ['刷新', 'Refresh'],
  'nav.settings': ['设置', 'Settings'],
  'nav.empty': ['还没有连接，点上方 + 新建', 'No connections yet — click + above to add one'],
  'nav.loading': ['加载中…', 'Loading…'],
  'bulk.selected': ['已选 {n} 项', '{n} selected'],
  'bulk.delete': ['批量删除', 'Delete selected'],
  'bulk.copyNames': ['复制名', 'Copy names'],
  'common.cancel': ['取消', 'Cancel'],
  'common.done': ['完成', 'Done'],
  'common.delete': ['删除', 'Delete'],
  'common.confirm': ['确定', 'OK'],
  'common.run': ['执行', 'Run'],
  'common.copy': ['复制', 'Copy'],
  'common.refresh': ['刷新', 'Refresh'],
  'common.resetDefault': ['恢复默认', 'Reset to defaults'],
  'common.untitled': ['(未命名)', '(untitled)'],
  'common.loading': ['加载中…', 'Loading…'],

  // ── 设置 ──
  'settings.title': ['设置', 'Settings'],
  'settings.language': ['语言', 'Language'],
  'settings.theme': ['主题', 'Theme'],
  'settings.theme.dark': ['深色', 'Dark'],
  'settings.theme.light': ['浅色', 'Light'],
  'settings.pageSize': ['默认每页条数', 'Default rows per page'],
  'settings.fontSize': ['编辑器字号', 'Editor font size'],
  'settings.keywordCase': ['SQL 格式化关键字', 'SQL keyword case'],
  'settings.keywordCase.upper': ['大写 UPPER', 'UPPER'],
  'settings.keywordCase.lower': ['小写 lower', 'lower'],
  'settings.keywordCase.preserve': ['保持原样', 'Preserve'],
  'settings.note': [
    '设置即时生效并本地保存；字号对新打开的编辑器生效。',
    'Changes apply instantly and are saved locally; font size affects newly opened editors.',
  ],

  // ── 查询页 QueryPane ──
  'query.run': ['执行', 'Run'],
  'query.run.title': ['执行（选中则只跑选区） ⌘/Ctrl+Enter', 'Run (selection only, if any) ⌘/Ctrl+Enter'],
  'query.explain': ['解释', 'Explain'],
  'query.explain.title': ['解释执行计划 (EXPLAIN)', 'Explain plan (EXPLAIN)'],
  'query.format': ['格式化', 'Format'],
  'query.format.title': ['格式化 SQL', 'Format SQL'],
  'query.stop': ['停止', 'Stop'],
  'query.clear': ['清空', 'Clear'],
  'query.saveSnippet': ['存为片段', 'Save snippet'],
  'query.saveSnippet.title': [
    '把选中语句（无选区则全部）存为片段',
    'Save selected statement (or all) as a snippet',
  ],
  'query.hint': ['⌘/Ctrl+Enter 执行（选中则只跑选区）', '⌘/Ctrl+Enter to run (selection only, if any)'],
  'query.defaultDb': ['（默认库）', '(default database)'],
  'query.defaultSchema': ['（默认 schema）', '(default schema)'],
  'query.splitterTitle': ['拖拽调整高度', 'Drag to resize'],
  'query.tabResult': ['结果 {n}', 'Result {n}'],
  'query.tabPlan': ['计划', 'Plan'],
  'query.tabHistory': ['历史', 'History'],
  'query.tabSnippets': ['片段', 'Snippets'],
  'query.paramsTitle': ['填写查询参数', 'Fill query parameters'],
  'query.paramsPlaceholder': [
    '数字原样 · 文本自动加引号 · 留空=NULL',
    'Numbers as-is · text auto-quoted · empty = NULL',
  ],
  'query.explainUnsupported': ['当前数据库方言暂不支持「解释」', 'EXPLAIN is not supported for this dialect'],
  'query.explainFailed': ['解释失败：{msg}', 'Explain failed: {msg}'],
  'query.commitFailed': ['提交失败：{msg}', 'Commit failed: {msg}'],
  'query.snippetNamePrompt': ['片段名称', 'Snippet name'],
  'query.snippetTagsPrompt': ['标签（逗号分隔，可留空）', 'Tags (comma-separated, optional)'],
  'query.dangerDeleteNoWhere': ['DELETE 无 WHERE：{sql}', 'DELETE without WHERE: {sql}'],
  'query.dangerUpdateNoWhere': ['UPDATE 无 WHERE：{sql}', 'UPDATE without WHERE: {sql}'],
  'query.prodDanger': [
    '⚠️ 这是【生产】连接的高危操作：\n\n{dangers}\n\n如确认执行，请键入连接名「{name}」：',
    '⚠️ Dangerous operation on a PRODUCTION connection:\n\n{dangers}\n\nType the connection name "{name}" to proceed:',
  ],
  'query.dangerConfirm': [
    '⚠️ 检测到高危操作：\n\n{dangers}\n\n确定执行？',
    '⚠️ Dangerous operation detected:\n\n{dangers}\n\nProceed?',
  ],
  'completion.function': ['函数', 'function'],
  'completion.snippet': ['片段', 'snippet'],
  'completion.table': ['表', 'table'],
  'env.dangerTitle': [
    '环境：{label}（高危操作需键入连接名确认）',
    'Environment: {label} (dangerous ops require typing the connection name)',
  ],
}

/** 翻译：取当前语言文案，缺失回退 key；支持 {name} 插值。 */
export function t(key: string, params?: Record<string, string | number>): string {
  const pair = DICT[key]
  let s = pair ? (locale.value === 'en' ? pair[1] : pair[0]) : key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return s
}
