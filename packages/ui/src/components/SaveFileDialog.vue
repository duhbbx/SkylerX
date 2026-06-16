<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 自定义 SaveFileDialog —— 跨平台一致的保存文件对话框,替代 OS 原生 showSaveDialog。
 *
 * 设计目标:
 *  - macOS / Windows / Linux 表现一致(同一套 Vue 组件,不调系统对话框)
 *  - 完整文件浏览能力(面包屑 / 上一级 / 隐藏文件)
 *  - 侧栏:Home/Desktop/Documents/Downloads + 收藏夹 + 最近保存(localStorage)
 *  - 文件名 + 扩展名下拉 + 自动追加扩展名
 *  - 重名警告 + 写入后弹卡片"打开文件 / 显示在文件夹"
 *  - 工具:新建文件夹 / 列表排序 / 当前目录搜索
 *  - 键盘: ↑↓ 选中, Enter 确认, Esc 取消, ⌘+L 聚焦地址栏
 */
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, prompt as appPrompt, toast } from '../dialog'
import { reportError, reportInlineError } from '../errorReporter'
import Modal from './Modal.vue'

type Filter = { name: string; extensions: string[] }
type Mode = 'save' | 'pick-existing' | 'pick-or-create' | 'pick-directory'

const props = defineProps<{
  open: boolean
  defaultName: string
  /** 一组 filter,UI 出下拉选;active filter 决定追加哪个扩展名 */
  filters?: Filter[]
  /** 默认开始目录;不传用 localStorage 上次目录,再不传用 Documents */
  defaultDir?: string
  /** 模式:save 写文件 / pick-existing 选已有 / pick-or-create 选或新建 */
  mode?: Mode
}>()

const mode = computed<Mode>(() => props.mode ?? 'save')
const isPickExisting = computed(() => mode.value === 'pick-existing')
const isPickDirectory = computed(() => mode.value === 'pick-directory')
const isPickAny = computed(() => mode.value === 'pick-existing' || mode.value === 'pick-or-create')
const titleText = computed(() => {
  if (mode.value === 'pick-existing') return '选择文件'
  if (mode.value === 'pick-or-create') return '选择或新建文件'
  if (mode.value === 'pick-directory') return '选择目录'
  return '保存文件'
})
const confirmText = computed(() => {
  if (mode.value === 'pick-existing') return '▶ 选定'
  if (mode.value === 'pick-or-create') return '▶ 选定路径'
  if (mode.value === 'pick-directory') return '▶ 选定此目录'
  return '▶ 保存'
})

const emit = defineEmits<{
  close: []
  /** 保存确认,父调 client.files.writeText 完成后通过外部 callback 回报结果 */
  save: [path: string]
}>()

interface DirItem {
  name: string
  isDirectory: boolean
  size: number
  mtime: number
  isHidden: boolean
}

const client = useDataClient()

const sep = ref('/')
const homes = ref<{ home: string; desktop: string; documents: string; downloads: string }>({
  home: '',
  desktop: '',
  documents: '',
  downloads: '',
})

const currentDir = ref<string>('')
const items = ref<DirItem[]>([])
const loadingDir = ref(false)
const loadError = ref<string | null>(null)
const fileName = ref('')
const filterIdx = ref(0)
const search = ref('')
const showHidden = ref(false)
type SortBy = 'name' | 'size' | 'mtime'
const sortBy = ref<SortBy>('name')
const sortDesc = ref(false)
const selectedIdx = ref(-1)
const submitting = ref(false)
const recentDirs = ref<string[]>([])
const favorites = ref<string[]>([])

const LS_RECENT = 'skylerx.saveDialog.recent'
const LS_FAV = 'skylerx.saveDialog.favorites'

const fileNameInputRef = useTemplateRef<HTMLInputElement>('fileNameInputEl')

const activeFilter = computed<Filter | null>(() => {
  if (!props.filters?.length) return null
  return props.filters[filterIdx.value] ?? null
})

/** 根据 activeFilter 给文件名自动追加扩展名(用户已带扩展名则不变)。 */
const fileNameFinal = computed(() => {
  const n = fileName.value.trim()
  if (!n) return ''
  const af = activeFilter.value
  if (!af || !af.extensions.length) return n
  const ext = af.extensions[0]
  if (ext === '*') return n
  // 用户已经带了任意 extension 就保持
  if (/\.[a-zA-Z0-9]+$/.test(n)) return n
  return `${n}.${ext}`
})

const targetPath = computed(() => {
  if (!currentDir.value || !fileNameFinal.value) return ''
  return joinPath(currentDir.value, fileNameFinal.value)
})

/** 当前目录里已经存在同名文件 → 弹覆盖警告 */
const nameConflict = computed(() =>
  items.value.some((it) => !it.isDirectory && it.name === fileNameFinal.value),
)

const displayItems = computed<DirItem[]>(() => {
  let arr = items.value
  if (!showHidden.value) arr = arr.filter((it) => !it.isHidden)
  const q = search.value.trim().toLowerCase()
  if (q) arr = arr.filter((it) => it.name.toLowerCase().includes(q))
  // 文件夹永远在前
  arr = [...arr].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    const dir = sortDesc.value ? -1 : 1
    if (sortBy.value === 'name') return a.name.localeCompare(b.name) * dir
    if (sortBy.value === 'size') return (a.size - b.size) * dir
    return (a.mtime - b.mtime) * dir
  })
  return arr
})

const crumb = computed<string[]>(() => {
  if (!currentDir.value) return []
  const parts = currentDir.value.split(sep.value).filter(Boolean)
  // Windows 盘符;Unix 绝对路径
  if (currentDir.value.startsWith('/')) return ['/', ...parts]
  return parts
})

function joinPath(...parts: string[]): string {
  // 简单实现:跨平台分隔符已经统一(主进程已经返回正确的 sep);renderer 端直接拼
  return parts
    .join(sep.value)
    .replace(new RegExp(`${escapeRegex(sep.value)}+`, 'g'), sep.value)
    .replace(/\/$/, '')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parentOf(p: string): string {
  if (!p || p === sep.value) return p
  const i = p.lastIndexOf(sep.value)
  if (i <= 0) return sep.value
  return p.slice(0, i) || sep.value
}

async function loadDir(p: string): Promise<void> {
  loadingDir.value = true
  loadError.value = null
  try {
    const api = (
      client.files as unknown as {
        listDir?: (path: string) => Promise<DirItem[]>
      }
    ).listDir
    if (!api) throw new Error('listDir 不可用(Web 端尚未实现)')
    items.value = await api(p)
    currentDir.value = p
    selectedIdx.value = -1
  } catch (e) {
    reportInlineError(loadError, e)
    items.value = []
  } finally {
    loadingDir.value = false
  }
}

async function goUp(): Promise<void> {
  await loadDir(parentOf(currentDir.value))
}

async function gotoCrumb(i: number): Promise<void> {
  let target = ''
  if (currentDir.value.startsWith('/')) {
    target = i === 0 ? '/' : `/${crumb.value.slice(1, i + 1).join('/')}`
  } else {
    target = crumb.value.slice(0, i + 1).join(sep.value)
  }
  await loadDir(target)
}

async function pickItem(it: DirItem): Promise<void> {
  if (it.isDirectory) {
    await loadDir(joinPath(currentDir.value, it.name))
  } else {
    // 文件 → 把名字填到输入框
    fileName.value = it.name
  }
}

/** pick-existing 模式下双击文件直接选定返回。 */
async function dblClickItem(it: DirItem): Promise<void> {
  if (it.isDirectory) {
    await loadDir(joinPath(currentDir.value, it.name))
  } else if (isPickAny.value) {
    fileName.value = it.name
    await doSave()
  } else {
    // save 模式双击文件:把文件名填到输入框,等用户点保存(避免误操作)
    fileName.value = it.name
  }
}

async function newFolder(): Promise<void> {
  const name = await appPrompt({ message: '新文件夹名:', defaultValue: 'New Folder' })
  if (!name?.trim()) return
  try {
    const fapi = client.files as unknown as { mkdir?: (p: string) => Promise<string> }
    await fapi.mkdir?.(joinPath(currentDir.value, name.trim()))
    await loadDir(currentDir.value)
  } catch (e) {
    reportError(e, { tag: 'save-file-mkdir' })
  }
}

function toggleFavorite(): void {
  const dir = currentDir.value
  if (!dir) return
  const i = favorites.value.indexOf(dir)
  if (i >= 0) favorites.value.splice(i, 1)
  else favorites.value.unshift(dir)
  localStorage.setItem(LS_FAV, JSON.stringify(favorites.value))
}

function isFav(): boolean {
  return favorites.value.includes(currentDir.value)
}

async function doSave(): Promise<void> {
  // 选目录模式:直接返回当前所在目录(不需要文件名)。
  if (isPickDirectory.value) {
    if (!currentDir.value) return
    submitting.value = true
    try {
      emit('save', currentDir.value)
      const next = [
        currentDir.value,
        ...recentDirs.value.filter((d) => d !== currentDir.value),
      ].slice(0, 5)
      recentDirs.value = next
      localStorage.setItem(LS_RECENT, JSON.stringify(next))
    } finally {
      submitting.value = false
    }
    return
  }
  if (!fileNameFinal.value || !currentDir.value) return
  // pick-existing 模式:确认所选确实存在
  if (isPickExisting.value && !nameConflict.value) {
    toast.warn('请选择一个已存在的文件')
    return
  }
  const path = targetPath.value
  // 只有 save 模式才弹覆盖确认;pick 模式选已有/新建文件路径都不写文件
  if (mode.value === 'save' && nameConflict.value) {
    if (!(await appConfirm({ message: `${fileNameFinal.value} 已存在,覆盖?`, variant: 'warn' })))
      return
  }
  submitting.value = true
  try {
    emit('save', path)
    // 记到 recent
    const next = [
      currentDir.value,
      ...recentDirs.value.filter((d) => d !== currentDir.value),
    ].slice(0, 5)
    recentDirs.value = next
    localStorage.setItem(LS_RECENT, JSON.stringify(next))
  } finally {
    submitting.value = false
  }
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  // 固定 24 小时制 YYYY-MM-DD HH:mm:ss,不走 locale 避免 PM/AM 出现
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function onSortClick(by: SortBy): void {
  if (sortBy.value === by) sortDesc.value = !sortDesc.value
  else {
    sortBy.value = by
    sortDesc.value = false
  }
}

/** ↑↓ 选条目,Enter 进入文件夹或保存。 */
function onKeyNav(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIdx.value = Math.min(displayItems.value.length - 1, selectedIdx.value + 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIdx.value = Math.max(0, selectedIdx.value - 1)
  } else if (e.key === 'Enter') {
    if (selectedIdx.value >= 0 && selectedIdx.value < displayItems.value.length) {
      e.preventDefault()
      void pickItem(displayItems.value[selectedIdx.value])
    } else if (fileNameFinal.value) {
      e.preventDefault()
      void doSave()
    }
  }
}

onMounted(async () => {
  const fapi = client.files as unknown as {
    commonDirs?: () => Promise<{
      home: string
      desktop: string
      documents: string
      downloads: string
      sep: string
    }>
  }
  const dirs = await fapi.commonDirs?.()
  if (dirs) {
    homes.value = dirs
    sep.value = dirs.sep
  }
  // 载入收藏/最近
  try {
    favorites.value = JSON.parse(localStorage.getItem(LS_FAV) ?? '[]')
  } catch {
    /* ignore */
  }
  try {
    recentDirs.value = JSON.parse(localStorage.getItem(LS_RECENT) ?? '[]')
  } catch {
    /* ignore */
  }
  // 默认目录
  const initDir =
    props.defaultDir || recentDirs.value[0] || homes.value.documents || homes.value.home
  fileName.value = props.defaultName
  if (initDir) await loadDir(initDir)
})

watch(
  () => props.open,
  async (op) => {
    if (op) {
      fileName.value = props.defaultName
      await nextTick()
      fileNameInputRef.value?.focus()
      fileNameInputRef.value?.select()
    }
  },
)
</script>

<template>
  <!-- topmost: 文件选择对话框等同 OS 原生 file dialog 性质, 必须盖在任何打开它的父弹窗之上
       (包括 ThemedSelect popup / appConfirm 等). 否则用户报告:
       "folder chooser dialog opens behind the original pop-up" -->
  <Modal v-if="open" topmost :title="titleText" width="xl" fixed-height storage-key="save-file-dialog" @close="emit('close')">
    <div class="save-shell">
    <div class="save-dialog" @keydown="onKeyNav">
      <!-- 左侧:常用位置 + 收藏 + 最近 -->
      <div class="sidebar">
        <div class="sb-title">📌 常用位置</div>
        <div class="sb-item" :class="{ on: currentDir === homes.home }" @click="loadDir(homes.home)">🏠 Home</div>
        <div class="sb-item" :class="{ on: currentDir === homes.desktop }" @click="loadDir(homes.desktop)">🖥 Desktop</div>
        <div class="sb-item" :class="{ on: currentDir === homes.documents }" @click="loadDir(homes.documents)">📄 Documents</div>
        <div class="sb-item" :class="{ on: currentDir === homes.downloads }" @click="loadDir(homes.downloads)">⬇ Downloads</div>

        <div v-if="favorites.length" class="sb-title">⭐ 收藏</div>
        <div
          v-for="f in favorites"
          :key="f"
          class="sb-item"
          :class="{ on: currentDir === f }"
          :title="f"
          @click="loadDir(f)"
        >{{ f.split(sep).pop() || f }}</div>

        <div v-if="recentDirs.length" class="sb-title">🕒 最近</div>
        <div
          v-for="r in recentDirs"
          :key="r"
          class="sb-item"
          :class="{ on: currentDir === r }"
          :title="r"
          @click="loadDir(r)"
        >{{ r.split(sep).pop() || r }}</div>
      </div>

      <!-- 右侧:面包屑 + 文件列表 + 输入区 -->
      <div class="main">
        <!-- 工具栏:上一级 + 路径面包屑 + 收藏当前 -->
        <div class="toolbar">
          <button class="tb-btn" title="上一级" :disabled="!currentDir" @click="goUp">↑</button>
          <div class="crumb">
            <span v-for="(c, i) in crumb" :key="i" class="cr-seg">
              <span v-if="i > 0" class="cr-sep">{{ sep }}</span>
              <button class="cr-link" @click="gotoCrumb(i)">{{ c }}</button>
            </span>
          </div>
          <span class="spacer" />
          <button class="tb-btn" :class="{ on: isFav() }" :title="isFav() ? '取消收藏' : '收藏此目录'" @click="toggleFavorite">⭐</button>
          <button class="tb-btn" title="新建文件夹" @click="newFolder">📁+</button>
          <input v-model="search" class="search-ip" placeholder="过滤当前目录…" />
          <label class="hidden-toggle" title="显示以 . 开头的隐藏文件">
            <input v-model="showHidden" type="checkbox" /> .隐
          </label>
        </div>

        <!-- 文件列表 -->
        <div class="list-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th class="name-col">
                  <button class="sort-btn" @click="onSortClick('name')">
                    名称 {{ sortBy === 'name' ? (sortDesc ? '↓' : '↑') : '' }}
                  </button>
                </th>
                <th style="width: 100px">
                  <button class="sort-btn" @click="onSortClick('size')">
                    大小 {{ sortBy === 'size' ? (sortDesc ? '↓' : '↑') : '' }}
                  </button>
                </th>
                <th style="width: 175px; white-space: nowrap;">
                  <button class="sort-btn" @click="onSortClick('mtime')">
                    修改时间 {{ sortBy === 'mtime' ? (sortDesc ? '↓' : '↑') : '' }}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loadingDir"><td colspan="3" class="empty">加载中…</td></tr>
              <tr v-else-if="loadError"><td colspan="3" class="empty err">✗ {{ loadError }}</td></tr>
              <tr v-else-if="!displayItems.length"><td colspan="3" class="empty">空目录</td></tr>
              <tr
                v-for="(it, i) in displayItems"
                :key="it.name"
                :class="{ folder: it.isDirectory, selected: selectedIdx === i }"
                @click="selectedIdx = i; pickItem(it)"
                @dblclick="dblClickItem(it)"
              >
                <td class="name-cell">
                  <span class="ico">{{ it.isDirectory ? '📁' : '📄' }}</span>
                  <span class="name">{{ it.name }}</span>
                </td>
                <td class="size">{{ it.isDirectory ? '' : fmtSize(it.size) }}</td>
                <td class="time">{{ fmtTime(it.mtime) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 底部:文件名 + filter + 保存 -->
        <div class="footer-row">
          <div v-if="!isPickDirectory" class="fn-row">
            <label class="fn-lbl">文件名</label>
            <input ref="fileNameInputEl" v-model="fileName" class="fn-ip" />
          </div>
          <div v-if="filters?.length" class="fn-row">
            <label class="fn-lbl">类型</label>
            <select v-model.number="filterIdx" class="fn-sel">
              <option v-for="(f, i) in filters" :key="i" :value="i">
                {{ f.name }} ({{ f.extensions.map((e) => `.${e}`).join(', ') }})
              </option>
            </select>
          </div>
          <!-- 冲突提示只在 save 模式;pick 模式存在反而是好事(说明用户选到了已有文件) -->
          <div v-if="mode === 'save' && nameConflict" class="conflict">⚠ 文件已存在,保存将覆盖</div>
          <div v-if="isPickExisting && fileNameFinal && !nameConflict" class="conflict">
            ⚠ 该文件不存在;本模式只能选已存在文件
          </div>
          <div class="target-preview">
            {{ mode === 'save' ? '保存到' : '选择' }}:
            <code>{{ isPickDirectory ? currentDir || '—' : targetPath || '—' }}</code>
          </div>
        </div>
      </div>
    </div>

    <!-- 底栏:Modal 没有 footer slot,自带一个,sticky 在 modal-body 底部 -->
    <div class="dialog-actions">
      <button class="btn-ghost" :disabled="submitting" @click="emit('close')">取消</button>
      <button
        class="btn-primary"
        :disabled="
          submitting ||
          !currentDir ||
          (!isPickDirectory && (!fileNameFinal || (isPickExisting && !nameConflict)))
        "
        @click="doSave"
      >
        {{ submitting ? '处理中…' : confirmText }}
      </button>
    </div>
    </div>
  </Modal>
</template>

<style scoped>
/* shell:把 save-dialog(可滚)+ dialog-actions(固定底栏)堆成 flex 列。
   Modal.vue 没有 footer slot,这里自带底栏,保证保存/取消按钮始终可见。 */
.save-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  gap: 10px;
}
.save-dialog {
  display: grid;
  /* minmax(0, 1fr) 防止 grid 子项的 min-width: auto 把列撑超过模板分配
     (grid 子项默认 min-width 是 auto,内容超时会顶开 1fr 列,sidebar 视觉
     上像延伸到了右侧主区) */
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 12px;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  flex: 0 0 auto;
}
.sidebar {
  border-right: 1px solid var(--border);
  padding-right: 8px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  max-width: 200px;
}
.sb-title { font-size: 10px; color: var(--muted); text-transform: uppercase; padding: 6px 4px 2px; font-weight: 600; }
.sb-item {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sb-item:hover { background: rgba(124, 108, 255, 0.10); }
.sb-item.on { background: rgba(124, 108, 255, 0.22); color: var(--accent); }
.main {
  display: flex;
  flex-direction: column;
  min-width: 0; /* 关键:让 1fr 列能正确收缩,不被 grid 内容撑超 */
  gap: 8px;
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
  flex-wrap: nowrap;
  min-width: 0;
}
.toolbar .tb-btn { flex-shrink: 0; }
.toolbar .hidden-toggle { flex-shrink: 0; white-space: nowrap; }
.tb-btn {
  padding: 3px 10px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.tb-btn:hover { background: rgba(124, 108, 255, 0.10); }
.tb-btn.on { background: rgba(124, 108, 255, 0.22); border-color: var(--accent); color: var(--accent); }
.tb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.crumb {
  display: flex;
  gap: 0;
  flex: 1 1 auto;
  min-width: 0; /* 关键:flex 子项默认 min-width: auto,会被内容撑超 */
  overflow-x: auto;
  align-items: center;
  white-space: nowrap;
}
.cr-link {
  background: transparent;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  font-family: var(--font-mono);
}
.cr-link:hover { background: rgba(124, 108, 255, 0.10); border-radius: 3px; }
.cr-sep { color: var(--muted); font-family: var(--font-mono); padding: 0 2px; }
.spacer { flex: 0; }
.search-ip {
  width: 140px;
  flex-shrink: 0;
  padding: 3px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
}
.hidden-toggle { font-size: 11px; color: var(--muted); display: inline-flex; align-items: center; gap: 3px; }
.list-wrap { flex: 1; overflow: auto; border: 1px solid var(--border); border-radius: 4px; min-height: 280px; }
.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
.grid th, .grid td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; }
.grid th { background: var(--panel); color: var(--muted); position: sticky; top: 0; }
.sort-btn { background: transparent; border: none; color: var(--muted); cursor: pointer; font-size: 12px; padding: 0; font-weight: 600; }
.sort-btn:hover { color: var(--text); }
.grid tr { cursor: pointer; }
.grid tr:hover { background: rgba(124, 108, 255, 0.06); }
.grid tr.selected { background: rgba(124, 108, 255, 0.18); }
.grid tr.folder .name { color: var(--accent); font-weight: 500; }
.name-cell { display: flex; align-items: center; gap: 6px; min-width: 0; }
.name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.size, .time {
  font-family: var(--font-mono);
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap; /* 时间用 24 小时制 YYYY-MM-DD HH:mm:ss,固定宽度,不换行 */
}
.empty { text-align: center; color: var(--muted); padding: 20px; font-style: italic; }
.empty.err { color: #e04050; }
.footer-row { display: flex; flex-direction: column; gap: 6px; padding: 8px 4px 0; border-top: 1px solid var(--border); }
.fn-row { display: flex; align-items: center; gap: 8px; }
.fn-lbl { font-size: 11px; color: var(--muted); width: 50px; }
.fn-ip, .fn-sel { flex: 1; padding: 4px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; font-family: var(--font-mono); }
.conflict { color: #ff9800; font-size: 11px; padding: 2px 0; }
.target-preview { font-size: 11px; color: var(--muted); }
.target-preview code { background: var(--panel); padding: 1px 6px; border-radius: 2px; font-family: var(--font-mono); }
.btn-primary, .btn-ghost { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 13px; }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-ghost { background: transparent; color: var(--muted); }
</style>
