import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { closeDb } from './db/sqlite.js'
import { registerConnectionIpc } from './ipc/connections.js'
import { registerFileIpc } from './ipc/files.js'
import { setupMenu } from './menu.js'
import { disposeTransport } from './transport.js'

const isDev = !app.isPackaged

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: false,
    title: 'SkylerX',
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
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  setupMenu()
  registerConnectionIpc()
  registerFileIpc()
  createWindow()

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
