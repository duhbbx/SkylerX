<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Redis 服务器管理面板。多 tab:
 *  - INFO:分类显示 server/clients/memory/persistence/stats/replication/cpu/keyspace
 *  - Slow log:SLOWLOG GET 列表 + RESET + slowlog-log-slower-than 配置
 *  - Clients:CLIENT LIST 列表 + 杀连接
 *  - Commandstats:INFO commandstats 排序后展示
 *  - Config:CONFIG GET * 列表 + CONFIG SET 编辑
 * 顶栏一个自动刷新开关(5s)。
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, prompt as appPrompt, toast } from '../dialog'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

type Tab = 'info' | 'slowlog' | 'clients' | 'cmdstats' | 'config' | 'cluster' | 'sentinel'
const tab = ref<Tab>('info')
const loading = ref(false)
const autoRefresh = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

// INFO 各分类 → key/value 表;Redis INFO 输出按 # SectionName 分块
const infoSections = ref<{ name: string; entries: { k: string; v: string }[] }[]>([])

// SLOWLOG GET 128 → [[id, ts, duration_us, [args...]], ...]
interface SlowLogEntry {
  id: number
  ts: number
  durationUs: number
  command: string
  clientAddr?: string
  clientName?: string
}
const slowlogEntries = ref<SlowLogEntry[]>([])
const slowThreshold = ref<number | null>(null) // CONFIG GET slowlog-log-slower-than 微秒

// CLIENT LIST 输出按行解析;每行 id=xx addr=xx fd=xx ...
interface ClientRow {
  id: string
  addr: string
  laddr: string
  name: string
  age: string
  idle: string
  db: string
  cmd: string
  user: string
  raw: string
}
const clientRows = ref<ClientRow[]>([])
const myClientId = ref<string | null>(null) // CLIENT ID,防误杀自己

// commandstats:cmdstat_<cmd>:calls=...,usec=...,usec_per_call=...
interface CmdStat {
  cmd: string
  calls: number
  usec: number
  usecPerCall: number
}
const cmdStats = ref<CmdStat[]>([])

// CONFIG GET * → { name: value }
const configEntries = ref<{ k: string; v: string }[]>([])
const configFilter = ref('')

// Cluster — CLUSTER INFO + CLUSTER NODES
interface ClusterNode {
  id: string
  endpoint: string
  flags: string[]
  master: string // '-' = self is master
  pingSent: number
  pongRecv: number
  configEpoch: number
  linkState: string
  slots: { from: number; to: number }[]
}
const clusterInfo = ref<{ k: string; v: string }[]>([])
const clusterNodes = ref<ClusterNode[]>([])
const clusterErr = ref<string | null>(null)

// Sentinel — SENTINEL masters / replicas / sentinels
const sentinelMasters = ref<{ k: string; v: string }[][]>([])
const sentinelErr = ref<string | null>(null)

async function call(op: string, args: unknown[] = []): Promise<unknown> {
  const r = await client.connections.executeCommand(props.conn.id, { op, args })
  return r.data
}

/** 解析 INFO 输出:按 "# Section" 分块,每行 key:value。 */
function parseInfo(raw: string): { name: string; entries: { k: string; v: string }[] }[] {
  const out: { name: string; entries: { k: string; v: string }[] }[] = []
  let current: { name: string; entries: { k: string; v: string }[] } | null = null
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('# ')) {
      current = { name: line.slice(2).trim(), entries: [] }
      out.push(current)
    } else if (line && current && line.includes(':')) {
      const idx = line.indexOf(':')
      current.entries.push({ k: line.slice(0, idx), v: line.slice(idx + 1) })
    }
  }
  return out
}

async function loadInfo(): Promise<void> {
  loading.value = true
  try {
    const raw = String((await call('INFO')) ?? '')
    infoSections.value = parseInfo(raw)
  } finally {
    loading.value = false
  }
}

async function loadCmdStats(): Promise<void> {
  loading.value = true
  try {
    const raw = String((await call('INFO', ['commandstats'])) ?? '')
    const parsed = parseInfo(raw)
    const section = parsed.find((s) => s.name.toLowerCase().includes('command'))
    const out: CmdStat[] = []
    for (const e of section?.entries ?? []) {
      // e.k = cmdstat_set;e.v = calls=12,usec=88,usec_per_call=7.33,rejected_calls=0,failed_calls=0
      const m = /^cmdstat_(.+)$/.exec(e.k)
      if (!m) continue
      const cmd = m[1]
      const obj: Record<string, string> = {}
      for (const part of e.v.split(',')) {
        const [pk, pv] = part.split('=')
        if (pk) obj[pk] = pv
      }
      out.push({
        cmd,
        calls: Number(obj.calls ?? 0),
        usec: Number(obj.usec ?? 0),
        usecPerCall: Number(obj.usec_per_call ?? 0),
      })
    }
    cmdStats.value = out.sort((a, b) => b.usecPerCall - a.usecPerCall)
  } finally {
    loading.value = false
  }
}

async function loadSlowlog(): Promise<void> {
  loading.value = true
  try {
    // SLOWLOG GET 128 返回 [[id, ts, duration_us, [cmd, arg1, ...], (optional) client_addr, client_name], ...]
    const raw = (await call('SLOWLOG', ['GET', '128'])) as unknown[]
    const out: SlowLogEntry[] = []
    for (const item of raw ?? []) {
      if (!Array.isArray(item)) continue
      const [id, ts, dur, cmd, clientAddr, clientName] = item as unknown[]
      const cmdStr = Array.isArray(cmd) ? cmd.map((x) => String(x)).join(' ') : String(cmd ?? '')
      out.push({
        id: Number(id),
        ts: Number(ts),
        durationUs: Number(dur),
        command: cmdStr,
        clientAddr: clientAddr ? String(clientAddr) : undefined,
        clientName: clientName ? String(clientName) : undefined,
      })
    }
    slowlogEntries.value = out

    // 同时拉 slowlog-log-slower-than 阈值
    try {
      const cfg = (await call('CONFIG', ['GET', 'slowlog-log-slower-than'])) as unknown[]
      if (Array.isArray(cfg) && cfg.length >= 2) slowThreshold.value = Number(cfg[1])
    } catch {
      slowThreshold.value = null
    }
  } finally {
    loading.value = false
  }
}

async function resetSlowlog(): Promise<void> {
  if (!(await appConfirm({ message: '清空所有慢日志记录?', variant: 'danger' }))) return
  try {
    await call('SLOWLOG', ['RESET'])
    slowlogEntries.value = []
    toast.success('已清空')
  } catch (e) {
    toast.error(`SLOWLOG RESET 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function setSlowThreshold(): Promise<void> {
  const input = await appPrompt({
    message: '设置慢日志阈值(微秒;-1 = 禁用;0 = 记录所有):',
    defaultValue: String(slowThreshold.value ?? 10000),
  })
  if (input == null) return
  const us = Number.parseInt(input, 10)
  if (!Number.isFinite(us)) return
  try {
    await call('CONFIG', ['SET', 'slowlog-log-slower-than', String(us)])
    slowThreshold.value = us
    toast.success(`阈值已更新为 ${us}μs`)
  } catch (e) {
    toast.error(`CONFIG SET 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 解析 CLIENT LIST 单行:用空格分,每段 `key=value`。 */
function parseClientLine(line: string): ClientRow {
  const obj: Record<string, string> = {}
  for (const part of line.trim().split(/\s+/)) {
    const idx = part.indexOf('=')
    if (idx > 0) obj[part.slice(0, idx)] = part.slice(idx + 1)
  }
  return {
    id: obj.id ?? '',
    addr: obj.addr ?? '',
    laddr: obj.laddr ?? '',
    name: obj.name ?? '',
    age: obj.age ?? '',
    idle: obj.idle ?? '',
    db: obj.db ?? '',
    cmd: obj.cmd ?? '',
    user: obj.user ?? '',
    raw: line,
  }
}

async function loadClients(): Promise<void> {
  loading.value = true
  try {
    const raw = String((await call('CLIENT', ['LIST'])) ?? '')
    const rows = raw
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map(parseClientLine)
    clientRows.value = rows.sort((a, b) => Number(b.idle) - Number(a.idle))
    try {
      myClientId.value = String((await call('CLIENT', ['ID'])) ?? '')
    } catch {
      myClientId.value = null
    }
  } finally {
    loading.value = false
  }
}

async function killClient(row: ClientRow): Promise<void> {
  if (row.id === myClientId.value) {
    toast.warn('这是当前连接自己,不能杀')
    return
  }
  if (!(await appConfirm({ message: `杀连接 id=${row.id} (${row.addr}) ?`, variant: 'danger' })))
    return
  try {
    await call('CLIENT', ['KILL', 'ID', row.id])
    clientRows.value = clientRows.value.filter((r) => r.id !== row.id)
    toast.success(`已杀 id=${row.id}`)
  } catch (e) {
    toast.error(`CLIENT KILL 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function loadConfig(): Promise<void> {
  loading.value = true
  try {
    const raw = (await call('CONFIG', ['GET', '*'])) as unknown[] | Record<string, string>
    const out: { k: string; v: string }[] = []
    if (Array.isArray(raw)) {
      for (let i = 0; i + 1 < raw.length; i += 2) out.push({ k: String(raw[i]), v: String(raw[i + 1] ?? '') })
    } else if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) out.push({ k, v: String(v ?? '') })
    }
    configEntries.value = out.sort((a, b) => a.k.localeCompare(b.k))
  } finally {
    loading.value = false
  }
}

async function setConfigEntry(entry: { k: string; v: string }): Promise<void> {
  const next = await appPrompt({ message: `CONFIG SET ${entry.k} =`, defaultValue: entry.v })
  if (next == null || next === entry.v) return
  try {
    await call('CONFIG', ['SET', entry.k, next])
    entry.v = next
    toast.success(`已更新 ${entry.k}`)
  } catch (e) {
    toast.error(`CONFIG SET 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const filteredConfig = computed(() => {
  const q = configFilter.value.trim().toLowerCase()
  if (!q) return configEntries.value
  return configEntries.value.filter((e) => e.k.includes(q))
})

async function loadCluster(): Promise<void> {
  loading.value = true
  clusterErr.value = null
  try {
    // CLUSTER INFO -> 文本 KEY:VALUE per line
    const infoRaw = String((await call('CLUSTER', ['INFO'])) ?? '')
    const infos: { k: string; v: string }[] = []
    for (const line of infoRaw.split(/\r?\n/)) {
      const idx = line.indexOf(':')
      if (idx > 0) infos.push({ k: line.slice(0, idx), v: line.slice(idx + 1).trim() })
    }
    clusterInfo.value = infos
    // CLUSTER NODES -> 多行,每行:id endpoint@cport flags master ping pong epoch link slot1 slot2 ...
    const nodesRaw = String((await call('CLUSTER', ['NODES'])) ?? '')
    const nodes: ClusterNode[] = []
    for (const line of nodesRaw.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 8) continue
      const slots: { from: number; to: number }[] = []
      for (let i = 8; i < parts.length; i++) {
        const s = parts[i]
        // slot 可能是 single (123) 或 range (100-200) 或 importing/migrating (跳过)
        if (s.includes('[')) continue
        if (s.includes('-')) {
          const [a, b] = s.split('-').map(Number)
          slots.push({ from: a, to: b })
        } else {
          const n = Number(s)
          if (Number.isFinite(n)) slots.push({ from: n, to: n })
        }
      }
      nodes.push({
        id: parts[0],
        endpoint: parts[1],
        flags: parts[2].split(','),
        master: parts[3],
        pingSent: Number(parts[4]),
        pongRecv: Number(parts[5]),
        configEpoch: Number(parts[6]),
        linkState: parts[7],
        slots,
      })
    }
    clusterNodes.value = nodes
  } catch (e) {
    clusterErr.value =
      e instanceof Error ? e.message : '该 Redis 实例可能未启用 cluster 模式(单机/Sentinel/Standalone)'
  } finally {
    loading.value = false
  }
}

async function loadSentinel(): Promise<void> {
  loading.value = true
  sentinelErr.value = null
  try {
    // SENTINEL MASTERS → 数组 of (字段名 - 值 交错 array)
    const raw = (await call('SENTINEL', ['MASTERS'])) as unknown[]
    const out: { k: string; v: string }[][] = []
    for (const m of raw ?? []) {
      const row: { k: string; v: string }[] = []
      if (Array.isArray(m)) {
        for (let i = 0; i + 1 < m.length; i += 2) {
          row.push({ k: String(m[i]), v: String(m[i + 1] ?? '') })
        }
      }
      out.push(row)
    }
    sentinelMasters.value = out
  } catch (e) {
    sentinelErr.value =
      e instanceof Error
        ? e.message
        : '该 Redis 实例不是 Sentinel 节点(只有 sentinel 服务端口才支持 SENTINEL 命令)'
  } finally {
    loading.value = false
  }
}

async function refresh(): Promise<void> {
  if (tab.value === 'info') await loadInfo()
  else if (tab.value === 'slowlog') await loadSlowlog()
  else if (tab.value === 'clients') await loadClients()
  else if (tab.value === 'cmdstats') await loadCmdStats()
  else if (tab.value === 'config') await loadConfig()
  else if (tab.value === 'cluster') await loadCluster()
  else if (tab.value === 'sentinel') await loadSentinel()
}

/** 把 slots 数组渲染成总计数字。 */
function totalSlots(slots: { from: number; to: number }[]): number {
  let n = 0
  for (const s of slots) n += s.to - s.from + 1
  return n
}
/** Slot 分布的彩条:按 master 分配颜色。 */
const slotBar = computed(() => {
  // 把所有 nodes 的 slots 按 from 起点排序,每段标 master id 短码,渲染时按短码哈希颜色
  const segs: { from: number; to: number; ownerShort: string }[] = []
  for (const n of clusterNodes.value) {
    if (n.master !== '-') continue // 只算 master
    for (const s of n.slots) segs.push({ from: s.from, to: s.to, ownerShort: n.id.slice(0, 8) })
  }
  segs.sort((a, b) => a.from - b.from)
  return segs
})
function slotColor(short: string): string {
  // 简易 hash → HSL
  let h = 0
  for (const c of short) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h}, 60%, 55%)`
}

watch(tab, refresh)
watch(autoRefresh, (on) => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (on) timer = setInterval(refresh, 5000)
})
watch(
  () => props.open,
  (op) => {
    if (op) {
      tab.value = 'info'
      autoRefresh.value = false
      void refresh()
    } else if (timer) {
      clearInterval(timer)
      timer = null
    }
  },
)

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function fmtBytes(n: string | number): string {
  const num = typeof n === 'string' ? Number(n) : n
  if (!Number.isFinite(num)) return String(n)
  if (num < 1024) return `${num} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`
  if (num < 1024 * 1024 * 1024) return `${(num / 1024 / 1024).toFixed(2)} MB`
  return `${(num / 1024 / 1024 / 1024).toFixed(2)} GB`
}
function fmtTime(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  return d.toLocaleString()
}
const MEMORY_HUMAN_KEYS = new Set(['used_memory', 'used_memory_peak', 'used_memory_rss', 'total_system_memory', 'maxmemory'])
function smartValue(k: string, v: string): string {
  if (MEMORY_HUMAN_KEYS.has(k) || /memory_human$/.test(k)) {
    if (/_human$/.test(k)) return v
    return fmtBytes(v)
  }
  return v
}
</script>

<template>
  <Modal v-if="open" :title="`Redis 服务器  ·  ${conn.name || conn.dialect}`" width="xl" fixed-height storage-key="redis-server-info" @close="emit('close')">
    <div class="tabs">
      <button v-for="t in (['info','slowlog','clients','cmdstats','config','cluster','sentinel'] as Tab[])" :key="t" :class="{ on: tab === t }" @click="tab = t">
        {{ ({info:'INFO',slowlog:'慢日志',clients:'客户端',cmdstats:'命令统计',config:'CONFIG',cluster:'Cluster',sentinel:'Sentinel'} as Record<Tab,string>)[t] }}
      </button>
      <span class="spacer" />
      <label class="auto"><input v-model="autoRefresh" type="checkbox" /> 5s 自动刷新</label>
      <button class="btn" :disabled="loading" @click="refresh">🔄 刷新</button>
    </div>

    <div class="body">
      <div v-if="loading" class="empty">加载中…</div>

      <!-- INFO -->
      <template v-else-if="tab === 'info'">
        <div v-for="s in infoSections" :key="s.name" class="info-sec">
          <div class="info-title">{{ s.name }}</div>
          <table class="grid">
            <tbody>
              <tr v-for="e in s.entries" :key="e.k">
                <td class="info-k">{{ e.k }}</td>
                <td class="info-v">{{ smartValue(e.k, e.v) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 慢日志 -->
      <template v-else-if="tab === 'slowlog'">
        <div class="sub-bar">
          <span class="meta">阈值: {{ slowThreshold == null ? '—' : `${slowThreshold} μs` }}</span>
          <button class="btn" @click="setSlowThreshold">设阈值</button>
          <button class="btn danger" @click="resetSlowlog">SLOWLOG RESET</button>
          <span class="spacer" />
          <span class="meta">{{ slowlogEntries.length }} 条</span>
        </div>
        <table class="grid">
          <thead>
            <tr>
              <th style="width: 60px">id</th>
              <th style="width: 160px">时间</th>
              <th style="width: 100px">耗时</th>
              <th>命令</th>
              <th style="width: 140px">客户端</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in slowlogEntries" :key="e.id">
              <td>{{ e.id }}</td>
              <td>{{ fmtTime(e.ts) }}</td>
              <td><b>{{ e.durationUs }}</b> μs</td>
              <td class="mono">{{ e.command }}</td>
              <td>{{ e.clientAddr ?? '—' }}{{ e.clientName ? ` (${e.clientName})` : '' }}</td>
            </tr>
            <tr v-if="!slowlogEntries.length"><td colspan="5" class="empty-row">无慢日志</td></tr>
          </tbody>
        </table>
      </template>

      <!-- 客户端 -->
      <template v-else-if="tab === 'clients'">
        <div class="sub-bar">
          <span class="meta">当前连接 id={{ myClientId ?? '—' }}</span>
          <span class="spacer" />
          <span class="meta">{{ clientRows.length }} 个客户端</span>
        </div>
        <table class="grid">
          <thead>
            <tr>
              <th style="width: 50px">id</th>
              <th style="width: 160px">addr</th>
              <th style="width: 90px">name</th>
              <th style="width: 50px">db</th>
              <th style="width: 70px">age</th>
              <th style="width: 70px">idle</th>
              <th>cmd</th>
              <th style="width: 90px">user</th>
              <th style="width: 80px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in clientRows" :key="r.id" :class="{ self: r.id === myClientId }">
              <td>{{ r.id }}<span v-if="r.id === myClientId" class="self-tag">self</span></td>
              <td class="mono">{{ r.addr }}</td>
              <td>{{ r.name || '—' }}</td>
              <td>{{ r.db }}</td>
              <td>{{ r.age }}s</td>
              <td>{{ r.idle }}s</td>
              <td class="mono">{{ r.cmd }}</td>
              <td>{{ r.user }}</td>
              <td><button class="mini-btn danger" :disabled="r.id === myClientId" @click="killClient(r)">杀</button></td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- 命令统计 -->
      <template v-else-if="tab === 'cmdstats'">
        <table class="grid">
          <thead>
            <tr>
              <th>命令</th>
              <th style="width: 100px">调用次数</th>
              <th style="width: 120px">总耗时 (μs)</th>
              <th style="width: 140px">平均耗时 (μs/call)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in cmdStats" :key="c.cmd">
              <td class="mono">{{ c.cmd }}</td>
              <td>{{ c.calls.toLocaleString() }}</td>
              <td>{{ c.usec.toLocaleString() }}</td>
              <td><b>{{ c.usecPerCall.toFixed(2) }}</b></td>
            </tr>
            <tr v-if="!cmdStats.length"><td colspan="4" class="empty-row">无统计</td></tr>
          </tbody>
        </table>
      </template>

      <!-- Cluster -->
      <template v-else-if="tab === 'cluster'">
        <div v-if="clusterErr" class="err-banner">{{ clusterErr }}</div>
        <template v-else>
          <div class="info-sec">
            <div class="info-title">CLUSTER INFO</div>
            <table class="grid">
              <tbody>
                <tr v-for="e in clusterInfo" :key="e.k">
                  <td class="info-k">{{ e.k }}</td><td class="info-v">{{ e.v }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="info-sec">
            <div class="info-title">Slot 分布 (0-16383)</div>
            <div class="slot-bar">
              <div
                v-for="(s, i) in slotBar"
                :key="i"
                class="slot-seg"
                :style="{
                  left: `${(s.from / 16384) * 100}%`,
                  width: `${((s.to - s.from + 1) / 16384) * 100}%`,
                  background: slotColor(s.ownerShort),
                }"
                :title="`${s.from}-${s.to} → ${s.ownerShort}`"
              />
            </div>
          </div>
          <div class="info-sec">
            <div class="info-title">CLUSTER NODES</div>
            <table class="grid">
              <thead>
                <tr>
                  <th style="width: 90px">id (短)</th>
                  <th>endpoint</th>
                  <th style="width: 100px">role</th>
                  <th style="width: 120px">master</th>
                  <th style="width: 60px">slots</th>
                  <th style="width: 70px">link</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="n in clusterNodes" :key="n.id">
                  <td class="mono">{{ n.id.slice(0, 8) }}</td>
                  <td class="mono">{{ n.endpoint }}</td>
                  <td>
                    <span v-for="f in n.flags" :key="f" class="flag" :data-flag="f">{{ f }}</span>
                  </td>
                  <td class="mono">{{ n.master === '-' ? '—' : n.master.slice(0, 8) }}</td>
                  <td>{{ totalSlots(n.slots) }}</td>
                  <td>{{ n.linkState }}</td>
                </tr>
                <tr v-if="!clusterNodes.length"><td colspan="6" class="empty-row">无节点</td></tr>
              </tbody>
            </table>
          </div>
        </template>
      </template>

      <!-- Sentinel -->
      <template v-else-if="tab === 'sentinel'">
        <div v-if="sentinelErr" class="err-banner">{{ sentinelErr }}</div>
        <template v-else>
          <div v-for="(m, i) in sentinelMasters" :key="i" class="info-sec">
            <div class="info-title">Master #{{ i + 1 }}</div>
            <table class="grid">
              <tbody>
                <tr v-for="e in m" :key="e.k">
                  <td class="info-k">{{ e.k }}</td><td class="info-v">{{ e.v }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="!sentinelMasters.length" class="empty">无监控的 master</div>
        </template>
      </template>

      <!-- CONFIG -->
      <template v-else-if="tab === 'config'">
        <div class="sub-bar">
          <input v-model="configFilter" class="ip" placeholder="过滤配置项,如 max / save" />
          <span class="spacer" />
          <span class="meta">{{ filteredConfig.length }} / {{ configEntries.length }}</span>
        </div>
        <table class="grid">
          <thead><tr><th>名称</th><th>值</th></tr></thead>
          <tbody>
            <tr v-for="e in filteredConfig" :key="e.k" class="cfg-row" @click="setConfigEntry(e)">
              <td class="mono">{{ e.k }}</td>
              <td class="mono cfg-val">{{ e.v }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 0 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}
.tabs button {
  background: transparent;
  border: 1px solid transparent;
  color: var(--muted);
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.tabs button.on {
  background: rgba(124, 108, 255, 0.18);
  border-color: var(--accent);
  color: var(--text);
}
.spacer {
  flex: 1;
}
.auto {
  font-size: 11px;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.btn {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.btn.danger {
  border-color: rgba(224, 64, 80, 0.4);
  color: #e04050;
}
.body {
  flex: 1;
  overflow: auto;
  max-height: 60vh;
}
.empty {
  padding: 30px;
  text-align: center;
  color: var(--muted);
}
.info-sec {
  margin-bottom: 16px;
}
.info-title {
  font-size: 11px;
  color: var(--accent);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.grid th,
.grid td {
  border-bottom: 1px solid var(--border);
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
}
.grid th {
  background: var(--panel);
  color: var(--muted);
  font-weight: 600;
  position: sticky;
  top: 0;
}
.info-k {
  width: 240px;
  color: var(--muted);
  font-family: var(--font-mono);
}
.info-v {
  font-family: var(--font-mono);
  word-break: break-all;
}
.mono {
  font-family: var(--font-mono);
}
.sub-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 8px;
}
.meta {
  font-size: 11px;
  color: var(--muted);
}
.ip {
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text);
}
.cfg-row {
  cursor: pointer;
}
.cfg-row:hover td {
  background: rgba(124, 108, 255, 0.08);
}
.cfg-val {
  word-break: break-all;
  color: var(--accent);
}
.mini-btn {
  padding: 2px 8px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: pointer;
  background: var(--bg);
  color: var(--text);
}
.mini-btn.danger {
  color: #e04050;
  border-color: rgba(224, 64, 80, 0.4);
}
.mini-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.empty-row {
  text-align: center;
  color: var(--muted);
  font-style: italic;
}
tr.self {
  background: rgba(76, 175, 80, 0.08);
}
.self-tag {
  display: inline-block;
  margin-left: 4px;
  padding: 0 4px;
  font-size: 9px;
  background: #4caf50;
  color: #fff;
  border-radius: 2px;
}
.btn-ghost {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
}
.err-banner {
  padding: 10px 14px;
  background: rgba(224, 64, 80, 0.08);
  border: 1px solid rgba(224, 64, 80, 0.4);
  border-radius: 6px;
  color: var(--err, #e04050);
  font-size: 12px;
}
.slot-bar {
  position: relative;
  height: 20px;
  background: var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.slot-seg {
  position: absolute;
  top: 0;
  bottom: 0;
}
.flag {
  display: inline-block;
  margin-right: 3px;
  padding: 0 4px;
  font-size: 9px;
  border-radius: 2px;
  background: var(--border);
  color: var(--muted);
}
.flag[data-flag='master'] { background: rgba(124, 108, 255, 0.4); color: #fff; }
.flag[data-flag='slave'] { background: rgba(3, 169, 244, 0.4); color: #fff; }
.flag[data-flag='myself'] { background: rgba(76, 175, 80, 0.5); color: #fff; }
.flag[data-flag='fail'],
.flag[data-flag='fail?'] { background: rgba(224, 64, 80, 0.6); color: #fff; }
</style>
