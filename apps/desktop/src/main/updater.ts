/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type BrowserWindow, app, ipcMain } from 'electron'
// electron-updater 是 CJS,ESM 下需取默认导出再解构。
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

/**
 * 应用内自动更新:
 *  - packaged 模式启用 electron-updater,渠道 = electron-builder.yml 的 publish(GitHub Releases)
 *  - dev 模式 IPC 仍注册但回 devMode=true,renderer 据此降级到 GitHub 链接
 *  - autoDownload=false:让 renderer 上的"立即下载并安装"按钮主动触发,避免后台偷偷下大文件
 *  - autoInstallOnAppQuit=true:即使用户没点重启,退出时也补装一次
 *
 * 状态机透传给 renderer 的事件 channel = 'updates:status',renderer 监听显示进度。
 */
export type UpdaterStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; info: { version: string; releaseNotes?: string } }
  | { kind: 'not-available'; currentVersion: string }
  | {
      kind: 'downloading'
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    }
  | { kind: 'downloaded'; info: { version: string } }
  | { kind: 'error'; message: string }

let lastStatus: UpdaterStatus = { kind: 'idle' }
let mainWindowRef: BrowserWindow | null = null

function broadcast(s: UpdaterStatus): void {
  lastStatus = s
  // webContents 可能在窗口关闭时不可用,加防御
  const wc = mainWindowRef?.webContents
  if (wc && !wc.isDestroyed()) wc.send('updates:status', s)
}

export function setupAutoUpdate(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow

  // 4 个 IPC:dev 模式也注册,但 actions 回 { devMode: true } 由 renderer 走 fallback
  ipcMain.handle('updates:getStatus', () => lastStatus)
  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged) {
      broadcast({ kind: 'error', message: '开发模式不支持应用内自动更新,请使用打包安装版' })
      return { devMode: true }
    }
    broadcast({ kind: 'checking' })
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      broadcast({ kind: 'error', message: msg })
      return { ok: false, error: msg }
    }
  })
  ipcMain.handle('updates:downloadAndInstall', async () => {
    if (!app.isPackaged) return { devMode: true }
    try {
      if (lastStatus.kind === 'downloaded') {
        // 已下完 → 直接装
        autoUpdater.quitAndInstall()
        return { ok: true }
      }
      // 否则触发下载;下载完成事件会自动激活"立即安装"按钮
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      broadcast({ kind: 'error', message: msg })
      return { ok: false, error: msg }
    }
  })
  ipcMain.handle('updates:install', () => {
    if (!app.isPackaged) return { devMode: true }
    autoUpdater.quitAndInstall()
    return { ok: true }
  })

  if (!app.isPackaged) return // 后续 autoUpdater 设置仅在 packaged 模式

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // UpdateInfo / ProgressInfo 类型来自 builder-util-runtime,这里用 any 规避
  // 跨包类型导入麻烦(electron-updater 6.x 的 d.ts 把它们藏在 sub-package),
  // 字段在运行时都稳定(electron-updater 文档约定的形状)。
  autoUpdater.on('checking-for-update', () => broadcast({ kind: 'checking' }))
  autoUpdater.on('update-available', (info: { version: string; releaseNotes?: unknown }) =>
    broadcast({
      kind: 'available',
      info: {
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      },
    }),
  )
  autoUpdater.on('update-not-available', (info: { version: string }) =>
    broadcast({ kind: 'not-available', currentVersion: info.version }),
  )
  autoUpdater.on('error', (err: Error) =>
    broadcast({ kind: 'error', message: err?.message ?? String(err) }),
  )
  autoUpdater.on(
    'download-progress',
    (p: { percent: number; bytesPerSecond: number; transferred: number; total: number }) =>
      broadcast({
        kind: 'downloading',
        percent: p.percent,
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total,
      }),
  )
  autoUpdater.on('update-downloaded', (info: { version: string }) =>
    broadcast({ kind: 'downloaded', info: { version: info.version } }),
  )

  // 启动时静默检查一次(不下载,仅探测有无新版)
  void autoUpdater.checkForUpdates()
}
