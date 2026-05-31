/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { promises as fs } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { type EnvSummary, type EnvSummaryInput, buildEnvSummary } from './env-summary'

// Re-exported so existing renderer-side imports of system.ts types keep working
// without changing every call site after the split.
export { buildEnvSummary }
export type { EnvSummary, EnvSummaryInput }

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

export interface LatestVersionPeek {
  /** Tag string without 'v' prefix, e.g. '0.5.0-rc21'. Empty if unknown. */
  tag: string
  /** Where the answer came from (telemetry / diagnostics). */
  source: 'oss' | 'github' | 'none'
  /** Friendly error message when both sources failed. */
  error?: string
}

/**
 * Main-process "what's the latest version" peek. Used by the renderer's dev /
 * web fallback so the renderer never has to hit api.github.com directly
 * (#13-related: that path returned 403 from rate-limit / corporate proxies).
 *
 * Order:
 *   1. OSS index.json (no auth, no rate limit, Asia-fast).
 *   2. GitHub /releases?per_page=1 (works elsewhere; we already use this
 *      shape on the docs site).
 *
 * Each step times out at 8s. Returns 'none' if both fail with the last
 * error message attached.
 */
async function peekLatestVersion(): Promise<LatestVersionPeek> {
  const fetchWithTimeout = async (url: string, ms: number): Promise<Response> => {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), ms)
    try {
      return await fetch(url, { signal: ac.signal })
    } finally {
      clearTimeout(t)
    }
  }
  const strip = (s: string): string => s.replace(/^v/, '')
  // 1. OSS
  try {
    const r = await fetchWithTimeout(
      'https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/latest/index.json',
      8000,
    )
    if (r.ok) {
      const data = (await r.json()) as { tag_name?: string }
      if (data.tag_name) return { tag: strip(data.tag_name), source: 'oss' }
    }
  } catch {
    /* fall through to GitHub */
  }
  // 2. GitHub
  let lastErr = ''
  try {
    const r = await fetchWithTimeout(
      'https://api.github.com/repos/duhbbx/SkylerX/releases?per_page=1',
      8000,
    )
    if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`)
    const arr = (await r.json()) as Array<{ tag_name?: string }>
    const tag = arr[0]?.tag_name
    if (tag) return { tag: strip(tag), source: 'github' }
    lastErr = 'GitHub returned empty list'
  } catch (e) {
    lastErr = e instanceof Error ? e.message : String(e)
  }
  return { tag: '', source: 'none', error: lastErr }
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

  // Renderer dev/web fallback for "is there a newer version?" UI. Stays in main
  // so renderer never hits api.github.com from the page (gets 403 on rate-limit
  // and trips corporate proxies).
  ipcMain.handle('system:peekLatestVersion', async (): Promise<LatestVersionPeek> => {
    return await peekLatestVersion()
  })
}
