import { promises as fs } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { app, ipcMain } from 'electron'

export interface EnvSummaryInput {
  appVersion: string
  platform: NodeJS.Platform
  arch: string
  electronVer: string
  nodeVer: string
  chromeVer: string
  locale: string
  timezone: string
  channel: 'github' | 'oss-cn' | undefined
  osRelease: string
}

export interface EnvSummary {
  appVersion: string
  platform: NodeJS.Platform
  arch: string
  electronVer: string
  nodeVer: string
  chromeVer: string
  locale: string
  timezone: string
  channel: 'github' | 'oss-cn'
  osRelease: string
}

/**
 * Pure builder so the unit test can exercise normalization without booting
 * Electron. The IPC handler below calls this with the live values.
 */
export function buildEnvSummary(input: EnvSummaryInput): EnvSummary {
  return {
    ...input,
    channel: input.channel ?? 'github',
  }
}

/**
 * Read the persisted updater channel, applying the same timezone-based
 * default as updater.ts:loadChannel() / defaultChannel() when no file
 * exists yet — otherwise we'd misreport the effective channel on first
 * launch for the mainland-CN audience that's defaulted to OSS.
 *
 * Inlined rather than importing from updater.ts so this IPC stays
 * side-effect-free (updater.ts pulls in autoUpdater + log streams).
 */
async function readChannel(): Promise<'github' | 'oss-cn'> {
  try {
    const raw = await fs.readFile(join(app.getPath('userData'), 'updater-channel.json'), 'utf8')
    const p = JSON.parse(raw) as { channel?: 'github' | 'oss-cn' }
    return p.channel === 'oss-cn' ? 'oss-cn' : 'github'
  } catch {
    return defaultChannelByTimezone()
  }
}

/** Same logic as updater.ts:defaultChannel(); kept in sync manually (~5 lines). */
function defaultChannelByTimezone(): 'github' | 'oss-cn' {
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
    /* Intl unavailable */
  }
  return 'github'
}

export function setupSystemIpc(): void {
  ipcMain.handle('system:getVersion', () => app.getVersion())

  ipcMain.handle('system:getEnvSummary', async (): Promise<EnvSummary> => {
    return buildEnvSummary({
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electronVer: process.versions.electron ?? 'unknown',
      nodeVer: process.versions.node ?? 'unknown',
      chromeVer: process.versions.chrome ?? 'unknown',
      locale: app.getLocale(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      channel: await readChannel(),
      osRelease: release(),
    })
  })
}
