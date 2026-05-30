<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * AI 建表助手(对话式):
 *  - 用户描述业务("我要做个订单系统"),AI 出多张关联表的 CREATE TABLE 全套
 *  - 用户在对话里追问/调整("加个 status 字段" / "把 order_items 改成 partition"),AI 增量改
 *  - 每轮回答里保留完整可执行 SQL,用户最终一键执行到指定库
 *
 * 与 AiSchemaReverseDialog(从 sample data 推断)的区别:
 *  - reverse:数据 → schema
 *  - architect:业务需求 → schema(关系建模)
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { askAiChat, extractAllSql, type ChatMessage } from '../ai'
import { confirm as appConfirm, toast } from '../dialog'
import { useDataClient } from '../data-client'
import { renderMarkdown } from '../markdown'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  database?: string
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

interface Turn {
  role: 'user' | 'assistant'
  content: string
  /** AI 回答里抽出来的 SQL 块(用户可一键执行) */
  sqlBlocks?: string[]
}
const turns = ref<Turn[]>([])
const input = ref('')
const running = ref(false)
const executing = ref(false)
const bodyRef = useTemplateRef<HTMLDivElement>('bodyEl')

const SYSTEM = `You are a senior database architect. The user describes a business domain (in any language).
Your job:
1. Design **multiple related tables** (with primary keys, foreign keys, indexes, sensible types for the **${props.conn.dialect}** dialect).
2. Output a single \`\`\`sql code block containing the COMPLETE CREATE TABLE statements (including foreign keys and indexes) so the user can copy-paste-run.
3. Explain key design decisions briefly in 2-4 bullet points.
4. When the user asks to revise, output the FULL updated SQL again (not just a diff) — they will execute the whole block.

Stay concise. Prefer normalized design unless user asks for denormalized.`

async function send(): Promise<void> {
  const text = input.value.trim()
  if (!text || running.value) return
  turns.value.push({ role: 'user', content: text })
  input.value = ''
  await scrollBottom()
  running.value = true
  try {
    // 历史:把所有 turns 转成 ChatMessage[]
    const messages: ChatMessage[] = turns.value.map((t) => ({
      role: t.role,
      content: t.content,
    }))
    const reply = await askAiChat({
      messages,
      dialect: props.conn.dialect,
      extraSystem: SYSTEM,
    })
    const sqls = extractAllSql(reply)
    turns.value.push({ role: 'assistant', content: reply, sqlBlocks: sqls })
  } catch (e) {
    turns.value.push({
      role: 'assistant',
      content: `**调用 AI 失败**: ${e instanceof Error ? e.message : String(e)}\n\n请确认设置里的 AI Provider/API Key/Base URL。`,
    })
  } finally {
    running.value = false
    await scrollBottom()
  }
}

async function scrollBottom(): Promise<void> {
  await nextTick()
  const el = bodyRef.value
  if (el) el.scrollTop = el.scrollHeight
}

/** 取最后一次助手回答里的 SQL(用户最终决定执行的版本)。 */
const latestSql = computed<string>(() => {
  for (let i = turns.value.length - 1; i >= 0; i--) {
    if (turns.value[i].role === 'assistant' && turns.value[i].sqlBlocks?.length) {
      return turns.value[i].sqlBlocks!.join('\n\n')
    }
  }
  return ''
})

async function executeAll(): Promise<void> {
  if (!latestSql.value.trim()) {
    toast.warn('暂无可执行 SQL')
    return
  }
  if (
    !(await appConfirm({
      message: `在 ${props.database || '当前默认库'} 执行 ${latestSql.value.match(/\bCREATE\b/gi)?.length ?? 0} 段 CREATE 语句?`,
      variant: 'warn',
    }))
  )
    return
  executing.value = true
  try {
    const ctx = props.database ? { database: props.database } : {}
    const stmts = latestSql.value
      .split(/;\s*(?:\n|$)/)
      .map((s) => s.trim().replace(/;$/, ''))
      .filter(Boolean)
    for (const s of stmts) {
      await client.connections.execute(props.conn.id, s, [], ctx)
    }
    toast.success(`已执行 ${stmts.length} 段`)
    emit('close')
  } catch (e) {
    toast.error(`执行失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    executing.value = false
  }
}

function copyLatestSql(): void {
  if (!latestSql.value) return
  void navigator.clipboard?.writeText(latestSql.value)
  toast.success('SQL 已复制')
}

function turnHtml(t: Turn): string {
  return renderMarkdown(t.content)
}

function clearChat(): void {
  turns.value = []
}

watch(
  () => props.open,
  (op) => {
    if (op && !turns.value.length) {
      // 首轮自动给个引导
      turns.value.push({
        role: 'assistant',
        content: `Hi 我是 SkylerX 数据库架构师 🛠

告诉我你的业务,我帮你设计多表 + 关联 + 索引 + 完整 ${props.conn.dialect} DDL。

**例子**:
- "做个电商订单系统:用户、商品、订单、订单项,支持优惠券"
- "做个简单博客:用户、文章、评论、标签 (多对多)"
- "做个 SaaS 多租户:tenant 隔离 + 用户 + 角色 + 权限"

直接描述,我就开始。`,
      })
    }
  },
)
</script>

<template>
  <Modal v-if="open" :title="`AI 建表助手  ·  ${conn.name || conn.dialect}`" width="xl" fixed-height storage-key="ai-architect" @close="emit('close')">
    <div ref="bodyEl" class="chat-body">
      <div v-for="(t, i) in turns" :key="i" class="turn" :class="t.role">
        <div class="role">{{ t.role === 'user' ? '🧑' : '🤖' }}</div>
        <div class="bubble md-body" v-html="turnHtml(t)" />
      </div>
      <div v-if="running" class="turn assistant">
        <div class="role">🤖</div>
        <div class="bubble dim">分析中…</div>
      </div>
    </div>

    <div class="input-bar">
      <textarea
        v-model="input"
        class="input"
        rows="2"
        placeholder="描述你的业务,或者要求改设计(⌘+Enter 发送)"
        @keydown.meta.enter="send"
        @keydown.ctrl.enter="send"
      />
      <button class="btn-primary" :disabled="running || !input.trim()" @click="send">
        {{ running ? '…' : '发送' }}
      </button>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="clearChat">清空对话</button>
      <button class="btn" :disabled="!latestSql" @click="copyLatestSql">📋 复制 SQL</button>
      <button class="btn-primary" :disabled="!latestSql || executing" @click="executeAll">
        {{ executing ? '执行中…' : '▶ 执行最新版本' }}
      </button>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.chat-body {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px;
  max-height: 60vh;
}
.turn { display: flex; gap: 8px; }
.turn.user { flex-direction: row-reverse; }
.role { width: 28px; flex: none; text-align: center; font-size: 18px; line-height: 1.5; }
.bubble { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; flex: 1; min-width: 0; }
.turn.user .bubble { background: rgba(124, 108, 255, 0.12); }
.bubble.dim { color: var(--muted); font-style: italic; }
.input-bar { display: flex; gap: 8px; padding: 8px 0; align-items: stretch; }
.input { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; color: var(--text); font-family: ui-monospace, monospace; font-size: 12px; resize: vertical; }
.btn, .btn-primary, .btn-ghost { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 13px; }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-ghost { background: transparent; color: var(--muted); }
:deep(.md-body h1), :deep(.md-body h2), :deep(.md-body h3) { color: var(--accent); margin: 8px 0 4px; font-size: 14px; }
:deep(.md-body p), :deep(.md-body li) { line-height: 1.6; font-size: 13px; margin: 4px 0; }
:deep(.md-body pre) { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 8px 12px; overflow: auto; font-size: 11px; max-height: 280px; }
:deep(.md-body code) { background: var(--bg); padding: 1px 4px; border-radius: 2px; font-size: 11px; }
</style>
