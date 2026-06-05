<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 备份 / 还原（#14）——MVP 走纯 SQL 路线（不依赖外部 mysqldump / pg_dump）。
 *
 *   - 备份：拉所有表的 CREATE + INSERT，连成一个 .sql 文件保存到本地
 *           （Schema diff 已有 doSchemaExport 同款逻辑；这里复用 / 给一个集中入口）
 *   - 还原：用户选一个 .sql 文件 → 切分语句 → 按顺序 execute；带进度条 + 错误列表
 *
 * 为什么不用 mysqldump？跨平台路径检测麻烦、用户机器上不一定有；先纯 SQL 兜底。
 * 真要用 mysqldump 的高级特性（trigger / view 完整 DDL / FK 自动顺序），
 * 后续在主进程加 IPC 调用 child_process.spawn 即可，这里 UI 不动。
 */
import { type ConnectionConfig, MetaNodeKind } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { quoteId } from '../ddl'
import { confirm as appConfirm, toast } from '../dialog'
import { reportError } from '../errorReporter'
import { t } from '../i18n'
import { splitStatements } from '../sqlSplit'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: [] }>()
const client = useDataClient()

// 自带连接选择：打开后先选连接（不再为每条连接在 ⌘K 里塞一条）
const conns = ref<ConnectionConfig[]>([])
const connId = ref('')
const conn = computed(() => conns.value.find((c) => c.id === connId.value))

type Mode = 'backup' | 'restore'
const mode = ref<Mode>('backup')
/**
 * 备份 / 还原格式（参考 dbgate Archives 概念）：
 *  - 'sql'    传统 .sql 路径（CREATE + INSERT），跟以前一样
 *  - 'ndjson' 每行一个 JSON 对象，格式 {"__table":"...","data":{...}}\n
 *             轻量、可跨连接 import/export、数据工程师友好
 */
type Format = 'sql' | 'ndjson'
const format = ref<Format>('sql')
const ndjsonProgress = ref<{ phase: string; done: number; total: number }>({
  phase: '',
  done: 0,
  total: 0,
})

// ── 还原态 ──
const restoring = ref(false)
const restoreProgress = ref({ done: 0, total: 0, errors: [] as string[] })
const stopRequested = ref(false)

async function pickFileAndRestore(): Promise<void> {
  const c = conn.value
  if (!c) return
  if (!client.files) {
    reportError(new Error('files API not available'))
    return
  }
  const file = await client.files.openText([{ name: 'SQL', extensions: ['sql', 'txt'] }])
  if (!file) return
  const stmts = splitStatements(file.content)
  if (!stmts.length) {
    toast.warn(t('backup.noStmts'))
    return
  }
  if (
    !(await appConfirm({
      title: t('backup.restoreTitle'),
      message: t('backup.restoreConfirm', { file: file.name, n: stmts.length }),
      variant: 'warn',
    }))
  )
    return

  restoring.value = true
  stopRequested.value = false
  restoreProgress.value = { done: 0, total: stmts.length, errors: [] }
  try {
    for (let i = 0; i < stmts.length; i++) {
      if (stopRequested.value) break
      try {
        await client.connections.execute(c.id, stmts[i])
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        restoreProgress.value.errors.push(`#${i + 1}: ${msg.slice(0, 200)}`)
      }
      restoreProgress.value.done = i + 1
    }
    if (stopRequested.value) toast.warn(t('backup.restoreStopped'))
    else if (restoreProgress.value.errors.length) {
      toast.warn(t('backup.restoreWithErrors', { n: restoreProgress.value.errors.length }))
    } else toast.success(t('backup.restoreOk'))
  } finally {
    restoring.value = false
  }
}

// ── 备份态 ──
const backingUp = ref(false)
async function doBackup(): Promise<void> {
  if (!client.files) {
    reportError(new Error('files API not available'))
    return
  }
  if (format.value === 'ndjson') {
    await doBackupNdjson()
    return
  }
  backingUp.value = true
  try {
    // SQL 路径：现状是引导用户走 NavTree 右键「导出 SQL」（doSchemaExport）
    toast.info(t('backup.hintUseSchemaExport'))
    emit('close')
  } finally {
    backingUp.value = false
  }
}

/**
 * NDJSON 备份（dbgate Archives 风格）：
 *   1. 取 conn.database 下所有 base table 列表
 *   2. 每张表 SELECT * → 每行写一条 {"__table":"t","data":{...}}\n
 *   3. 全部连成一个 .ndjson 文件，files.saveText 弹保存对话框
 *
 * 简化前提：单库导出；多库 / 跨 schema 用户可分多次跑。BLOB 字段被 JSON.stringify
 * 当 base64-like 处理可能失真（Buffer → {type:'Buffer', data:[]}），这是 v1 已知限制。
 */
async function doBackupNdjson(): Promise<void> {
  const c = conn.value
  if (!c) return
  if (!client.files) return
  backingUp.value = true
  ndjsonProgress.value = { phase: t('backup.ndjsonPhaseList'), done: 0, total: 0 }
  try {
    // 1. 取表列表
    const dbPath = c.database ? [c.database] : []
    const tables = await client.connections.metadata(c.id, {
      parentKind: MetaNodeKind.Group,
      path: dbPath,
      group: 'tables',
    })
    if (!tables.length) {
      toast.warn(t('backup.noTables'))
      return
    }
    ndjsonProgress.value.total = tables.length

    // 2. 逐表 SELECT *，拼 NDJSON
    const lines: string[] = []
    for (let i = 0; i < tables.length; i++) {
      if (stopRequested.value) break
      const tab = tables[i]
      ndjsonProgress.value.phase = t('backup.ndjsonPhaseDump', { name: tab.name })
      try {
        const sqlName = tab.sqlName ?? quoteId(c.dialect, tab.name)
        const r = await client.connections.execute(c.id, `SELECT * FROM ${sqlName}`)
        for (const row of r.rows) {
          lines.push(JSON.stringify({ __table: tab.name, data: row }))
        }
      } catch (e) {
        // 单表失败不中断整批，记一条 __error 让还原方看到
        const msg = e instanceof Error ? e.message : String(e)
        lines.push(JSON.stringify({ __table: tab.name, __error: msg.slice(0, 200) }))
      }
      ndjsonProgress.value.done = i + 1
    }
    if (stopRequested.value) {
      toast.warn(t('backup.restoreStopped'))
      return
    }

    // 3. 保存
    ndjsonProgress.value.phase = t('backup.ndjsonPhaseSave')
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    const path = await client.files.saveText({
      defaultName: `skylerx-${c.name || c.dialect}-${stamp}.ndjson`,
      content: lines.join('\n'),
      filters: [{ name: 'NDJSON', extensions: ['ndjson', 'jsonl'] }],
    })
    if (path) {
      toast.success(
        t('backup.ndjsonSaved', {
          n: lines.length,
          t: tables.length,
          path: path.split('/').pop() ?? path,
        }),
      )
    }
  } finally {
    backingUp.value = false
    stopRequested.value = false
  }
}

/**
 * NDJSON 还原：读用户选的 .ndjson → 按 __table 分桶 → 每桶 INSERT 多行。
 * 简化：跳过 __error 行；用 splitStatements 也兼容 SQL 混合写法（虽然这里不该有）。
 */
async function pickFileAndRestoreNdjson(): Promise<void> {
  const c = conn.value
  if (!c) return
  if (!client.files) return
  const file = await client.files.openText([{ name: 'NDJSON', extensions: ['ndjson', 'jsonl'] }])
  if (!file) return
  const lines = file.content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) {
    toast.warn(t('backup.noStmts'))
    return
  }
  // 按 __table 分桶
  const buckets = new Map<string, Record<string, unknown>[]>()
  let skipped = 0
  for (const ln of lines) {
    try {
      const obj = JSON.parse(ln) as {
        __table?: string
        data?: Record<string, unknown>
        __error?: string
      }
      if (obj.__error || !obj.__table || !obj.data) {
        skipped++
        continue
      }
      if (!buckets.has(obj.__table)) buckets.set(obj.__table, [])
      buckets.get(obj.__table)!.push(obj.data)
    } catch {
      skipped++
    }
  }
  if (!buckets.size) {
    toast.warn(t('backup.ndjsonNoRows'))
    return
  }
  if (
    !(await appConfirm({
      title: t('backup.restoreTitle'),
      message: t('backup.ndjsonRestoreConfirm', {
        file: file.name,
        n: lines.length - skipped,
        t: buckets.size,
      }),
      variant: 'warn',
    }))
  )
    return

  restoring.value = true
  stopRequested.value = false
  restoreProgress.value = { done: 0, total: buckets.size, errors: [] }
  try {
    let i = 0
    for (const [tableName, rows] of buckets) {
      if (stopRequested.value) break
      try {
        // 每张表一次大 INSERT（按 chunk 切，避免单条过长）
        const cols = Object.keys(rows[0] ?? {})
        if (!cols.length) continue
        const colList = cols.map((col) => quoteId(c.dialect, col)).join(', ')
        const tableRef = quoteId(c.dialect, tableName)
        const chunkSize = 100
        for (let start = 0; start < rows.length; start += chunkSize) {
          const slice = rows.slice(start, start + chunkSize)
          const valuesSql = slice
            .map(
              (row) =>
                `(${cols
                  .map((col) => {
                    const v = row[col]
                    if (v == null) return 'NULL'
                    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
                    if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`
                    return `'${String(v).replace(/'/g, "''")}'`
                  })
                  .join(', ')})`,
            )
            .join(',\n  ')
          await client.connections.execute(
            c.id,
            `INSERT INTO ${tableRef} (${colList}) VALUES\n  ${valuesSql}`,
          )
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        restoreProgress.value.errors.push(`${tableName}: ${msg.slice(0, 200)}`)
      }
      i++
      restoreProgress.value.done = i
    }
    if (stopRequested.value) toast.warn(t('backup.restoreStopped'))
    else if (restoreProgress.value.errors.length) {
      toast.warn(t('backup.restoreWithErrors', { n: restoreProgress.value.errors.length }))
    } else toast.success(t('backup.restoreOk'))
  } finally {
    restoring.value = false
  }
}

onMounted(async () => {
  conns.value = await client.connections.list()
})
</script>

<template>
  <Modal :title="t('backup.titleBare')" @close="emit('close')">
    <div class="backup">
      <!-- 连接选择（自带，不再从 ⌘K 带连接） -->
      <div class="conn-bar">
        <select v-model="connId" class="conn-sel">
          <option value="" disabled>{{ t('diff.selectConn') }}</option>
          <option v-for="c in conns" :key="c.id" :value="c.id">
            {{ c.name || c.id }} · {{ c.dialect }}
          </option>
        </select>
      </div>
      <div v-if="!conn" class="info">{{ t('backup.pickConn') }}</div>
      <template v-else>
      <div class="mode-tabs">
        <button :class="{ on: mode === 'backup' }" @click="mode = 'backup'">📦 {{ t('backup.tabBackup') }}</button>
        <button :class="{ on: mode === 'restore' }" @click="mode = 'restore'">↺ {{ t('backup.tabRestore') }}</button>
        <!-- 格式切换：SQL 传统 / NDJSON 轻量（dbgate Archives 风格） -->
        <span class="fmt-row">
          <label><input type="radio" v-model="format" value="sql" /> SQL</label>
          <label><input type="radio" v-model="format" value="ndjson" /> NDJSON</label>
        </span>
      </div>

      <!-- 备份 -->
      <template v-if="mode === 'backup'">
        <div v-if="format === 'sql'" class="info">
          <p>{{ t('backup.howBackup1') }}</p>
          <ol>
            <li>{{ t('backup.howBackup2') }}</li>
            <li>{{ t('backup.howBackup3') }}</li>
          </ol>
          <p class="muted">{{ t('backup.noMysqldumpNote') }}</p>
        </div>
        <div v-else class="info">
          <p>{{ t('backup.howBackupNdjson1') }}</p>
          <ol>
            <li>{{ t('backup.howBackupNdjson2') }}</li>
            <li>{{ t('backup.howBackupNdjson3') }}</li>
            <li>{{ t('backup.howBackupNdjson4') }}</li>
          </ol>
          <p class="muted">{{ t('backup.ndjsonNote') }}</p>
        </div>
        <div v-if="backingUp && format === 'ndjson'" class="progress">
          <div class="bar">
            <div
              :style="{
                width: `${ndjsonProgress.total ? (ndjsonProgress.done / ndjsonProgress.total) * 100 : 0}%`,
              }"
            />
          </div>
          <div class="prog-text">
            {{ ndjsonProgress.done }} / {{ ndjsonProgress.total }} · {{ ndjsonProgress.phase }}
          </div>
          <button class="ghost sm" @click="stopRequested = true">⏹ {{ t('backup.stop') }}</button>
        </div>
        <div class="actions">
          <button class="primary" :disabled="backingUp" @click="doBackup">
            {{ format === 'ndjson' ? t('backup.ndjsonDoBackup') : t('backup.openExportHint') }}
          </button>
        </div>
      </template>

      <!-- 还原 -->
      <template v-else>
        <div class="info">
          <p v-if="format === 'sql'">{{ t('backup.howRestore') }}</p>
          <p v-else>{{ t('backup.howRestoreNdjson') }}</p>
          <p class="muted">{{ t('backup.restoreWarn') }}</p>
        </div>
        <div v-if="restoring" class="progress">
          <div class="bar"><div :style="{ width: `${(restoreProgress.done / restoreProgress.total) * 100}%` }" /></div>
          <div class="prog-text">{{ restoreProgress.done }} / {{ restoreProgress.total }}</div>
          <button class="ghost sm" @click="stopRequested = true">⏹ {{ t('backup.stop') }}</button>
        </div>
        <div v-if="restoreProgress.errors.length" class="err-list">
          <div class="err-head">{{ t('backup.errorsTitle', { n: restoreProgress.errors.length }) }}</div>
          <pre v-for="(e, i) in restoreProgress.errors" :key="i">{{ e }}</pre>
        </div>
        <div class="actions">
          <button
            class="primary"
            :disabled="restoring"
            @click="format === 'ndjson' ? pickFileAndRestoreNdjson() : pickFileAndRestore()"
          >
            📂 {{ t('backup.pickFile') }}
          </button>
        </div>
      </template>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.backup { min-width: 540px; display: flex; flex-direction: column; gap: 12px; }
.conn-bar { padding-bottom: 0; }
.conn-sel {
  width: 100%;
  padding: 6px 10px;
  font-size: 13px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.mode-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.mode-tabs button {
  padding: 5px 14px;
  font-size: 13px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
}
.mode-tabs button.on { color: var(--accent); border-color: var(--accent); }
.fmt-row {
  margin-left: auto;
  display: inline-flex;
  gap: 12px;
  align-items: center;
  font-size: 12px;
  color: var(--muted);
}
.fmt-row label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.info { font-size: 12px; color: var(--text); line-height: 1.6; }
.info ol { margin: 4px 0 8px 20px; padding: 0; }
.info .muted { color: var(--muted); font-size: 11px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
.actions button {
  padding: 5px 14px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.actions .primary { background: var(--accent, #7c6cff); color: #fff; border-color: var(--accent, #7c6cff); }
.actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.progress { display: flex; align-items: center; gap: 8px; }
.progress .bar { flex: 1; height: 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 5px; overflow: hidden; }
.progress .bar > div { height: 100%; background: var(--accent, #7c6cff); transition: width 0.2s; }
.progress .prog-text { font-family: var(--font-mono); font-size: 11px; min-width: 80px; text-align: right; }
.err-list {
  background: rgba(224, 64, 80, 0.06);
  border: 1px solid var(--err, #e04050);
  border-radius: 6px;
  padding: 8px;
  max-height: 200px;
  overflow-y: auto;
}
.err-head { font-size: 12px; color: var(--err, #e04050); font-weight: 600; margin-bottom: 6px; }
.err-list pre {
  margin: 2px 0;
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
}
.ghost.sm { padding: 3px 8px; font-size: 11px; }
</style>
