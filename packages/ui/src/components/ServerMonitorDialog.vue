<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ConnectionConfig, DbDialect, type QueryResult } from '@db-tool/shared-types'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { reportInlineError } from '../errorReporter'
import { t } from '../i18n'
import Modal from './Modal.vue'

const client = useDataClient()
const emit = defineEmits<{ close: [] }>()

const conns = ref<ConnectionConfig[]>([])
const connId = ref('')
const error = ref<string | null>(null)
const cards = ref<{ label: string; value: string }[]>([])
const rateHistory = ref<number[]>([]) // QPS(MySQL) / TPS(PG) 采样，最多 60 点
const rateLabel = ref('')
let timer: ReturnType<typeof setInterval> | undefined
let prev: { counter: number; at: number } | null = null

function fam(d: DbDialect | undefined): 'mysql' | 'pg' | 'other' {
  if (d && [DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase].includes(d)) return 'mysql'
  if (d && [DbDialect.PostgreSQL, DbDialect.KingbaseES, DbDialect.Vastbase].includes(d)) return 'pg'
  return 'other'
}
const connOf = (id: string) => conns.value.find((c) => c.id === id)
const supported = computed(() => fam(connOf(connId.value)?.dialect) !== 'other')

function rows(res: QueryResult): Record<string, unknown>[] {
  return res.rows as Record<string, unknown>[]
}
function fmtDuration(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`
}
function num(v: unknown): number {
  return Number(v) || 0
}

async function pollMysql(c: ConnectionConfig): Promise<void> {
  const res = (await client.connections.execute(c.id, 'SHOW GLOBAL STATUS', [])) as QueryResult
  const s = new Map<string, string>()
  for (const r of rows(res)) s.set(String(r.Variable_name), String(r.Value))
  const vars = (await client.connections.execute(
    c.id,
    "SHOW VARIABLES LIKE 'max_connections'",
    [],
  )) as QueryResult
  const maxConn = num(rows(vars)[0]?.Value)
  const queries = num(s.get('Queries') ?? s.get('Questions'))
  const now = Date.now()
  let qps = 0
  if (prev) qps = Math.max(0, (queries - prev.counter) / ((now - prev.at) / 1000))
  prev = { counter: queries, at: now }
  rateLabel.value = 'QPS'
  if (prev) {
    rateHistory.value.push(qps)
    if (rateHistory.value.length > 60) rateHistory.value.shift()
  }
  const conn = num(s.get('Threads_connected'))
  cards.value = [
    { label: t('monitor.uptime'), value: fmtDuration(num(s.get('Uptime'))) },
    { label: t('monitor.qps'), value: qps.toFixed(1) },
    { label: t('monitor.connections'), value: maxConn ? `${conn} / ${maxConn}` : String(conn) },
    { label: t('monitor.running'), value: String(num(s.get('Threads_running'))) },
    { label: t('monitor.slow'), value: String(num(s.get('Slow_queries'))) },
    { label: t('monitor.aborted'), value: String(num(s.get('Aborted_connects'))) },
  ]
}

async function pollPg(c: ConnectionConfig): Promise<void> {
  const sql = `SELECT
      (SELECT count(*) FROM pg_stat_activity) AS conns,
      (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') AS active,
      (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock') AS waiting,
      (SELECT coalesce(sum(xact_commit + xact_rollback), 0) FROM pg_stat_database) AS xacts,
      (SELECT coalesce(sum(blks_hit), 0) FROM pg_stat_database) AS hit,
      (SELECT coalesce(sum(blks_read), 0) FROM pg_stat_database) AS rd,
      extract(epoch FROM (now() - pg_postmaster_start_time()))::bigint AS uptime`
  const res = (await client.connections.execute(c.id, sql, [])) as QueryResult
  const r = rows(res)[0] ?? {}
  const xacts = num(r.xacts)
  const now = Date.now()
  let tps = 0
  if (prev) tps = Math.max(0, (xacts - prev.counter) / ((now - prev.at) / 1000))
  prev = { counter: xacts, at: now }
  rateLabel.value = 'TPS'
  rateHistory.value.push(tps)
  if (rateHistory.value.length > 60) rateHistory.value.shift()
  const hit = num(r.hit)
  const rd = num(r.rd)
  const ratio = hit + rd > 0 ? (hit / (hit + rd)) * 100 : 100
  cards.value = [
    { label: t('monitor.uptime'), value: fmtDuration(num(r.uptime)) },
    { label: t('monitor.tps'), value: tps.toFixed(1) },
    { label: t('monitor.connections'), value: String(num(r.conns)) },
    { label: t('monitor.running'), value: String(num(r.active)) },
    { label: t('monitor.waiting'), value: String(num(r.waiting)) },
    { label: t('monitor.cacheHit'), value: `${ratio.toFixed(1)}%` },
  ]
}

async function poll(): Promise<void> {
  const c = connOf(connId.value)
  if (!c) return
  const f = fam(c.dialect)
  if (f === 'other') return
  try {
    error.value = null
    if (f === 'mysql') await pollMysql(c)
    else await pollPg(c)
  } catch (e) {
    reportInlineError(error, e)
  }
}

function restart(): void {
  clearInterval(timer)
  prev = null
  rateHistory.value = []
  cards.value = []
  if (!supported.value) return
  void poll()
  timer = setInterval(() => void poll(), 2000)
}

const maxRate = computed(() => Math.max(1, ...rateHistory.value))

onMounted(async () => {
  conns.value = await client.connections.list()
  connId.value = conns.value.find((c) => fam(c.dialect) !== 'other')?.id ?? conns.value[0]?.id ?? ''
  restart()
})
watch(connId, restart)
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <Modal :title="t('monitor.title')" width="wide" @close="emit('close')">
    <div class="mon">
      <select v-model="connId" class="sel">
        <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name || c.id }} · {{ c.dialect }}</option>
      </select>

      <div v-if="!supported" class="hint warn">{{ t('monitor.unsupported') }}</div>
      <div v-else-if="error" class="hint err">{{ error }}</div>
      <template v-else>
        <div class="cards">
          <div v-for="m in cards" :key="m.label" class="card">
            <div class="cval">{{ m.value }}</div>
            <div class="clabel">{{ m.label }}</div>
          </div>
        </div>
        <div class="spark-wrap">
          <div class="spark-title">{{ rateLabel }}</div>
          <div class="spark">
            <span
              v-for="(v, i) in rateHistory"
              :key="i"
              class="bar"
              :style="{ height: Math.max(2, (v / maxRate) * 100) + '%' }"
              :title="v.toFixed(1)"
            ></span>
          </div>
        </div>
        <p class="foot">{{ t('monitor.foot') }}</p>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.mon {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 560px;
  max-width: 84vw;
}
.sel {
  padding: 7px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.hint {
  font-size: 13px;
  color: var(--muted);
  padding: 12px 2px;
}
.hint.err {
  color: var(--err, #e04050);
}
.hint.warn {
  color: #e0a020;
}
.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}
.cval {
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.clabel {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}
.spark-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
.spark-title {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 6px;
}
.spark {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 64px;
}
.spark .bar {
  flex: 1;
  min-width: 2px;
  background: var(--accent, #7c6cff);
  border-radius: 1px 1px 0 0;
}
.foot {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
</style>
