<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Workspace 导出/导入: 把整套配置(连接 + Snippets + 设置)打包到 .skylerxws 文件。
 *
 * 适用场景:
 *  - 换电脑迁移
 *  - 团队同事共享连接(密码可选不带)
 *  - 备份本地配置(避免 SQLite 库挂)
 *
 * 密码:
 *  - 导出时可选"包含密码"(默认不带,因为团队共享场景往往不想泄露)
 *  - 包含时 SQLite 里的 password_enc 已经是 safeStorage 加密的,但导到别人电脑 safeStorage 解不开
 *    → 改为提示用户填一个 passphrase,导出时 base64(原文+盐),导入时再问 passphrase 解
 *  - 简版:本次只支持"不带密码导出"(让用户在新机重填)
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, toast } from '../dialog'
import { reportError } from '../errorReporter'
import { snippets } from '../snippets'
import Modal from './Modal.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  /** 导入完成 → 通知外层刷新连接树 */
  imported: []
}>()

const client = useDataClient()

type Mode = 'export' | 'import'
const mode = ref<Mode>('export')

// 导出选项
const includeConns = ref(true)
const includeSnippets = ref(true)
const includePasswords = ref(false) // 密码默认不带
const exporting = ref(false)
const importing = ref(false)

// 导入选项
const conflictMode = ref<'skip' | 'overwrite' | 'rename'>('skip')

const allConns = ref<ConnectionConfig[]>([])

interface WorkspaceFile {
  version: 1
  exportedAt: number
  source: string // 哪台机器/版本导出的
  connections?: ConnectionConfig[]
  snippets?: typeof snippets
}

async function loadConns(): Promise<void> {
  allConns.value = await client.connections.list()
}

async function doExport(): Promise<void> {
  exporting.value = true
  try {
    const ws: WorkspaceFile = {
      version: 1,
      exportedAt: Date.now(),
      source: 'SkylerX',
    }
    if (includeConns.value) {
      // list() 是脱敏的;要带密码需要 .get(id) 一条条拉
      if (includePasswords.value) {
        const full: ConnectionConfig[] = []
        for (const c of allConns.value) {
          full.push(await client.connections.get(c.id))
        }
        ws.connections = full
      } else {
        ws.connections = allConns.value
      }
    }
    if (includeSnippets.value) ws.snippets = JSON.parse(JSON.stringify(snippets))
    // 走自定义 SaveFileDialog
    const path = await client.files.saveText({
      defaultName: `skylerx-workspace-${new Date().toISOString().slice(0, 10)}.skylerxws`,
      content: JSON.stringify(ws, null, 2),
      filters: [{ name: 'SkylerX Workspace', extensions: ['skylerxws', 'json'] }],
    })
    if (path) {
      toast.success(`已导出 → ${path}`)
      emit('close')
    }
  } catch (e) {
    reportError(e, { tag: 'workspace-export' })
  } finally {
    exporting.value = false
  }
}

async function doImport(): Promise<void> {
  const api = (
    window as unknown as {
      api?: {
        files?: {
          openText?: (filters: unknown) => Promise<{ name: string; content: string } | null>
        }
      }
    }
  )?.api
  const openText = api?.files?.openText
  if (!openText) {
    reportError(new Error('文件 API 不可用'))
    return
  }
  const file = await openText([{ name: 'SkylerX Workspace', extensions: ['skylerxws', 'json'] }])
  if (!file) return
  let ws: WorkspaceFile
  try {
    ws = JSON.parse(file.content) as WorkspaceFile
    if (ws.version !== 1) throw new Error(`不支持的版本: ${ws.version}`)
  } catch (e) {
    reportError(e, { tag: 'workspace-import-parse' })
    return
  }
  const stat = `连接 ${ws.connections?.length ?? 0} · Snippets ${ws.snippets?.length ?? 0}`
  if (
    !(await appConfirm({
      message: `导入: ${stat}?\n冲突策略: ${conflictMode.value}`,
      variant: 'warn',
    }))
  )
    return
  importing.value = true
  try {
    let okC = 0
    let okS = 0
    if (ws.connections) {
      const existing = await client.connections.list()
      const existingByName = new Map(existing.map((c) => [c.name, c]))
      for (const c of ws.connections) {
        const dup = existingByName.get(c.name)
        if (dup) {
          if (conflictMode.value === 'skip') continue
          if (conflictMode.value === 'overwrite') {
            // 覆盖 = 更新已有(用同 id 或者 dup.id)
            await client.connections.update({ ...c, id: dup.id })
            okC++
            continue
          }
          if (conflictMode.value === 'rename') {
            // 改名导入
            await client.connections.create({ ...c, id: '', name: `${c.name} (导入)` })
            okC++
            continue
          }
        }
        await client.connections.create({ ...c, id: '' })
        okC++
      }
    }
    if (ws.snippets?.length) {
      // 简化:snippets 用 localStorage,直接 push
      const existingIds = new Set(snippets.map((s) => s.id))
      for (const s of ws.snippets) {
        if (existingIds.has(s.id)) {
          if (conflictMode.value === 'skip') continue
          // overwrite/rename → 替换或加新
        }
        snippets.unshift({ ...s, id: `${s.id}-imp-${Date.now()}` })
        okS++
      }
    }
    toast.success(`已导入 连接 ${okC} · Snippets ${okS}`)
    emit('imported')
    emit('close')
  } catch (e) {
    reportError(e, { tag: 'workspace-import' })
  } finally {
    importing.value = false
  }
}

const summary = computed(() => {
  return `连接 ${allConns.value.length} · Snippets ${snippets.length}`
})

watch(
  () => props.open,
  async (op) => {
    if (op) {
      await loadConns()
      mode.value = 'export'
    }
  },
)
</script>

<template>
  <Modal v-if="open" title="Workspace 导出 / 导入" width="medium" @close="emit('close')">
    <div class="form">
      <div class="seg">
        <button :class="{ on: mode === 'export' }" @click="mode = 'export'">📤 导出</button>
        <button :class="{ on: mode === 'import' }" @click="mode = 'import'">📥 导入</button>
      </div>

      <template v-if="mode === 'export'">
        <div class="meta">当前 workspace: <b>{{ summary }}</b></div>
        <label class="lbl-inline">
          <input v-model="includeConns" type="checkbox" />
          包含连接配置 ({{ allConns.length }} 条)
        </label>
        <label v-if="includeConns" class="lbl-inline indent" :title="'勾选会导出明文密码;不勾选导出后需要在新机重新填写连接密码'">
          <input v-model="includePasswords" type="checkbox" />
          <span :class="{ warn: includePasswords }">{{ includePasswords ? '⚠ 包含密码(慎用!)' : '不带密码(推荐)' }}</span>
        </label>
        <label class="lbl-inline">
          <input v-model="includeSnippets" type="checkbox" />
          包含 SQL Snippets ({{ snippets.length }} 条)
        </label>
        <div class="meta">
          导出文件 .skylerxws 是 JSON 格式;换电脑 / 给同事时直接发文件,对方用"导入"加载。
        </div>
      </template>

      <template v-else>
        <div class="meta">从 .skylerxws 文件导入。同名连接的冲突处理:</div>
        <div class="seg seg-inline">
          <button :class="{ on: conflictMode === 'skip' }" @click="conflictMode = 'skip'">跳过</button>
          <button :class="{ on: conflictMode === 'overwrite' }" @click="conflictMode = 'overwrite'">覆盖</button>
          <button :class="{ on: conflictMode === 'rename' }" @click="conflictMode = 'rename'">改名导入</button>
        </div>
        <div class="meta">"覆盖" 会替换同名连接的所有字段(包括密码,如果文件里有)。</div>
      </template>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('close')">取消</button>
      <button
        v-if="mode === 'export'"
        class="btn-primary"
        :disabled="exporting"
        @click="doExport"
      >
        {{ exporting ? '导出中…' : '▶ 选位置导出' }}
      </button>
      <button v-else class="btn-primary" :disabled="importing" @click="doImport">
        {{ importing ? '导入中…' : '▶ 选文件导入' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 10px; }
.seg { display: flex; gap: 4px; }
.seg button { padding: 6px 14px; font-size: 12px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; background: var(--bg); color: var(--muted); }
.seg button.on { background: rgba(124, 108, 255, 0.18); color: var(--accent); border-color: var(--accent); }
.seg-inline { padding-left: 16px; }
.lbl-inline { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text); cursor: pointer; }
.lbl-inline.indent { padding-left: 24px; }
.lbl-inline .warn { color: #e04050; font-weight: 600; }
.meta { font-size: 11px; color: var(--muted); line-height: 1.6; }
.btn-primary, .btn-ghost { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 13px; }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-ghost { background: transparent; color: var(--muted); }
</style>
