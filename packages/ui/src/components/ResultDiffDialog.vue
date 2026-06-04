<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 查询结果对比(result diff)
 *
 * 跑两段 SQL(可同库可跨库)→ 按 key 列对齐 → 列出 新增 / 删除 / 变更 行。
 * 验证查询改写前后、prod/dev、迁移前后一致性。diff 在 ../resultDiff/diff(已单测)。
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { reportError } from '../errorReporter'
import { locale } from '../i18n'
import { type ResultDiff, type ResultSet, diffResults, isIdentical } from '../resultDiff/diff'
import Modal from './Modal.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()
const L = (zh: string, en: string): string => (locale.value === 'en' ? en : zh)

const conns = ref<ConnectionConfig[]>([])
const leftConn = ref('')
const rightConn = ref('')
const leftSql = ref('')
const rightSql = ref('')
const keyColsText = ref('')
const running = ref(false)
const diff = ref<ResultDiff | null>(null)
const errMsg = ref('')

async function run(connId: string, sql: string): Promise<ResultSet> {
  const r = await client.connections.execute(connId, sql, [], { maxRows: 100000 })
  return { columns: r.columns?.map((c) => c.name) ?? [], rows: r.rows ?? [] }
}

async function compare(): Promise<void> {
  if (!leftConn.value || !rightConn.value || !leftSql.value.trim() || !rightSql.value.trim()) {
    errMsg.value = L('两侧的连接和 SQL 都要填', 'Fill both connections and SQL')
    return
  }
  running.value = true
  errMsg.value = ''
  diff.value = null
  try {
    const [a, b] = await Promise.all([
      run(leftConn.value, leftSql.value),
      run(rightConn.value, rightSql.value),
    ])
    const keyCols = keyColsText.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    diff.value = diffResults(a, b, keyCols)
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e)
    reportError(e, { tag: 'resultDiff.run' })
  } finally {
    running.value = false
  }
}

const cell = (v: unknown): string => (v == null ? '∅' : String(v))
onMounted(async () => {
  try {
    conns.value = await client.connections.list()
    if (conns.value[0]) {
      leftConn.value = conns.value[0].id
      rightConn.value = conns.value[0].id
    }
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <Modal v-if="open" :title="L('查询结果对比', 'Query result diff')" width="xl" @close="emit('close')">
    <div class="rd">
      <div class="cols2">
        <div class="side">
          <select v-model="leftConn">
            <option value="">{{ L('左:连接', 'Left: connection') }}</option>
            <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} ({{ c.dialect }})</option>
          </select>
          <textarea v-model="leftSql" rows="4" class="ta" placeholder="SELECT … (A)"></textarea>
        </div>
        <div class="side">
          <select v-model="rightConn">
            <option value="">{{ L('右:连接', 'Right: connection') }}</option>
            <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} ({{ c.dialect }})</option>
          </select>
          <textarea v-model="rightSql" rows="4" class="ta" placeholder="SELECT … (B)"></textarea>
        </div>
      </div>
      <div class="bar">
        <label class="kc">{{ L('对齐键列', 'key columns') }}
          <input v-model="keyColsText" :placeholder="L('如 id,code(空=整行比对)', 'e.g. id,code (empty = whole-row)')" style="width: 220px" />
        </label>
        <button class="primary" :disabled="running" @click="compare">{{ running ? '…' : L('对比', 'Compare') }}</button>
        <span v-if="errMsg" class="err">❌ {{ errMsg }}</span>
      </div>

      <template v-if="diff">
        <div :class="['summary', isIdentical(diff) ? 'ok' : 'diff']">
          <template v-if="isIdentical(diff)">✅ {{ L('两侧结果完全一致', 'Identical') }} · {{ diff.same }} {{ L('行', 'rows') }}</template>
          <template v-else>
            <span>{{ L('一致', 'same') }} <b>{{ diff.same }}</b></span>
            <span class="add">+{{ diff.added.length }} {{ L('新增', 'added') }}</span>
            <span class="rem">-{{ diff.removed.length }} {{ L('删除', 'removed') }}</span>
            <span class="chg">~{{ diff.changed.length }} {{ L('变更', 'changed') }}</span>
          </template>
          <span v-if="diff.colsOnlyInA.length || diff.colsOnlyInB.length" class="note">
            {{ L('列差异', 'col diff') }}: A {{ diff.colsOnlyInA.join(',') || '—' }} / B {{ diff.colsOnlyInB.join(',') || '—' }}
          </span>
        </div>

        <div v-if="diff.changed.length" class="sec">
          <h4 class="chg">~ {{ L('变更行', 'Changed') }} ({{ diff.changed.length }})</h4>
          <div class="scroll"><table class="tbl">
            <thead><tr><th>{{ L('键', 'key') }}</th><th>{{ L('列', 'col') }}</th><th>A</th><th>B</th></tr></thead>
            <tbody>
              <template v-for="(r, i) in diff.changed.slice(0, 200)" :key="i">
                <tr v-for="col in r.changedCols" :key="col">
                  <td>{{ r.key }}</td><td>{{ col }}</td><td class="rem">{{ cell(r.a?.[col]) }}</td><td class="add">{{ cell(r.b?.[col]) }}</td>
                </tr>
              </template>
            </tbody>
          </table></div>
        </div>

        <div v-if="diff.removed.length" class="sec">
          <h4 class="rem">- {{ L('仅左有(删除)', 'Only in A (removed)') }} ({{ diff.removed.length }})</h4>
          <div class="scroll"><table class="tbl">
            <thead><tr><th v-for="c in diff.compareCols" :key="c">{{ c }}</th></tr></thead>
            <tbody><tr v-for="(r, i) in diff.removed.slice(0, 200)" :key="i"><td v-for="c in diff.compareCols" :key="c">{{ cell(r.a?.[c]) }}</td></tr></tbody>
          </table></div>
        </div>

        <div v-if="diff.added.length" class="sec">
          <h4 class="add">+ {{ L('仅右有(新增)', 'Only in B (added)') }} ({{ diff.added.length }})</h4>
          <div class="scroll"><table class="tbl">
            <thead><tr><th v-for="c in diff.compareCols" :key="c">{{ c }}</th></tr></thead>
            <tbody><tr v-for="(r, i) in diff.added.slice(0, 200)" :key="i"><td v-for="c in diff.compareCols" :key="c">{{ cell(r.b?.[c]) }}</td></tr></tbody>
          </table></div>
        </div>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.rd { display: flex; flex-direction: column; gap: 10px; min-width: 820px; }
.cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.side { display: flex; flex-direction: column; gap: 4px; }
.ta { width: 100%; font-family: monospace; font-size: 12px; }
.bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.kc { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.err { font-size: 12px; color: #c0392b; }
.summary { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.summary.ok { background: #e8f6ec; color: #1e7e34; }
.summary.diff { background: #fff8e6; }
.add { color: #1e7e34; } .rem { color: #c0392b; } .chg { color: #c87f0a; }
.note { color: var(--fg-muted, #888); font-size: 12px; margin-left: auto; }
.sec h4 { margin: 8px 0 4px; font-size: 13px; }
.scroll { max-height: 220px; overflow: auto; }
.tbl { border-collapse: collapse; font-size: 12px; }
.tbl th, .tbl td { border: 1px solid var(--border, #e8e8e8); padding: 3px 8px; text-align: left; white-space: nowrap; }
.primary { background: var(--accent, #2d7ff9); color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
.primary:disabled { opacity: .5; }
</style>
