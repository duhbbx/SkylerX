/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 应用 settings 持久化(整份 JSON 一行 KV)。
 *
 * 为什么不放 renderer localStorage?
 *  - Chromium LevelDB 异步落盘,SIGKILL 强杀(开发期 pkill -9 Electron 常见)会丢最后写入
 *  - 这里至少走主进程 SQLite 原子写；secret 按产品决策裸存,不再触发系统钥匙串
 *
 * 这里:
 *  - SQLite 同步事务写,强杀也不丢
 *  - 不使用系统钥匙串;统一以 plain:base64 保存,避免开发态反复弹授权
 *
 * 不分行存(key=aiProvider/aiApiKey/...)的原因:
 *  - Settings 接口是单一对象,整份原子 read/write 最简单
 *  - 单 IPC 调用 ↔ 单 DB 写,延迟更低
 *  - 存储粒度=整份,丢就一起丢,不会出现"theme 在但 apiKey 没了"的撕裂态
 */
import { getDb } from './sqlite.js'

const SETTINGS_KEY = 'settings'

/** 裸存一段 JSON 文本。base64 只是避免特殊字符影响存储,不是加密。 */
function encodeValue(plain: string): string {
  return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
}

/** 反向:plain 前缀解码;旧 enc 不再读取,避免触发系统钥匙串。 */
function decodeValue(stored: string): string | null {
  if (!stored) return null
  if (stored.startsWith('enc:')) {
    // 旧版本系统加密密文。按新策略不碰系统钥匙串,返回 null 让上层走默认设置。
    return null
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
  return decodeValue(row.value)
}

/** 写整份 settings JSON;不校验内容形态,renderer 自己保证是合法 Settings 序列化。 */
export function setSettings(jsonText: string): void {
  const enc = encodeValue(jsonText)
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
