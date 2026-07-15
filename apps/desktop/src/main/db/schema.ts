/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/** 本地 SQLite 表结构（桌面端自身存储，与"目标数据库"无关）。 */
export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS connections (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  dialect      TEXT    NOT NULL,
  host         TEXT    NOT NULL,
  port         INTEGER NOT NULL,
  username     TEXT    NOT NULL,
  password_enc TEXT,
  database     TEXT,
  ssl_json     TEXT,
  ssh_json     TEXT,
  group_name   TEXT,
  extra_json   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  -- 用户拖拽排序的相对位置(REAL 支持 0.5 这种插队值, 避免每次重排所有行)
  sort_index   REAL
);

CREATE TABLE IF NOT EXISTS query_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT    NOT NULL,
  sql           TEXT    NOT NULL,
  executed_at   INTEGER NOT NULL,
  duration_ms   INTEGER,
  success       INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

-- 应用级 KV 持久化(替代 renderer localStorage,避免 force-kill 丢配置)。
-- value 形态:
--   plain:base64→ 明文 base64(不是加密,只做 SQLite 文本安全包装)
--   enc:base64  → 旧版本系统加密密文;新版本不再读取,避免触发系统钥匙串
-- 目前只放一行 key='settings'(整份 Settings JSON,主进程 encode/decode)。
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`
