/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 全局 imperative API:saveFileWithDialog —— 替代 client.files.saveText 走 OS 原生对话框。
 *
 * 使用方式跟 saveText 几乎一致:
 *
 *   import { saveFileWithDialog } from '../saveFile'
 *   const path = await saveFileWithDialog({
 *     defaultName: 'export.csv',
 *     content: csvText,
 *     filters: [{ name: 'CSV', extensions: ['csv'] }],
 *   })
 *
 * 实现:
 *  - reactive 单例 + 顶层 <AppDialogs /> 渲染 SaveFileDialog
 *  - Promise 在用户点保存/取消时 resolve
 *  - 保存成功后自动弹"打开文件 / 显示在文件夹"小卡片(toast 升级版)
 */
import { reactive } from 'vue'

/**
 * 'save'           写文件(默认):有 content,确认后写盘 → resolve(path)
 * 'pick-existing'  只选已存在文件:用户点列表里的文件就 resolve(path),不写
 * 'pick-or-create' 选已有或填新名(SQLite/DuckDB 新建库场景):resolve(path),不写
 */
export type SaveDialogMode = 'save' | 'pick-existing' | 'pick-or-create' | 'pick-directory'

export interface SaveFileRequest {
  /** save / pick-or-create 模式的默认文件名;pick-existing 模式可空 */
  defaultName?: string
  /** save 模式需要;pick 模式不传 */
  content?: string | Uint8Array
  filters?: { name: string; extensions: string[] }[]
  defaultDir?: string
  /** 默认 save */
  mode?: SaveDialogMode
}

interface SaveFileState {
  open: boolean
  req: SaveFileRequest | null
  resolve: ((p: string | null) => void) | null
}

export const saveFileState = reactive<SaveFileState>({
  open: false,
  req: null,
  resolve: null,
})

/**
 * 桌面端能力检测:listDir 是 SaveFileDialog 文件浏览的关键 IPC,
 * 不可用 → 走 web 端 fallback(浏览器 anchor download 或 File System Access API)。
 *
 * 同样可用于"用户没重启 dev,旧 preload 没暴露新 IPC"的兼容场景。
 */
function hasFsCapability(): boolean {
  const api = (globalThis as { api?: { files?: { listDir?: unknown } } }).api
  return typeof api?.files?.listDir === 'function'
}

/** Web 端 fallback:优先 File System Access API → 兜底 anchor download。 */
async function saveFileWithBrowserFallback(req: SaveFileRequest): Promise<string | null> {
  // 1) 新浏览器(Chrome 86+/Edge):File System Access API,体验最接近原生
  const showSaveFilePicker = (
    window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<{
        createWritable: () => Promise<{
          write: (d: string | Uint8Array) => Promise<void>
          close: () => Promise<void>
        }>
        name: string
      }>
    }
  ).showSaveFilePicker
  if (showSaveFilePicker) {
    try {
      const types = (req.filters ?? []).map((f) => ({
        description: f.name,
        accept: { 'application/octet-stream': f.extensions.map((e) => `.${e}`) },
      }))
      const handle = await showSaveFilePicker({
        suggestedName: req.defaultName ?? 'export',
        types: types.length ? types : undefined,
      })
      const writable = await handle.createWritable()
      await writable.write(req.content!)
      await writable.close()
      return handle.name // 浏览器 API 不暴露绝对路径,只有文件名
    } catch (e) {
      // 用户取消 / 浏览器拒绝 → 不要抛,跌落到 anchor 兜底
      if ((e as Error).name === 'AbortError') return null
      // 其它错误也走 anchor 兜底
    }
  }
  // 2) 兜底:anchor download(文本/二进制都支持)
  try {
    const isBin = req.content instanceof Uint8Array
    const blob = isBin
      ? new Blob([(req.content as Uint8Array).buffer as ArrayBuffer], {
          type: 'application/octet-stream',
        })
      : new Blob([req.content as string], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const name = req.defaultName ?? 'export'
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return name
  } catch {
    return null
  }
}

/**
 * 弹自定义保存对话框,返回保存到的绝对路径或 null(取消)。
 *
 * 平台分流:
 *  - 桌面端(检测到 listDir IPC) → 弹完整 SaveFileDialog
 *  - Web 端 / 旧 preload → 自动 fallback 到 File System Access API → anchor download
 */
export function saveFileWithDialog(req: SaveFileRequest): Promise<string | null> {
  if (!hasFsCapability()) {
    return saveFileWithBrowserFallback({ ...req, mode: 'save' } as SaveFileRequest & {
      content: string | Uint8Array
    })
  }
  return new Promise((resolve) => {
    saveFileState.req = { ...req, mode: req.mode ?? 'save' }
    saveFileState.resolve = resolve
    saveFileState.open = true
  })
}

/**
 * 仅"选择文件路径"(不写内容):
 *  - allowCreate: true  → 允许选不存在的文件名(SQLite/DuckDB 新建库)
 *  - allowCreate: false → 只能选已存在的文件
 *
 * 桌面端 → 弹自定义 SaveFileDialog;Web 端 → showOpenFilePicker(File System Access API)。
 */
export function selectFileWithDialog(req: {
  filters?: { name: string; extensions: string[] }[]
  allowCreate?: boolean
  defaultDir?: string
  defaultName?: string
  /** true = 选目录(代码库关联等);走统一 SaveFileDialog 的 pick-directory 模式 */
  directory?: boolean
}): Promise<string | null> {
  if (!hasFsCapability()) {
    return selectFileBrowserFallback(req)
  }
  return new Promise((resolve) => {
    saveFileState.req = {
      mode: req.directory ? 'pick-directory' : req.allowCreate ? 'pick-or-create' : 'pick-existing',
      filters: req.filters,
      defaultDir: req.defaultDir,
      defaultName: req.defaultName ?? '',
    }
    saveFileState.resolve = resolve
    saveFileState.open = true
  })
}

/** Web 端 fallback for selectFile:用 showOpenFilePicker / showSaveFilePicker。 */
async function selectFileBrowserFallback(req: {
  filters?: { name: string; extensions: string[] }[]
  allowCreate?: boolean
  defaultName?: string
  directory?: boolean
}): Promise<string | null> {
  const win = window as unknown as {
    showOpenFilePicker?: (opts: unknown) => Promise<Array<{ name: string }>>
    showSaveFilePicker?: (opts: unknown) => Promise<{ name: string }>
    showDirectoryPicker?: () => Promise<{ name: string }>
  }
  if (req.directory) {
    try {
      const h = await win.showDirectoryPicker?.()
      return h?.name ?? null // 浏览器只给目录名,不给绝对路径
    } catch (e) {
      return (e as Error).name === 'AbortError' ? null : null
    }
  }
  const types = (req.filters ?? []).map((f) => ({
    description: f.name,
    accept: { 'application/octet-stream': f.extensions.map((e) => `.${e}`) },
  }))
  try {
    if (req.allowCreate && win.showSaveFilePicker) {
      const h = await win.showSaveFilePicker({
        suggestedName: req.defaultName ?? '',
        types: types.length ? types : undefined,
      })
      return h.name
    }
    if (win.showOpenFilePicker) {
      const handles = await win.showOpenFilePicker({
        multiple: false,
        types: types.length ? types : undefined,
      })
      return handles[0]?.name ?? null
    }
    return null
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null
    return null
  }
}
