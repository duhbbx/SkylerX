<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * RAG over schema —— 按问题检索相关表/文档,注入 AI 回答(带来源)。
 *
 * 「构建索引」把选定 schema 的结构拆成 chunk,能向量化就向量(provider 的 /v1/embeddings),
 * 否则词法。问问题时检索 top-K 注入 askAiChat。比「整库 dump 进提示词」更省 token、能上大库。
 * 引擎在 ../rag/*(已单测 + Vastbase 词法路径活验)。
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { onMounted, ref } from 'vue'
import { askAiChat, canEmbed } from '../ai'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { reportError } from '../errorReporter'
import { locale } from '../i18n'
import { renderMarkdown } from '../markdown'
import { canIntrospect, readSchema } from '../migrate/introspect'
import {
  type RagChunk,
  chunksFromMarkdown,
  chunksFromRoutines,
  chunksFromSchema,
  chunksFromViews,
} from '../rag/corpus'
import { readRoutines, readViews } from '../rag/objects'
import { buildIndex, formatContext, isStale, searchIndex } from '../rag/service'
import { type RagIndex, loadIndex } from '../rag/store'
import Modal from './Modal.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()
const L = (zh: string, en: string): string => (locale.value === 'en' ? en : zh)

const conns = ref<ConnectionConfig[]>([])
const connId = ref('')
const schemaName = ref('')
const docsText = ref('')
const building = ref(false)
const progress = ref('')
const idx = ref<RagIndex | null>(null)
const stale = ref(false)

const question = ref('')
const asking = ref(false)
const answer = ref('')
const sources = ref<Array<{ title: string; score: number }>>([])
const usedMode = ref<'hybrid' | 'lexical' | ''>('')

const dialectOf = (): ConnectionConfig['dialect'] | undefined =>
  conns.value.find((c) => c.id === connId.value)?.dialect
const keyOf = (): string => `${connId.value}:${schemaName.value}`

function loadExisting(): void {
  idx.value = connId.value && schemaName.value ? loadIndex(keyOf()) : null
  stale.value = false
}

/** 读结构 + 视图/函数 + 粘贴文档 → 合并 chunk(表 + 视图 + 函数/过程 + 文档段)。 */
async function gatherChunks(): Promise<RagChunk[]> {
  const dialect = dialectOf()
  if (!dialect) return []
  const exec = (sql: string): Promise<Array<Record<string, unknown>>> =>
    client.connections.execute(connId.value, sql).then((r) => r.rows)
  const [si, views, routines] = await Promise.all([
    readSchema(exec, dialect, schemaName.value),
    readViews(exec, dialect, schemaName.value).catch(() => []),
    readRoutines(exec, dialect, schemaName.value).catch(() => []),
  ])
  return [
    ...chunksFromSchema(si),
    ...chunksFromViews(views),
    ...chunksFromRoutines(routines),
    ...chunksFromMarkdown(docsText.value),
  ]
}

async function build(): Promise<void> {
  const dialect = dialectOf()
  if (!connId.value || !schemaName.value || !dialect) return
  if (!canIntrospect(dialect)) {
    toast.info(L('该方言暂不支持读结构建索引', 'introspection not supported for this dialect'))
    return
  }
  building.value = true
  progress.value = ''
  try {
    const chunks = await gatherChunks()
    if (!chunks.length) {
      toast.info(L('该 schema 没有可索引的表', 'no tables to index'))
      return
    }
    idx.value = await buildIndex(keyOf(), chunks, {
      nowMs: Date.now(),
      onProgress: (done, total) => {
        progress.value = `${done}/${total}`
      },
    })
    stale.value = false
    const n = (kind: RagChunk['kind']): number => chunks.filter((c) => c.kind === kind).length
    const zh = [
      `${n('table')} 表`,
      n('view') && `${n('view')} 视图`,
      n('routine') && `${n('routine')} 函数/过程`,
      n('doc') && `${n('doc')} 文档段`,
    ]
      .filter(Boolean)
      .join(' + ')
    toast.success(
      L(
        `索引完成:${zh},${idx.value.mode === 'vector' ? '向量(混合检索)' : '词法'}模式`,
        `Indexed ${chunks.length} chunks (${idx.value.mode === 'vector' ? 'vector/hybrid' : 'lexical'})`,
      ),
    )
  } catch (e) {
    reportError(e, { tag: 'rag.build' })
  } finally {
    building.value = false
    progress.value = ''
  }
}

/** 重新读结构,与现有索引指纹比对,标记是否陈旧。 */
async function checkStale(): Promise<void> {
  if (!idx.value) return
  try {
    stale.value = isStale(idx.value, await gatherChunks())
    toast.info(
      stale.value
        ? L('结构已变,建议重建', 'schema changed — rebuild')
        : L('索引仍是最新', 'index up to date'),
    )
  } catch (e) {
    reportError(e, { tag: 'rag.checkStale' })
  }
}

async function ask(): Promise<void> {
  if (!idx.value || !question.value.trim()) return
  asking.value = true
  answer.value = ''
  sources.value = []
  try {
    const { hits, mode } = await searchIndex(idx.value, question.value, 6)
    usedMode.value = mode
    sources.value = hits.map((h) => ({ title: h.chunk.title, score: h.score }))
    const context = formatContext(hits)
    answer.value = await askAiChat({
      messages: [{ role: 'user', content: question.value }],
      dialect: dialectOf(),
      schema: context,
      extraSystem:
        'Answer using ONLY the provided schema context. Reference the relevant table names. ' +
        'If the context does not contain the answer, say so plainly.',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    answer.value = msg === 'NO_API_KEY' ? L('AI 未配置 API Key', 'AI API key not set') : `❌ ${msg}`
    reportError(e, { tag: 'rag.ask' })
  } finally {
    asking.value = false
  }
}

onMounted(async () => {
  try {
    conns.value = (await client.connections.list()).filter((c) => canIntrospect(c.dialect))
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <Modal v-if="open" :title="L('AI 知识库(RAG over schema)', 'AI knowledge base (RAG over schema)')" width="wide" @close="emit('close')">
    <div class="rag">
      <div class="bar">
        <select v-model="connId" @change="loadExisting">
          <option value="">{{ L('选连接', 'connection') }}</option>
          <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} ({{ c.dialect }})</option>
        </select>
        <input v-model="schemaName" :placeholder="L('schema(如 public / HR / dbo)', 'schema')" style="width: 160px" @change="loadExisting" />
        <button class="primary" :disabled="building || !connId || !schemaName" @click="build">
          {{ building ? (progress || '…') : L('构建索引', 'Build index') }}
        </button>
        <span v-if="idx" class="badge" :class="idx.mode">{{ idx.chunks.length }} {{ L('块', 'chunks') }} · {{ idx.mode === 'vector' ? L('向量·混合', 'vector·hybrid') : L('词法', 'lexical') }}</span>
        <button v-if="idx" class="ghost" :disabled="building" @click="checkStale">{{ L('检测变化', 'Check stale') }}</button>
        <span v-if="stale" class="badge stale">{{ L('结构已变,建议重建', 'stale — rebuild') }}</span>
        <span v-if="!canEmbed()" class="note">{{ L('当前 provider 无向量化 → 用词法检索', 'no embeddings on this provider → lexical') }}</span>
      </div>

      <details class="docs">
        <summary>{{ L('附加文档语料(可选,markdown,按 ## 标题分段)', 'Extra doc corpus (optional, markdown by ## headings)') }}</summary>
        <textarea v-model="docsText" rows="4" :placeholder="L('粘贴数据字典 / 业务说明 / README…构建时一并索引', 'Paste a data dictionary / business notes / README — indexed alongside the schema')"></textarea>
      </details>

      <div v-if="idx" class="ask">
        <textarea v-model="question" rows="2" class="q" :placeholder="L('问关于这个库的问题,如「订单和客户怎么关联?」', 'Ask about this database…')"></textarea>
        <button class="primary" :disabled="asking || !question.trim()" @click="ask">{{ asking ? '…' : L('提问', 'Ask') }}</button>
      </div>

      <p v-if="!idx" class="note hint">{{ L('先选连接 + schema,点「构建索引」。索引存本地,下次直接用。', 'Pick a connection + schema and build an index; it is stored locally for reuse.') }}</p>

      <div v-if="sources.length" class="sources">
        <span class="note">{{ L('引用', 'cited') }} ({{ usedMode === 'hybrid' ? L('混合', 'hybrid') : L('词法', 'lexical') }}):</span>
        <span v-for="(s, i) in sources" :key="i" class="src">{{ s.title }}</span>
      </div>

      <div v-if="answer" class="answer" v-html="renderMarkdown(answer)"></div>
    </div>
  </Modal>
</template>

<style scoped>
.rag { display: flex; flex-direction: column; gap: 12px; min-width: 720px; }
.bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.badge { font-size: 11px; padding: 1px 8px; border-radius: 4px; }
.badge.vector { background: #e8f0ff; color: #2d4fff; }
.badge.lexical { background: #f0f0f0; color: #888; }
.badge.stale { background: #fff3e0; color: #e67700; }
.ghost { background: transparent; border: 1px solid var(--border, #ddd); padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.ghost:disabled { opacity: .5; }
.docs summary { font-size: 12px; color: var(--fg-muted, #888); cursor: pointer; }
.docs textarea { width: 100%; margin-top: 6px; font-size: 12px; box-sizing: border-box; }
.note { font-size: 12px; color: var(--fg-muted, #888); }
.hint { background: var(--bg-subtle, #f7f7f7); padding: 8px 10px; border-radius: 6px; }
.ask { display: flex; gap: 8px; align-items: flex-start; }
.q { flex: 1; font-size: 13px; }
.sources { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.src { font-size: 11px; background: #eef5ff; color: #2d7ff9; padding: 1px 8px; border-radius: 4px; }
.answer { border-left: 3px solid var(--accent, #2d7ff9); padding: 6px 12px; font-size: 13px; }
.primary { background: var(--accent, #2d7ff9); color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
.primary:disabled { opacity: .5; }
</style>
