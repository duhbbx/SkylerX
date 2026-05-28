import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'

/** 文件读写 IPC 通道名（preload 侧保持一致）。 */
export const FILE_IPC = {
  saveText: 'files:saveText',
  openText: 'files:openText',
  /** 仅选择文件路径(不读内容),用于 SQLite/DuckDB 数据库文件指定 */
  selectFile: 'files:selectFile',
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

  // 仅选择文件路径(不读内容);用于 SQLite/DuckDB 数据库文件指定。
  // 可选 createOption=true 时允许选择尚不存在的文件名(新建数据库)。
  ipcMain.handle(
    FILE_IPC.selectFile,
    async (
      _e,
      req?: { filters?: Filter[]; allowCreate?: boolean; defaultPath?: string },
    ): Promise<string | null> => {
      const win = focusedWindow()
      if (req?.allowCreate) {
        // showSaveDialog 允许指定不存在的文件名,用于"新建数据库文件"场景
        const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined!, {
          defaultPath: req.defaultPath,
          filters: req.filters,
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        })
        return canceled || !filePath ? null : filePath
      }
      const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined!, {
        properties: ['openFile'],
        defaultPath: req?.defaultPath,
        filters: req?.filters,
      })
      return canceled || !filePaths.length ? null : filePaths[0]
    },
  )
}
