/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommitMode, ConnectionEnv } from '@db-tool/shared-types'

/** 环境标记的展示元信息（标签 + 颜色）。 */
export const ENV_META: Record<ConnectionEnv, { label: string; color: string }> = {
  dev: { label: '开发', color: '#4caf50' },
  test: { label: '测试', color: '#e0a020' },
  prod: { label: '生产', color: '#e04050' },
}

export const ENV_OPTIONS: ConnectionEnv[] = ['dev', 'test', 'prod']

/** 从连接配置读取环境标记（存于 extra.env）；非法/缺省返回 undefined。 */
export function connEnv(
  conn: { extra?: Record<string, unknown> } | undefined,
): ConnectionEnv | undefined {
  const e = conn?.extra?.env
  return e === 'dev' || e === 'test' || e === 'prod' ? e : undefined
}

/** 该连接是否为只读模式（存于 extra.readOnly）；只读时整连接禁写。 */
export function connReadOnly(conn: { extra?: Record<string, unknown> } | undefined): boolean {
  return conn?.extra?.readOnly === true
}

/** 只读判定：仅放行明确的读语句（SELECT/WITH/SHOW/EXPLAIN/DESCRIBE/PRAGMA）。 */
export function isReadOnlyStatement(sql: string): boolean {
  return /^\s*(select|with|show|explain|desc(ribe)?|pragma)\b/i.test(sql)
}

/**
 * 结构变更判定：DDL 增删改对象后导航树需要刷新。
 * 命中 CREATE / DROP / ALTER / TRUNCATE / RENAME / COMMENT（可带前导注释 / 空白）。
 * 故意不含 GRANT/REVOKE（改权限不增减树节点）。
 */
export function isStructureChangingStatement(sql: string): boolean {
  // 去掉前导行注释 / 块注释，避免 `-- create...\nSELECT` 被误判
  const head = sql.replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)+/, '')
  return /^(create|drop|alter|truncate|rename|comment)\b/i.test(head)
}

/**
 * 解析连接初始的提交模式（仅用于「新建 query tab 时取个默认值」）。
 *
 * 不再读 `conn.extra.commitMode`——提交模式已经从连接配置迁移到 query tab，
 * 每个 tab 在工具栏里可以即时切换 auto/manual。
 *
 *  - 只读连接强制 'auto'：手动事务对只读连接无意义
 *  - 其它一律跟随全局 settings.commitMode
 */
export function initialCommitMode(
  conn: { extra?: Record<string, unknown> } | undefined,
  globalDefault: CommitMode,
): CommitMode {
  if (connReadOnly(conn)) return 'auto'
  return globalDefault
}
