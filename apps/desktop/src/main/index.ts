/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */

import { join } from 'node:path'
import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { logCryptoProbe } from './crypto-probe.js'
import { closeDb } from './db/sqlite.js'
import { registerAiIpc } from './ipc/ai.js'
import { registerConnectionIpc } from './ipc/connections.js'
import { registerFileIpc } from './ipc/files.js'
import { registerSettingsIpc } from './ipc/settings.js'
import { setupSystemIpc } from './ipc/system.js'
import { setupMenu } from './menu.js'
import { disposeTransport } from './transport.js'
import { setupAutoUpdate } from './updater.js'

// Boot-time crypto runtime check — logs OpenSSL/BoringSSL identity + missing legacy
// ciphers so future driver crypto bugs (DM / Oracle / etc.) are one log line away
// from a diagnosis. Cheap (synchronous, ~ms). 详见 crypto-probe.ts 头注释.
logCryptoProbe()

const isDev = !app.isPackaged

/** #15 第二窗口：复用同一 renderer URL，开一个全新的 BrowserWindow，跟主窗口完全独立 */
function spawnExtraWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: isDev ? '[DEV] SkylerX' : 'SkylerX',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.on('ready-to-show', () => win.show())
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && rendererUrl) void win.loadURL(rendererUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: false,
    title: isDev ? '[DEV] SkylerX' : 'SkylerX',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // F12 切换开发者工具（默认不自动打开；菜单「视图」里也有，附带 ⌥⌘I / Ctrl+Shift+I）
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools()
    }
  })

  // 开发态加载 Vite dev server，生产态加载打包后的 index.html（均不自动开 DevTools）
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

app.whenReady().then(() => {
  registerConnectionIpc()
  registerFileIpc()
  registerAiIpc()
  registerSettingsIpc()
  setupSystemIpc()
  // #15 让渲染层能开新窗口；新窗口跟主窗口共享 sqlite 数据 + 各自独立的 Vue 状态
  ipcMain.handle('window:newSession', () => spawnExtraWindow())
  // 菜单要拿到主窗口的 webContents 才能 send 命令到渲染层，所以先建窗后建菜单
  const mainWindow = createWindow()
  setupMenu(mainWindow)
  setupAutoUpdate(mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDb()
    app.quit()
  }
})

app.on('before-quit', () => {
  void disposeTransport()
  closeDb()
})
