import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'

/** 文件读写 IPC 通道名（preload 侧保持一致）。 */
export const FILE_IPC = {
  saveText: 'files:saveText',
  openText: 'files:openText',
} as const

type Filter = { name: string; extensions: string[] }

export interface SaveTextRequest {
  defaultName: string
  content: string
  filters?: Filter[]
}

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

/** 注册「保存文本到文件 / 从文件读文本」的 IPC（导出 / 导入用）。 */
export function registerFileIpc(): void {
  // 弹保存对话框并写入；返回写入路径，取消返回 null
  ipcMain.handle(FILE_IPC.saveText, async (_e, req: SaveTextRequest): Promise<string | null> => {
    const win = focusedWindow()
    const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined!, {
      defaultPath: req.defaultName,
      filters: req.filters,
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, req.content, 'utf8')
    return filePath
  })

  // 弹打开对话框并读取；返回 { name, content }，取消返回 null
  ipcMain.handle(
    FILE_IPC.openText,
    async (_e, filters?: Filter[]): Promise<{ name: string; content: string } | null> => {
      const win = focusedWindow()
      const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined!, {
        properties: ['openFile'],
        filters,
      })
      if (canceled || !filePaths.length) return null
      const content = await readFile(filePaths[0], 'utf8')
      return { name: basename(filePaths[0]), content }
    },
  )
}
