/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type BrowserWindow, app, ipcMain, shell } from 'electron'
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

/**
 * 首启动 / 没保存过 channel 时,按时区猜一个合理默认值.
 *  - 大陆时区(Asia/Shanghai 等) → 'oss-cn',避免国内用户开箱就撞 GFW 把
 *    github.com 的 TCP 切断(net::ERR_CONNECTION_CLOSED).
 *  - 其余(含 HK/MO/TW + 海外) → 'github',源头最新.
 * 用户在 UI 上手动切过就持久化,后续启动不再走这个推断.
 */
function defaultChannel(): UpdateChannel {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (
      tz === 'Asia/Shanghai' ||
      tz === 'Asia/Chongqing' ||
      tz === 'Asia/Urumqi' ||
      tz === 'Asia/Harbin'
    ) {
      return 'oss-cn'
    }
  } catch {
    /* Intl 不可用就走默认 */
  }
  return 'github'
}

async function loadChannel(): Promise<UpdateChannel> {
  try {
    const raw = await fs.readFile(channelFilePath(), 'utf8')
    const p = JSON.parse(raw) as { channel?: UpdateChannel }
    return p.channel === 'oss-cn' ? 'oss-cn' : 'github'
  } catch {
    return defaultChannel()
  }
}
async function saveChannel(c: UpdateChannel): Promise<void> {
  await fs.writeFile(channelFilePath(), JSON.stringify({ channel: c }))
}

// 记一份当前 channel, error 提示用 — applyChannel 是唯一写点
let currentChannel: UpdateChannel = 'github'

/**
 * mac 平台没 Apple Developer ID 签名,自动安装走不通.
 * 这里给一份"前往下载页"用的 URL,channel=oss-cn 走 OSS latest 目录,
 * 其余走 GitHub Releases latest 页(用户在国内可能慢但 mac 用户少数在墙内).
 */
async function downloadPageFor(c: UpdateChannel): Promise<string> {
  return c === 'oss-cn'
    ? 'https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/latest/'
    : 'https://github.com/duhbbx/SkylerX/releases/latest'
}

function applyChannel(c: UpdateChannel): void {
  currentChannel = c
  if (c === 'oss-cn') {
    autoUpdater.setFeedURL({ provider: 'generic', url: OSS_GENERIC_URL })
    pushLog(`setFeedURL → OSS (generic) ${OSS_GENERIC_URL}`)
  } else {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'duhbbx',
      repo: 'SkylerX',
    })
    pushLog('setFeedURL → GitHub (duhbbx/SkylerX)')
  }
}

// ── 调试日志 ─────────────────────────────────────────────────────────
// 用户报告: 检查更新时不清楚到底用了哪个 channel / 拉哪个 yml,
// 失败时只看到一句话错误难定位. 维护一个滚动日志(最近 50 条),
// renderer 'updates:onLog' 订阅 + 'updates:getLogs' 拉历史.
export interface UpdaterLog {
  ts: number // unix ms
  level: 'info' | 'warn' | 'error'
  msg: string
}
const updaterLogs: UpdaterLog[] = []
const MAX_LOGS = 50

function pushLog(msg: string, level: UpdaterLog['level'] = 'info'): void {
  const entry: UpdaterLog = { ts: Date.now(), level, msg }
  updaterLogs.push(entry)
  if (updaterLogs.length > MAX_LOGS) updaterLogs.shift()
  const wc = mainWindowRef?.webContents
  if (wc && !wc.isDestroyed()) wc.send('updates:log', entry)
}

function broadcast(s: UpdaterStatus): void {
  lastStatus = s
  // 状态变化时也写进日志 (kind + 关键字段),让面板显示一份完整时间线
  switch (s.kind) {
    case 'checking':
      pushLog('checking for update ...')
      break
    case 'available':
      pushLog(
        `update available: v${s.info.version}${s.info.releaseDate ? ` (released ${s.info.releaseDate})` : ''}`,
      )
      break
    case 'not-available':
      pushLog(`up to date (current: v${s.currentVersion})`)
      break
    case 'downloading':
      // download-progress 触发频繁,只每 10% 打一条
      if (Math.floor(s.percent) % 10 === 0) {
        pushLog(
          `downloading ${Math.floor(s.percent)}% @ ${(s.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`,
        )
      }
      break
    case 'downloaded':
      pushLog(`downloaded v${s.info.version}, ready to install`)
      break
    case 'error':
      pushLog(s.message, 'error')
      // GitHub channel + 网络层错误 → 八成是 GFW / 公司代理切断 TCP.
      // 主动建议用户切到 OSS 镜像,省得他自己猜.
      if (
        currentChannel === 'github' &&
        /(ECONN|ETIMEDOUT|ENOTFOUND|CONNECTION_CLOSED|CONNECTION_REFUSED|CONNECTION_RESET|net::ERR_|getaddrinfo)/i.test(
          s.message,
        )
      ) {
        pushLog(
          '提示: GitHub 在当前网络下不可达(可能被防火墙/代理切断). 在「关于」弹框里切到「OSS 镜像」试试.',
          'warn',
        )
      }
      break
  }
  // webContents 可能在窗口关闭时不可用,加防御
  const wc = mainWindowRef?.webContents
  if (wc && !wc.isDestroyed()) wc.send('updates:status', s)
}

export function setupAutoUpdate(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow

  // 4 个 IPC:dev 模式也注册,但 actions 回 { devMode: true } 由 renderer 走 fallback
  // + 2 个 channel IPC: 取/设国内 OSS 镜像还是 GitHub 源
  ipcMain.handle('updates:getStatus', () => lastStatus)
  ipcMain.handle('updates:getLogs', () => updaterLogs.slice())
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
    pushLog(`user clicked "check for updates" (app version: v${app.getVersion()})`)
    broadcast({ kind: 'checking' })
    try {
      const r = await autoUpdater.checkForUpdates()
      // r 可能是 UpdateCheckResult 含 updateInfo + downloadPromise, 这里只 log 版本
      const v = (r as { updateInfo?: { version?: string } } | null)?.updateInfo?.version
      if (v) pushLog(`server reports latest version: v${v}`)
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      broadcast({ kind: 'error', message: msg })
      return { ok: false, error: msg }
    }
  })
  ipcMain.handle('updates:downloadAndInstall', async () => {
    if (!app.isPackaged) return { devMode: true }
    // macOS 自动安装走 Squirrel.Mac,swap-in 前会做系统 codesign 校验:新版签名必须满足
    // 旧版的 Designated Requirement(同一 Developer ID / Team).正式版已 Developer ID 签名
    // + 公证(CI secret 齐时用 -c.mac.identity= 覆盖 electron-builder.yml 的 identity:null),
    // 新旧版同 Team → 校验通过,可正常应用内更新.
    // 兜底:万一某个构建没签到位 / 校验失败,catch 里降级到下载页,别让用户卡住.
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
      if (process.platform === 'darwin') {
        const url = await downloadPageFor(await loadChannel())
        pushLog(`macOS 自动更新失败(${msg}); 降级到下载页: ${url}`, 'warn')
        await shell.openExternal(url)
        return { ok: true, manualDownload: true }
      }
      broadcast({ kind: 'error', message: msg })
      return { ok: false, error: msg }
    }
  })
  ipcMain.handle('updates:install', async () => {
    if (!app.isPackaged) return { devMode: true }
    // 正式版已 Developer ID 签名 + 公证,quitAndInstall 可正常 swap;失败再降级到下载页.
    try {
      autoUpdater.quitAndInstall()
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (process.platform === 'darwin') {
        const url = await downloadPageFor(await loadChannel())
        pushLog(`macOS quitAndInstall 失败(${msg}); 降级到下载页: ${url}`, 'warn')
        await shell.openExternal(url)
        return { ok: true, manualDownload: true }
      }
      broadcast({ kind: 'error', message: msg })
      return { ok: false, error: msg }
    }
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
  // ⚠ 不要强制 autoUpdater.channel = 'latest':
  //   GitHub provider 在 channel='latest' 时会主动过滤掉所有 -rc/-beta/-alpha tag
  //   的 release(不管 allowPrerelease 是否 true),导致仓库全是 -rc 时报
  //   "No published versions on GitHub".
  //   让 electron-updater 按 app version 自动推断 channel:
  //     0.5.0      → 'latest' → 拉 latest.yml + 找 stable release
  //     0.5.0-rc9  → 'rc'     → 拉 rc.yml    + 找 含-rc 的 release
  //   CI 已经同时生成 latest.yml + rc.yml/beta.yml/alpha.yml,所以两种 channel 都有.
  //
  // allowPrerelease=true 让 prerelease → stable 升级也能跑(stable app 收到 -rc 更新)
  autoUpdater.allowPrerelease = true

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
      releaseName?: string | null
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
          releaseName: info.releaseName ?? undefined,
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
