/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { SCHEMA_SQL } from './schema.js'

let db: Database.Database | null = null

/** 打开（或返回已打开的）本地 SQLite 库，并保证表结构存在。 */
export function getDb(): Database.Database {
  if (db) return db
  const file = join(app.getPath('userData'), 'db-tool.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  migrate(db)
  return db
}

/** 为既有库补齐新增列（幂等）。 */
function migrate(db: Database.Database): void {
  ensureColumn(db, 'connections', 'ssh_json', 'TEXT')
  ensureColumn(db, 'connections', 'group_name', 'TEXT')
  ensureColumn(db, 'connections', 'sort_index', 'REAL') // 拖拽排序
  // 历史增强:标签 / 备注 / 置顶,supportable on old db
  ensureColumn(db, 'query_history', 'tags', 'TEXT')
  ensureColumn(db, 'query_history', 'note', 'TEXT')
  ensureColumn(db, 'query_history', 'pinned', 'INTEGER NOT NULL DEFAULT 0')
}

function ensureColumn(db: Database.Database, table: string, col: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`)
  }
}

export function closeDb(): void {
  db?.close()
  db = null
}
