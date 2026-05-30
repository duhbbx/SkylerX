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
 * 弹自定义保存对话框,返回保存到的绝对路径或 null(取消)。
 * 实际写文件 + "打开文件 / 显示在文件夹"提示由 AppDialogs 在 SaveFileDialog 的 save 回调里完成。
 */
export function saveFileWithDialog(req: SaveFileRequest): Promise<string | null> {
  return new Promise((resolve) => {
    saveFileState.req = req
    saveFileState.resolve = resolve
    saveFileState.open = true
  })
}
