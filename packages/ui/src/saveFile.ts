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

export interface SaveFileRequest {
  defaultName: string
  content: string
  filters?: { name: string; extensions: string[] }[]
  defaultDir?: string
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
  const showSaveFilePicker = (window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<{
      createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>
      name: string
    }>
  }).showSaveFilePicker
  if (showSaveFilePicker) {
    try {
      const types = (req.filters ?? []).map((f) => ({
        description: f.name,
        accept: { 'text/plain': f.extensions.map((e) => `.${e}`) },
      }))
      const handle = await showSaveFilePicker({
        suggestedName: req.defaultName,
        types: types.length ? types : undefined,
      })
      const writable = await handle.createWritable()
      await writable.write(req.content)
      await writable.close()
      return handle.name // 浏览器 API 不暴露绝对路径,只有文件名
    } catch (e) {
      // 用户取消 / 浏览器拒绝 → 不要抛,跌落到 anchor 兜底
      if ((e as Error).name === 'AbortError') return null
      // 其它错误也走 anchor 兜底
    }
  }
  // 2) 兜底:anchor download
  try {
    const blob = new Blob([req.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = req.defaultName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return req.defaultName
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
    return saveFileWithBrowserFallback(req)
  }
  return new Promise((resolve) => {
    saveFileState.req = req
    saveFileState.resolve = resolve
    saveFileState.open = true
  })
}
