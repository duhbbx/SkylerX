<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 等保合规检查面板。
 *
 * 用法（Workspace 或上层组件按需注册；注意 props.open=false 时不渲染 Modal，开关由父控）：
 * ```vue
 * <ComplianceDialog v-if="showCompliance" :conn="currentConn" :open="true" @close="showCompliance=false" />
 * ```
 *
 * 也可通过模板 ref + defineExpose：
 * ```vue
 * <ComplianceDialog ref="compl" :conn="conn" :open="open" @close="open=false" />
 * <button @click="compl?.runAll()">一键检测</button>
 * ```
 */
import type { ConnectionConfig, QueryResult } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import {
  type ComplianceCheck,
  type ComplianceResult,
  SEVERITY_LABEL,
  type Severity,
  checksFor,
  renderReport,
} from '../compliance'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

const checks = computed<ComplianceCheck[]>(() => checksFor(props.conn.dialect))
const results = ref<Map<string, ComplianceResult>>(new Map())
/** 单条检查项的运行态：未跑 / 运行中 / 已完成 */
const running = ref<Set<string>>(new Set())
const runningAll = ref(false)

// 切换连接时清空已有结果
watch(
  () => props.conn?.id,
  () => {
    results.value = new Map()
    running.value = new Set()
  },
)

async function runOne(c: ComplianceCheck): Promise<void> {
  running.value = new Set(running.value).add(c.id)
  try {
    const r = await c.run(props.conn, async (sql) => {
      const qr = (await client.connections.execute(props.conn.id, sql, [])) as QueryResult
      return (qr.rows ?? []) as Array<Record<string, unknown>>
    })
    const next = new Map(results.value)
    next.set(c.id, r)
    results.value = next
  } catch (e) {
    const next = new Map(results.value)
    next.set(c.id, {
      severity: 'unknown',
      message: e instanceof Error ? e.message : String(e),
    })
    results.value = next
  } finally {
    const s = new Set(running.value)
    s.delete(c.id)
    running.value = s
  }
}

async function runAll(): Promise<void> {
  if (runningAll.value) return
  runningAll.value = true
  try {
    // 并发跑；驱动层自己排队/复用连接
    await Promise.all(checks.value.map(runOne))
    toast.success('合规检查完成')
  } finally {
    runningAll.value = false
  }
}

/** 把同 category 的检查聚到一起；保持原始声明顺序 */
interface CatGroup {
  name: string
  items: ComplianceCheck[]
  pass: number
  warn: number
  fail: number
  unknown: number
  pending: number
}
const groups = computed<CatGroup[]>(() => {
  const map = new Map<string, ComplianceCheck[]>()
  for (const c of checks.value) {
    const list = map.get(c.category) ?? []
    list.push(c)
    map.set(c.category, list)
  }
  const out: CatGroup[] = []
  for (const [name, items] of map) {
    let pass = 0
    let warn = 0
    let fail = 0
    let unknown = 0
    let pending = 0
    for (const c of items) {
      const r = results.value.get(c.id)
      if (!r) {
        pending++
        continue
      }
      if (r.severity === 'pass') pass++
      else if (r.severity === 'warn') warn++
      else if (r.severity === 'fail') fail++
      else unknown++
    }
    out.push({ name, items, pass, warn, fail, unknown, pending })
  }
  return out
})

/** 折叠状态：默认全部展开 */
const collapsed = ref<Set<string>>(new Set())
function toggleCat(name: string): void {
  const s = new Set(collapsed.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  collapsed.value = s
}

function sevClass(s: Severity | undefined): string {
  return s ? `sev-${s}` : 'sev-pending'
}

function sevLabel(s: Severity | undefined): string {
  return s ? SEVERITY_LABEL[s] : '· 待运行'
}

async function exportReport(): Promise<void> {
  const md = renderReport(props.conn, checks.value, results.value)
  const safeName = (props.conn.name || props.conn.id).replace(/[^\w\-]+/g, '_')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const saved = await client.files.saveText({
    defaultName: `compliance-${safeName}-${stamp}.md`,
    content: md,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (saved) toast.success(`已导出：${saved}`)
}

/** 暴露给父组件用模板 ref 触发：跑一遍 / 单独跑 / 导出报告 / 读取结果。 */
defineExpose({ runAll, runOne, exportReport, results })
</script>

<template>
  <Modal v-if="open" title="等保合规检查" width="wide" @close="emit('close')">
    <div class="cmp">
      <!-- 顶部：连接 + 操作 -->
      <div class="bar">
        <div class="conn">
          <span class="lbl">连接</span>
          <strong>{{ conn.name || conn.id }}</strong>
          <span class="muted">· {{ conn.dialect }} · {{ conn.host }}:{{ conn.port }}</span>
        </div>
        <div class="spacer" />
        <button class="primary" :disabled="runningAll || !checks.length" @click="runAll">
          {{ runningAll ? '检查中…' : '开始检查' }}
        </button>
        <button :disabled="results.size === 0" @click="exportReport">导出 Markdown</button>
      </div>

      <!-- 中部：按 category 分组 -->
      <div class="groups">
        <div v-for="g in groups" :key="g.name" class="grp">
          <div class="ghead" @click="toggleCat(g.name)">
            <span class="caret">{{ collapsed.has(g.name) ? '▶' : '▼' }}</span>
            <span class="gname">{{ g.name }}</span>
            <span class="gcount">
              {{ g.items.length }} 项
              <span v-if="g.pass" class="tag pass">✅ {{ g.pass }}</span>
              <span v-if="g.warn" class="tag warn">⚠️ {{ g.warn }}</span>
              <span v-if="g.fail" class="tag fail">❌ {{ g.fail }}</span>
              <span v-if="g.unknown" class="tag unknown">— {{ g.unknown }}</span>
              <span v-if="g.pending" class="tag pending">· {{ g.pending }} 待运行</span>
            </span>
          </div>
          <div v-if="!collapsed.has(g.name)" class="gitems">
            <div
              v-for="c in g.items"
              :key="c.id"
              class="row"
              :class="sevClass(results.get(c.id)?.severity)"
            >
              <div class="row-main">
                <span class="sev">{{ sevLabel(results.get(c.id)?.severity) }}</span>
                <span class="title">{{ c.title }}</span>
                <button
                  class="run-one"
                  :disabled="running.has(c.id)"
                  :title="c.description"
                  @click="runOne(c)"
                >
                  {{ running.has(c.id) ? '…' : '单独运行' }}
                </button>
              </div>
              <div class="desc">{{ c.description }}</div>
              <div v-if="results.get(c.id)?.message" class="msg">
                {{ results.get(c.id)?.message }}
              </div>
              <div v-if="results.get(c.id)?.evidence" class="evi">
                <code>{{ results.get(c.id)?.evidence }}</code>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部：状态条 -->
      <div class="foot muted">
        共 {{ checks.length }} 项；已运行 {{ results.size }} 项
        {{ runningAll ? '· 正在并发执行…' : '' }}
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.cmp {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 820px;
  max-width: 92vw;
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.bar .spacer {
  flex: 1;
}
.conn .lbl {
  font-size: 12px;
  color: var(--muted);
  margin-right: 6px;
}
.conn .muted {
  margin-left: 6px;
  color: var(--muted);
  font-size: 12px;
}
.bar button {
  padding: 6px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
}
.bar button.primary {
  background: rgba(124, 108, 255, 0.28);
  border-color: rgba(124, 108, 255, 0.5);
}
.bar button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.groups {
  max-height: 60vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.grp {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.ghead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  user-select: none;
}
.ghead .gname {
  font-weight: 600;
}
.ghead .gcount {
  color: var(--muted);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.tag {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}
.tag.pass {
  background: rgba(60, 180, 100, 0.18);
  color: #5ec679;
}
.tag.warn {
  background: rgba(240, 180, 40, 0.18);
  color: #e1b13a;
}
.tag.fail {
  background: rgba(224, 64, 80, 0.18);
  color: #e04050;
}
.tag.unknown,
.tag.pending {
  background: rgba(160, 160, 160, 0.18);
  color: var(--muted);
}
.gitems {
  display: flex;
  flex-direction: column;
}
.row {
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row-main {
  display: flex;
  align-items: center;
  gap: 10px;
}
.row .sev {
  font-size: 12px;
  min-width: 78px;
}
.row.sev-pass .sev {
  color: #5ec679;
}
.row.sev-warn .sev {
  color: #e1b13a;
}
.row.sev-fail .sev {
  color: #e04050;
}
.row.sev-unknown .sev,
.row.sev-pending .sev {
  color: var(--muted);
}
.row .title {
  font-weight: 500;
}
.row .desc {
  font-size: 12px;
  color: var(--muted);
  padding-left: 88px;
}
.row .msg {
  font-size: 12px;
  padding-left: 88px;
}
.row .evi {
  padding-left: 88px;
}
.row .evi code {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  background: var(--bg);
  padding: 1px 4px;
  border-radius: 4px;
}
.run-one {
  margin-left: auto;
  padding: 2px 8px;
  font-size: 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
}
.run-one:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.foot {
  font-size: 12px;
  border-top: 1px solid var(--border);
  padding-top: 6px;
}
.muted {
  color: var(--muted);
}
</style>
