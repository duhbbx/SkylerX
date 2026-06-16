/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'

/** 文件读写 IPC 通道名（preload 侧保持一致）。 */
export const FILE_IPC = {
  saveText: 'files:saveText',
  openText: 'files:openText',
  /** 仅选择文件路径(不读内容),用于 SQLite/DuckDB 数据库文件指定 */
  selectFile: 'files:selectFile',
  // ── 给自定义 SaveFileDialog 用的低级原语(跨平台一致 UI,不走 OS 原生) ──
  listDir: 'files:listDir',
  commonDirs: 'files:commonDirs',
  writeText: 'files:writeText',
  writeBinary: 'files:writeBinary',
  openPath: 'files:openPath',
  showInFolder: 'files:showInFolder',
  mkdir: 'files:mkdir',
  stat: 'files:stat',
  pathJoin: 'files:pathJoin',
  readText: 'files:readText',
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
      req?: { filters?: Filter[]; allowCreate?: boolean; defaultPath?: string; directory?: boolean },
    ): Promise<string | null> => {
      const win = focusedWindow()
      if (req?.directory) {
        // 选目录(代码库关联用):openDirectory 只让选文件夹。
        const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined!, {
          properties: ['openDirectory'],
          defaultPath: req?.defaultPath,
        })
        return canceled || !filePaths.length ? null : filePaths[0]
      }
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

  // ── 自定义 SaveFileDialog 用的原语 ────────────────────────────────
  /** 列目录:返回所有条目的 name/isDirectory/size/mtime/isHidden。 */
  ipcMain.handle(
    FILE_IPC.listDir,
    async (
      _e,
      dirPath: string,
    ): Promise<
      Array<{
        name: string
        isDirectory: boolean
        size: number
        mtime: number
        isHidden: boolean
      }>
    > => {
      try {
        const items = await readdir(dirPath, { withFileTypes: true })
        return Promise.all(
          items.map(async (it) => {
            const full = join(dirPath, it.name)
            let size = 0
            let mtime = 0
            try {
              const s = await stat(full)
              size = s.size
              mtime = s.mtimeMs
            } catch {
              /* 权限不足等 */
            }
            return {
              name: it.name,
              isDirectory: it.isDirectory(),
              size,
              mtime,
              // Unix-like 隐藏文件 = 点开头;Windows 隐藏属性这里不查(成本高 + 罕用)
              isHidden: it.name.startsWith('.'),
            }
          }),
        )
      } catch (e) {
        throw new Error(`无法读取目录: ${(e as Error).message}`)
      }
    },
  )

  /** 常用位置 + path 分隔符。 */
  ipcMain.handle(FILE_IPC.commonDirs, () => ({
    home: app.getPath('home'),
    desktop: app.getPath('desktop'),
    documents: app.getPath('documents'),
    downloads: app.getPath('downloads'),
    sep,
  }))

  /** 直接写到指定路径(自定义对话框确认后调用)。 */
  ipcMain.handle(FILE_IPC.writeText, async (_e, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf8')
    return filePath
  })

  /** 写二进制文件(xlsx / png / blob 等;renderer 端传 Uint8Array 序列化为 Buffer)。 */
  ipcMain.handle(
    FILE_IPC.writeBinary,
    async (_e, filePath: string, bytes: ArrayBuffer | Uint8Array) => {
      const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      await writeFile(filePath, buf)
      return filePath
    },
  )

  /** 打开路径(文件用默认程序,文件夹用 Finder/Explorer)。 */
  ipcMain.handle(FILE_IPC.openPath, async (_e, p: string): Promise<string> => {
    // shell.openPath 失败时返回错误字符串,成功返回 ''
    return shell.openPath(p)
  })

  /** 在文件管理器(Finder/Explorer)里选中文件。 */
  ipcMain.handle(FILE_IPC.showInFolder, (_e, p: string) => {
    shell.showItemInFolder(p)
  })

  /** 新建文件夹(recursive)。 */
  ipcMain.handle(FILE_IPC.mkdir, async (_e, p: string) => {
    await mkdir(p, { recursive: true })
    return p
  })

  /** stat 文件:返回 size/mtime/isFile/isDirectory;路径不存在返回 null。 */
  ipcMain.handle(
    FILE_IPC.stat,
    async (
      _e,
      p: string,
    ): Promise<{ size: number; mtime: number; isFile: boolean; isDirectory: boolean } | null> => {
      try {
        const s = await stat(p)
        return {
          size: s.size,
          mtime: s.mtimeMs,
          isFile: s.isFile(),
          isDirectory: s.isDirectory(),
        }
      } catch {
        return null
      }
    },
  )

  /** path.join — renderer 不能直接用 node:path,这里转发。 */
  ipcMain.handle(FILE_IPC.pathJoin, (_e, ...parts: string[]) => join(...parts))

  /** 按路径读取 utf8 文本(供代码库索引扫描用)。失败抛错,渲染层 catch 跳过该文件。 */
  ipcMain.handle(FILE_IPC.readText, async (_e, filePath: string): Promise<string> => {
    return readFile(filePath, 'utf8')
  })
}
