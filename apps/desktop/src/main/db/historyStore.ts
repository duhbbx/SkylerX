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
  tags: string | null
  note: string | null
  pinned: number
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

/**
 * 取某连接最近的执行历史(默认 100 条,最新在前)。
 * - pinned 永远置顶(逆时间序内部排)
 * - 普通条目按 executed_at DESC
 * - 支持 search(sql/note/tags 任一 LIKE)
 */
export function listHistory(connectionId: string, limit = 100): QueryHistoryEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT id, connection_id, sql, executed_at, duration_ms, success, tags, note, pinned
         FROM query_history WHERE connection_id = ?
        ORDER BY pinned DESC, executed_at DESC LIMIT ?`,
    )
    .all(connectionId, limit) as HistoryRow[]
  return rows.map(rowToEntry)
}

/** 跨连接搜索 SQL/备注/标签;不传 connectionId 表示全库搜。 */
export function searchHistory(
  query: string,
  opts: { connectionId?: string; limit?: number } = {},
): QueryHistoryEntry[] {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100))
  const q = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`
  const sql = opts.connectionId
    ? `SELECT id, connection_id, sql, executed_at, duration_ms, success, tags, note, pinned
       FROM query_history
       WHERE connection_id = ? AND (sql LIKE ? ESCAPE '\\' OR IFNULL(note,'') LIKE ? ESCAPE '\\' OR IFNULL(tags,'') LIKE ? ESCAPE '\\')
       ORDER BY pinned DESC, executed_at DESC LIMIT ?`
    : `SELECT id, connection_id, sql, executed_at, duration_ms, success, tags, note, pinned
       FROM query_history
       WHERE (sql LIKE ? ESCAPE '\\' OR IFNULL(note,'') LIKE ? ESCAPE '\\' OR IFNULL(tags,'') LIKE ? ESCAPE '\\')
       ORDER BY pinned DESC, executed_at DESC LIMIT ?`
  const args: unknown[] = opts.connectionId
    ? [opts.connectionId, q, q, q, limit]
    : [q, q, q, limit]
  const rows = getDb().prepare(sql).all(...args) as HistoryRow[]
  return rows.map(rowToEntry)
}

/** 更新某条历史的 tags/note/pinned(都可选,只传给出来的)。 */
export function updateHistoryMeta(
  id: number,
  patch: { tags?: string | null; note?: string | null; pinned?: number },
): void {
  const sets: string[] = []
  const args: unknown[] = []
  if ('tags' in patch) {
    sets.push('tags = ?')
    args.push(patch.tags ?? null)
  }
  if ('note' in patch) {
    sets.push('note = ?')
    args.push(patch.note ?? null)
  }
  if ('pinned' in patch) {
    sets.push('pinned = ?')
    args.push(patch.pinned ?? 0)
  }
  if (!sets.length) return
  args.push(id)
  getDb()
    .prepare(`UPDATE query_history SET ${sets.join(', ')} WHERE id = ?`)
    .run(...args)
}

/** 删除单条历史(用于"忘掉这条")。 */
export function deleteHistoryEntry(id: number): void {
  getDb().prepare('DELETE FROM query_history WHERE id = ?').run(id)
}

/** 清空某连接的历史。 */
export function clearHistory(connectionId: string): void {
  getDb().prepare('DELETE FROM query_history WHERE connection_id = ?').run(connectionId)
}

function rowToEntry(r: HistoryRow): QueryHistoryEntry {
  return {
    id: r.id,
    connectionId: r.connection_id,
    sql: r.sql,
    executedAt: r.executed_at,
    durationMs: r.duration_ms,
    success: r.success === 1,
    tags: r.tags,
    note: r.note,
    pinned: r.pinned,
  }
}
