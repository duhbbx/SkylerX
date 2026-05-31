<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * #6 可视化查询构建器 v1（参考 dbgate / SSMS Query Designer）。
 *
 * MVP 不做拖拽画布 —— 走更稳的列表 + 卡片布局：
 *   1. 顶部：选当前 conn 的当前库 → 拉表清单
 *   2. 左侧栏：可勾选的表列表
 *   3. 中间：勾选了的表 → 展开列卡片，每列前面可勾选「输出此列」
 *   4. 自动检测勾中表之间的 FK，生成 INNER JOIN
 *   5. 顶部 WHERE / ORDER BY 输入
 *   6. 底部：实时生成的 SQL，「打开为新查询 tab」按钮
 *
 * v2 可扩展：拖拽画布 + SVG 连线 + 列别名 + GROUP BY UI / 函数聚合 /
 *           手工添加 JOIN（非 FK）/ 多 schema 支持
 */
import { type ConnectionConfig, MetaNodeKind } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { quoteId } from '../ddl'
import { toast } from '../dialog'
import { reportInlineError } from '../errorReporter'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig }>()
const emit = defineEmits<{
  openSql: [sql: string]
  close: []
}>()
const client = useDataClient()

interface TableInfo {
  name: string
  sqlName: string
}
interface ColInfo {
  name: string
  dataType?: string
  primaryKey?: boolean
}
interface FkEdge {
  from: string // table
  fromCol: string
  to: string // ref table
  toCol: string
}

const tables = ref<TableInfo[]>([])
const tableFilter = ref('')
/** 用户勾选的表名集合 */
const selectedTables = ref<Set<string>>(new Set())
/** 表 → 列信息（懒加载） */
const tableCols = ref<Record<string, ColInfo[]>>({})
const colsLoading = ref<Set<string>>(new Set())
/** 表 → 该表勾中要 SELECT 的列名集合（缺省时显示星号 * ） */
const selectedCols = ref<Record<string, Set<string>>>({})
/** 表 → 该表向外引用的 FK（懒加载） */
const tableFks = ref<Record<string, FkEdge[]>>({})

const whereClause = ref('')
const orderClause = ref('')
const limitN = ref(200)
const loading = ref(false)
const error = ref<string | null>(null)

// ── 加载表列表 ──
async function loadTables(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const dbPath = props.conn.database ? [props.conn.database] : []
    const nodes = await client.connections.metadata(props.conn.id, {
      parentKind: MetaNodeKind.Group,
      path: dbPath,
      group: 'tables',
    })
    tables.value = nodes.map((n) => ({
      name: n.name,
      sqlName: n.sqlName ?? quoteId(props.conn.dialect, n.name),
    }))
  } catch (e) {
    reportInlineError(error, e)
  } finally {
    loading.value = false
  }
}
onMounted(loadTables)

const filteredTables = computed(() => {
  const f = tableFilter.value.trim().toLowerCase()
  return f ? tables.value.filter((t) => t.name.toLowerCase().includes(f)) : tables.value
})

// ── 勾选 / 取消勾选表 ──
async function toggleTable(name: string): Promise<void> {
  if (selectedTables.value.has(name)) {
    selectedTables.value.delete(name)
    selectedTables.value = new Set(selectedTables.value)
    return
  }
  selectedTables.value.add(name)
  selectedTables.value = new Set(selectedTables.value)
  await loadTableCols(name)
  await loadTableFks(name)
}

async function loadTableCols(name: string): Promise<void> {
  if (tableCols.value[name] || colsLoading.value.has(name)) return
  colsLoading.value.add(name)
  try {
    const dbPath = props.conn.database ? [props.conn.database] : []
    const nodes = await client.connections.metadata(props.conn.id, {
      parentKind: MetaNodeKind.Group,
      path: [...dbPath, name],
      group: 'columns',
    })
    tableCols.value[name] = nodes.map((n) => ({
      name: n.name,
      dataType: n.detail?.dataType,
      primaryKey: !!n.detail?.primaryKey,
    }))
  } catch {
    tableCols.value[name] = []
  } finally {
    colsLoading.value.delete(name)
  }
}

async function loadTableFks(name: string): Promise<void> {
  if (tableFks.value[name]) return
  try {
    const dbPath = props.conn.database ? [props.conn.database] : []
    const fkNodes = await client.connections.metadata(props.conn.id, {
      parentKind: MetaNodeKind.Group,
      path: [...dbPath, name],
      group: 'keys',
    })
    // SkylerX 的 keys 节点信息有限；这里用 SELECT information_schema 兜底
    // 简化：v1 暂只用名字推测（user_id 对 users.id 这类约定俗成）
    // 真正落地：用 incomingForeignKeysQuery 之类。这里偷个懒先不做精细推断
    void fkNodes
    tableFks.value[name] = inferConventionalFks(name)
  } catch {
    tableFks.value[name] = []
  }
}

/**
 * v1 朴素 FK 推断：列名形如 <table_singular>_id 或 <table>Id 时认为指向 <table>.id。
 * 真实 FK 元数据查询很方言相关，v2 接驳 ddl.ts 已有的 existingForeignKeysQuery。
 */
function inferConventionalFks(table: string): FkEdge[] {
  const cols = tableCols.value[table] ?? []
  const edges: FkEdge[] = []
  for (const c of cols) {
    const m = /^(.+?)_id$|^(.+?)Id$/.exec(c.name)
    if (!m) continue
    const refStem = m[1] ?? m[2] ?? ''
    if (!refStem) continue
    // 尝试匹配：refStem / refStem+'s' 表名都试
    const candidates = [refStem, `${refStem}s`]
    for (const cand of candidates) {
      const t = tables.value.find((tt) => tt.name.toLowerCase() === cand.toLowerCase())
      if (t) {
        edges.push({ from: table, fromCol: c.name, to: t.name, toCol: 'id' })
        break
      }
    }
  }
  return edges
}

// ── 列勾选 ──
function toggleCol(table: string, col: string): void {
  const set = selectedCols.value[table] ?? new Set()
  if (set.has(col)) set.delete(col)
  else set.add(col)
  selectedCols.value = { ...selectedCols.value, [table]: new Set(set) }
}
function isColSelected(table: string, col: string): boolean {
  return selectedCols.value[table]?.has(col) ?? false
}
function anyColSelected(table: string): boolean {
  return (selectedCols.value[table]?.size ?? 0) > 0
}

// ── 自动 JOIN 边：仅勾中表之间 ──
const autoJoinEdges = computed<FkEdge[]>(() => {
  const sel = selectedTables.value
  const edges: FkEdge[] = []
  for (const tab of sel) {
    for (const e of tableFks.value[tab] ?? []) {
      if (sel.has(e.to) && e.from !== e.to) edges.push(e)
    }
  }
  return edges
})

// ── 生成 SQL ──
const generatedSql = computed<string>(() => {
  const sel = [...selectedTables.value]
  if (!sel.length) return ''
  const q = (s: string) => quoteId(props.conn.dialect, s)
  // SELECT 列：每张表勾中的列；都没勾就 *
  const selectParts: string[] = []
  for (const tab of sel) {
    if (anyColSelected(tab)) {
      for (const c of selectedCols.value[tab] ?? []) {
        selectParts.push(`${q(tab)}.${q(c)} AS ${q(`${tab}_${c}`)}`)
      }
    } else {
      selectParts.push(`${q(tab)}.*`)
    }
  }
  // FROM + JOIN：第一个表打头，其余按自动 join 边接
  let fromSql = q(sel[0] ?? '')
  const joined = new Set([sel[0]])
  const remaining = sel.slice(1)
  while (remaining.length) {
    let progressed = false
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i] as string
      // 找一条 cand 与 joined 之间的边
      const edge = autoJoinEdges.value.find(
        (e) => (e.from === cand && joined.has(e.to)) || (e.to === cand && joined.has(e.from)),
      )
      if (!edge) continue
      const [left, leftCol, right, rightCol] = joined.has(edge.to)
        ? [edge.to, edge.toCol, edge.from, edge.fromCol]
        : [edge.from, edge.fromCol, edge.to, edge.toCol]
      fromSql += `\n  INNER JOIN ${q(right)} ON ${q(left)}.${q(leftCol)} = ${q(right)}.${q(rightCol)}`
      joined.add(cand)
      remaining.splice(i, 1)
      progressed = true
      break
    }
    if (!progressed) {
      // 找不到 FK 路径 → CROSS JOIN（用户注意效率）
      const cand = remaining.shift() as string
      fromSql += `\n  CROSS JOIN ${q(cand)}`
      joined.add(cand)
    }
  }
  let sqlOut = `SELECT ${selectParts.join(', ')}\nFROM ${fromSql}`
  if (whereClause.value.trim()) sqlOut += `\nWHERE ${whereClause.value.trim()}`
  if (orderClause.value.trim()) sqlOut += `\nORDER BY ${orderClause.value.trim()}`
  if (limitN.value > 0) sqlOut += `\nLIMIT ${Math.floor(limitN.value)}`
  return sqlOut
})

function openInTab(): void {
  if (!generatedSql.value) {
    toast.warn(t('vqd.noTables'))
    return
  }
  emit('openSql', generatedSql.value)
  emit('close')
}
</script>

<template>
  <Modal
    :title="t('vqd.title', { conn: conn.name || conn.dialect })"
    width="xl"
    fixed-height
    storage-key="visual-query-designer"
    @close="emit('close')"
  >
    <div class="vqd">
      <!-- 顶部工具栏 -->
      <div class="bar">
        <span class="muted" v-if="conn.database">DB: {{ conn.database }}</span>
        <span class="spacer" />
        <button class="primary" :disabled="!selectedTables.size" @click="openInTab">
          {{ t('vqd.openSql') }}
        </button>
      </div>

      <div v-if="error" class="err">⚠ {{ error }}</div>

      <div class="body">
        <!-- 左侧：表列表 -->
        <div class="side">
          <input v-model="tableFilter" :placeholder="t('vqd.searchPh')" class="search" />
          <div v-if="loading" class="muted pad">{{ t('vqd.loading') }}</div>
          <div v-else class="t-list">
            <label v-for="tab in filteredTables" :key="tab.name" class="t-row">
              <input
                type="checkbox"
                :checked="selectedTables.has(tab.name)"
                @change="toggleTable(tab.name)"
              />
              <span>{{ tab.name }}</span>
            </label>
            <div v-if="!filteredTables.length" class="muted pad">{{ t('vqd.empty') }}</div>
          </div>
        </div>

        <!-- 中间：已选表的列卡片 -->
        <div class="canvas">
          <div v-if="!selectedTables.size" class="canvas-empty">
            {{ t('vqd.canvasHint') }}
          </div>
          <div v-else class="t-cards">
            <div v-for="tab in [...selectedTables]" :key="tab" class="t-card">
              <div class="card-head">
                <span class="card-title">{{ tab }}</span>
                <button class="card-x" :title="t('common.close')" @click="toggleTable(tab)">×</button>
              </div>
              <div v-if="colsLoading.has(tab)" class="muted pad">{{ t('vqd.loadingCols') }}</div>
              <ul v-else class="card-cols">
                <li v-for="c in tableCols[tab] ?? []" :key="c.name">
                  <label>
                    <input
                      type="checkbox"
                      :checked="isColSelected(tab, c.name)"
                      @change="toggleCol(tab, c.name)"
                    />
                    <span class="cname">{{ c.name }}</span>
                    <span class="ctype">{{ c.dataType }}</span>
                    <span v-if="c.primaryKey" class="pk">PK</span>
                  </label>
                </li>
                <li v-if="!anyColSelected(tab)" class="hint-star muted">
                  {{ t('vqd.hintStar') }}
                </li>
              </ul>
            </div>
          </div>
          <!-- 自动 JOIN 边描述 -->
          <div v-if="autoJoinEdges.length" class="join-info">
            <div class="join-title">{{ t('vqd.autoJoins', { n: autoJoinEdges.length }) }}</div>
            <ul>
              <li v-for="(e, i) in autoJoinEdges" :key="i">
                {{ e.from }}.{{ e.fromCol }} → {{ e.to }}.{{ e.toCol }}
              </li>
            </ul>
          </div>
        </div>

        <!-- 右侧：WHERE / ORDER / LIMIT 输入 -->
        <div class="cond">
          <label>WHERE</label>
          <textarea v-model="whereClause" :placeholder="t('vqd.wherePh')" rows="3" />
          <label>ORDER BY</label>
          <input v-model="orderClause" :placeholder="t('vqd.orderPh')" />
          <label>LIMIT</label>
          <input v-model.number="limitN" type="number" min="0" />
        </div>
      </div>

      <!-- 底部：SQL 预览 -->
      <div class="preview">
        <div class="preview-head">{{ t('vqd.preview') }}</div>
        <pre>{{ generatedSql || t('vqd.empty') }}</pre>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.vqd {
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
.muted { color: var(--muted); font-size: 12px; }
.spacer { flex: 1; }
.bar .primary {
  padding: 5px 14px;
  background: var(--accent, #7c6cff);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.bar .primary:disabled { opacity: 0.55; cursor: not-allowed; }
.err {
  padding: 6px 10px;
  background: rgba(224, 64, 80, 0.10);
  border: 1px solid rgba(224, 64, 80, 0.40);
  border-radius: 4px;
  color: #e04050;
  font-size: 12px;
}
.body {
  display: grid;
  grid-template-columns: 220px 1fr 200px;
  gap: 8px;
  flex: 1 1 auto;
  min-height: 0;
}
.side, .canvas, .cond {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.side .search {
  padding: 5px 8px;
  background: var(--bg);
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: 12px;
}
.t-list { flex: 1; overflow-y: auto; }
.t-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}
.t-row:hover { background: rgba(124, 108, 255, 0.06); }
.canvas { padding: 8px; overflow: auto; }
.canvas-empty {
  padding: 60px 20px;
  text-align: center;
  color: var(--muted);
  font-style: italic;
}
.t-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}
.t-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.card-head {
  display: flex;
  align-items: center;
  padding: 5px 8px;
  background: rgba(124, 108, 255, 0.10);
  border-bottom: 1px solid var(--border);
}
.card-title { flex: 1; font-weight: 600; font-size: 12px; }
.card-x {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 14px;
}
.card-cols {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  max-height: 220px;
  overflow-y: auto;
}
.card-cols li label {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}
.card-cols li label:hover { background: rgba(124, 108, 255, 0.06); }
.cname { flex: 1; font-family: var(--font-mono); }
.ctype { color: var(--muted); font-size: 10px; }
.pk {
  background: rgba(255, 200, 64, 0.18);
  color: #e0a020;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 600;
}
.hint-star { padding: 4px 8px; font-style: italic; font-size: 11px; }
.join-info {
  margin-top: 12px;
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
}
.join-title { color: var(--accent); font-weight: 600; }
.join-info ul { margin: 4px 0 0 16px; padding: 0; color: var(--muted); }
.cond {
  padding: 8px;
  gap: 4px;
}
.cond label { font-size: 11px; color: var(--muted); margin-top: 4px; }
.cond textarea, .cond input {
  padding: 4px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}
.preview {
  flex: none;
  max-height: 200px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.preview-head {
  padding: 4px 10px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
}
.preview pre {
  margin: 0;
  padding: 8px 12px;
  flex: 1;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text);
}
.pad { padding: 12px; }
</style>
