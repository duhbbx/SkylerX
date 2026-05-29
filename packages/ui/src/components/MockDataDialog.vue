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
import Modal from './Modal.vue'

const props = defineProps<{
  conn: ConnectionConfig
  tableRef: string
  tableName: string
  /** 从 metadata 取来的列：name / type / pk */
  baseColumns: { name: string; type: string; pk?: boolean }[]
}>()
const emit = defineEmits<{
  /** 用户点「生成」：把 SQL 草稿发出去（父组件灌进查询页） */
  generate: [sql: string]
  close: []
}>()

// ─── 状态 ─────────────────────────────────────────────────────────

const count = ref(20)
/** 每列的当前配置（kind / values / regex / range / nullProb） */
const cfg = ref<Record<string, MockColumn['semantic']>>({})
const previewSeed = ref(0) // 改了配置就 bump 触发预览重算

const STORAGE_KEY = computed(
  () => `skylerx.mockcfg.${props.conn.id}::${props.tableRef}`,
)

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

// 按 group 折叠的 kind 选项
const groupedKinds = computed(() => {
  const groups: Record<string, typeof SEMANTIC_KINDS> = {}
  for (const k of SEMANTIC_KINDS) {
    if (!groups[k.group]) groups[k.group] = []
    groups[k.group]!.push(k)
  }
  return groups
})

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

// ─── 生成 ──────────────────────────────────────────────────────────

function generate(): void {
  if (count.value < 1) {
    toast.warn(t('mock.invalidCount'))
    return
  }
  const sql = buildMockInserts(props.conn.dialect, props.tableRef, columns.value, count.value)
  if (!sql) {
    toast.warn(t('mock.empty'))
    return
  }
  emit('generate', sql)
  emit('close')
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
        <button class="ghost" :title="t('mock.resetHint')" @click="reset">
          {{ t('mock.reset') }}
        </button>
        <button class="ghost" :title="t('mock.saveHint')" @click="save">
          {{ t('mock.save') }}
        </button>
        <button class="primary" @click="generate">{{ t('mock.generate') }}</button>
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
                <select
                  :value="kindOf(c.name)"
                  class="kind-sel"
                  @change="setKind(c.name, ($event.target as HTMLSelectElement).value as SemanticKind)"
                >
                  <optgroup v-for="(items, g) in groupedKinds" :key="g" :label="g">
                    <option v-for="k in items" :key="k.kind" :value="k.kind">
                      {{ k.labelKey }}
                    </option>
                  </optgroup>
                </select>
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
}
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
  table-layout: fixed;
  font-size: 12px;
}
table.cols col.c-name { width: 18%; }
table.cols col.c-type { width: 14%; }
table.cols col.c-kind { width: 22%; }
table.cols col.c-extra { width: 30%; }
table.cols col.c-preview { width: 16%; }
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
  font-family: ui-monospace, monospace;
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
.ext-in.mono { font-family: ui-monospace, monospace; }
.range-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.num-in { width: 80px; }
.num-in.tiny { width: 56px; }
.dash { color: var(--muted); }
.null-prob {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 11px;
}
.preview {
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 4px;
}
.prev-val {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, monospace;
  color: var(--text);
}
.reroll {
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
