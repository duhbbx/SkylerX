/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { reactive, watch } from 'vue'
import { DEFAULT_MASK_RULES, type MaskRule } from './masking'

/** AI 后端 provider 标识；anthropic 用 Messages API，其余走 OpenAI 兼容的 chat/completions。 */
export type AiProvider = 'anthropic' | 'openai' | 'deepseek' | 'codex' | 'grok'

export interface AiProviderConfig {
  apiKey: string
  model: string
  baseUrl: string
}

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'ChatGPT (OpenAI)',
  deepseek: 'DeepSeek',
  codex: 'Codex (OpenAI 兼容)',
  grok: 'Grok (xAI)',
}

export const AI_PROVIDER_ORDER: AiProvider[] = ['anthropic', 'openai', 'deepseek', 'codex', 'grok']

export const AI_PROVIDER_DEFAULTS: Record<AiProvider, AiProviderConfig> = {
  anthropic: { apiKey: '', model: 'claude-sonnet-4-6', baseUrl: 'https://api.anthropic.com' },
  openai: { apiKey: '', model: 'gpt-4o', baseUrl: 'https://api.openai.com' },
  deepseek: { apiKey: '', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
  codex: { apiKey: '', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com' },
  grok: { apiKey: '', model: 'grok-2-latest', baseUrl: 'https://api.x.ai' },
}

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
  /**
   * 事务提交模式（全局默认）：
   *  - 'auto'：每条 SQL 立即提交（默认）
   *  - 'manual'：手动「提交/回滚」，QueryPane 走 session
   * 每个连接可在 extra.commitMode 里以 'inherit' / 'auto' / 'manual' 单独覆盖
   */
  commitMode: 'auto' | 'manual'

  // ── AI 助手（多 provider）──
  /** 当前激活的 AI provider */
  aiProvider: AiProvider
  /** 各 provider 的独立配置 */
  aiProviders: Record<AiProvider, AiProviderConfig>

  // ── 编辑器 ──
  tabSize: number
  wordWrap: boolean
  enableCompletion: boolean

  // ── 结果集 ──
  nullDisplay: string

  // ── 生产水印（env === 'prod' 的查询页显示，斜向重复）──
  watermarkText: string
  watermarkOpacity: number
  watermarkAngle: number
  watermarkSize: number
  watermarkColor: string

  // ── AI 记忆三档（拼到 system prompt 前置；A/B 全量、C 检索 top-K） ──
  /** A: 自定义画像/写作偏好；自由文本；总是注入 */
  aiCustomInstructions: string
  /** B: 结构化事实清单（手动维护 + 可选 AI 自动抽取）；总是全量注入 */
  aiFacts: { id: string; text: string; createdAt: number }[]
  /** B: 每轮对话结束后让 LLM 抽取 1-3 条事实（多一次小请求；可关） */
  aiAutoExtractFacts: boolean
  /** I1 通知触发阈值：执行耗时超过此值（毫秒）算"慢查询"，触发 notify('slow-query')。0 = 不报 */
  slowQueryNotifyMs: number
  /** I1 是否启用执行失败通知（notify('query-error')） */
  notifyOnQueryError: boolean
  /** C: 把每轮对话向量化存本地；查询前按相似度取 top-K 注入 */
  aiVectorMemory: boolean
  /** C: 本地向量记忆条目（小规模直接 localStorage；超过 1000 条会截断旧的） */
  aiVectorMemories: { id: string; text: string; vec: number[]; createdAt: number }[]
  /** C: embedding API（一般 OpenAI 兼容端点；Anthropic 没 embeddings） */
  aiEmbeddingBaseUrl: string
  aiEmbeddingApiKey: string
  aiEmbeddingModel: string
  /** C: 检索 top-K（小一点防 token 爆炸） */
  aiVectorTopK: number

  // ── 数据脱敏（#13）：按列名匹配规则，结果集渲染时遮罩 ──
  /** 总开关；关掉则所有规则不生效 */
  maskingEnabled: boolean
  /** 规则列表（首次启动取 DEFAULT_MASK_RULES，之后从 localStorage 读用户改过的） */
  maskingRules: MaskRule[]

  // ── K1 自定义键盘快捷键 ──
  /** 用户自定义的快捷键覆盖；key = 命令 id，value = chord 字符串（详见 keybindings.ts） */
  keyBindings: Record<string, string>

  // ── 用户报告 #7：NavTree 库/schema 按使用频率排序 ──
  /**
   * 开启后导航树中的 Database / Schema 子节点按用户「展开 / 双击 / 选中」累计次数
   * 降序排列；关闭则保持驱动返回的字典序。明细见 nav-usage.ts。
   */
  navSortByUsage: boolean
}

const KEY = 'skylerx.settings'

function defaultProviders(): Record<AiProvider, AiProviderConfig> {
  return Object.fromEntries(
    AI_PROVIDER_ORDER.map((p) => [p, { ...AI_PROVIDER_DEFAULTS[p] }]),
  ) as Record<AiProvider, AiProviderConfig>
}

const DEFAULTS: Settings = {
  pageSize: 200,
  fontSize: 13,
  keywordCase: 'upper',
  theme: 'dark',
  uiZoom: 1,
  commitMode: 'auto',
  aiProvider: 'anthropic',
  aiProviders: defaultProviders(),
  tabSize: 2,
  wordWrap: false,
  enableCompletion: true,
  nullDisplay: 'NULL',
  watermarkText: '生产环境 PROD',
  watermarkOpacity: 0.22,
  watermarkAngle: -28,
  watermarkSize: 56,
  watermarkColor: '#ff5566',
  aiCustomInstructions: '',
  aiFacts: [],
  aiAutoExtractFacts: false,
  slowQueryNotifyMs: 0, // 默认关；用户在通知配置里开
  notifyOnQueryError: false,
  aiVectorMemory: false,
  aiVectorMemories: [],
  aiEmbeddingBaseUrl: 'https://api.openai.com',
  aiEmbeddingApiKey: '',
  aiEmbeddingModel: 'text-embedding-3-small',
  aiVectorTopK: 5,
  maskingEnabled: false,
  maskingRules: structuredClone(DEFAULT_MASK_RULES),
  keyBindings: {},
  navSortByUsage: false,
}

interface LegacySettings {
  aiApiKey?: string
  aiModel?: string
  aiBaseUrl?: string
}

/** 防止 AI 配置丢失:settings 写盘时同步备份到 BACKUP_KEY,主 KEY 异常/空时从这恢复。 */
const BACKUP_KEY = 'skylerx.settings.backup'

function parseSettings(raw: string | null): Settings | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Settings> & LegacySettings
    // 迁移老字段(单 provider → providers.anthropic),原字段读完即丢
    const providers = parsed.aiProviders
      ? ({ ...defaultProviders(), ...parsed.aiProviders } as Record<AiProvider, AiProviderConfig>)
      : defaultProviders()
    if (parsed.aiApiKey || parsed.aiModel || parsed.aiBaseUrl) {
      providers.anthropic = {
        apiKey: parsed.aiApiKey ?? providers.anthropic.apiKey,
        model: parsed.aiModel || providers.anthropic.model,
        baseUrl: parsed.aiBaseUrl || providers.anthropic.baseUrl,
      }
    }
    return {
      ...DEFAULTS,
      ...parsed,
      aiProviders: providers,
      aiProvider: (parsed.aiProvider as AiProvider | undefined) ?? 'anthropic',
    }
  } catch {
    return null
  }
}

/** 一份 settings 是否包含有意义的 AI 配置(至少一个 provider 有 apiKey)。 */
function hasMeaningfulConfig(s: Settings): boolean {
  return Object.values(s.aiProviders).some((p) => p?.apiKey?.trim())
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function load(): Settings {
  const main = parseSettings(safeGetItem(KEY))
  const backup = parseSettings(safeGetItem(BACKUP_KEY))
  // 1) 主存在且有 AI 配置 → 用主
  if (main && hasMeaningfulConfig(main)) return main
  // 2) 主丢了/没配,但备份还有 → 用备份(这种情况通常是用户报"配置丢了")
  if (backup && hasMeaningfulConfig(backup)) {
    // 顺手把备份写回主 KEY,避免每次启动都走 fallback
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(backup))
    } catch {
      /* ignore */
    }
    return backup
  }
  // 3) 两份都没用 → 用主(可能是首次启动的 DEFAULTS 形态)或 DEFAULTS
  return main ?? backup ?? structuredClone(DEFAULTS)
}

/** 全局设置单例（任意组件 import 即用，改动自动持久化）。 */
export const settings = reactive<Settings>(load())

watch(
  settings,
  () => {
    try {
      const json = JSON.stringify(settings)
      localStorage.setItem(KEY, json)
      // 只有当确实有"有意义的 AI 配置"才更新 backup;
      // 防止用户某次误把所有 key 删空导致 backup 被破坏。
      if (hasMeaningfulConfig(settings)) localStorage.setItem(BACKUP_KEY, json)
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
    ;(document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(
      settings.uiZoom,
    )
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
  Object.assign(settings, structuredClone(DEFAULTS))
}
