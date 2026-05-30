<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * AI Insights 双 tab:
 *  - 慢 SQL 优化: 用户粘 SQL(可附 EXPLAIN/统计) → AI 给索引/重写建议
 *  - 错误根因: 粘错误信息 + 上下文 → AI 分析根因 + 修复
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { askAiChat } from '../ai'
import { toast } from '../dialog'
import { marked } from 'marked'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  /** 触发时预填的内容(慢 SQL/错误信息) */
  prefillSql?: string
  prefillError?: string
  /** 触发时直接切到哪个 tab */
  initialTab?: 'slow' | 'error'
}>()

const emit = defineEmits<{ close: [] }>()

type Tab = 'slow' | 'error'
const tab = ref<Tab>(props.initialTab ?? 'slow')

// 慢 SQL 优化
const sqlInput = ref(props.prefillSql ?? '')
const planInput = ref('')
const statsInput = ref('')
const slowResult = ref('')
const slowRunning = ref(false)

// 错误根因
const errorInput = ref(props.prefillError ?? '')
const errorCtxInput = ref('')
const errorResult = ref('')
const errorRunning = ref(false)

async function runSlowOptimize(): Promise<void> {
  if (!sqlInput.value.trim()) {
    toast.warn('请输入要优化的 SQL')
    return
  }
  slowRunning.value = true
  slowResult.value = ''
  try {
    const userMsg = `请分析下面这条 SQL 的性能问题,给出具体的:
1. 可疑慢点(全表扫/无索引/笛卡尔积/隐式转换/统计信息陈旧 等)
2. 推荐索引(给出 CREATE INDEX 语句)
3. 改写建议(覆盖索引 / 子查询 → JOIN / 等价改写)
4. 估算改进效果

SQL:
\`\`\`sql
${sqlInput.value}
\`\`\`

${planInput.value.trim() ? `\nEXPLAIN/执行计划:\n\`\`\`\n${planInput.value}\n\`\`\`` : ''}
${statsInput.value.trim() ? `\n表统计/行数:\n\`\`\`\n${statsInput.value}\n\`\`\`` : ''}`

    const result = await askAiChat({
      messages: [{ role: 'user', content: userMsg }],
      dialect: props.conn.dialect,
      extraSystem: 'You are a database performance expert. Be specific and reference actual cost trade-offs.',
    })
    slowResult.value = result
  } catch (e) {
    slowResult.value = `**调用 AI 失败**: ${e instanceof Error ? e.message : String(e)}\n\n请确认设置里的 AI Provider / API Key / Base URL。`
  } finally {
    slowRunning.value = false
  }
}

async function runErrorDiagnose(): Promise<void> {
  if (!errorInput.value.trim()) {
    toast.warn('请粘贴错误信息')
    return
  }
  errorRunning.value = true
  errorResult.value = ''
  try {
    const userMsg = `请分析下面这个数据库报错的根因,给出:
1. 错误意义(用人话翻译)
2. 最可能的 3 个原因(按概率排序)
3. 排查步骤(按顺序逐步)
4. 修复方案(SQL 或操作)

错误信息:
\`\`\`
${errorInput.value}
\`\`\`

${errorCtxInput.value.trim() ? `\n上下文(执行的 SQL / 时间 / 用户):\n\`\`\`\n${errorCtxInput.value}\n\`\`\`` : ''}`

    const result = await askAiChat({
      messages: [{ role: 'user', content: userMsg }],
      dialect: props.conn.dialect,
      extraSystem: 'You are an SRE/DBA. Be practical, prioritize quick mitigation.',
    })
    errorResult.value = result
  } catch (e) {
    errorResult.value = `**调用 AI 失败**: ${e instanceof Error ? e.message : String(e)}\n\n请确认设置里的 AI Provider / API Key / Base URL。`
  } finally {
    errorRunning.value = false
  }
}

const slowResultHtml = computed(() => (slowResult.value ? marked.parse(slowResult.value) : ''))
const errorResultHtml = computed(() => (errorResult.value ? marked.parse(errorResult.value) : ''))

watch(
  () => props.open,
  (op) => {
    if (op) {
      sqlInput.value = props.prefillSql ?? ''
      errorInput.value = props.prefillError ?? ''
      tab.value = props.initialTab ?? 'slow'
    }
  },
)
</script>

<template>
  <Modal v-if="open" :title="`AI 诊断  ·  ${conn.name || conn.dialect}`" width="xl" fixed-height storage-key="ai-insights" @close="emit('close')">
    <div class="tabs">
      <button :class="{ on: tab === 'slow' }" @click="tab = 'slow'">🐢 慢 SQL 优化</button>
      <button :class="{ on: tab === 'error' }" @click="tab = 'error'">🩹 错误根因</button>
    </div>

    <!-- 慢 SQL 优化 -->
    <template v-if="tab === 'slow'">
      <div class="form">
        <div class="row">
          <label class="lbl">SQL *</label>
          <textarea v-model="sqlInput" class="code" spellcheck="false" rows="5" placeholder="SELECT * FROM ..." />
        </div>
        <div class="row two">
          <div>
            <label class="lbl">EXPLAIN / 执行计划(可选)</label>
            <textarea v-model="planInput" class="code small" spellcheck="false" rows="4" />
          </div>
          <div>
            <label class="lbl">表统计 / 行数(可选)</label>
            <textarea v-model="statsInput" class="code small" spellcheck="false" rows="4" />
          </div>
        </div>
        <div class="run-row">
          <button class="btn-primary" :disabled="slowRunning" @click="runSlowOptimize">
            {{ slowRunning ? '✨ 分析中…' : '✨ 分析' }}
          </button>
        </div>
        <div v-if="slowResultHtml" class="result md-body" v-html="slowResultHtml" />
        <div v-else-if="!slowRunning" class="hint">填入 SQL → 点分析,AI 会给出索引/重写建议</div>
      </div>
    </template>

    <!-- 错误根因 -->
    <template v-else>
      <div class="form">
        <div class="row">
          <label class="lbl">错误信息 *</label>
          <textarea v-model="errorInput" class="code" spellcheck="false" rows="5" placeholder="ERROR 1452 (23000): Cannot add or update a child row..." />
        </div>
        <div class="row">
          <label class="lbl">上下文(可选:执行的 SQL / 时间点 / 用户)</label>
          <textarea v-model="errorCtxInput" class="code small" spellcheck="false" rows="4" />
        </div>
        <div class="run-row">
          <button class="btn-primary" :disabled="errorRunning" @click="runErrorDiagnose">
            {{ errorRunning ? '✨ 分析中…' : '✨ 分析根因' }}
          </button>
        </div>
        <div v-if="errorResultHtml" class="result md-body" v-html="errorResultHtml" />
        <div v-else-if="!errorRunning" class="hint">粘错误信息 → 点分析根因,AI 会列出可能原因 + 排查步骤</div>
      </div>
    </template>

    <template #footer>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; padding: 0 0 8px; border-bottom: 1px solid var(--border); margin-bottom: 10px; }
.tabs button { background: transparent; border: 1px solid transparent; color: var(--muted); padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.tabs button.on { background: rgba(124, 108, 255, 0.18); border-color: var(--accent); color: var(--text); }
.form { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; flex-direction: column; gap: 4px; }
.row.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.lbl { font-size: 11px; color: var(--muted); font-weight: 600; }
.code { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px; font-family: ui-monospace, monospace; font-size: 12px; color: var(--text); resize: vertical; }
.code.small { font-size: 11px; }
.run-row { display: flex; align-items: center; gap: 8px; }
.btn-primary, .btn-ghost { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 13px; }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-ghost { background: transparent; color: var(--muted); }
.hint { padding: 30px; text-align: center; color: var(--muted); font-size: 12px; }
.result { padding: 12px 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; max-height: 50vh; overflow: auto; }
:deep(.md-body h1), :deep(.md-body h2), :deep(.md-body h3) { color: var(--accent); margin: 12px 0 6px; }
:deep(.md-body p) { line-height: 1.6; margin: 6px 0; }
:deep(.md-body pre) { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 8px 12px; overflow: auto; font-size: 11px; }
:deep(.md-body code) { background: var(--bg); padding: 1px 4px; border-radius: 2px; font-size: 11px; }
:deep(.md-body ul), :deep(.md-body ol) { margin: 6px 0; padding-left: 20px; }
:deep(.md-body li) { margin: 3px 0; }
</style>
