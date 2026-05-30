<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 测试数据生成对话框 v2（用户报告：原版按类型随机太弱，需要按字段语义生成）。
 *
 * 特性：
 *  - 自动按列名 + SQL 类型推断 SemanticKind（detectSemantic）
 *  - 每列可手动覆盖：在下拉里挑（中文姓名 / 身份证 / 手机 / 地址 …）
 *  - 自定义：enum 候选 / regex 模式 / 数值范围 / NULL 概率
 *  - 实时预览每列的示例值
 *  - 配置持久化：按 connId + 表名 key 存 localStorage，下次自动加载
 *  - AI 推断（如果配过 AI provider）：一键让 LLM 按列名分类
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { computed, onMounted, ref, watch } from 'vue'
import { askAiChat } from '../ai'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, toast } from '../dialog'
import { t } from '../i18n'
import {
  type MockColumn,
  SEMANTIC_KINDS,
  type SemanticKind,
  buildMockInserts,
  detectSemantic,
  previewSample,
} from '../mockgen'
import { settings } from '../settings'
import { splitStatements } from '../sqlSplit'
import Modal from './Modal.vue'
import ThemedSelect from './ThemedSelect.vue'

const client = useDataClient()

const props = defineProps<{
  conn: ConnectionConfig
  tableRef: string
  tableName: string
  /** 从 metadata 取来的列：name / type / pk */
  baseColumns: { name: string; type: string; pk?: boolean }[]
}>()
const emit = defineEmits<{
  /** 用户点「生成」:把 SQL 草稿发出去(父组件灌进查询页) */
  generate: [sql: string]
  /** 用户点「直接执行」:由父组件调 client.connections.execute 写入数据库 */
  execute: [sql: string]
  close: []
}>()

// ─── 状态 ─────────────────────────────────────────────────────────

const count = ref(20)
/** 每列的当前配置（kind / values / regex / range / nullProb） */
const cfg = ref<Record<string, MockColumn['semantic']>>({})
const previewSeed = ref(0) // 改了配置就 bump 触发预览重算

const STORAGE_KEY = computed(() => `skylerx.mockcfg.${props.conn.id}::${props.tableRef}`)

// 把配置 + 基础列合并成 MockColumn 列表
const columns = computed<MockColumn[]>(() =>
  props.baseColumns.map((c) => ({
    name: c.name,
    type: c.type,
    pk: c.pk,
    semantic: cfg.value[c.name] ?? { kind: detectSemantic(c.name, c.type) },
  })),
)

const previews = computed(() => {
  void previewSeed.value // 依赖 bump
  const out: Record<string, string> = {}
  for (const c of columns.value) out[c.name] = previewSample(c)
  return out
})

/**
 * 扁平化给 ThemedSelect 用 — 它通过 option.group 字段识别分组并插 header。
 * 注意保持 SEMANTIC_KINDS 原顺序(用户的"人 → 联系 → 地址 …"心智),不要按 kind 排序。
 */
const kindOptions = computed(() =>
  SEMANTIC_KINDS.map((k) => ({ value: k.kind, label: k.labelKey, group: k.group })),
)

// ─── 持久化 ────────────────────────────────────────────────────────

interface SavedCfg {
  count: number
  columns: Record<string, MockColumn['semantic']>
  updatedAt: number
}

function loadSaved(): SavedCfg | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY.value)
    if (!raw) return null
    return JSON.parse(raw) as SavedCfg
  } catch {
    return null
  }
}

function save(): void {
  try {
    const payload: SavedCfg = {
      count: count.value,
      columns: cfg.value,
      updatedAt: Date.now(),
    }
    localStorage.setItem(STORAGE_KEY.value, JSON.stringify(payload))
    toast.success(t('mock.saved'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function reset(): Promise<void> {
  const ok = await appConfirm({
    message: t('mock.resetConfirm'),
    variant: 'warn',
  })
  if (!ok) return
  cfg.value = {}
  // 重新按列名推断
  for (const c of props.baseColumns) {
    cfg.value[c.name] = { kind: detectSemantic(c.name, c.type) }
  }
  localStorage.removeItem(STORAGE_KEY.value)
  bumpPreview()
}

function bumpPreview(): void {
  previewSeed.value++
}

// 首次加载：有保存的就用，否则按名字推断
onMounted(() => {
  const saved = loadSaved()
  if (saved) {
    count.value = saved.count
    cfg.value = saved.columns
  } else {
    for (const c of props.baseColumns) {
      cfg.value[c.name] = { kind: detectSemantic(c.name, c.type) }
    }
  }
})

// 配置变化时刷新预览
watch(cfg, bumpPreview, { deep: true })

// ─── 配置编辑 ──────────────────────────────────────────────────────

function setKind(colName: string, kind: SemanticKind): void {
  const cur = cfg.value[colName] ?? {}
  cfg.value = { ...cfg.value, [colName]: { ...cur, kind } }
}
function setValues(colName: string, csv: string): void {
  const values = csv
    .split(/[,，;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const cur = cfg.value[colName] ?? { kind: 'enum' }
  cfg.value = { ...cfg.value, [colName]: { ...cur, values } }
}
function setRegex(colName: string, regex: string): void {
  const cur = cfg.value[colName] ?? { kind: 'regex' }
  cfg.value = { ...cfg.value, [colName]: { ...cur, regex } }
}
function setRange(colName: string, key: 'min' | 'max' | 'precision', v: string): void {
  const n = Number(v)
  if (!Number.isFinite(n)) return
  const cur = cfg.value[colName] ?? { kind: 'integer' }
  const range = { min: 0, max: 1000, precision: 2, ...(cur.range ?? {}), [key]: n }
  cfg.value = { ...cfg.value, [colName]: { ...cur, range } }
}
function setNullProb(colName: string, v: string): void {
  const n = Math.max(0, Math.min(1, Number(v) || 0))
  const cur = cfg.value[colName] ?? { kind: 'auto' }
  cfg.value = { ...cfg.value, [colName]: { ...cur, nullProb: n } }
}

// 当前列的 kind（用于在模板里判断哪些扩展字段要显示）
function kindOf(colName: string): SemanticKind {
  return cfg.value[colName]?.kind ?? detectSemantic(colName, '')
}

// ─── AI 推断 ──────────────────────────────────────────────────────

const aiBusy = ref(false)
/** 检查当前 AI provider 是否配过 key（按钮 disabled 用） */
const aiConfigured = computed(() => {
  const cfg = settings.aiProviders[settings.aiProvider]
  return !!cfg?.apiKey?.trim() && !!cfg?.baseUrl?.trim()
})

/**
 * 让 AI 看一遍所有列，按列名 + SQL 类型推断 SemanticKind。
 * 失败 / 解析不到 → toast，不破坏现有 cfg。
 */
async function aiInfer(): Promise<void> {
  if (!aiConfigured.value) {
    toast.warn(t('mock.aiNoKey'))
    return
  }
  aiBusy.value = true
  try {
    const kindList = SEMANTIC_KINDS.map((k) => k.kind).join(', ')
    const colsText = props.baseColumns
      .map((c) => `- ${c.name} (${c.type})${c.pk ? ' [PK]' : ''}`)
      .join('\n')
    // prompt 用英文：模型对英文 JSON instruction 反应更稳；返回的 kind 都是 ascii
    const prompt = `You are helping generate realistic test data for a SQL table.

Given the column list below, infer the most likely "semantic kind" for each column by looking at:
  - The column name (English / Chinese / pinyin / abbreviation all possible)
  - The SQL type
  - The [PK] marker (primary keys often get 'auto')

Pick ONE kind per column from this exact allow-list (anything else is invalid):
${kindList}

Notes:
  - For Chinese context columns (name/姓名 → name_cn, 手机/phone → phone_cn, 身份证 → id_card_cn, 地址 → address_cn etc.) prefer the _cn variants.
  - DO NOT pick "auto" — it produces meaningless random text. Always pick a concrete kind.
  - For integer-ish numeric columns (Oracle NUMBER without scale, INT/BIGINT, count, age, status, etc.) pick "integer".
  - For money/price/amount/cost columns pick "money"; for decimal/float pick "decimal".
  - For ID-like primary keys (NUMBER + [PK], or any int + [PK]) pick "integer" — caller auto-increments PKs.
  - For status/state/role columns prefer "enum" (caller will fill values later).
  - For description/content/remark/note prefer "lorem_cn".

Columns:
${colsText}

Respond with ONLY a JSON object mapping column name to kind, nothing else. Example:
{"user_id":"auto","name":"name_cn","mobile":"phone_cn"}`

    const reply = await askAiChat({
      messages: [{ role: 'user', content: prompt }],
      dialect: props.conn.dialect,
    })

    // 抓第一段 { ... }（容忍模型前后多余文字）
    const m = reply.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('AI did not return JSON')
    const parsed = JSON.parse(m[0]) as Record<string, string>

    const allowed = new Set(SEMANTIC_KINDS.map((k) => k.kind))
    const next = { ...cfg.value }
    let applied = 0
    for (const [name, kind] of Object.entries(parsed)) {
      if (!allowed.has(kind as SemanticKind)) continue
      const exists = props.baseColumns.some((c) => c.name === name)
      if (!exists) continue
      const cur = next[name] ?? {}
      next[name] = { ...cur, kind: kind as SemanticKind }
      applied++
    }
    cfg.value = next
    bumpPreview()
    toast.success(t('mock.aiSuccess', { n: applied }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'NO_API_KEY') toast.warn(t('mock.aiNoKey'))
    else toast.error(t('mock.aiFail', { err: msg.slice(0, 80) }))
  } finally {
    aiBusy.value = false
  }
}

// ─── 生成 ──────────────────────────────────────────────────────────

function buildSql(): string | null {
  if (count.value < 1) {
    toast.warn(t('mock.invalidCount'))
    return null
  }
  const sql = buildMockInserts(props.conn.dialect, props.tableRef, columns.value, count.value)
  if (!sql) {
    toast.warn(t('mock.empty'))
    return null
  }
  return sql
}

function generate(): void {
  const sql = buildSql()
  if (!sql) return
  emit('generate', sql)
  emit('close')
}

// ─── 直接执行(带进度,弹框不关) ────────────────────────────────────
// 改前: emit('execute', sql) 然后父组件执行并立刻 emit('close') —— 用户看不到进度,
//        且一旦关掉弹框就丢失了已配置的 mock 规则。
// 改后: 在 dialog 内分段执行(splitStatements 切分 INSERT chunks),按已执行 chunk 数
//       更新进度条。用户可随时按"取消"中止;成功后弹框不会自动关,用户决定继续调
//       配置还是手动关。
//       (仍保留 emit('execute') 兼容旧调用方,但 SkylerX 内已不再依赖它。)

const execProgress = ref<null | {
  done: number // 已成功执行的 chunk 数
  total: number // 总 chunk 数
  rowsDone: number // 已写入行数
  rowsTotal: number // 目标总行数
  state: 'running' | 'success' | 'error' | 'cancelled'
  error?: string
}>(null)
let cancelExec = false

async function execute(): Promise<void> {
  const sql = buildSql()
  if (!sql) return
  if (
    !(await appConfirm({
      message: `确认在 ${props.tableRef} 写入 ${count.value} 行测试数据?`,
      variant: 'warn',
    }))
  )
    return

  // 把 SQL 按 ; 切成 INSERT chunk;buildMockInserts 每 chunk 默认 100 行
  const stmts = splitStatements(sql).filter((s) => s.trim())
  const rowsPerChunk = 100
  cancelExec = false
  execProgress.value = {
    done: 0,
    total: stmts.length,
    rowsDone: 0,
    rowsTotal: count.value,
    state: 'running',
  }

  for (let i = 0; i < stmts.length; i++) {
    if (cancelExec) {
      execProgress.value = { ...execProgress.value, state: 'cancelled' }
      toast.warn(`已取消,已写入 ${execProgress.value.rowsDone} 行`)
      return
    }
    try {
      await client.connections.execute(props.conn.id, stmts[i])
      const rowsDone = Math.min((i + 1) * rowsPerChunk, count.value)
      execProgress.value = { ...execProgress.value, done: i + 1, rowsDone }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      execProgress.value = {
        ...execProgress.value,
        state: 'error',
        error: errMsg,
      }
      // 出错的 INSERT 通常是某个 chunk 触发了约束 / 类型不兼容,把 SQL+连接信息
      // 一起丢给 AI 最快能定位(NOT NULL 列没值 / FK 不存在 / 类型不匹配等)
      toast.error(`执行失败: ${errMsg.slice(0, 100)}`, {
        askAi: {
          sql: stmts[i],
          error: errMsg,
          connId: props.conn.id,
          connName: props.conn.name,
          dialect: props.conn.dialect,
        },
      })
      return
    }
  }

  execProgress.value = { ...execProgress.value, state: 'success' }
  toast.success(`已写入 ${count.value} 行到 ${props.tableRef}`)
  // 兼容老版本订阅 execute 的父组件(实际已不依赖 SQL,只是个完成事件)
  emit('execute', sql)
}

function cancelExecution(): void {
  cancelExec = true
}
function clearProgress(): void {
  execProgress.value = null
}

/** 手动加载已保存配置(覆盖当前未保存的) */
async function loadFromSaved(): Promise<void> {
  const s = loadSaved()
  if (!s) {
    toast.warn('未找到保存的配置')
    return
  }
  if (
    !(await appConfirm({
      message: `加载已保存配置(${new Date(s.updatedAt).toLocaleString()}),会覆盖当前修改?`,
      variant: 'warn',
    }))
  )
    return
  count.value = s.count
  cfg.value = s.columns
  bumpPreview()
  toast.success('已加载')
}
</script>

<template>
  <Modal
    :title="t('mock.title', { name: tableName })"
    width="xl"
    fixed-height
    storage-key="mock-data"
    @close="emit('close')"
  >
    <div class="mock">
      <!-- 顶部工具栏：行数 + 操作按钮 -->
      <div class="bar">
        <label class="count-row">
          <span>{{ t('mock.count') }}</span>
          <input v-model.number="count" type="number" min="1" max="100000" class="count-in" />
        </label>
        <span class="muted">{{ t('mock.cols', { n: baseColumns.length }) }}</span>
        <span class="spacer" />
        <button
          class="ghost ai"
          :disabled="aiBusy || !aiConfigured"
          :title="aiConfigured ? t('mock.aiInferHint') : t('mock.aiNoKey')"
          @click="aiInfer"
        >
          {{ aiBusy ? t('mock.aiInferring') : t('mock.aiInfer') }}
        </button>
        <button class="ghost" :title="t('mock.resetHint')" @click="reset">
          {{ t('mock.reset') }}
        </button>
        <button class="ghost" :title="t('mock.saveHint')" @click="save">
          {{ t('mock.save') }}
        </button>
        <button class="ghost" title="从保存配置加载(覆盖当前)" @click="loadFromSaved">
          加载
        </button>
        <button class="primary" :disabled="execProgress?.state === 'running'" @click="generate">{{ t('mock.generate') }}</button>
        <button class="primary" title="直接执行,不打开查询页" :disabled="execProgress?.state === 'running'" @click="execute">▶ 直接执行</button>
      </div>

      <!-- 直接执行进度条:运行中显示进度+取消; 终态(成功/失败/取消)显示总结+关闭. -->
      <div v-if="execProgress" class="progress-bar" :class="execProgress.state">
        <div class="pg-track">
          <div class="pg-fill" :style="{ width: ((execProgress.done / Math.max(1, execProgress.total)) * 100) + '%' }" />
        </div>
        <div class="pg-meta">
          <span class="pg-text">
            <template v-if="execProgress.state === 'running'">
              正在写入 {{ execProgress.rowsDone }} / {{ execProgress.rowsTotal }} 行 ({{ execProgress.done }} / {{ execProgress.total }} 批)
            </template>
            <template v-else-if="execProgress.state === 'success'">
              ✓ 完成:{{ execProgress.rowsDone }} 行已写入 {{ tableRef }}
            </template>
            <template v-else-if="execProgress.state === 'cancelled'">
              ⊘ 已取消,已写入 {{ execProgress.rowsDone }} 行
            </template>
            <template v-else>
              ✗ 失败 (已写 {{ execProgress.rowsDone }} 行):{{ execProgress.error }}
            </template>
          </span>
          <button v-if="execProgress.state === 'running'" class="ghost sm" @click="cancelExecution">取消</button>
          <button v-else class="ghost sm" @click="clearProgress">关闭进度</button>
        </div>
      </div>

      <!-- 列配置表格 -->
      <div class="table-wrap">
        <table class="cols">
          <colgroup>
            <col class="c-name" />
            <col class="c-type" />
            <col class="c-kind" />
            <col class="c-extra" />
            <col class="c-preview" />
          </colgroup>
          <thead>
            <tr>
              <th>{{ t('mock.col.name') }}</th>
              <th>{{ t('mock.col.type') }}</th>
              <th>{{ t('mock.col.kind') }}</th>
              <th>{{ t('mock.col.extra') }}</th>
              <th>{{ t('mock.col.preview') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in baseColumns" :key="c.name" :class="{ pk: c.pk }">
              <td class="name">
                {{ c.name }}
                <span v-if="c.pk" class="pk-flag">PK</span>
              </td>
              <td class="type">{{ c.type }}</td>
              <td>
                <ThemedSelect
                  :model-value="kindOf(c.name)"
                  :options="kindOptions"
                  :width="180"
                  :max-height="360"
                  @update:model-value="(v) => setKind(c.name, v as SemanticKind)"
                />
              </td>
              <td>
                <!-- enum: CSV 候选 -->
                <input
                  v-if="kindOf(c.name) === 'enum' || kindOf(c.name) === 'fixed'"
                  :value="(cfg[c.name]?.values ?? []).join(',')"
                  :placeholder="kindOf(c.name) === 'enum' ? t('mock.enumPh') : t('mock.fixedPh')"
                  class="ext-in"
                  @input="setValues(c.name, ($event.target as HTMLInputElement).value)"
                />
                <!-- regex 模板 -->
                <input
                  v-else-if="kindOf(c.name) === 'regex'"
                  :value="cfg[c.name]?.regex ?? ''"
                  :placeholder="t('mock.regexPh')"
                  class="ext-in mono"
                  @input="setRegex(c.name, ($event.target as HTMLInputElement).value)"
                />
                <!-- 数值范围 -->
                <span
                  v-else-if="['integer','decimal','money','age'].includes(kindOf(c.name))"
                  class="range-row"
                >
                  <input
                    type="number"
                    :value="cfg[c.name]?.range?.min ?? 0"
                    :placeholder="t('mock.min')"
                    class="num-in"
                    @input="setRange(c.name, 'min', ($event.target as HTMLInputElement).value)"
                  />
                  <span class="dash">~</span>
                  <input
                    type="number"
                    :value="cfg[c.name]?.range?.max ?? 1000"
                    :placeholder="t('mock.max')"
                    class="num-in"
                    @input="setRange(c.name, 'max', ($event.target as HTMLInputElement).value)"
                  />
                  <input
                    v-if="kindOf(c.name) === 'decimal' || kindOf(c.name) === 'money'"
                    type="number"
                    :value="cfg[c.name]?.range?.precision ?? 2"
                    :placeholder="t('mock.precision')"
                    class="num-in tiny"
                    min="0"
                    max="6"
                    @input="setRange(c.name, 'precision', ($event.target as HTMLInputElement).value)"
                  />
                </span>
                <!-- NULL 概率（除主键外都可设） -->
                <label v-if="!c.pk" class="null-prob">
                  <span class="muted">NULL</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    :value="cfg[c.name]?.nullProb ?? 0"
                    class="num-in tiny"
                    @input="setNullProb(c.name, ($event.target as HTMLInputElement).value)"
                  />
                </label>
              </td>
              <td class="preview" :title="previews[c.name]">
                <span class="prev-val">{{ previews[c.name] }}</span>
                <button class="reroll" :title="t('mock.reroll')" @click="bumpPreview">↻</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.mock {
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
  flex: none;
}
.count-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  flex-shrink: 0;
  white-space: nowrap;
}
.count-row span { white-space: nowrap; flex-shrink: 0; }
.count-in {
  width: 80px;
  padding: 4px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.spacer { flex: 1; }
.progress-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  flex: none;
}
.progress-bar.success {
  border-color: rgba(76, 175, 80, 0.5);
  background: rgba(76, 175, 80, 0.06);
}
.progress-bar.error {
  border-color: rgba(224, 64, 80, 0.5);
  background: rgba(224, 64, 80, 0.06);
}
.progress-bar.cancelled {
  border-color: rgba(255, 152, 0, 0.5);
  background: rgba(255, 152, 0, 0.06);
}
.pg-track {
  height: 6px;
  background: var(--bg);
  border-radius: 3px;
  overflow: hidden;
}
.pg-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease-out;
}
.progress-bar.success .pg-fill {
  background: #4caf50;
}
.progress-bar.error .pg-fill {
  background: var(--err, #e04050);
}
.pg-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.pg-text {
  flex: 1;
  color: var(--text);
}
.pg-meta .sm {
  padding: 3px 10px !important;
  font-size: 11px !important;
}
.bar button {
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--border);
}
.bar .ghost {
  background: transparent;
  color: var(--text);
}
.bar .ghost:hover {
  background: rgba(124, 108, 255, 0.10);
}
.bar .ghost.ai {
  color: var(--accent, #7c6cff);
  border-color: var(--accent, #7c6cff);
}
.bar .ghost.ai:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  background: transparent;
}
.bar .primary {
  background: var(--accent, #7c6cff);
  color: white;
  border-color: var(--accent, #7c6cff);
}

.table-wrap {
  flex: 1 1 auto;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
table.cols {
  width: 100%;
  border-collapse: collapse;
  /* auto 让浏览器按内容自适应:列名/类型不会被截短,语义/配置在剩余空间里自由扩展
     (旧 fixed 18%/14%/22%/30%/16% 把短列名也强拉成 18% 浪费空间,长列名又被切掉) */
  table-layout: auto;
  font-size: 12px;
}
/* min-width 是"宁可让窄列再窄一点"的下限,实际宽度由 auto 决定 */
table.cols col.c-name { min-width: 100px; }
table.cols col.c-type { min-width: 90px; }
table.cols col.c-kind { min-width: 180px; }
table.cols col.c-extra { min-width: 220px; }
table.cols col.c-preview { min-width: 140px; }
table.cols thead {
  position: sticky;
  top: 0;
  background: var(--panel);
  z-index: 1;
}
table.cols th,
table.cols td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}
table.cols tr.pk {
  background: rgba(124, 108, 255, 0.04);
}
.name {
  font-weight: 600;
  word-break: break-word;
}
.pk-flag {
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 10px;
  background: rgba(255, 200, 64, 0.18);
  color: #e0a020;
  border-radius: 3px;
}
.type {
  color: var(--muted);
  font-family: var(--font-mono);
  word-break: break-word;
}
.kind-sel,
.ext-in,
.num-in {
  width: 100%;
  padding: 3px 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
}
.ext-in.mono { font-family: var(--font-mono); }
.range-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  flex-wrap: nowrap; /* range 区域 min~max 不要折行 */
}
.range-row .num-in { width: auto; flex: 1 1 0; min-width: 60px; }
.num-in { width: 80px; }
.num-in.tiny { width: 56px; flex: 0 0 56px; }
.dash { color: var(--muted); flex: none; }
.null-prob {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 11px;
  white-space: nowrap; /* "NULL 0" 不要被压成两行 */
}
/* td 保持 table-cell — 之前 display:flex 把 cell 脱出表行流,导致与其它列错位 */
.preview {
  color: var(--muted);
  white-space: nowrap;
}
.prev-val {
  display: inline-block;
  vertical-align: middle;
  max-width: calc(100% - 32px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  color: var(--text);
}
.reroll {
  display: inline-block;
  vertical-align: middle;
  margin-left: 6px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
}
.reroll:hover { color: var(--accent, #7c6cff); }
</style>
