<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 「慢查询日志分析」对话框。
 *
 * 数据来源（按方言族）：
 *   - MySQL 族：performance_schema.events_statements_summary_by_digest
 *   - PG 族：pg_stat_statements
 *   - 其它方言：unsupported
 *
 * 与父容器的协作（emit）：
 *   - close          关闭对话框（标准）
 *   - openSql        (connId, sql) 把一条 SQL 推送到新查询页;父容器（Workspace）已有
 *                    `onDiffOpenSql(connId, sql)` 这样的现成 handler 可直接对接。
 *   - optimizeWithAi { connId, sql } 触发 AI 工具箱「优化 SQL」任务;父容器接住后
 *                    给 aiToolboxOpen 赋值 { task: 'optimize', sql, connId } 即可。
 *
 * 接入方式（不在本文件改 Workspace）：
 *   父组件挂载示例:
 *     <SlowQueryDialog v-if="slowOpen" :conn="slowOpen.conn" :open="true"
 *       @close="slowOpen = null"
 *       @open-sql="onDiffOpenSql"
 *       @optimize-with-ai="({ connId, sql }) => aiToolboxOpen = { task: 'optimize', sql, connId }" />
 *   defineExpose 暴露 reload(),便于父容器在菜单里手动触发。
 */
import type { ConnectionConfig, QueryResult } from '@db-tool/shared-types'
import { computed, onMounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { t } from '../i18n'
import {
  type SlowFamily,
  type SlowRow,
  type SlowSort,
  explainSqlFor,
  isEnabled,
  normalizeRows,
  slowFamilyOf,
  slowQueryFor,
} from '../slowQuery'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig; open: boolean }>()
const emit = defineEmits<{
  close: []
  openSql: [string, string]
  optimizeWithAi: [{ connId: string; sql: string }]
}>()
const client = useDataClient()

const family = computed<SlowFamily>(() => slowFamilyOf(props.conn.dialect))
const supported = computed(() => family.value !== 'other')

const loading = ref(false)
const error = ref<string | null>(null)
/** 慢日志未启用的提示文本（来自 slowQuery.ts 的 enableHint）；不为 null 则替代列表 */
const notEnabledHint = ref<string | null>(null)
const rows = ref<SlowRow[]>([])
const sort = ref<SlowSort>('totalMs')
const sourceLabel = ref<string>('')
const expandedIdx = ref<number | null>(null)
/** 内联 EXPLAIN 区域:idx → { running, error, result } */
const explainState = ref<
  Record<number, { running: boolean; error?: string; result?: QueryResult }>
>({})

const MAX_DIGEST_PREVIEW = 200

function digestPreview(sql: string): string {
  const s = sql.replace(/\s+/g, ' ').trim()
  return s.length > MAX_DIGEST_PREVIEW ? `${s.slice(0, MAX_DIGEST_PREVIEW)}…` : s
}

async function load(): Promise<void> {
  error.value = null
  notEnabledHint.value = null
  rows.value = []
  expandedIdx.value = null
  explainState.value = {}
  if (!supported.value) return
  const def = slowQueryFor(props.conn.dialect, {
    database: props.conn.database,
    sort: sort.value,
    limit: 50,
  })
  if (!def) return
  sourceLabel.value = def.sourceLabel
  loading.value = true
  try {
    // 1) 探测启用状态：失败 / 未启用 → 给开启提示，但不当作错误
    let checkRows: Array<Record<string, unknown>> = []
    try {
      const chk = await client.connections.execute(props.conn.id, def.checkSql)
      checkRows = chk.rows
    } catch {
      // checkSql 执行失败可能是权限不足/版本太老；后面再用 listSql 尝试,失败就给提示
    }
    if (!isEnabled(def.family, checkRows)) {
      notEnabledHint.value = def.enableHint
      return
    }
    // 2) 取 Top N
    const res = await client.connections.execute(
      props.conn.id,
      def.listSql,
      def.params,
    )
    rows.value = normalizeRows(def.family, res.rows)
    if (!rows.value.length) {
      // 列表空但启用了:可能是刚启动还没记录;不当 error,展示 empty 即可
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // listSql 失败常见原因:performance_schema/pg_stat_statements 没装/没权限。
    // 把开启提示一起带上,降低用户排障门槛。
    const def2 = slowQueryFor(props.conn.dialect)
    notEnabledHint.value = def2 ? def2.enableHint : null
    error.value = t('slowq.loadErr', { msg })
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (props.open) void load()
})
// 排序切换 → 重查（用 ORDER BY 重跑,行为更准）
watch(sort, () => {
  if (props.open) void load()
})
// 父容器从 v-if 改成 v-show 时也能响应
watch(
  () => props.open,
  (v) => {
    if (v) void load()
  },
)

async function copySql(sql: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(sql)
    toast.success(t('slowq.copied'))
  } catch {
    /* 剪贴板被禁:忽略 */
  }
}

function openAsQuery(sql: string): void {
  emit('openSql', props.conn.id, sql)
  emit('close')
}

function optimize(sql: string): void {
  emit('optimizeWithAi', { connId: props.conn.id, sql })
  emit('close')
}

async function runExplain(idx: number, sql: string): Promise<void> {
  const stmt = explainSqlFor(family.value, sql)
  if (!stmt) return
  explainState.value = { ...explainState.value, [idx]: { running: true } }
  try {
    const res = await client.connections.execute(props.conn.id, stmt)
    explainState.value = { ...explainState.value, [idx]: { running: false, result: res } }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    explainState.value = {
      ...explainState.value,
      [idx]: { running: false, error: t('slowq.explainErr', { msg }) },
    }
  }
}

function toggleExpand(idx: number): void {
  expandedIdx.value = expandedIdx.value === idx ? null : idx
}

defineExpose({
  /** 手动触发刷新（父容器从菜单触发时可用） */
  reload: load,
})
</script>

<template>
  <Modal :title="t('slowq.title')" width="xl" @close="emit('close')">
    <div class="slowq">
      <!-- 顶部工具栏 -->
      <div class="bar">
        <button class="btn" :disabled="loading" @click="load">
          {{ t('slowq.refresh') }}
        </button>
        <span class="lbl">{{ t('slowq.sortBy') }}</span>
        <select v-model="sort" class="sel" :disabled="loading">
          <option value="totalMs">{{ t('slowq.sort.totalMs') }}</option>
          <option value="avgMs">{{ t('slowq.sort.avgMs') }}</option>
          <option value="execCount">{{ t('slowq.sort.execCount') }}</option>
        </select>
        <span class="grow" />
        <span v-if="loading" class="muted">{{ t('common.loading') }}</span>
      </div>

      <!-- 错误条 -->
      <div v-if="error" class="banner err">✗ {{ error }}</div>

      <!-- 不支持当前方言 -->
      <div v-if="!supported" class="hint">
        {{ t('slowq.unsupported') }}
      </div>

      <!-- 慢日志未启用 / 扩展未装：把开启提示原样给出 -->
      <div v-else-if="notEnabledHint" class="enable-block">
        <div class="enable-title">{{ t('slowq.notEnabledTitle') }}</div>
        <div class="enable-hint">{{ t('slowq.notEnabledHint') }}</div>
        <pre class="enable-sql">{{ notEnabledHint }}</pre>
      </div>

      <!-- 主体表格 -->
      <div v-else-if="!loading && !rows.length" class="hint">
        {{ t('slowq.empty') }}
      </div>

      <div v-else class="table">
        <div class="thead">
          <span class="c-sql">{{ t('slowq.col.sql') }}</span>
          <span class="c-num">{{ t('slowq.col.calls') }}</span>
          <span class="c-num">{{ t('slowq.col.avgMs') }}</span>
          <span class="c-num">{{ t('slowq.col.totalMs') }}</span>
          <span class="c-num">{{ t('slowq.col.maxMs') }}</span>
          <span class="c-num">{{ t('slowq.col.rowsExam') }}</span>
        </div>
        <div class="tbody">
          <template v-for="(r, i) in rows" :key="i">
            <div
              class="trow"
              :class="{ on: expandedIdx === i }"
              @click="toggleExpand(i)"
            >
              <span class="c-sql" :title="r.sqlText">{{ digestPreview(r.sqlText) }}</span>
              <span class="c-num">{{ r.execCount }}</span>
              <span class="c-num">{{ r.avgMs }}</span>
              <span class="c-num">{{ r.totalMs }}</span>
              <span class="c-num">{{ r.maxMs }}</span>
              <span class="c-num">{{ r.rowsExamined ?? '—' }}</span>
            </div>
            <div v-if="expandedIdx === i" class="expand">
              <pre class="full-sql">{{ r.sqlText }}</pre>
              <div class="ops">
                <button class="btn" @click.stop="copySql(r.sqlText)">{{ t('slowq.copy') }}</button>
                <button class="btn" @click.stop="openAsQuery(r.sqlText)">
                  {{ t('slowq.openSql') }}
                </button>
                <button
                  class="btn"
                  :disabled="explainState[i]?.running"
                  @click.stop="runExplain(i, r.sqlText)"
                >
                  {{ explainState[i]?.running ? t('common.loading') : t('slowq.explainRun') }}
                </button>
                <button class="btn primary" @click.stop="optimize(r.sqlText)">
                  {{ t('slowq.aiOptimize') }}
                </button>
              </div>
              <!-- 内联 EXPLAIN 结果 -->
              <div v-if="explainState[i]?.error" class="explain-box err">
                {{ explainState[i]?.error }}
              </div>
              <div v-else-if="explainState[i]?.result" class="explain-box">
                <div class="explain-title">{{ t('slowq.explainTitle') }}</div>
                <div class="explain-grid">
                  <div class="ex-head">
                    <span v-for="c in explainState[i]!.result!.columns" :key="c.name">{{ c.name }}</span>
                  </div>
                  <div
                    v-for="(row, ri) in explainState[i]!.result!.rows"
                    :key="ri"
                    class="ex-row"
                  >
                    <span v-for="c in explainState[i]!.result!.columns" :key="c.name">
                      {{ row[c.name] == null ? '' : String(row[c.name]) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- 底部状态栏 -->
      <p v-if="supported && !notEnabledHint && rows.length" class="foot">
        {{ t('slowq.foot', { n: rows.length, source: sourceLabel, window: t('slowq.windowSinceStart') }) }}
      </p>
    </div>
  </Modal>
</template>

<style scoped>
.slowq {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-width: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bar .grow {
  flex: 1;
}
.bar .lbl {
  color: var(--muted);
  font-size: 12px;
}
.bar select,
.bar button {
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
}
.bar button:disabled,
.bar select:disabled {
  opacity: 0.5;
  cursor: default;
}
.muted {
  color: var(--muted);
  font-size: 13px;
}
.banner.err {
  color: var(--err, #e04050);
  font-size: 13px;
}
.hint {
  font-size: 13px;
  color: var(--muted);
  padding: 24px 8px;
  text-align: center;
}
.enable-block {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 14px;
  background: var(--bg);
}
.enable-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.enable-hint {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
}
.enable-sql {
  margin: 0;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
}

.table {
  border: 1px solid var(--border);
  border-radius: 6px;
  max-height: 56vh;
  overflow: auto;
}
/* 列宽：SQL 摘要占满,其余固定窄列 */
.thead,
.trow {
  display: grid;
  grid-template-columns: 1fr 80px 100px 100px 100px 110px;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  font-size: 12px;
}
.thead {
  font-weight: 600;
  color: var(--muted);
  background: var(--panel);
  position: sticky;
  top: 0;
  z-index: 1;
  border-bottom: 1px solid var(--border);
}
.trow {
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}
.trow:hover {
  background: rgba(124, 108, 255, 0.1);
}
.trow.on {
  background: rgba(124, 108, 255, 0.18);
}
.c-sql {
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.c-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.expand {
  padding: 10px 14px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.full-sql {
  margin: 0 0 8px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
}
.ops {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.ops .btn {
  padding: 5px 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}
.ops .btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.ops .btn.primary {
  background: var(--accent, #7c6cff);
  border-color: var(--accent, #7c6cff);
  color: #fff;
}
.explain-box {
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--panel);
  font-size: 12px;
}
.explain-box.err {
  color: var(--err, #e04050);
}
.explain-title {
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--muted);
}
.explain-grid {
  max-height: 200px;
  overflow: auto;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.ex-head,
.ex-row {
  display: flex;
  gap: 10px;
  padding: 2px 0;
  border-bottom: 1px dashed var(--border);
}
.ex-head {
  font-weight: 600;
  color: var(--muted);
}
.ex-head span,
.ex-row span {
  flex: 1;
  min-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.foot {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
</style>
