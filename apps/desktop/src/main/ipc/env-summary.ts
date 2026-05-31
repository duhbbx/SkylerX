/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure env-summary builder, split out of system.ts so the unit test can
 * exercise it without importing electron — system.ts pulls in `app` /
 * `ipcMain` at top level, which fails to load in headless CI (electron
 * binary is not on disk).
 */

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
 * Normalize an EnvSummaryInput into an EnvSummary, applying defaults.
 * Currently only coerces an undefined channel to 'github' — the rest is
 * a straight pass-through; centralizing it here lets the IPC handler stay
 * a thin shell and lets the test cover the defaulting logic.
 */
export function buildEnvSummary(input: EnvSummaryInput): EnvSummary {
  return {
    ...input,
    channel: input.channel ?? 'github',
  }
}
