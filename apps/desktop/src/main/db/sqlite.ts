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
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
