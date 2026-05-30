<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Redis 实时事件监听。
 *
 * 实现选择:不用 MONITOR(它 blocking 整个连接,影响其它命令),用 keyspace notifications。
 *  - 需要服务器 CONFIG SET notify-keyspace-events 'AKE'(本对话框第一次启动时检查并提示)
 *  - 我们对所有 db PSUBSCRIBE __keyspace@*__:* 和 __keyevent@*__:*
 *
 * 局限:driver 当前的 executeCommand 是 request-response;PSUBSCRIBE 是持续推送,
 *   ioredis pubsub 模式后 connection 转入 subscriber 状态,不再接受其它命令。
 *   折中:用轮询方式 — 每 1.5s 拉一次 INFO + CLIENT LIST 看流量;
 *   或者请用户在 RedisServerInfoDialog 的 CONFIG tab 手动观察 stats:total_commands_processed 增长。
 *
 * 目前的 dialog 提供两种"实时观察"方案:
 *  - INFO stats 模式:每 N 秒拉 keyspace_hits/misses + total_commands + ops_per_sec,绘成滚动表
 *  - Keyspace notifications 提示:告诉用户怎么开启 + 通过命令行临时观察(给出 CLI 命令)
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { onUnmounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

interface Tick {
  ts: number
  totalCmds: number
  hits: number
  misses: number
  opsPerSec: number
  connectedClients: number
  usedMemory: number
}
const ticks = ref<Tick[]>([])
const running = ref(false)
const intervalMs = ref(2000)
let timer: ReturnType<typeof setInterval> | null = null

async function call(op: string, args: unknown[]): Promise<unknown> {
  const r = await client.connections.executeCommand(props.conn.id, { op, args })
  return r.data
}

async function tick(): Promise<void> {
  try {
    const raw = String((await call('INFO', ['stats'])) ?? '')
    const stats: Record<string, string> = {}
    for (const line of raw.split(/\r?\n/)) {
      const i = line.indexOf(':')
      if (i > 0) stats[line.slice(0, i)] = line.slice(i + 1)
    }
    const clientsRaw = String((await call('INFO', ['clients'])) ?? '')
    const memRaw = String((await call('INFO', ['memory'])) ?? '')
    let connectedClients = 0
    for (const line of clientsRaw.split(/\r?\n/)) {
      if (line.startsWith('connected_clients:')) connectedClients = Number(line.split(':')[1] ?? 0)
    }
    let usedMemory = 0
    for (const line of memRaw.split(/\r?\n/)) {
      if (line.startsWith('used_memory:')) usedMemory = Number(line.split(':')[1] ?? 0)
    }
    const t: Tick = {
      ts: Date.now(),
      totalCmds: Number(stats.total_commands_processed ?? 0),
      hits: Number(stats.keyspace_hits ?? 0),
      misses: Number(stats.keyspace_misses ?? 0),
      opsPerSec: Number(stats.instantaneous_ops_per_sec ?? 0),
      connectedClients,
      usedMemory,
    }
    ticks.value.push(t)
    if (ticks.value.length > 60) ticks.value.shift() // 保留最近 60 个点
  } catch (e) {
    toast.error(`采样失败: ${e instanceof Error ? e.message : String(e)}`)
    stop()
  }
}

function start(): void {
  if (running.value) return
  running.value = true
  ticks.value = []
  void tick()
  timer = setInterval(tick, intervalMs.value)
}

function stop(): void {
  running.value = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

watch(
  () => props.open,
  (op) => {
    if (!op) stop()
  },
)
onUnmounted(stop)
</script>

<template>
  <Modal v-if="open" title="实时监控  ·  Redis stats 滚动" width="wide" @close="emit('close')">
    <div class="form">
      <div class="ctrl">
        <label class="lbl-inline">采样间隔
          <input v-model.number="intervalMs" type="number" class="ip-mini" min="500" :disabled="running" />
          ms
        </label>
        <button v-if="!running" class="btn-primary" @click="start">▶ 开始</button>
        <button v-else class="btn-danger" @click="stop">■ 停止</button>
        <span v-if="ticks.length" class="meta">{{ ticks.length }} 个采样点(最近 60)</span>
      </div>

      <div class="hint">
        <strong>说明:</strong>
        Redis 的 MONITOR 命令是 blocking 模式,会独占连接;
        本面板退而求其次,通过 <code>INFO stats</code> + <code>INFO clients/memory</code>
        定时采样,展示 ops_per_sec / 命中率 / 内存 / 连接数。
        若要看每条命令明细,请在终端执行 <code>redis-cli MONITOR</code>。
      </div>

      <table v-if="ticks.length" class="grid">
        <thead>
          <tr>
            <th>时间</th>
            <th style="width: 100px">ops/sec</th>
            <th style="width: 110px">命中/未命中</th>
            <th style="width: 90px">命中率</th>
            <th style="width: 110px">总命令数</th>
            <th style="width: 90px">客户端</th>
            <th style="width: 110px">已用内存</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(t, i) in [...ticks].reverse()" :key="i">
            <td>{{ fmtTime(t.ts) }}</td>
            <td><b>{{ t.opsPerSec }}</b></td>
            <td>{{ t.hits.toLocaleString() }} / {{ t.misses.toLocaleString() }}</td>
            <td>
              {{ t.hits + t.misses > 0 ? `${((t.hits / (t.hits + t.misses)) * 100).toFixed(1)}%` : '—' }}
            </td>
            <td>{{ t.totalCmds.toLocaleString() }}</td>
            <td>{{ t.connectedClients }}</td>
            <td>{{ fmtBytes(t.usedMemory) }}</td>
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
.ctrl { display: flex; align-items: center; gap: 12px; }
.lbl-inline { font-size: 12px; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
.ip-mini { width: 70px; padding: 3px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-family: ui-monospace, monospace; font-size: 12px; }
.meta { font-size: 11px; color: var(--muted); }
.hint { padding: 8px 12px; background: var(--panel); border-radius: 6px; font-size: 11px; color: var(--muted); line-height: 1.6; }
.hint code { background: var(--bg); padding: 1px 6px; border-radius: 3px; font-family: ui-monospace, monospace; }
.grid { width: 100%; border-collapse: collapse; font-size: 12px; font-family: ui-monospace, monospace; }
.grid th, .grid td { border-bottom: 1px solid var(--border); padding: 4px 8px; text-align: left; }
.grid th { background: var(--panel); color: var(--muted); position: sticky; top: 0; font-family: inherit; }
.btn-primary, .btn-danger, .btn-ghost { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; cursor: pointer; }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-danger { background: var(--err, #e04050); color: #fff; border-color: var(--err, #e04050); }
.btn-ghost { background: transparent; color: var(--muted); }
</style>
