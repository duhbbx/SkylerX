<script setup lang="ts">
/**
 * Schema 快照（#16）：把某连接当前所有表的 DDL 抓下来存 localStorage，
 * 后续任何时候可以列出历史快照、对比两份的差异（按表 diff）。
 *
 * 不进 SQLite（避免污染本地库迁移），存 localStorage 足够；每个快照按 connId 分组。
 * 大库（百表+）单份大概几 MB，浏览器存储限额 5MB 通常够用；超过会按时间淘汰最老的。
 */
import type { ConnectionConfig, MetadataNode } from '@db-tool/shared-types'
import { MetaNodeKind } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { familyOf } from '../ddl'
import { confirm as appConfirm, prompt as appPrompt, toast } from '../dialog'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig }>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()

interface Snapshot {
  id: string // ts + random
  connId: string
  takenAt: number
  note: string
  /** Map<tableName, ddl> */
  tables: Record<string, string>
}

const SNAP_KEY = 'skylerx.schema-snapshots'
const MAX_PER_CONN = 20 // 超过 20 个时淘汰最老的

const snapshots = ref<Snapshot[]>([])
const taking = ref(false)
const diffOf = ref<{ a: Snapshot; b: Snapshot } | null>(null)

function loadAll(): Snapshot[] {
  try {
    return JSON.parse(localStorage.getItem(SNAP_KEY) ?? '[]') as Snapshot[]
  } catch {
    return []
  }
}
function saveAll(arr: Snapshot[]): void {
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(arr))
  } catch {
    toast.error(t('snap.storageFull'))
  }
}

function reload(): void {
  snapshots.value = loadAll()
    .filter((s) => s.connId === props.conn.id)
    .sort((a, b) => b.takenAt - a.takenAt)
}

onMounted(reload)

/** 拍快照：拉默认 database/schema 下所有 table 的 DDL */
async function takeSnapshot(): Promise<void> {
  taking.value = true
  try {
    // 拉根节点 → 第一层（db / schema）→ tables group → table
    const fam = familyOf(props.conn.dialect)
    const top: MetadataNode[] = await client.connections.metadata(props.conn.id, {
      parentKind: MetaNodeKind.Connection,
      path: [],
    })
    if (!top.length) {
      toast.error(t('snap.noDbs'))
      return
    }
    // 简化：只对第一个 database/schema 拍照（覆盖单库场景；多库可后续扩）
    const first = top[0]
    const tablesGroup = await client.connections
      .metadata(props.conn.id, {
        parentKind: MetaNodeKind.Group,
        path: [...first.path],
        group: 'tables',
      })
      .catch(() => [] as MetadataNode[])

    const tables: Record<string, string> = {}
    for (const t of tablesGroup) {
      const ref = t.sqlName ?? t.name
      try {
        const ddl = await fetchTableDdl(ref, fam)
        if (ddl) tables[t.name] = ddl
      } catch {
        /* 单张表拉失败不致命 */
      }
    }

    const note =
      (await appPrompt({
        message: t('snap.notePrompt'),
        defaultValue: new Date().toLocaleString(),
      })) ?? ''
    if (note == null) return

    const snap: Snapshot = {
      id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      connId: props.conn.id,
      takenAt: Date.now(),
      note,
      tables,
    }
    // 维护 LRU：最多保留 MAX_PER_CONN 个
    const all = loadAll().filter((s) => s.connId !== props.conn.id || true)
    const mine = all.filter((s) => s.connId === props.conn.id)
    const others = all.filter((s) => s.connId !== props.conn.id)
    mine.unshift(snap)
    if (mine.length > MAX_PER_CONN) mine.length = MAX_PER_CONN
    saveAll([...others, ...mine])
    reload()
    toast.success(t('snap.taken', { n: Object.keys(tables).length }))
  } finally {
    taking.value = false
  }
}

async function fetchTableDdl(
  tableRef: string,
  fam: 'mysql' | 'pg' | 'sqlserver' | 'oracle' | 'nosql',
): Promise<string> {
  if (fam === 'mysql') {
    const r = await client.connections.execute(props.conn.id, `SHOW CREATE TABLE ${tableRef}`)
    const row = r.rows[0] as Record<string, unknown> | undefined
    return String(row?.['Create Table'] ?? '')
  }
  if (fam === 'pg') {
    // PG 没有 SHOW CREATE TABLE，拼一份简化 DDL（列 + 类型 + NULL/PK）
    const r = await client.connections.execute(
      props.conn.id,
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = '${tableRef.replace(/^.*\./, '').replace(/['"\`]/g, '')}'
       ORDER BY ordinal_position`,
    )
    const cols = r.rows.map(
      (row) =>
        `  ${row.column_name} ${row.data_type}${row.is_nullable === 'NO' ? ' NOT NULL' : ''}${row.column_default ? ` DEFAULT ${row.column_default}` : ''}`,
    )
    return `CREATE TABLE ${tableRef} (\n${cols.join(',\n')}\n);`
  }
  return ''
}

async function deleteSnap(id: string): Promise<void> {
  if (!(await appConfirm({ message: t('snap.deleteConfirm'), variant: 'warn' }))) return
  saveAll(loadAll().filter((s) => s.id !== id))
  reload()
}

const selectedIds = ref<string[]>([])
function toggleSelect(id: string): void {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else {
    selectedIds.value.push(id)
    if (selectedIds.value.length > 2) selectedIds.value.shift()
  }
}
function openDiff(): void {
  if (selectedIds.value.length !== 2) {
    toast.warn(t('snap.pickTwo'))
    return
  }
  const a = snapshots.value.find((s) => s.id === selectedIds.value[0])
  const b = snapshots.value.find((s) => s.id === selectedIds.value[1])
  if (!a || !b) return
  // 按 takenAt 升序：a 在前（旧），b 在后（新）
  diffOf.value = a.takenAt < b.takenAt ? { a, b } : { a: b, b: a }
}

// 简单按表 diff：列出 A 没有的（新增）/ B 没有的（删除）/ 两边不同的（修改）
interface TableDiff {
  name: string
  status: 'added' | 'removed' | 'changed' | 'same'
}
const tableDiffs = computed<TableDiff[]>(() => {
  const d = diffOf.value
  if (!d) return []
  const names = new Set([...Object.keys(d.a.tables), ...Object.keys(d.b.tables)])
  const out: TableDiff[] = []
  for (const n of names) {
    const av = d.a.tables[n]
    const bv = d.b.tables[n]
    if (av == null) out.push({ name: n, status: 'added' })
    else if (bv == null) out.push({ name: n, status: 'removed' })
    else if (av.trim() !== bv.trim()) out.push({ name: n, status: 'changed' })
    else out.push({ name: n, status: 'same' })
  }
  return out.sort((a, b) => {
    const order = { added: 0, removed: 1, changed: 2, same: 3 }
    return order[a.status] - order[b.status] || a.name.localeCompare(b.name)
  })
})
const visibleDiffs = computed(() => tableDiffs.value.filter((d) => d.status !== 'same'))

const focusedTable = ref<string | null>(null)
const focusedDdl = computed(() => {
  if (!focusedTable.value || !diffOf.value) return null
  return {
    a:
      diffOf.value.a.tables[focusedTable.value] ??
      `-- 不存在于 ${new Date(diffOf.value.a.takenAt).toLocaleString()}`,
    b:
      diffOf.value.b.tables[focusedTable.value] ??
      `-- 不存在于 ${new Date(diffOf.value.b.takenAt).toLocaleString()}`,
  }
})

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString()
}
</script>

<template>
  <Modal :title="t('snap.title', { conn: conn.name || conn.dialect })" @close="emit('close')">
    <div class="snap">
      <!-- 列表视图 -->
      <template v-if="!diffOf">
        <div class="snap-bar">
          <button class="primary" :disabled="taking" @click="takeSnapshot">
            {{ taking ? '…' : '📸 ' + t('snap.take') }}
          </button>
          <button :disabled="selectedIds.length !== 2" @click="openDiff">⟷ {{ t('snap.diff') }}</button>
          <span class="muted">{{ t('snap.hint') }}</span>
        </div>
        <div v-if="!snapshots.length" class="snap-empty">{{ t('snap.empty') }}</div>
        <div v-else class="snap-list">
          <div
            v-for="s in snapshots"
            :key="s.id"
            class="snap-item"
            :class="{ on: selectedIds.includes(s.id) }"
            @click="toggleSelect(s.id)"
          >
            <input :checked="selectedIds.includes(s.id)" type="checkbox" @click.stop />
            <span class="snap-time">{{ fmtTime(s.takenAt) }}</span>
            <span class="snap-note">{{ s.note || '—' }}</span>
            <span class="snap-count">{{ Object.keys(s.tables).length }} {{ t('snap.tables') }}</span>
            <button class="ghost sm" @click.stop="deleteSnap(s.id)">×</button>
          </div>
        </div>
      </template>

      <!-- Diff 视图 -->
      <template v-else>
        <div class="snap-bar">
          <button class="ghost sm" @click="diffOf = null; focusedTable = null">← {{ t('snap.back') }}</button>
          <span class="muted">
            {{ fmtTime(diffOf.a.takenAt) }} → {{ fmtTime(diffOf.b.takenAt) }}
            · {{ visibleDiffs.length }} {{ t('snap.changes') }}
          </span>
        </div>
        <div class="diff-wrap">
          <div class="diff-list">
            <div v-if="!visibleDiffs.length" class="snap-empty">{{ t('snap.identical') }}</div>
            <div
              v-for="d in visibleDiffs"
              :key="d.name"
              class="diff-item"
              :class="['st-' + d.status, { on: focusedTable === d.name }]"
              @click="focusedTable = d.name"
            >
              <span class="st-badge">{{
                d.status === 'added' ? '+ ' :
                d.status === 'removed' ? '- ' :
                '~ '
              }}</span>
              <span class="d-name">{{ d.name }}</span>
            </div>
          </div>
          <div v-if="focusedDdl" class="diff-panes">
            <div class="diff-pane">
              <div class="pane-h">{{ fmtTime(diffOf.a.takenAt) }} ({{ t('snap.before') }})</div>
              <pre>{{ focusedDdl.a }}</pre>
            </div>
            <div class="diff-pane">
              <div class="pane-h">{{ fmtTime(diffOf.b.takenAt) }} ({{ t('snap.after') }})</div>
              <pre>{{ focusedDdl.b }}</pre>
            </div>
          </div>
        </div>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.snap {
  min-width: 720px;
  min-height: 420px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}
.snap-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}
.snap-bar button {
  padding: 4px 12px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.snap-bar button.primary {
  background: var(--accent, #7c6cff);
  color: #fff;
  border-color: var(--accent, #7c6cff);
}
.snap-bar button:disabled { opacity: 0.5; cursor: not-allowed; }
.snap-bar .muted { font-size: 11px; color: var(--muted); margin-left: auto; }
.snap-empty { padding: 32px; text-align: center; color: var(--muted); }
.snap-list { flex: 1; overflow-y: auto; }
.snap-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.snap-item:hover { background: rgba(124, 108, 255, 0.08); }
.snap-item.on { background: rgba(124, 108, 255, 0.16); }
.snap-time { font-family: ui-monospace, monospace; font-size: 12px; }
.snap-note { flex: 1; font-size: 12px; }
.snap-count { font-size: 11px; color: var(--muted); }
.ghost.sm { padding: 2px 8px; font-size: 11px; }

.diff-wrap { flex: 1; display: flex; gap: 8px; overflow: hidden; }
.diff-list {
  width: 240px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.diff-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.diff-item.on { background: rgba(124, 108, 255, 0.18); }
.diff-item.st-added .st-badge { color: #4caf50; }
.diff-item.st-removed .st-badge { color: var(--err, #e04050); }
.diff-item.st-changed .st-badge { color: #e0a020; }
.st-badge { font-weight: 600; }

.diff-panes { flex: 1; display: flex; gap: 8px; }
.diff-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.pane-h {
  padding: 6px 10px;
  background: var(--panel);
  font-size: 11px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}
.diff-pane pre {
  flex: 1;
  margin: 0;
  padding: 8px 10px;
  background: var(--bg);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
}
</style>
