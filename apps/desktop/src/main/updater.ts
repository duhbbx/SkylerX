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
  | {
      kind: 'available'
      info: {
        version: string
        /** GitHub release body / latest.yml.releaseNotes(可能 markdown 文本) */
        releaseNotes?: string
        /** ISO 8601, electron-updater 从 yml 取 */
        releaseDate?: string
        releaseName?: string
      }
    }
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

/**
 * 更新源选择 — 解决国内用户连 github.com 慢/被墙的问题。
 *  - 'github'  → 默认,跟 electron-builder.yml 的 publish 一致 (GitHub Releases)
 *  - 'oss-cn'  → 阿里云 OSS 镜像 (上海),CI 已把同套产物 + latest*.yml 同步到这里
 *
 * 用户在 设置 → 应用更新 切换;切完调 updates:setChannel IPC,主进程持久化到
 * userData/updater-channel.json,下次启动也走该源。
 */
export type UpdateChannel = 'github' | 'oss-cn'

const OSS_GENERIC_URL = 'https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/latest/'

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

function channelFilePath(): string {
  return join(app.getPath('userData'), 'updater-channel.json')
}
async function loadChannel(): Promise<UpdateChannel> {
  try {
    const raw = await fs.readFile(channelFilePath(), 'utf8')
    const p = JSON.parse(raw) as { channel?: UpdateChannel }
    return p.channel === 'oss-cn' ? 'oss-cn' : 'github'
  } catch {
    return 'github'
  }
}
async function saveChannel(c: UpdateChannel): Promise<void> {
  await fs.writeFile(channelFilePath(), JSON.stringify({ channel: c }))
}

function applyChannel(c: UpdateChannel): void {
  if (c === 'oss-cn') {
    autoUpdater.setFeedURL({ provider: 'generic', url: OSS_GENERIC_URL })
  } else {
    // 走 electron-builder.yml 里的 github publish(默认行为,不需要 setFeedURL)
    // 但如果先前切到过 oss-cn,要重新指回 github;最稳妥用 channel reload
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'duhbbx',
      repo: 'SkylerX',
    })
  }
}

function broadcast(s: UpdaterStatus): void {
  lastStatus = s
  // webContents 可能在窗口关闭时不可用,加防御
  const wc = mainWindowRef?.webContents
  if (wc && !wc.isDestroyed()) wc.send('updates:status', s)
}

export function setupAutoUpdate(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow

  // 4 个 IPC:dev 模式也注册,但 actions 回 { devMode: true } 由 renderer 走 fallback
  // + 2 个 channel IPC: 取/设国内 OSS 镜像还是 GitHub 源
  ipcMain.handle('updates:getStatus', () => lastStatus)
  ipcMain.handle('updates:getChannel', async () => await loadChannel())
  ipcMain.handle('updates:setChannel', async (_e, c: UpdateChannel) => {
    if (c !== 'github' && c !== 'oss-cn') return { ok: false, error: 'unknown channel' }
    await saveChannel(c)
    if (app.isPackaged) applyChannel(c)
    return { ok: true }
  })
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
  // Windows: 暂时关闭签名校验 — 未走 SignPath 之前 exe 没签,
  // electron-updater 默认会拒绝 "publisherName 不匹配" / "not signed".
  // 走 SignPath 给 Windows 签名后删掉这两行,改回严格校验.
  // 类型断言:这两个属性在 electron-updater 6.x 都存在但 .d.ts 没声明
  ;(autoUpdater as unknown as { disableWebInstaller: boolean }).disableWebInstaller = false
  ;(autoUpdater as unknown as { verifyUpdateCodeSignature: unknown }).verifyUpdateCodeSignature =
    () => Promise.resolve(null)
  // 强制 channel = 'latest', 不让 electron-updater 看到 -rc / -beta / -alpha 后缀时
  // 自动推断成 rc / beta / alpha channel (会去拉 rc.yml/beta.yml 之类, 我们 build
  // 默认只生成 latest.yml, 导致 prerelease 用户检测不到新版本退化为 '已是最新').
  // 强制走 latest.yml 后, prerelease → prerelease 升级 + prerelease → stable 升级
  // 全部走同一条路径, 不再被 channel 自动推断坑.
  autoUpdater.channel = 'latest'

  // loadChannel + applyChannel + 启动 check 必须串行,
  // 否则 check 时 feed URL 还是默认的 github,跟用户的 OSS 选择不一致.

  // UpdateInfo / ProgressInfo 类型来自 builder-util-runtime,这里用 any 规避
  // 跨包类型导入麻烦(electron-updater 6.x 的 d.ts 把它们藏在 sub-package),
  // 字段在运行时都稳定(electron-updater 文档约定的形状)。
  autoUpdater.on('checking-for-update', () => broadcast({ kind: 'checking' }))
  autoUpdater.on(
    'update-available',
    (info: {
      version: string
      releaseNotes?: unknown
      releaseDate?: string
      releaseName?: string
    }) =>
      broadcast({
        kind: 'available',
        info: {
          version: info.version,
          // electron-updater 6.x 的 releaseNotes 可能是 string 也可能是 Array<{version,note}>
          // (multi-version aggregated). 这里把 Array 形态扁平成 markdown 字符串.
          releaseNotes:
            typeof info.releaseNotes === 'string'
              ? info.releaseNotes
              : Array.isArray(info.releaseNotes)
                ? (info.releaseNotes as { version?: string; note?: string }[])
                    .map((r) =>
                      r.version ? `## v${r.version}\n\n${r.note ?? ''}` : (r.note ?? ''),
                    )
                    .join('\n\n')
                : undefined,
          releaseDate: info.releaseDate,
          releaseName: info.releaseName,
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

  // 启动时静默检查一次(不下载,仅探测有无新版).
  // 先 await applyChannel 让 setFeedURL 完成,再 check,避免走错 channel.
  void (async () => {
    try {
      const c = await loadChannel()
      applyChannel(c)
      await autoUpdater.checkForUpdates()
    } catch (e) {
      broadcast({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  })()
}
