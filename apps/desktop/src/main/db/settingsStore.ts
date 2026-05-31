/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 应用 settings 持久化(整份 JSON 一行 KV)。
 *
 * 为什么不放 renderer localStorage?
 *  - Chromium LevelDB 异步落盘,SIGKILL 强杀(开发期 pkill -9 Electron 常见)会丢最后写入
 *  - apiKey 等敏感字段在 localStorage 是磁盘明文,任何能读 user data dir 的进程都能取
 *
 * 这里:
 *  - SQLite 同步事务写,强杀也不丢
 *  - safeStorage 加密整份 blob(含 apiKey);跨 OS keychain(macOS Keychain / Win DPAPI / Linux libsecret)
 *  - safeStorage 不可用时 fallback 到明文 base64(plain: 前缀,带警告),与 connectionStore 同模式
 *
 * 不分行存(key=aiProvider/aiApiKey/...)的原因:
 *  - Settings 接口是单一对象,整份原子 read/write 最简单
 *  - 单 IPC 调用 ↔ 单 DB 写,延迟更低
 *  - 加密粒度=整份,丢就一起丢,不会出现"theme 在但 apiKey 没了"的撕裂态
 */
import { safeStorage } from 'electron'
import { getDb } from './sqlite.js'

const SETTINGS_KEY = 'settings'

/** 加密一段 JSON 文本;safeStorage 不可用时 fallback 到 plain: base64 */
function encryptValue(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(plain).toString('base64')}`
  }
  // 警告级别 fallback:OS 钥匙串不可用时(罕见,通常 Linux 上 libsecret 缺失),
  // 仍然落盘但明文。renderer 侧可在 UI 上提示用户。
  return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
}

/** 反向:enc/plain 前缀分别解码;无前缀视为旧明文(向前兼容) */
function decryptValue(stored: string): string | null {
  if (!stored) return null
  if (stored.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    } catch {
      // 钥匙串里的 key 失效(用户换机 / 删登录 keychain),整份还原失败
      // 不抛错,返回 null 让上层走默认设置;丢失内容用户得重输 apiKey,
      // 但避免一次解密失败永远卡住启动。
      return null
    }
  }
  if (stored.startsWith('plain:')) {
    return Buffer.from(stored.slice(6), 'base64').toString('utf8')
  }
  return stored
}

/** 读整份 settings JSON;不存在返回 null。 */
export function getSettings(): string | null {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTINGS_KEY) as
    | { value: string }
    | undefined
  if (!row) return null
  return decryptValue(row.value)
}

/** 写整份 settings JSON;不校验内容形态,renderer 自己保证是合法 Settings 序列化。 */
export function setSettings(jsonText: string): void {
  const enc = encryptValue(jsonText)
  const now = Date.now()
  getDb()
    .prepare(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .run(SETTINGS_KEY, enc, now)
}

/** 删除 settings(测试 / 重置用)。 */
export function clearSettings(): void {
  getDb().prepare('DELETE FROM app_settings WHERE key = ?').run(SETTINGS_KEY)
}
