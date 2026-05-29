<script setup lang="ts">/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * G4 「AI SQL 跨方言翻译」弹窗
 *
 * 流程：
 *   1) 用户选源方言 / 目标方言 + 粘贴源 SQL
 *   2) 点「翻译」→ 调 askAiChat 拿回包含 ```sql 代码块 + 警告 + 建议 的 Markdown
 *   3) 左侧：抽出译后 SQL，过 monaco.editor.colorize 出彩色 HTML，可一键复制
 *      右侧：把 ```sql 块抠掉后剩下的部分（即警告 / 建议 markdown）渲染出来
 *
 * 设计要点：
 *   - 4 个方言固定（mysql / postgresql / sqlserver / oracle），UI 显示友好名，
 *     传给 prompt 时用同一份 key 让 AI 也用稳定的 dialect 名
 *   - 「交换」按钮一键互换源 / 目标，方便把翻译结果回填后再反向翻译
 *   - 不依赖任何外部状态（不读 settings 的连接 / schema），独立工具弹窗
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { askAiChat, extractSql } from '../ai'
import { pTranslate } from '../ai-prompts'
import { toast } from '../dialog'
import { t } from '../i18n'
import { renderMarkdown } from '../markdown'
import { monaco } from '../monaco-setup'
import { settings } from '../settings'
import Modal from './Modal.vue'

const props = defineProps<{ initialSql?: string }>()
const emit = defineEmits<{ close: [] }>()

// 4 选方言。value 即传给 pTranslate 的 from/to，label 是 UI 显示。
const DIALECTS: { value: string; label: string }[] = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlserver', label: 'SQL Server' },
  { value: 'oracle', label: 'Oracle' },
]

const fromDialect = ref<string>('mysql')
const toDialect = ref<string>('postgresql')
const sourceSql = ref<string>(props.initialSql ?? '')

const loading = ref(false)
const error = ref<string | null>(null)
/** AI 原始 Markdown 回复 */
const answer = ref<string>('')
/** 译后 SQL（已抽出 ```sql 块的内容） */
const translatedSql = computed<string>(() => (answer.value ? extractSql(answer.value) : ''))
/** 高亮后的 HTML（Monaco colorize 异步生成） */
const translatedHtml = ref<string>('')
/** 警告 / 建议 markdown 渲染出的 HTML */
const notesHtml = computed<string>(() => {
  if (!answer.value) return ''
  // 把首个 ```sql 块（即译后 SQL）从 markdown 里剔除，剩下的就是警告 + 建议两段
  const stripped = answer.value.replace(/```sql\s*[\s\S]*?```/i, '').trim()
  return renderMarkdown(stripped)
})

const copied = ref(false)
let controller: AbortController | null = null

/** 切换译后 SQL 时刷新 Monaco 高亮 */
watch(translatedSql, async (sql) => {
  if (!sql) {
    translatedHtml.value = ''
    return
  }
  try {
    translatedHtml.value = await monaco.editor.colorize(sql, 'sql', { tabSize: 2 })
  } catch {
    // colorize 失败就走 plain pre fallback
    translatedHtml.value = ''
  }
})

function swapDialects(): void {
  const tmp = fromDialect.value
  fromDialect.value = toDialect.value
  toDialect.value = tmp
}

async function run(): Promise<void> {
  const sql = sourceSql.value.trim()
  if (!sql) return
  if (fromDialect.value === toDialect.value) {
    // 同方言无需翻译，直接回填，避免浪费一次请求
    answer.value = `\`\`\`sql\n${sql}\n\`\`\`\n\n### 警告\n- 源方言与目标方言相同，无需翻译\n\n### 建议\n- 直译已足够地道`
    return
  }
  if (!settings.aiProviders[settings.aiProvider]?.apiKey?.trim()) {
    error.value = t('ai.noKey')
    return
  }
  loading.value = true
  error.value = null
  answer.value = ''
  try {
    controller = new AbortController()
    const prompt = pTranslate(fromDialect.value, toDialect.value, sql)
    const text = await askAiChat({
      messages: [{ role: 'user', content: prompt }],
      extraSystem:
        'You are a senior SQL polyglot. Translate SQL across dialects precisely; flag every non-portable construct honestly.',
      signal: controller.signal,
    })
    answer.value = text
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      error.value = null
      return
    }
    const msg = e instanceof Error ? e.message : String(e)
    error.value = msg === 'NO_API_KEY' ? t('ai.noKey') : msg
  } finally {
    loading.value = false
    controller = null
  }
}

async function copyTranslated(): Promise<void> {
  if (!translatedSql.value) return
  try {
    await navigator.clipboard?.writeText(translatedSql.value)
    copied.value = true
    toast.success(t('xlate.copied'))
    setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

onUnmounted(() => controller?.abort())
</script>

<template>
  <Modal
    :title="t('xlate.title')"
    width="xl"
    fixed-height
    storage-key="sql-translate"
    @close="emit('close')"
  >
    <div class="xlate">
      <!-- 方言选择 + 翻译按钮 -->
      <div class="bar">
        <label class="field">
          <span>{{ t('xlate.from') }}</span>
          <select v-model="fromDialect">
            <option v-for="d in DIALECTS" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </label>
        <button class="swap" :title="t('xlate.swap')" @click="swapDialects">⇄</button>
        <label class="field">
          <span>{{ t('xlate.to') }}</span>
          <select v-model="toDialect">
            <option v-for="d in DIALECTS" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </label>
        <span class="spacer"></span>
        <button class="primary" :disabled="loading || !sourceSql.trim()" @click="run">
          {{ loading ? t('xlate.translating') : t('xlate.translate') }}
        </button>
      </div>

      <!-- 源 SQL -->
      <textarea
        v-model="sourceSql"
        class="source"
        :placeholder="t('xlate.sourcePh')"
        spellcheck="false"
      ></textarea>

      <!-- 错误条 -->
      <div v-if="error" class="err">✗ {{ error }}</div>

      <!-- 译后结果两栏 -->
      <div v-if="answer" class="result">
        <section class="pane sql-pane">
          <header>
            <span>{{ t('xlate.result') }}</span>
            <button
              class="ghost"
              :class="{ copied }"
              :disabled="!translatedSql"
              @click="copyTranslated"
            >
              {{ copied ? t('xlate.copied') : t('xlate.copy') }}
            </button>
          </header>
          <!-- Monaco colorize HTML 优先；高亮还没出来时降级为 plain pre -->
          <div
            v-if="translatedHtml"
            class="sql-view"
            v-html="translatedHtml"
          ></div>
          <pre v-else class="sql-view plain">{{ translatedSql }}</pre>
        </section>
        <section class="pane notes-pane">
          <header><span>{{ t('xlate.warnings') }}</span></header>
          <div class="md" v-html="notesHtml"></div>
        </section>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.xlate {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.field select {
  min-width: 140px;
}
.swap {
  padding: 4px 10px;
  font-size: 14px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  cursor: pointer;
}
.swap:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.spacer {
  flex: 1 1 auto;
}
.primary {
  padding: 6px 16px;
  font-size: 13px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.source {
  width: 100%;
  min-height: 140px;
  resize: vertical;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  padding: 10px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
}
.source:focus {
  border-color: var(--accent);
}
.err {
  color: var(--err, #e04050);
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.result {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel);
}
.pane header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
}
.pane header button {
  padding: 3px 10px;
  font-size: 11px;
}
.copied {
  color: var(--accent);
}
.sql-view {
  flex: 1 1 auto;
  overflow: auto;
  margin: 0;
  padding: 10px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  background: var(--bg);
  white-space: pre;
}
.sql-view.plain {
  color: var(--text);
}
.md {
  flex: 1 1 auto;
  overflow: auto;
  padding: 10px 12px;
}
.md :deep(h3) {
  margin: 10px 0 6px;
  font-size: 13px;
  color: var(--accent);
}
.md :deep(h3:first-child) {
  margin-top: 0;
}
.md :deep(p) {
  margin: 4px 0;
  line-height: 1.55;
  font-size: 13px;
}
.md :deep(ul),
.md :deep(ol) {
  margin: 4px 0 4px 20px;
  padding: 0;
  font-size: 13px;
}
.md :deep(li) {
  margin: 2px 0;
  line-height: 1.55;
}
.md :deep(code) {
  background: var(--bg);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.md :deep(pre) {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  overflow: auto;
  margin: 6px 0;
}
.md :deep(pre code) {
  background: transparent;
  padding: 0;
  font-size: 12px;
}
.md :deep(strong) {
  color: var(--text);
}
</style>
