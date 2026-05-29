<script setup lang="ts">/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 「AI 工具箱」（#9 / #10 / #17 / #18 / #19 / #20 / #21 的统一入口）。
 *
 * 7 类常用 AI 任务共用一张表单，省去为每个特性单独做右键 / 工具栏的代价。
 * 选好类型 + 上下文后点「让 AI 干」→ 关闭本对话框 + 把 prompt 发给右侧聊天面板。
 */
import type { ConnectionConfig, MetadataNode } from '@db-tool/shared-types'
import { MetaNodeKind } from '@db-tool/shared-types'
import { computed, onMounted, ref, watch } from 'vue'
import {
  pDataDictDoc,
  pExplainAnalysis,
  pExplainTable,
  pMigration,
  pNl2Sql,
  pOptimizeSql,
  pTestData,
} from '../ai-prompts'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { t } from '../i18n'
import Modal from './Modal.vue'

type Task =
  | 'migration' // #9
  | 'optimize' // #10
  | 'explain-analysis' // #17
  | 'test-data' // #18
  | 'nl2sql' // #19
  | 'doc' // #20
  | 'explain-table' // #21

const props = defineProps<{
  /** 默认选定的任务（可选） */
  initialTask?: Task
  /** 默认填入的 SQL（QueryPane 弹出时把当前 SQL 带过来） */
  initialSql?: string
  /** 默认填入的 EXPLAIN 文本 */
  initialExplain?: string
  /** 默认连接 ID */
  initialConnId?: string
  /** 默认表名（schema.table 形式） */
  initialTable?: string
}>()
const emit = defineEmits<{
  close: []
  /** 用户点「让 AI 干」：把拼好的 prompt 与连接信息上抛，由 Workspace 转发到 chat */
  submit: [payload: { prompt: string; connId: string; connName?: string; withSchema: boolean }]
}>()

const client = useDataClient()
const conns = ref<ConnectionConfig[]>([])
const task = ref<Task>(props.initialTask ?? 'nl2sql')
const connId = ref<string>(props.initialConnId ?? '')
const table = ref<string>(props.initialTable ?? '')
const sql = ref<string>(props.initialSql ?? '')
const explain = ref<string>(props.initialExplain ?? '')
const userIntent = ref<string>('') // migration / nl2sql 的需求描述
const rowCount = ref<number>(20) // test-data 的行数
const businessHint = ref<string>('') // test-data 的业务背景

// 表选择：需要 table 的任务，加载该连接下所有表（懒加载，避免每次开都拉）
const tables = ref<string[]>([])
const loadingTables = ref(false)

const needsTable = computed(
  () =>
    task.value === 'migration' ||
    task.value === 'doc' ||
    task.value === 'explain-table' ||
    task.value === 'test-data',
)
const needsSql = computed(
  () => task.value === 'optimize' || task.value === 'explain-analysis' || task.value === 'nl2sql',
)
const needsExplain = computed(() => task.value === 'optimize' || task.value === 'explain-analysis')

onMounted(async () => {
  conns.value = await client.connections.list()
  if (!connId.value && conns.value.length) connId.value = conns.value[0].id
})

watch(connId, async (cid) => {
  if (!cid || !needsTable.value) return
  await loadTables()
})

watch(task, async () => {
  if (needsTable.value && connId.value && !tables.value.length) await loadTables()
})

async function loadTables(): Promise<void> {
  if (!connId.value) return
  loadingTables.value = true
  try {
    const conn = conns.value.find((c) => c.id === connId.value)
    if (!conn) return
    // 简化：所有方言通用，假设有默认 database / schema 就用，否则用第一个 schema
    let nodes: MetadataNode[] = []
    try {
      // 拉 database 列表（MySQL）或 schema（PG）
      nodes = await client.connections.metadata(connId.value, {
        parentKind: MetaNodeKind.Connection,
        path: [],
      })
    } catch {
      /* ignore */
    }
    if (!nodes.length) return
    // 取第一个 db/schema，往下钻一层到 tables group
    const first = nodes[0]
    const tablesGroup = await client.connections
      .metadata(connId.value, {
        parentKind: MetaNodeKind.Group,
        path: [...first.path],
        group: 'tables',
      })
      .catch(() => [] as MetadataNode[])
    tables.value = tablesGroup.map((n) => n.sqlName ?? n.name)
    if (!table.value && tables.value.length) table.value = tables.value[0]
  } finally {
    loadingTables.value = false
  }
}

const dialect = computed(() => conns.value.find((c) => c.id === connId.value)?.dialect ?? 'mysql')
const connName = computed(() => conns.value.find((c) => c.id === connId.value)?.name ?? '')

async function fetchColumnsCsv(): Promise<string> {
  // 通过 schema 节点路径拿列；这里走 information_schema 反而更可控
  try {
    const r = await client.connections.execute(
      connId.value,
      `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
              COLUMN_KEY AS \`key\`, COLUMN_DEFAULT AS \`default\`
       FROM information_schema.COLUMNS
       WHERE TABLE_NAME = '${table.value.replace(/^.*\./, '').replace(/['"\`]/g, '')}'
       ORDER BY ORDINAL_POSITION`,
    )
    return r.rows
      .map(
        (row) =>
          `- ${row.name} ${row.type}${row.nullable === 'NO' ? ' NOT NULL' : ''}${row.key ? ` ${row.key}` : ''}${row.default ? ` DEFAULT ${row.default}` : ''}`,
      )
      .join('\n')
  } catch {
    return '（拉取列定义失败，AI 仅基于附带的 schema 上下文推断）'
  }
}

async function submit(): Promise<void> {
  if (!connId.value) {
    toast.error(t('aitool.noConn'))
    return
  }
  let prompt = ''
  if (task.value === 'migration') {
    if (!table.value || !userIntent.value.trim()) {
      toast.error(t('aitool.missingFields'))
      return
    }
    prompt = pMigration({ tableRef: table.value, dialect: dialect.value }, userIntent.value)
  } else if (task.value === 'optimize') {
    if (!sql.value.trim()) {
      toast.error(t('aitool.missingFields'))
      return
    }
    prompt = pOptimizeSql({ dialect: dialect.value }, sql.value, explain.value || undefined)
  } else if (task.value === 'explain-analysis') {
    if (!sql.value.trim() || !explain.value.trim()) {
      toast.error(t('aitool.missingFields'))
      return
    }
    prompt = pExplainAnalysis({ dialect: dialect.value }, sql.value, explain.value)
  } else if (task.value === 'test-data') {
    if (!table.value) {
      toast.error(t('aitool.missingFields'))
      return
    }
    prompt = pTestData(
      { tableRef: table.value, dialect: dialect.value },
      rowCount.value,
      businessHint.value,
    )
  } else if (task.value === 'nl2sql') {
    if (!userIntent.value.trim()) {
      toast.error(t('aitool.missingFields'))
      return
    }
    prompt = pNl2Sql({ dialect: dialect.value }, userIntent.value)
  } else if (task.value === 'doc') {
    if (!table.value) {
      toast.error(t('aitool.missingFields'))
      return
    }
    const cols = await fetchColumnsCsv()
    prompt = pDataDictDoc({ tableRef: table.value, dialect: dialect.value }, cols)
  } else if (task.value === 'explain-table') {
    if (!table.value) {
      toast.error(t('aitool.missingFields'))
      return
    }
    const cols = await fetchColumnsCsv()
    prompt = pExplainTable({ tableRef: table.value, dialect: dialect.value }, cols, '')
  }
  emit('submit', { prompt, connId: connId.value, connName: connName.value, withSchema: true })
  emit('close')
}
</script>

<template>
  <Modal :title="t('aitool.title')" @close="emit('close')">
    <div class="aitool">
      <!-- 任务选择 -->
      <div class="task-grid">
        <button :class="{ on: task === 'migration' }" @click="task = 'migration'">
          <div class="t-emoji">📝</div>
          <div class="t-name">{{ t('aitool.task.migration') }}</div>
          <div class="t-desc">{{ t('aitool.taskDesc.migration') }}</div>
        </button>
        <button :class="{ on: task === 'optimize' }" @click="task = 'optimize'">
          <div class="t-emoji">⚡</div>
          <div class="t-name">{{ t('aitool.task.optimize') }}</div>
          <div class="t-desc">{{ t('aitool.taskDesc.optimize') }}</div>
        </button>
        <button :class="{ on: task === 'explain-analysis' }" @click="task = 'explain-analysis'">
          <div class="t-emoji">🔍</div>
          <div class="t-name">{{ t('aitool.task.explainAnalysis') }}</div>
          <div class="t-desc">{{ t('aitool.taskDesc.explainAnalysis') }}</div>
        </button>
        <button :class="{ on: task === 'test-data' }" @click="task = 'test-data'">
          <div class="t-emoji">🧪</div>
          <div class="t-name">{{ t('aitool.task.testData') }}</div>
          <div class="t-desc">{{ t('aitool.taskDesc.testData') }}</div>
        </button>
        <button :class="{ on: task === 'nl2sql' }" @click="task = 'nl2sql'">
          <div class="t-emoji">💬</div>
          <div class="t-name">{{ t('aitool.task.nl2sql') }}</div>
          <div class="t-desc">{{ t('aitool.taskDesc.nl2sql') }}</div>
        </button>
        <button :class="{ on: task === 'doc' }" @click="task = 'doc'">
          <div class="t-emoji">📚</div>
          <div class="t-name">{{ t('aitool.task.doc') }}</div>
          <div class="t-desc">{{ t('aitool.taskDesc.doc') }}</div>
        </button>
        <button :class="{ on: task === 'explain-table' }" @click="task = 'explain-table'">
          <div class="t-emoji">🧭</div>
          <div class="t-name">{{ t('aitool.task.explainTable') }}</div>
          <div class="t-desc">{{ t('aitool.taskDesc.explainTable') }}</div>
        </button>
      </div>

      <!-- 通用：连接 -->
      <label class="row">
        <span class="lbl">{{ t('aichat.conn') }}</span>
        <select v-model="connId" class="grow">
          <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name || c.id }} · {{ c.dialect }}</option>
        </select>
      </label>

      <!-- 需要表的任务 -->
      <label v-if="needsTable" class="row">
        <span class="lbl">{{ t('aitool.table') }}</span>
        <input v-model="table" class="grow" :placeholder="loadingTables ? '…' : 'schema.table'" list="aitool-tables" />
        <datalist id="aitool-tables">
          <option v-for="t in tables" :key="t" :value="t" />
        </datalist>
      </label>

      <!-- migration / nl2sql：需求描述 -->
      <label v-if="task === 'migration' || task === 'nl2sql'" class="row col">
        <span class="lbl">{{ t('aitool.intent') }}</span>
        <textarea v-model="userIntent" rows="3" :placeholder="task === 'migration' ? t('aitool.intentMigPh') : t('aitool.intentNlPh')" />
      </label>

      <!-- optimize / explain-analysis：原 SQL + 可选 EXPLAIN -->
      <label v-if="needsSql" class="row col">
        <span class="lbl">SQL</span>
        <textarea v-model="sql" rows="4" placeholder="SELECT ..." spellcheck="false" />
      </label>
      <label v-if="needsExplain" class="row col">
        <span class="lbl">EXPLAIN</span>
        <textarea v-model="explain" rows="4" :placeholder="t('aitool.explainPh')" spellcheck="false" />
      </label>

      <!-- test-data：行数 + 业务背景 -->
      <template v-if="task === 'test-data'">
        <label class="row">
          <span class="lbl">{{ t('aitool.rowCount') }}</span>
          <input v-model.number="rowCount" type="number" min="1" max="500" />
        </label>
        <label class="row col">
          <span class="lbl">{{ t('aitool.business') }}</span>
          <textarea v-model="businessHint" rows="2" :placeholder="t('aitool.businessPh')" />
        </label>
      </template>

      <div class="actions">
        <button class="ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="primary" @click="submit">✨ {{ t('aitool.submit') }}</button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.aitool {
  min-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.task-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 4px;
}
.task-grid button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.task-grid button:hover { background: rgba(124, 108, 255, 0.08); }
.task-grid button.on {
  background: rgba(124, 108, 255, 0.14);
  border-color: var(--accent, #7c6cff);
}
.t-emoji { font-size: 16px; }
.t-name { font-size: 12px; font-weight: 600; }
.t-desc { font-size: 10px; color: var(--muted); }
.row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.row.col {
  align-items: stretch;
  flex-direction: column;
  gap: 4px;
}
.row .lbl {
  width: 100px;
  flex: none;
  font-size: 12px;
  color: var(--muted);
}
.row.col .lbl { width: auto; }
.row .grow { flex: 1; }
.row select, .row input[type='text'], .row input[type='number'], .row input:not([type]) {
  padding: 4px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
}
.row textarea {
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.actions button {
  padding: 5px 14px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid var(--border);
  cursor: pointer;
}
.actions .ghost { background: transparent; color: var(--text); }
.actions .ghost:hover { background: rgba(124, 108, 255, 0.10); }
.actions .primary { background: var(--accent, #7c6cff); color: #fff; border-color: var(--accent, #7c6cff); }
.actions .primary:hover { filter: brightness(1.1); }
</style>
