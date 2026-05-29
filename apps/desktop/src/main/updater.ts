/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { BrowserWindow, app, dialog } from 'electron'
// electron-updater 是 CJS，ESM 下需取默认导出再解构。
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

/**
 * 自动更新（仅打包态生效）。
 * 后台静默下载，下载完成后弹原生对话框询问是否立即重启安装；
 * 用户选「稍后」则在下次退出时自动安装。全部逻辑留在主进程，
 * 不侵入共享的 @db-tool/ui，也不影响 Web 端。
 * 发布渠道见 electron-builder.yml 的 publish（GitHub Releases）。
 */
export function setupAutoUpdate(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err?.message ?? err)
  })
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] 发现新版本', info.version, '，后台下载中…')
  })
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] 已是最新版本')
  })
  autoUpdater.on('update-downloaded', (info) => {
    const win = BrowserWindow.getAllWindows()[0]
    const opts = {
      type: 'info' as const,
      buttons: ['立即重启更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: '发现新版本',
      message: `SkylerX ${info.version} 已下载完成`,
      detail: '重启应用即可完成更新；选择「稍后」将在下次退出时自动安装。',
    }
    const handle = (response: number): void => {
      if (response === 0) autoUpdater.quitAndInstall()
    }
    if (win) {
      void dialog.showMessageBox(win, opts).then((r) => handle(r.response))
    } else {
      void dialog.showMessageBox(opts).then((r) => handle(r.response))
    }
  })

  void autoUpdater.checkForUpdates()
}
