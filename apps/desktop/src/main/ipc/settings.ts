/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { ipcMain } from 'electron'
import { clearSettings, getSettings, setSettings } from '../db/settingsStore.js'

/** IPC 通道名:preload 侧需保持一致。 */
export const SETTINGS_IPC = {
  get: 'settings:get',
  set: 'settings:set',
  clear: 'settings:clear',
} as const

/** 注册 settings 持久化 IPC。 */
export function registerSettingsIpc(): void {
  // 读整份 settings JSON;首次启动 / 清空状态返回 null
  ipcMain.handle(SETTINGS_IPC.get, (): string | null => getSettings())
  // 写整份 settings JSON(主进程 safeStorage 加密整份 blob)
  ipcMain.handle(SETTINGS_IPC.set, (_e, jsonText: string): void => {
    if (typeof jsonText !== 'string') throw new Error('settings:set payload 必须是 JSON 字符串')
    setSettings(jsonText)
  })
  // 测试 / 出问题时重置用
  ipcMain.handle(SETTINGS_IPC.clear, (): void => clearSettings())
}
