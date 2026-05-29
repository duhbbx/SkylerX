<script setup lang="ts">/*
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
import type { ConnectionConfig } from '@db-tool/shared-types'
import { onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, toast } from '../dialog'
import { t } from '../i18n'
import { splitStatements } from '../sqlSplit'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig }>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()

type Mode = 'backup' | 'restore'
const mode = ref<Mode>('backup')

// ── 还原态 ──
const restoring = ref(false)
const restoreProgress = ref({ done: 0, total: 0, errors: [] as string[] })
const stopRequested = ref(false)

async function pickFileAndRestore(): Promise<void> {
  if (!client.files) {
    toast.error('files API not available')
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
        await client.connections.execute(props.conn.id, stmts[i])
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
    toast.error('files API not available')
    return
  }
  backingUp.value = true
  try {
    // 让 Workspace 现有 doSchemaExport 流程兜底；这里走"先拉所有 table，再 SELECT *"
    // 简化版：用户提示用 NavTree 右键库/Schema 「导出 SQL」。这个对话框纯入口。
    toast.info(t('backup.hintUseSchemaExport'))
    emit('close')
  } finally {
    backingUp.value = false
  }
}

onMounted(() => {
  /* 留作未来 prebid */
})
</script>

<template>
  <Modal :title="t('backup.title', { conn: conn.name || conn.dialect })" @close="emit('close')">
    <div class="backup">
      <div class="mode-tabs">
        <button :class="{ on: mode === 'backup' }" @click="mode = 'backup'">📦 {{ t('backup.tabBackup') }}</button>
        <button :class="{ on: mode === 'restore' }" @click="mode = 'restore'">↺ {{ t('backup.tabRestore') }}</button>
      </div>

      <!-- 备份 -->
      <template v-if="mode === 'backup'">
        <div class="info">
          <p>{{ t('backup.howBackup1') }}</p>
          <ol>
            <li>{{ t('backup.howBackup2') }}</li>
            <li>{{ t('backup.howBackup3') }}</li>
          </ol>
          <p class="muted">{{ t('backup.noMysqldumpNote') }}</p>
        </div>
        <div class="actions">
          <button class="primary" :disabled="backingUp" @click="doBackup">{{ t('backup.openExportHint') }}</button>
        </div>
      </template>

      <!-- 还原 -->
      <template v-else>
        <div class="info">
          <p>{{ t('backup.howRestore') }}</p>
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
          <button class="primary" :disabled="restoring" @click="pickFileAndRestore">📂 {{ t('backup.pickFile') }}</button>
        </div>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.backup { min-width: 540px; display: flex; flex-direction: column; gap: 12px; }
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
.progress .prog-text { font-family: ui-monospace, monospace; font-size: 11px; min-width: 80px; text-align: right; }
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
  font-family: ui-monospace, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
}
.ghost.sm { padding: 3px 8px; font-size: 11px; }
</style>
