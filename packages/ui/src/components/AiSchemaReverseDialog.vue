<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * AI schema 反向工程:
 *  - 用户粘贴 CSV / TSV / JSON sample 数据(只要前几行就够)
 *  - AI 推断每列类型 + 是否 NULL + 主键候选 + 推荐索引
 *  - 生成 CREATE TABLE SQL,用户可编辑并执行
 *  - 可选:同时生成 INSERT 把 sample 数据写入
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { askAiChat, extractSql } from '../ai'
import { confirm as appConfirm, toast } from '../dialog'
import { renderMarkdown } from '../markdown'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  database?: string
}>()

const emit = defineEmits<{ close: [] }>()

type Format = 'csv' | 'tsv' | 'json'
const format = ref<Format>('csv')
const sampleText = ref('')
const tableName = ref('inferred_table')
const includeInsert = ref(false)
const result = ref('')
const running = ref(false)
const executing = ref(false)
const sqlEdit = ref('')

function buildPrompt(): string {
  return `请基于下面的 ${format.value.toUpperCase()} 示例数据,反向推断 schema 并生成 ${props.conn.dialect} 方言的 CREATE TABLE SQL,以及可选 INSERT 语句。

要求:
1. 推断每列**最合适**的类型(考虑长度、是否纯数字、是否日期、是否 enum 等)
2. 推断哪些列适合做**主键**(自增 vs 业务键)、哪些**必须 NOT NULL**
3. 推荐 1-2 个**索引候选**(基于经验:外键样的列、常用过滤列)
4. 表名: \`${tableName.value}\`
${includeInsert.value ? '5. 生成对应的 INSERT 语句(把示例数据全部插入)' : ''}

示例数据:
\`\`\`
${sampleText.value}
\`\`\`

请严格按这个结构输出:

### 推断说明
(列名 → 类型 → 理由,2-3 句)

### CREATE TABLE
\`\`\`sql
CREATE TABLE ...
\`\`\`

${includeInsert.value ? `### INSERT(数据)
\`\`\`sql
INSERT INTO ...
\`\`\`
` : ''}### 索引建议
- ...
`
}

async function run(): Promise<void> {
  if (!sampleText.value.trim()) {
    toast.warn('请粘贴示例数据')
    return
  }
  running.value = true
  result.value = ''
  try {
    const text = await askAiChat({
      messages: [{ role: 'user', content: buildPrompt() }],
      dialect: props.conn.dialect,
      extraSystem: 'You are a data engineer. Infer the most reasonable schema from sample data. Be concise but specific about type choices.',
    })
    result.value = text
    sqlEdit.value = extractSql(text)
  } catch (e) {
    result.value = `**调用 AI 失败**: ${e instanceof Error ? e.message : String(e)}\n\n请确认设置里的 AI Provider / API Key。`
  } finally {
    running.value = false
  }
}

const resultHtml = computed(() => (result.value ? renderMarkdown(result.value) : ''))

async function execute(): Promise<void> {
  if (!sqlEdit.value.trim()) {
    toast.warn('SQL 为空')
    return
  }
  if (
    !(await appConfirm({
      message: `在 ${props.database ? props.database : '当前默认库'} 执行 SQL ?`,
      variant: 'warn',
    }))
  )
    return
  executing.value = true
  try {
    // 拆成多条;简易按 ; 换行分
    const ctx = props.database ? { database: props.database } : {}
    const useDataClient = (await import('../data-client')).useDataClient
    const client = useDataClient()
    const stmts = sqlEdit.value
      .split(/;\s*(?:\n|$)/)
      .map((s) => s.trim().replace(/;$/, ''))
      .filter(Boolean)
    for (const s of stmts) {
      await client.connections.execute(props.conn.id, s, [], ctx)
    }
    toast.success('已执行')
    emit('close')
  } catch (e) {
    toast.error(`执行失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    executing.value = false
  }
}

watch(
  () => props.open,
  (op) => {
    if (op) {
      result.value = ''
      sqlEdit.value = ''
    }
  },
)
</script>

<template>
  <Modal v-if="open" :title="`AI 反向推断 schema  ·  ${conn.name || conn.dialect}`" width="xl" fixed-height storage-key="ai-schema-reverse" @close="emit('close')">
    <div class="form">
      <div class="row two">
        <div>
          <label class="lbl">格式</label>
          <div class="seg">
            <button :class="{ on: format === 'csv' }" @click="format = 'csv'">CSV</button>
            <button :class="{ on: format === 'tsv' }" @click="format = 'tsv'">TSV</button>
            <button :class="{ on: format === 'json' }" @click="format = 'json'">JSON</button>
          </div>
        </div>
        <div>
          <label class="lbl">表名</label>
          <input v-model="tableName" class="ip" />
        </div>
      </div>

      <div class="row">
        <label class="lbl">示例数据(几行就够,带表头/字段名最准)</label>
        <textarea
          v-model="sampleText"
          class="code"
          spellcheck="false"
          rows="10"
          :placeholder="format === 'json'
            ? '[\n  {&quot;id&quot;: 1, &quot;email&quot;: &quot;a@x.com&quot;, &quot;created_at&quot;: &quot;2026-01-01&quot;},\n  {&quot;id&quot;: 2, ...}\n]'
            : format === 'tsv'
              ? 'id\\tname\\temail\\n1\\talice\\ta@x.com'
              : 'id,name,email,created_at\n1,alice,a@x.com,2026-01-01\n2,bob,b@x.com,2026-01-02'"
        />
      </div>

      <div class="row run-row">
        <label class="lbl-inline">
          <input v-model="includeInsert" type="checkbox" /> 同时生成 INSERT
        </label>
        <button class="btn-primary" :disabled="running" @click="run">
          {{ running ? '✨ 推断中…' : '✨ 推断 schema' }}
        </button>
      </div>

      <div v-if="resultHtml" class="result md-body" v-html="resultHtml" />

      <div v-if="sqlEdit" class="sql-row">
        <label class="lbl">SQL(可编辑后执行)</label>
        <textarea v-model="sqlEdit" class="sql" spellcheck="false" rows="8" />
        <div class="exec-row">
          <button class="btn-primary" :disabled="executing" @click="execute">
            {{ executing ? '执行中…' : '▶ 执行' }}
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; flex-direction: column; gap: 4px; }
.row.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.lbl { font-size: 11px; color: var(--muted); font-weight: 600; }
.lbl-inline { font-size: 11px; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
.seg { display: inline-flex; gap: 4px; }
.seg button { padding: 4px 12px; font-size: 11px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; background: var(--bg); color: var(--muted); }
.seg button.on { background: rgba(124, 108, 255, 0.18); color: var(--text); border-color: var(--accent); }
.ip, .code, .sql { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; color: var(--text); font-family: var(--font-mono); font-size: 12px; }
.code, .sql { resize: vertical; }
.run-row, .exec-row { flex-direction: row; align-items: center; gap: 10px; }
.btn-primary, .btn-ghost { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 13px; }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-ghost { background: transparent; color: var(--muted); }
.result { padding: 12px 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; max-height: 30vh; overflow: auto; }
:deep(.md-body h3) { color: var(--accent); margin: 10px 0 4px; font-size: 13px; }
:deep(.md-body p), :deep(.md-body li) { line-height: 1.6; font-size: 12px; }
:deep(.md-body pre) { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 6px; font-size: 11px; }
:deep(.md-body code) { background: var(--bg); padding: 1px 4px; border-radius: 2px; font-size: 11px; }
.sql-row { display: flex; flex-direction: column; gap: 4px; }
.sql { border-color: var(--accent); }
</style>
