<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Redis 跨库搜索:在 16 个逻辑库 db0..db15 上并发 SCAN MATCH,把结果汇成表。
 *
 * 命中条数大,所以单库设了 ROUND_CAP 防止恶意/超大库下 SCAN 不停;
 * 每命中一条再单调用 TYPE+TTL,这两个不算贵。
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
}>()

const emit = defineEmits<{
  close: []
  /** 用户在结果表点击某行 → 跳到对应 db 的 RedisPane 并定位 key */
  pick: [dbIndex: number, key: string]
}>()

const client = useDataClient()

const pattern = ref('*')
const dbSel = ref<Set<number>>(new Set(Array.from({ length: 16 }, (_, i) => i)))
const running = ref(false)
const cancel = ref(false)
const progress = ref<{ db: number; scanned: number; matched: number } | null>(null)

interface Hit {
  db: number
  key: string
  type: string
  ttl: number
}
const hits = ref<Hit[]>([])

const SCAN_PER_DB_LIMIT = 5000 // 单库最多命中数(超过提示截断)

function toggleDb(i: number): void {
  const s = new Set(dbSel.value)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  dbSel.value = s
}
function selectAll(): void {
  dbSel.value = new Set(Array.from({ length: 16 }, (_, i) => i))
}
function selectNone(): void {
  dbSel.value = new Set()
}

async function call(op: string, args: unknown[], dbIndex: number): Promise<unknown> {
  const r = await client.connections.executeCommand(props.conn.id, {
    op,
    args,
    context: { dbIndex },
  })
  return r.data
}

async function run(): Promise<void> {
  if (!pattern.value.trim()) {
    toast.warn('请输入 MATCH 模式')
    return
  }
  if (!dbSel.value.size) {
    toast.warn('请至少勾选一个库')
    return
  }
  running.value = true
  cancel.value = false
  hits.value = []
  progress.value = null
  try {
    const dbs = Array.from(dbSel.value).sort((a, b) => a - b)
    for (const db of dbs) {
      if (cancel.value) break
      progress.value = { db, scanned: 0, matched: 0 }
      let cursor = '0'
      let scanned = 0
      let matched = 0
      do {
        if (cancel.value) break
        const r = (await call('SCAN', [cursor, 'MATCH', pattern.value.trim(), 'COUNT', '500'], db)) as [string, string[]]
        cursor = String(r?.[0] ?? '0')
        const batch = (r?.[1] ?? []) as string[]
        scanned += batch.length
        if (batch.length) {
          // 对每个命中 key 取 type + ttl(并发,但分块)
          const out: Hit[] = []
          await Promise.all(
            batch.map(async (k) => {
              try {
                const [t, ttl] = await Promise.all([
                  call('TYPE', [k], db) as Promise<string>,
                  call('TTL', [k], db) as Promise<number>,
                ])
                out.push({ db, key: k, type: String(t ?? 'none'), ttl: Number(ttl ?? -1) })
              } catch {
                out.push({ db, key: k, type: 'unknown', ttl: -1 })
              }
            }),
          )
          hits.value = hits.value.concat(out)
          matched += batch.length
          progress.value = { db, scanned, matched }
        }
        if (matched >= SCAN_PER_DB_LIMIT) {
          toast.warn(`db${db} 命中超过 ${SCAN_PER_DB_LIMIT} 条,已截断`)
          break
        }
      } while (cursor !== '0')
    }
  } catch (e) {
    toast.error(`搜索失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    running.value = false
    cancel.value = false
    progress.value = null
  }
}

function stop(): void {
  cancel.value = true
}

watch(
  () => props.open,
  (op) => {
    if (op) {
      pattern.value = '*'
      hits.value = []
      progress.value = null
    }
  },
)

const totalMatched = computed(() => hits.value.length)
</script>

<template>
  <Modal v-if="open" :title="`跨库搜索  ·  ${conn.name || conn.dialect}`" width="wide" @close="emit('close')">
    <div class="form">
      <div class="row">
        <label class="lbl">MATCH 模式</label>
        <input v-model="pattern" class="ip" placeholder="例如 user:* / cache:home:?" @keydown.enter="run" />
      </div>

      <div class="row">
        <div class="db-head">
          <span class="lbl">在哪些库搜?</span>
          <button class="mini" @click="selectAll">全选</button>
          <button class="mini" @click="selectNone">全不选</button>
        </div>
        <div class="db-grid">
          <label v-for="i in 16" :key="i - 1" class="db-card" :class="{ on: dbSel.has(i - 1) }">
            <input type="checkbox" :checked="dbSel.has(i - 1)" @change="toggleDb(i - 1)" />
            db{{ i - 1 }}
          </label>
        </div>
      </div>

      <div class="row run-row">
        <button v-if="!running" class="btn-primary" @click="run">▶ 搜索</button>
        <button v-else class="btn-danger" @click="stop">■ 停止</button>
        <span v-if="progress" class="meta">
          扫描 db{{ progress.db }} · 已命中 {{ progress.matched }}
        </span>
        <span v-else-if="totalMatched" class="meta">共 {{ totalMatched }} 个命中</span>
      </div>

      <div class="results">
        <table v-if="hits.length" class="grid">
          <thead>
            <tr>
              <th style="width: 50px">db</th>
              <th>key</th>
              <th style="width: 80px">type</th>
              <th style="width: 80px">ttl</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(h, i) in hits" :key="i" class="hit-row" @click="emit('pick', h.db, h.key)">
              <td>db{{ h.db }}</td>
              <td class="key-cell">{{ h.key }}</td>
              <td><span class="tag" :data-type="h.type">{{ h.type }}</span></td>
              <td>{{ h.ttl === -1 ? '∞' : h.ttl === -2 ? 'n/a' : `${h.ttl}s` }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="!running && !progress" class="empty">输入模式后点搜索</div>
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lbl {
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
}
.ip {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 6px 10px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
.db-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.db-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.db-card {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 6px;
  text-align: center;
  font-size: 11px;
  font-family: ui-monospace, monospace;
  cursor: pointer;
  background: var(--bg);
}
.db-card.on {
  background: rgba(124, 108, 255, 0.18);
  border-color: var(--accent);
}
.db-card input {
  display: none;
}
.mini {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--muted);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.run-row {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}
.meta {
  font-size: 11px;
  color: var(--muted);
}
.results {
  max-height: 400px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.grid th,
.grid td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}
.grid th {
  background: var(--panel);
  color: var(--muted);
  position: sticky;
  top: 0;
}
.hit-row {
  cursor: pointer;
}
.hit-row:hover td {
  background: rgba(124, 108, 255, 0.08);
}
.key-cell {
  word-break: break-all;
}
.tag {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 3px;
  color: #fff;
  font-size: 10px;
  background: #888;
}
.tag[data-type='string'] { background: #4caf50; }
.tag[data-type='hash'] { background: #7c6cff; }
.tag[data-type='list'] { background: #e0a020; }
.tag[data-type='set'] { background: #03a9f4; }
.tag[data-type='zset'] { background: #e04050; }
.tag[data-type='stream'] { background: #9c27b0; }
.empty {
  padding: 20px;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
}
.btn-primary,
.btn-danger,
.btn-ghost {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn-danger {
  background: var(--err, #e04050);
  color: #fff;
  border-color: var(--err, #e04050);
}
.btn-ghost {
  background: transparent;
  color: var(--muted);
}
</style>
