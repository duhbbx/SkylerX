/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { QueryHistoryEntry } from '@db-tool/shared-types'
import { getDb } from './sqlite.js'

interface HistoryRow {
  id: number
  connection_id: string
  sql: string
  executed_at: number
  duration_ms: number | null
  success: number
}

/** 记录一次 SQL 执行。 */
export function recordHistory(
  connectionId: string,
  sql: string,
  durationMs: number,
  success: boolean,
): void {
  getDb()
    .prepare(
      'INSERT INTO query_history (connection_id, sql, executed_at, duration_ms, success) VALUES (?, ?, ?, ?, ?)',
    )
    .run(connectionId, sql, Date.now(), durationMs, success ? 1 : 0)
}

/** 取某连接最近的执行历史（默认 100 条，最新在前）。 */
export function listHistory(connectionId: string, limit = 100): QueryHistoryEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT id, connection_id, sql, executed_at, duration_ms, success
         FROM query_history WHERE connection_id = ?
        ORDER BY executed_at DESC LIMIT ?`,
    )
    .all(connectionId, limit) as HistoryRow[]
  return rows.map((r) => ({
    id: r.id,
    connectionId: r.connection_id,
    sql: r.sql,
    executedAt: r.executed_at,
    durationMs: r.duration_ms,
    success: r.success === 1,
  }))
}

/** 清空某连接的历史。 */
export function clearHistory(connectionId: string): void {
  getDb().prepare('DELETE FROM query_history WHERE connection_id = ?').run(connectionId)
}
