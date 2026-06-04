<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * #24 NavTree 可见库/Schema 过滤配置 (v2: 二级 schema).
 *
 * 数据形态:
 *   - extra.visibleDatabases?: string[]                       — 顶层白名单
 *   - extra.visibleDatabasesTotal?: number                    — chip 分母 snapshot
 *   - extra.visibleSchemas?: Record<dbName, string[]>          — 库下 schema 白名单 (v2)
 *
 * UI: 顶层 checkbox 列表 (databases or top-level schemas);
 *     当条目是 database (kind=database) 时, 多一个展开器, 点击异步 fetch 该库的 schemas
 *     渲染为子级 checkbox. 父勾全 = 不进 visibleSchemas, 部分勾 = 持久该数组.
 *     父节点 unchecked → 子节点禁用 (UI 一致但不参与保存).
 */
import type { ConnectionConfig, MetadataNode } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { reportError } from '../errorReporter'
import Modal from './Modal.vue'
import { isSystemMetaNode } from './tree-actions'

const props = defineProps<{ conn: ConnectionConfig | null }>()
const emit = defineEmits<{
  close: []
  saved: []
}>()

const client = useDataClient()

const loading = ref(false)
const error = ref<string | null>(null)
/** 顶层节点列表 (databases or schemas, 取决于方言) */
const items = ref<MetadataNode[]>([])
/** 已勾选的名字集. 进入对话框时按 conn.extra.visibleDatabases 初始化;
 *  没设时 = 全部勾选 (因为 "全显示" 等价于 "全勾选"). */
const checked = ref<Set<string>>(new Set())
const saving = ref(false)

// ── v2: 库下 schema 二级 ─────────────────────────────────────────
/** 已展开的 database 行 (用户点开就 lazy fetch 一次) */
const expanded = ref<Set<string>>(new Set())
/** dbName → schemas. 异步 fetch 之后填. 缺 key = 未 fetch 过. */
const schemaItems = ref<Record<string, MetadataNode[]>>({})
/** dbName → 勾选的 schema 集合 — 跟外层 checked 同语义但作用域是该库. */
const schemaChecked = ref<Record<string, Set<string>>>({})
const schemaLoading = ref<Set<string>>(new Set())
const schemaError = ref<Record<string, string>>({})

const totalCount = computed(() => items.value.length)
const checkedCount = computed(() => checked.value.size)
const allChecked = computed(() => totalCount.value > 0 && checkedCount.value === totalCount.value)
const noneChecked = computed(() => checkedCount.value === 0)

watch(
  () => props.conn,
  async (c) => {
    if (!c) return
    loading.value = true
    error.value = null
    items.value = []
    expanded.value = new Set()
    schemaItems.value = {}
    schemaChecked.value = {}
    schemaLoading.value = new Set()
    schemaError.value = {}
    try {
      const raw = await client.connections.metadata(c.id, {
        parentKind: 'connection' as MetadataNode['kind'],
        path: [],
      })
      items.value = raw.filter((n) => n.kind === 'database' || n.kind === 'schema')
      const extra = c.extra as { visibleDatabases?: unknown; visibleSchemas?: unknown } | undefined
      const allowed = extra?.visibleDatabases
      if (Array.isArray(allowed) && allowed.length > 0) {
        checked.value = new Set(allowed.filter((x): x is string => typeof x === 'string'))
      } else {
        checked.value = new Set(items.value.map((n) => n.name))
      }
      // 预填已持久的 schema 白名单 (但还没 fetch schemas 列表 — 那要等用户点开展开器)
      const vs = extra?.visibleSchemas
      if (vs && typeof vs === 'object' && !Array.isArray(vs)) {
        for (const [k, v] of Object.entries(vs)) {
          if (Array.isArray(v)) {
            schemaChecked.value[k] = new Set(v.filter((x): x is string => typeof x === 'string'))
          }
        }
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

function toggle(name: string): void {
  if (checked.value.has(name)) checked.value.delete(name)
  else checked.value.add(name)
  checked.value = new Set(checked.value)
}
function selectAll(): void {
  checked.value = new Set(items.value.map((n) => n.name))
}
function selectNone(): void {
  checked.value = new Set()
}

/** 顶层有多少系统库/Schema(给按钮显隐/计数用)。 */
const systemTopCount = computed(() => items.value.filter((n) => isSystemMetaNode(n)).length)

/**
 * 一键排除系统库/Schema:取消勾选顶层的系统项,以及所有已展开加载的库下系统 schema。
 * 用户对象不动;系统名单见 tree-actions.ts(各方言内置库/schema + PG 的 pg_* 前缀)。
 */
function excludeSystem(): void {
  let removed = 0
  const next = new Set(checked.value)
  for (const n of items.value) {
    if (isSystemMetaNode(n) && next.has(n.name)) {
      next.delete(n.name)
      removed++
    }
  }
  checked.value = next
  for (const [db, list] of Object.entries(schemaItems.value)) {
    const set = new Set(schemaChecked.value[db] ?? new Set<string>())
    let changed = false
    for (const s of list) {
      if (isSystemMetaNode(s) && set.has(s.name)) {
        set.delete(s.name)
        removed++
        changed = true
      }
    }
    if (changed) schemaChecked.value = { ...schemaChecked.value, [db]: set }
  }
  toast.success(removed ? `已排除 ${removed} 个系统库/Schema` : '没有匹配到系统库/Schema')
}

/** 某库下「排除系统 schema」。 */
function schemaExcludeSystem(dbName: string): void {
  const list = schemaItems.value[dbName] ?? []
  const set = new Set(schemaChecked.value[dbName] ?? new Set<string>())
  let removed = 0
  for (const s of list) {
    if (isSystemMetaNode(s) && set.has(s.name)) {
      set.delete(s.name)
      removed++
    }
  }
  schemaChecked.value = { ...schemaChecked.value, [dbName]: set }
  toast.success(removed ? `已排除 ${removed} 个系统 schema` : '该库下没有系统 schema')
}

async function toggleExpand(dbName: string): Promise<void> {
  if (expanded.value.has(dbName)) {
    expanded.value.delete(dbName)
    expanded.value = new Set(expanded.value)
    return
  }
  expanded.value.add(dbName)
  expanded.value = new Set(expanded.value)
  // 首次展开 → fetch 该库的 schemas
  if (schemaItems.value[dbName] || schemaLoading.value.has(dbName) || !props.conn) return
  schemaLoading.value.add(dbName)
  schemaLoading.value = new Set(schemaLoading.value)
  schemaError.value[dbName] = ''
  try {
    const list = await client.connections.metadata(props.conn.id, {
      parentKind: 'database' as MetadataNode['kind'],
      path: [dbName],
    })
    const schemas = list.filter((n) => n.kind === 'schema')
    schemaItems.value = { ...schemaItems.value, [dbName]: schemas }
    // 没预填过 → 默认全勾 (跟顶层一致语义: 未配置 = 全可见)
    if (!schemaChecked.value[dbName]) {
      schemaChecked.value = {
        ...schemaChecked.value,
        [dbName]: new Set(schemas.map((s) => s.name)),
      }
    }
  } catch (e) {
    schemaError.value[dbName] = e instanceof Error ? e.message : String(e)
  } finally {
    schemaLoading.value.delete(dbName)
    schemaLoading.value = new Set(schemaLoading.value)
  }
}

function toggleSchema(dbName: string, schemaName: string): void {
  const set = schemaChecked.value[dbName] ?? new Set<string>()
  if (set.has(schemaName)) set.delete(schemaName)
  else set.add(schemaName)
  schemaChecked.value = { ...schemaChecked.value, [dbName]: new Set(set) }
}

/** db 行下"全部勾选" / "全部不选" 快捷 — UX 友好对 50 schemas 的库 */
function schemaSelectAll(dbName: string): void {
  const list = schemaItems.value[dbName] ?? []
  schemaChecked.value = { ...schemaChecked.value, [dbName]: new Set(list.map((s) => s.name)) }
}
function schemaSelectNone(dbName: string): void {
  schemaChecked.value = { ...schemaChecked.value, [dbName]: new Set() }
}

async function save(): Promise<void> {
  if (!props.conn) return
  saving.value = true
  try {
    const isAllChecked = checkedCount.value === totalCount.value
    const restExtra = { ...(props.conn.extra ?? {}) } as Record<string, unknown>
    if (isAllChecked) {
      restExtra.visibleDatabases = undefined
      restExtra.visibleDatabasesTotal = undefined
    } else {
      restExtra.visibleDatabases = items.value
        .filter((n) => checked.value.has(n.name))
        .map((n) => n.name)
      restExtra.visibleDatabasesTotal = items.value.length
    }
    // v2: visibleSchemas — 只持久 (a) 顶层被勾选 且 (b) 用户展开过 (schemaItems 有数据)
    // 且 (c) 不是全勾 的库. 全勾等于 "该库下不过滤", 不写, 让 unset 表达.
    const visSchemas: Record<string, string[]> = {}
    for (const dbName of Object.keys(schemaItems.value)) {
      if (!checked.value.has(dbName)) continue // 父层 unchecked, 子层无意义
      const list = schemaItems.value[dbName] ?? []
      const sel = schemaChecked.value[dbName] ?? new Set<string>()
      if (sel.size === list.length) continue // 全勾, 跳过持久 (= 不过滤该库)
      visSchemas[dbName] = list.filter((s) => sel.has(s.name)).map((s) => s.name)
    }
    if (Object.keys(visSchemas).length > 0) {
      restExtra.visibleSchemas = visSchemas
    } else {
      restExtra.visibleSchemas = undefined
    }
    await client.connections.update({
      ...props.conn,
      extra: Object.keys(restExtra).length > 0 ? restExtra : undefined,
    })
    toast.success('已保存可见库/Schema 配置')
    emit('saved')
    emit('close')
  } catch (e) {
    reportError(e, { tag: 'nav-filter-save' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal
    v-if="conn"
    :title="`配置可见库 / Schema · ${conn.name}`"
    width="normal"
    @close="emit('close')"
  >
    <div class="hint">
      勾选要在导航树中显示的项. 未勾选的将被隐藏 (数据本身不删, 任何时候来这里改回即可).
      <br />
      <strong>展开</strong> 库的 ▸ 可进一步配置该库下哪些 schema 可见
      (仅对 PG / MSSQL / ClickHouse 等库→schema 两层结构方言有意义).
    </div>

    <div v-if="loading" class="msg">加载中...</div>
    <div v-else-if="error" class="msg err">读取元数据失败: {{ error }}</div>
    <div v-else-if="items.length === 0" class="msg">该连接没有可过滤的顶层节点.</div>
    <template v-else>
      <div class="bar">
        <span class="count">已选 {{ checkedCount }} / {{ totalCount }}</span>
        <div class="bar-r">
          <button
            class="link"
            :disabled="systemTopCount === 0"
            title="取消勾选系统库/Schema(mysql / pg_catalog / SYS / SYSAUDITOR / 物化系统 schema 等),用户对象不动"
            @click="excludeSystem"
          >排除系统库/Schema</button>
          <button class="link" :disabled="allChecked" @click="selectAll">全选</button>
          <button class="link" :disabled="noneChecked" @click="selectNone">全不选</button>
        </div>
      </div>
      <ul class="list">
        <li v-for="n in items" :key="n.name" class="row">
          <div class="row-line">
            <button
              v-if="n.kind === 'database'"
              class="exp"
              :title="expanded.has(n.name) ? '收起' : '展开 schemas'"
              @click="toggleExpand(n.name)"
            >{{ expanded.has(n.name) ? '▾' : '▸' }}</button>
            <span v-else class="exp empty"></span>
            <label class="cb">
              <input
                type="checkbox"
                :checked="checked.has(n.name)"
                @change="toggle(n.name)"
              />
              <span class="ico">{{ n.kind === 'schema' ? '📂' : '🗄' }}</span>
              <span class="name">{{ n.name }}</span>
            </label>
          </div>
          <!-- schema 子级 (v2) -->
          <div v-if="n.kind === 'database' && expanded.has(n.name)" class="sub">
            <div v-if="schemaLoading.has(n.name)" class="msg">加载 schemas...</div>
            <div v-else-if="schemaError[n.name]" class="msg err">
              {{ schemaError[n.name] }}
            </div>
            <template v-else-if="(schemaItems[n.name] ?? []).length > 0">
              <div class="sub-bar">
                <span class="count">
                  已选 {{ (schemaChecked[n.name]?.size ?? 0) }} /
                  {{ schemaItems[n.name]?.length ?? 0 }}
                </span>
                <div class="bar-r">
                  <button class="link" @click="schemaExcludeSystem(n.name)">排除系统</button>
                  <button class="link" @click="schemaSelectAll(n.name)">全选</button>
                  <button class="link" @click="schemaSelectNone(n.name)">全不选</button>
                </div>
              </div>
              <ul class="sub-list">
                <li
                  v-for="s in (schemaItems[n.name] ?? [])"
                  :key="s.name"
                  class="row"
                  :class="{ disabled: !checked.has(n.name) }"
                >
                  <label class="cb">
                    <input
                      type="checkbox"
                      :checked="schemaChecked[n.name]?.has(s.name)"
                      :disabled="!checked.has(n.name)"
                      @change="toggleSchema(n.name, s.name)"
                    />
                    <span class="ico">📂</span>
                    <span class="name">{{ s.name }}</span>
                  </label>
                </li>
              </ul>
            </template>
            <div v-else class="msg">该库下无 schema</div>
          </div>
        </li>
      </ul>
    </template>

    <template #footer>
      <button class="ghost" @click="emit('close')">取消</button>
      <button
        class="primary"
        :disabled="saving || loading || items.length === 0"
        @click="save"
      >
        {{ saving ? '保存中...' : '保存' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.hint {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
  margin-bottom: 12px;
}
.hint strong {
  color: var(--text);
}
.msg {
  padding: 16px 12px;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
}
.msg.err {
  color: var(--err, #ff6c6c);
  white-space: pre-wrap;
}
.bar,
.sub-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
}
.sub-bar {
  padding: 4px 12px 6px;
}
.bar .count,
.sub-bar .count {
  color: var(--muted);
}
.bar .bar-r,
.sub-bar .bar-r {
  display: flex;
  gap: 8px;
}
.bar .link,
.sub-bar .link {
  background: transparent;
  border: none;
  color: var(--accent, #7c6cff);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.bar .link:disabled,
.sub-bar .link:disabled {
  color: var(--muted);
  cursor: default;
}
.list,
.sub-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.list {
  max-height: 420px;
  overflow-y: auto;
}
.sub-list {
  margin: 0 12px 8px;
  background: var(--bg);
}
.row {
  border-bottom: 1px solid var(--border);
}
.row:last-child {
  border-bottom: none;
}
.row.disabled {
  opacity: 0.5;
}
.row-line {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 4px;
}
.row .exp {
  width: 18px;
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 11px;
  padding: 0;
}
.row .exp.empty {
  cursor: default;
}
.row .cb {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 8px 0;
  cursor: pointer;
  user-select: none;
  flex: 1;
}
.row .cb:hover {
  background: rgba(124, 108, 255, 0.08);
}
.row .ico {
  width: 16px;
  text-align: center;
}
.row .name {
  font-size: 13px;
}
.sub {
  background: rgba(0, 0, 0, 0.04);
  border-top: 1px solid var(--border);
}
button.primary {
  background: var(--accent, #7c6cff);
  color: white;
  border: none;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button.ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
button.ghost:hover {
  background: rgba(124, 108, 255, 0.08);
}
</style>
