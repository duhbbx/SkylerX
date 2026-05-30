<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * MongoDB 集合信息面板:
 *   - collStats: 文档数 / 平均大小 / 存储大小 / 索引大小
 *   - Indexes:  listIndexes + createIndex({key: 1/-1, ...}, opts) + dropIndex
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, toast } from '../dialog'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  database: string
  collection: string
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

type Tab = 'stats' | 'indexes'
const tab = ref<Tab>('stats')
const loading = ref(false)

interface CollStats {
  count: number
  size: number
  avgObjSize: number
  storageSize: number
  totalIndexSize: number
  nindexes: number
  indexSizes: Record<string, number>
}
const stats = ref<CollStats | null>(null)

interface IndexInfo {
  name: string
  key: Record<string, number | string>
  unique?: boolean
  sparse?: boolean
  ttl?: number
  size?: number
}
const indexes = ref<IndexInfo[]>([])

// 新建索引表单
const newIdxFields = ref<{ field: string; dir: 1 | -1 | 'text' | '2dsphere' }[]>([
  { field: '', dir: 1 },
])
const newIdxName = ref('')
const newIdxUnique = ref(false)
const newIdxSparse = ref(false)
const newIdxTtl = ref<number | null>(null)

async function call(op: string, args: unknown): Promise<unknown> {
  const r = await client.connections.executeCommand(props.conn.id, {
    op,
    args,
    context: { database: props.database, collection: props.collection },
  })
  return r.data
}

async function loadStats(): Promise<void> {
  loading.value = true
  try {
    const r = (await call('collStats', {})) as Record<string, unknown>
    stats.value = {
      count: Number(r.count ?? 0),
      size: Number(r.size ?? 0),
      avgObjSize: Number(r.avgObjSize ?? 0),
      storageSize: Number(r.storageSize ?? 0),
      totalIndexSize: Number(r.totalIndexSize ?? 0),
      nindexes: Number(r.nindexes ?? 0),
      indexSizes: (r.indexSizes as Record<string, number>) ?? {},
    }
  } catch (e) {
    toast.error(`collStats 失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    loading.value = false
  }
}

async function loadIndexes(): Promise<void> {
  loading.value = true
  try {
    const r = (await call('listIndexes', {})) as Record<string, unknown>[]
    const sizes = stats.value?.indexSizes ?? {}
    indexes.value = (r ?? []).map((x) => ({
      name: String(x.name ?? ''),
      key: (x.key as Record<string, number>) ?? {},
      unique: Boolean(x.unique),
      sparse: Boolean(x.sparse),
      ttl: typeof x.expireAfterSeconds === 'number' ? x.expireAfterSeconds : undefined,
      size: sizes[String(x.name)] ?? undefined,
    }))
  } catch (e) {
    toast.error(`listIndexes 失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    loading.value = false
  }
}

async function dropIndex(name: string): Promise<void> {
  if (name === '_id_') {
    toast.warn('_id 默认索引不能删除')
    return
  }
  if (!(await appConfirm({ message: `删除索引 "${name}" ?`, variant: 'danger' }))) return
  try {
    await call('dropIndex', { name })
    toast.success(`已删除 ${name}`)
    await loadIndexes()
    await loadStats()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function createIndex(): Promise<void> {
  const keys: Record<string, number | string> = {}
  for (const f of newIdxFields.value) {
    if (!f.field.trim()) continue
    keys[f.field.trim()] = f.dir
  }
  if (!Object.keys(keys).length) {
    toast.warn('请至少填一个字段')
    return
  }
  const opts: Record<string, unknown> = {}
  if (newIdxName.value.trim()) opts.name = newIdxName.value.trim()
  if (newIdxUnique.value) opts.unique = true
  if (newIdxSparse.value) opts.sparse = true
  if (newIdxTtl.value != null && newIdxTtl.value >= 0) opts.expireAfterSeconds = newIdxTtl.value
  try {
    await call('createIndex', { key: keys, ...opts })
    toast.success('索引创建成功')
    newIdxFields.value = [{ field: '', dir: 1 }]
    newIdxName.value = ''
    newIdxUnique.value = false
    newIdxSparse.value = false
    newIdxTtl.value = null
    await loadIndexes()
    await loadStats()
  } catch (e) {
    toast.error(`createIndex 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function addField(): void {
  newIdxFields.value.push({ field: '', dir: 1 })
}
function removeField(i: number): void {
  if (newIdxFields.value.length > 1) newIdxFields.value.splice(i, 1)
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

watch(
  () => props.open,
  async (op) => {
    if (op) {
      tab.value = 'stats'
      await loadStats()
    }
  },
)
watch(tab, async (t) => {
  if (t === 'indexes' && !indexes.value.length) await loadIndexes()
})
</script>

<template>
  <Modal v-if="open" :title="`${database}.${collection}`" width="medium" @close="emit('close')">
    <div class="tabs">
      <button :class="{ on: tab === 'stats' }" @click="tab = 'stats'">统计</button>
      <button :class="{ on: tab === 'indexes' }" @click="tab = 'indexes'">索引</button>
      <span class="spacer" />
      <button class="btn" :disabled="loading" @click="tab === 'stats' ? loadStats() : loadIndexes()">🔄</button>
    </div>

    <!-- Stats -->
    <template v-if="tab === 'stats'">
      <div v-if="!stats" class="empty">加载中…</div>
      <table v-else class="grid">
        <tbody>
          <tr><td class="k">文档数 (count)</td><td><b>{{ stats.count.toLocaleString() }}</b></td></tr>
          <tr><td class="k">数据大小 (size)</td><td>{{ fmtBytes(stats.size) }}</td></tr>
          <tr><td class="k">平均文档大小 (avgObjSize)</td><td>{{ fmtBytes(stats.avgObjSize) }}</td></tr>
          <tr><td class="k">存储大小 (storageSize)</td><td>{{ fmtBytes(stats.storageSize) }}</td></tr>
          <tr><td class="k">索引数量 (nindexes)</td><td>{{ stats.nindexes }}</td></tr>
          <tr><td class="k">索引总大小 (totalIndexSize)</td><td>{{ fmtBytes(stats.totalIndexSize) }}</td></tr>
        </tbody>
      </table>
    </template>

    <!-- Indexes -->
    <template v-else>
      <div class="idx-list">
        <table class="grid">
          <thead>
            <tr>
              <th>name</th><th>keys</th><th style="width: 70px">unique</th><th style="width: 70px">sparse</th><th style="width: 80px">ttl</th><th style="width: 80px">size</th><th style="width: 50px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="idx in indexes" :key="idx.name">
              <td class="mono">{{ idx.name }}</td>
              <td class="mono">{{ JSON.stringify(idx.key) }}</td>
              <td>{{ idx.unique ? '✓' : '' }}</td>
              <td>{{ idx.sparse ? '✓' : '' }}</td>
              <td>{{ idx.ttl != null ? `${idx.ttl}s` : '' }}</td>
              <td>{{ idx.size != null ? fmtBytes(idx.size) : '' }}</td>
              <td><button class="x-btn" :disabled="idx.name === '_id_'" @click="dropIndex(idx.name)">✕</button></td>
            </tr>
            <tr v-if="!indexes.length"><td colspan="7" class="empty-row">无</td></tr>
          </tbody>
        </table>
      </div>

      <div class="new-idx">
        <div class="ni-title">新建索引</div>
        <div v-for="(f, i) in newIdxFields" :key="i" class="ni-row">
          <input v-model="f.field" class="ip" placeholder="字段名,如 user_id" />
          <select v-model="f.dir" class="ip" style="width: 100px">
            <option :value="1">↑ ASC</option>
            <option :value="-1">↓ DESC</option>
            <option value="text">text</option>
            <option value="2dsphere">2dsphere</option>
          </select>
          <button class="x-btn" :disabled="newIdxFields.length <= 1" @click="removeField(i)">✕</button>
        </div>
        <button class="add-row" @click="addField">+ 添加字段</button>

        <div class="ni-opts">
          <input v-model="newIdxName" class="ip" placeholder="索引名(可选,默认自动)" />
          <label class="lbl-inline"><input v-model="newIdxUnique" type="checkbox" /> unique</label>
          <label class="lbl-inline"><input v-model="newIdxSparse" type="checkbox" /> sparse</label>
          <label class="lbl-inline">TTL <input v-model.number="newIdxTtl" type="number" class="ip" style="width: 80px" placeholder="秒" /></label>
        </div>
        <button class="btn-primary" @click="createIndex">创建索引</button>
      </div>
    </template>

    <template #footer>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; padding: 0 0 8px; border-bottom: 1px solid var(--border); margin-bottom: 10px; align-items: center; }
.tabs button { background: transparent; border: 1px solid transparent; color: var(--muted); padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.tabs button.on { background: rgba(124, 108, 255, 0.18); border-color: var(--accent); color: var(--text); }
.spacer { flex: 1; }
.empty { padding: 20px; text-align: center; color: var(--muted); font-size: 12px; }
.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
.grid th, .grid td { border-bottom: 1px solid var(--border); padding: 4px 8px; text-align: left; }
.grid th { background: var(--panel); color: var(--muted); position: sticky; top: 0; }
.mono { font-family: var(--font-mono); word-break: break-all; }
.k { width: 240px; color: var(--muted); }
.empty-row { text-align: center; color: var(--muted); font-style: italic; }
.idx-list { max-height: 240px; overflow: auto; }
.new-idx { margin-top: 12px; padding: 10px; background: var(--panel); border-radius: 6px; }
.ni-title { font-size: 11px; color: var(--muted); font-weight: 600; margin-bottom: 6px; }
.ni-row { display: flex; gap: 4px; margin-bottom: 4px; }
.ni-opts { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
.ip { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; color: var(--text); font-family: var(--font-mono); font-size: 12px; }
.ni-row .ip { flex: 1; }
.lbl-inline { font-size: 11px; color: var(--muted); display: inline-flex; align-items: center; gap: 3px; }
.x-btn { background: transparent; border: none; color: var(--muted); cursor: pointer; padding: 0 6px; }
.x-btn:hover:not(:disabled) { color: #e04050; }
.x-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.add-row { width: 100%; background: transparent; border: 1px dashed var(--border); color: var(--muted); padding: 3px; border-radius: 4px; font-size: 11px; cursor: pointer; }
.btn, .btn-primary, .btn-ghost { padding: 4px 12px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg); color: var(--text); }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); margin-top: 6px; }
.btn-ghost { background: transparent; color: var(--muted); padding: 6px 14px; font-size: 13px; }
</style>
