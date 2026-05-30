<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Redis 大 key 排行:
 *   SCAN 当前 db → MEMORY USAGE per key → 倒序展示 + 前缀分组聚合
 *
 * MEMORY USAGE 是 O(N) 采样命令(默认 SAMPLES 5),比 OBJECT ENCODING + 内置长度估算更准。
 * 大库要小心(几十万 key 时拉满几分钟),所以加进度 + ▶/■ 控制。
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  dbIndex: number
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

interface BigKey {
  key: string
  type: string
  bytes: number
}
const items = ref<BigKey[]>([])
const running = ref(false)
const cancel = ref(false)
const progress = ref<{ scanned: number; sized: number } | null>(null)
const topN = ref(100)

async function call(op: string, args: unknown[]): Promise<unknown> {
  const r = await client.connections.executeCommand(props.conn.id, {
    op,
    args,
    context: { dbIndex: props.dbIndex },
  })
  return r.data
}

async function start(): Promise<void> {
  running.value = true
  cancel.value = false
  items.value = []
  progress.value = { scanned: 0, sized: 0 }
  const all: BigKey[] = []
  try {
    let cursor = '0'
    do {
      if (cancel.value) break
      const r = (await call('SCAN', [cursor, 'COUNT', '500'])) as [string, string[]]
      cursor = String(r?.[0] ?? '0')
      const batch = (r?.[1] ?? []) as string[]
      progress.value.scanned += batch.length
      // 对每个 key 拿 type + memory usage,分块并发
      const CHUNK = 20
      for (let i = 0; i < batch.length; i += CHUNK) {
        if (cancel.value) break
        const chunk = batch.slice(i, i + CHUNK)
        await Promise.all(
          chunk.map(async (k) => {
            try {
              const [t, b] = await Promise.all([
                call('TYPE', [k]) as Promise<string>,
                call('MEMORY', ['USAGE', k]) as Promise<number>,
              ])
              all.push({ key: k, type: String(t ?? 'none'), bytes: Number(b ?? 0) })
            } catch {
              /* ignore */
            }
          }),
        )
        progress.value.sized += chunk.length
      }
    } while (cursor !== '0')
    all.sort((a, b) => b.bytes - a.bytes)
    items.value = all.slice(0, topN.value)
    toast.success(`扫描完成,共 ${all.length} 个 key,展示 top ${items.value.length}`)
  } catch (e) {
    toast.error(`失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    running.value = false
    cancel.value = false
    progress.value = null
  }
}

function stop(): void {
  cancel.value = true
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 按前缀(冒号前)分组聚合内存占用。 */
const byPrefix = computed(() => {
  const m = new Map<string, { count: number; bytes: number }>()
  for (const it of items.value) {
    const prefix = it.key.split(':')[0] || it.key
    const e = m.get(prefix) ?? { count: 0, bytes: 0 }
    e.count++
    e.bytes += it.bytes
    m.set(prefix, e)
  }
  return Array.from(m.entries())
    .map(([prefix, v]) => ({ prefix, ...v }))
    .sort((a, b) => b.bytes - a.bytes)
})

const totalBytes = computed(() => items.value.reduce((s, x) => s + x.bytes, 0))

watch(
  () => props.open,
  (op) => {
    if (op) {
      items.value = []
      progress.value = null
    }
  },
)
</script>

<template>
  <Modal v-if="open" :title="`大 key 排行  ·  db${dbIndex}`" width="wide" @close="emit('close')">
    <div class="form">
      <div class="run-bar">
        <label class="lbl-inline">展示前
          <input v-model.number="topN" type="number" class="ip-mini" min="10" max="1000" />
          个
        </label>
        <button v-if="!running" class="btn-primary" @click="start">▶ 开始扫描</button>
        <button v-else class="btn-danger" @click="stop">■ 停止</button>
        <span v-if="progress" class="meta">
          扫描 {{ progress.scanned }} · 已采样 {{ progress.sized }}
        </span>
        <span v-else-if="items.length" class="meta">
          {{ items.length }} 个 key 共 {{ fmtBytes(totalBytes) }}
        </span>
      </div>

      <div v-if="byPrefix.length" class="prefix-bar">
        <span class="lbl">前缀聚合(top {{ byPrefix.length }})</span>
        <div class="bars">
          <div v-for="p in byPrefix.slice(0, 8)" :key="p.prefix" class="bar">
            <span class="bar-name">{{ p.prefix }}: ({{ p.count }})</span>
            <span class="bar-fill" :style="{ width: `${(p.bytes / totalBytes) * 100}%` }">{{ fmtBytes(p.bytes) }}</span>
          </div>
        </div>
      </div>

      <table v-if="items.length" class="grid">
        <thead><tr><th style="width: 40px">#</th><th>key</th><th style="width: 80px">type</th><th style="width: 100px">bytes</th></tr></thead>
        <tbody>
          <tr v-for="(it, i) in items" :key="it.key">
            <td>{{ i + 1 }}</td>
            <td class="mono">{{ it.key }}</td>
            <td><span class="tag" :data-type="it.type">{{ it.type }}</span></td>
            <td><b>{{ fmtBytes(it.bytes) }}</b></td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 12px; }
.run-bar { display: flex; align-items: center; gap: 10px; }
.lbl, .lbl-inline { font-size: 12px; color: var(--muted); }
.lbl-inline { display: inline-flex; align-items: center; gap: 4px; }
.ip-mini { width: 70px; padding: 3px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-family: ui-monospace, monospace; font-size: 12px; }
.meta { font-size: 11px; color: var(--muted); }
.prefix-bar { padding: 10px; background: var(--panel); border-radius: 6px; }
.bars { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.bar { display: grid; grid-template-columns: 120px 1fr; gap: 6px; align-items: center; font-size: 11px; }
.bar-name { font-family: ui-monospace, monospace; color: var(--muted); text-align: right; }
.bar-fill { background: rgba(124, 108, 255, 0.4); padding: 2px 8px; color: #fff; border-radius: 3px; font-family: ui-monospace, monospace; min-width: 50px; }
.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
.grid th, .grid td { border-bottom: 1px solid var(--border); padding: 4px 8px; text-align: left; }
.grid th { background: var(--panel); color: var(--muted); position: sticky; top: 0; }
.mono { font-family: ui-monospace, monospace; word-break: break-all; }
.tag { display: inline-block; padding: 1px 5px; border-radius: 3px; color: #fff; font-size: 10px; background: #888; }
.tag[data-type='string'] { background: #4caf50; }
.tag[data-type='hash'] { background: #7c6cff; }
.tag[data-type='list'] { background: #e0a020; }
.tag[data-type='set'] { background: #03a9f4; }
.tag[data-type='zset'] { background: #e04050; }
.tag[data-type='stream'] { background: #9c27b0; }
.btn-primary, .btn-danger, .btn-ghost { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; cursor: pointer; }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-danger { background: var(--err, #e04050); color: #fff; border-color: var(--err, #e04050); }
.btn-ghost { background: transparent; color: var(--muted); }
</style>
