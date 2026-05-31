<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * #8 NDJSON 文件查看器（参考 dbgate）：
 *   - 用户选 .ndjson / .jsonl 文件 → 在表格里查看每行 JSON
 *   - 自动归并列：所有行的 union 字段，缺失显示 null
 *   - 行间右侧显示原始 JSON（双击行）
 *   - 跟 dbgate Archives 互通：识别 {__table, data} 形式 → 按 __table 分组显示
 *
 * v1 仅查看（read-only）；后续可加：编辑、按 __table 过滤、导出某表。
 */
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { reportError } from '../errorReporter'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{
  /** 已读到的文件名（外层 Workspace 弹文件选择，把 name + content 一起传进来） */
  file: { name: string; content: string }
}>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()

interface Row {
  raw: Record<string, unknown>
  /** 识别出的归属表（{__table,data} 形式时取 __table，否则空） */
  table: string
}

const rows = ref<Row[]>([])
const parseError = ref<string | null>(null)
const skipped = ref(0)
const activeTable = ref<string>('') // 空串 = 全部
const detail = ref<Row | null>(null)

function parse(): void {
  const lines = props.file.content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const parsed: Row[] = []
  let skip = 0
  for (const ln of lines) {
    try {
      const obj = JSON.parse(ln) as Record<string, unknown>
      // 识别 {__table, data} 包装
      if (typeof obj.__table === 'string' && obj.data && typeof obj.data === 'object') {
        parsed.push({ raw: obj.data as Record<string, unknown>, table: obj.__table })
      } else if (typeof obj.__error === 'string') {
        skip++
      } else {
        parsed.push({ raw: obj, table: '' })
      }
    } catch {
      skip++
    }
  }
  rows.value = parsed
  skipped.value = skip
  parseError.value = parsed.length === 0 ? t('ndjson.empty') : null
}

onMounted(parse)

/** 所有出现过的表名（用于 tab 切换；空集时显示 'All'） */
const tableNames = computed(() => {
  const s = new Set<string>()
  for (const r of rows.value) if (r.table) s.add(r.table)
  return [...s].sort()
})

const filteredRows = computed(() =>
  activeTable.value ? rows.value.filter((r) => r.table === activeTable.value) : rows.value,
)

/** 所有列名的并集（每张表/每个 row 字段可能不同） */
const columns = computed<string[]>(() => {
  const s = new Set<string>()
  for (const r of filteredRows.value) for (const k of Object.keys(r.raw)) s.add(k)
  return [...s]
})

function cellText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

async function copyAll(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.file.content)
    toast.success(t('ndjson.copied'))
  } catch {
    reportError(new Error(t('ndjson.copyFail')))
  }
}

async function saveCopy(): Promise<void> {
  if (!client.files) return
  await client.files.saveText({
    defaultName: props.file.name,
    content: props.file.content,
    filters: [{ name: 'NDJSON', extensions: ['ndjson', 'jsonl'] }],
  })
}
</script>

<template>
  <Modal
    :title="t('ndjson.title', { name: file.name })"
    width="xl"
    fixed-height
    storage-key="ndjson-viewer"
    @close="emit('close')"
  >
    <div class="ndj">
      <div class="bar">
        <span class="muted">
          {{ t('ndjson.summary', { n: rows.length, skip: skipped }) }}
        </span>
        <span v-if="tableNames.length" class="tabs">
          <button :class="{ on: !activeTable }" @click="activeTable = ''">
            {{ t('ndjson.tabAll') }}
          </button>
          <button
            v-for="tn in tableNames"
            :key="tn"
            :class="{ on: activeTable === tn }"
            @click="activeTable = tn"
          >
            {{ tn }}
          </button>
        </span>
        <span class="spacer" />
        <button class="ghost" @click="copyAll">{{ t('ndjson.copy') }}</button>
        <button class="ghost" @click="saveCopy">{{ t('ndjson.save') }}</button>
      </div>

      <div v-if="parseError" class="err">{{ parseError }}</div>

      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="rownum">#</th>
              <th v-if="!activeTable && tableNames.length" class="table-col">
                {{ t('ndjson.colTable') }}
              </th>
              <th v-for="c in columns" :key="c">{{ c }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in filteredRows"
              :key="i"
              :class="{ active: detail === r }"
              @dblclick="detail = detail === r ? null : r"
            >
              <td class="rownum">{{ i + 1 }}</td>
              <td v-if="!activeTable && tableNames.length" class="table-col">{{ r.table }}</td>
              <td
                v-for="c in columns"
                :key="c"
                :class="{ nullcell: r.raw[c] == null }"
                :title="cellText(r.raw[c])"
              >
                {{ cellText(r.raw[c]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 行详情：双击行显示完整 JSON -->
      <div v-if="detail" class="detail">
        <div class="detail-head">
          <span class="muted">{{ t('ndjson.detailHead') }}</span>
          <button class="x" @click="detail = null">×</button>
        </div>
        <pre>{{ JSON.stringify(detail.raw, null, 2) }}</pre>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.ndj {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  font-size: 12px;
}
.muted { color: var(--muted); }
.spacer { flex: 1; }
.tabs {
  display: inline-flex;
  gap: 4px;
}
.tabs button {
  padding: 3px 10px;
  font-size: 11px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 4px;
  cursor: pointer;
}
.tabs button.on { border-color: var(--accent); color: var(--accent); }
.bar .ghost {
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 4px;
  cursor: pointer;
}
.bar .ghost:hover { background: rgba(124, 108, 255, 0.10); }
.err {
  padding: 24px;
  text-align: center;
  color: var(--muted);
  font-style: italic;
}
.table-wrap {
  flex: 1 1 auto;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
}
thead {
  position: sticky;
  top: 0;
  background: var(--panel);
  z-index: 1;
}
th, td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
  font-family: var(--font-mono);
}
th { font-weight: 600; color: var(--text); }
tr.active { background: rgba(124, 108, 255, 0.10); }
tbody tr:hover { background: rgba(124, 108, 255, 0.05); }
.rownum {
  width: 40px;
  color: var(--muted);
  text-align: right;
  font-family: var(--font-mono);
}
.table-col {
  font-weight: 600;
  color: var(--accent);
}
.nullcell { color: var(--muted); font-style: italic; }
.nullcell::before { content: 'null'; }
.detail {
  flex: none;
  max-height: 240px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.detail-head {
  display: flex;
  align-items: center;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}
.detail-head .x {
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
}
.detail pre {
  margin: 0;
  padding: 8px 12px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
}
</style>
