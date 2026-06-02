/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 慢查询模板 + 数据归一化。
 *
 * 思路：本工具不维护「写入慢日志」的功能（只读），把不同方言的「Top N 慢 SQL」
 * 接口统一抽成 { checkSql, listSql, params, source, enableHint } 四件套，
 * 再把不同列名的行规整成统一的 SlowRow 给 UI 渲染。
 *
 * 方言族：
 *   - MySQL 族（MySQL/MariaDB/TiDB/OceanBase/Doris/StarRocks）走
 *     performance_schema.events_statements_summary_by_digest（5.7+）。
 *     注：Doris/StarRocks 协议兼容 MySQL，FE 通常也暴露该表；个别版本不暴露时
 *     listSql 会失败,UI 会落到 unsupported 友好提示。
 *   - PG 族（PostgreSQL/CockroachDB/Greenplum/openGauss/KingbaseES/Redshift）走
 *     pg_stat_statements 扩展。Redshift 实际是 STL_QUERY 系族，这里保持简单：
 *     若 PG 系扩展查不到,UI 同样落到 unsupported,提示用户去对应控制台。
 *   - 其它方言：返回 null,UI 走 unsupported 文案。
 *
 * 不为方言写 EXPLAIN 模板；EXPLAIN 由组件按方言族即时拼。
 */
import { DbDialect } from '@db-tool/shared-types'

/** 单条归一化的慢 SQL 行（UI 直接消费）。 */
export interface SlowRow {
  /** SQL 摘要文本（已 normalize/digest 过的形态由 DB 给出） */
  sqlText: string
  /** 调用次数 */
  execCount: number
  /** 平均耗时（毫秒） */
  avgMs: number
  /** 累计总耗时（毫秒） */
  totalMs: number
  /** 单次最大耗时（毫秒） */
  maxMs: number
  /** 扫描行数（MySQL: SUM_ROWS_EXAMINED；PG: 用 total_rows 兜底） */
  rowsExamined?: number
  /** 返回行数（MySQL: SUM_ROWS_SENT；PG: rows） */
  rowsSent?: number
  /** MySQL: SUM_NO_INDEX_USED；PG: 无,留空 */
  noIndexCount?: number
  /** 首次见到（时间戳字符串，未解析；PG 无,留空） */
  firstSeen?: string
  /** 最近一次见到 */
  lastSeen?: string
}

/** 方言族（仅本模块用，不与 ddl.familyOf() 复用：那个把 H2 划进 pg、把 Redshift 没收录，与本模块的判定边界不同） */
export type SlowFamily = 'mysql' | 'pg' | 'other'

export function slowFamilyOf(dialect: DbDialect): SlowFamily {
  switch (dialect) {
    case DbDialect.MySQL:
    case DbDialect.MariaDB:
    case DbDialect.TiDB:
    case DbDialect.OceanBase:
    case DbDialect.Doris:
    case DbDialect.StarRocks:
    case DbDialect.PolarDBX:
    case DbDialect.GreatSQL:
    case DbDialect.TDSQLC:
      return 'mysql'
    case DbDialect.PostgreSQL:
    case DbDialect.CockroachDB:
    case DbDialect.Greenplum:
    case DbDialect.OpenGauss:
    case DbDialect.KingbaseES:
    case DbDialect.Vastbase:
    case DbDialect.MogDB:
    case DbDialect.HighGo:
    case DbDialect.Redshift:
    case DbDialect.PolarDBPG:
    case DbDialect.GaussDB:
    case DbDialect.TimescaleDB:
    case DbDialect.QuestDB:
    case DbDialect.Materialize:
    case DbDialect.RisingWave:
    case DbDialect.Hologres:
      return 'pg'
    default:
      return 'other'
  }
}

/** 排序键：UI 排序切换给我们 → 我们生成对应 ORDER BY 列。 */
export type SlowSort = 'totalMs' | 'avgMs' | 'execCount'

/** 方言模板定义。 */
export interface SlowQueryDef {
  family: SlowFamily
  /** 用来快速探测「是否启用慢日志/扩展」的极轻量 SQL。 */
  checkSql: string
  /** 主查询 SQL（含 ORDER BY 与 LIMIT 占位）。 */
  listSql: string
  /** 主查询参数（位置参数；MySQL 传 schema 名,PG 不需要） */
  params: unknown[]
  /** 时间窗描述（累计窗口的人类化文案 key） */
  windowKey: 'slowq.windowSinceStart'
  /** 数据源人类描述（用作底部状态栏） */
  sourceLabel: string
  /** 未启用时给用户的开启提示（含可粘贴 SQL；多行字符串） */
  enableHint: string
}

/** 生成方言族对应的 SlowQueryDef；不支持的方言返回 null。 */
export function slowQueryFor(
  dialect: DbDialect,
  opts?: { database?: string; sort?: SlowSort; limit?: number },
): SlowQueryDef | null {
  const family = slowFamilyOf(dialect)
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 50))
  const sort: SlowSort = opts?.sort ?? 'totalMs'
  if (family === 'mysql') {
    const orderCol =
      sort === 'avgMs' ? 'AVG_TIMER_WAIT' : sort === 'execCount' ? 'COUNT_STAR' : 'SUM_TIMER_WAIT'
    // events_statements_summary_by_digest 的 *_TIMER_WAIT 单位是皮秒（10^-12s），换算到毫秒 = / 1e9
    const listSql = `SELECT
        DIGEST_TEXT AS sql_text,
        COUNT_STAR AS exec_count,
        ROUND(AVG_TIMER_WAIT/1e9, 2) AS avg_ms,
        ROUND(SUM_TIMER_WAIT/1e9, 2) AS total_ms,
        ROUND(MAX_TIMER_WAIT/1e9, 2) AS max_ms,
        SUM_ROWS_EXAMINED AS rows_examined,
        SUM_ROWS_SENT AS rows_sent,
        SUM_NO_INDEX_USED AS no_index_count,
        FIRST_SEEN AS first_seen,
        LAST_SEEN AS last_seen
      FROM performance_schema.events_statements_summary_by_digest
      WHERE (? IS NULL OR SCHEMA_NAME = ?)
      ORDER BY ${orderCol} DESC
      LIMIT ${limit}`
    const db = opts?.database || null
    return {
      family,
      checkSql: "SHOW VARIABLES LIKE 'slow_query_log'",
      listSql,
      params: [db, db],
      windowKey: 'slowq.windowSinceStart',
      sourceLabel: 'performance_schema.events_statements_summary_by_digest',
      enableHint:
        "-- MySQL 开启慢日志（仅参考；生产请按 DBA 规范）\nSET GLOBAL slow_query_log = ON;\nSET GLOBAL long_query_time = 1;\n-- 启用 statements summary（默认开启）\nUPDATE performance_schema.setup_consumers SET ENABLED = 'YES' WHERE NAME LIKE 'statements%';",
    }
  }
  if (family === 'pg') {
    const orderCol =
      sort === 'avgMs' ? 'mean_exec_time' : sort === 'execCount' ? 'calls' : 'total_exec_time'
    const listSql = `SELECT
        query AS sql_text,
        calls AS exec_count,
        ROUND(mean_exec_time::numeric, 2) AS avg_ms,
        ROUND(total_exec_time::numeric, 2) AS total_ms,
        ROUND(max_exec_time::numeric, 2) AS max_ms,
        rows AS rows_sent,
        shared_blks_hit,
        shared_blks_read
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY ${orderCol} DESC NULLS LAST
      LIMIT ${limit}`
    return {
      family,
      checkSql: "SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'",
      listSql,
      params: [],
      windowKey: 'slowq.windowSinceStart',
      sourceLabel: 'pg_stat_statements',
      enableHint:
        "-- PostgreSQL 启用 pg_stat_statements\n-- 1) postgresql.conf:\n--    shared_preload_libraries = 'pg_stat_statements'\n-- 2) 重启 PG 后,目标库执行：\nCREATE EXTENSION IF NOT EXISTS pg_stat_statements;",
    }
  }
  return null
}

/** 把方言族行转成统一形态。容错地处理列名大小写差异（PG/MySQL 返回大小写不一致时）。 */
export function normalizeRows(family: SlowFamily, rows: Array<Record<string, unknown>>): SlowRow[] {
  const num = (v: unknown): number => {
    if (v == null || v === '') return 0
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : 0
  }
  const str = (v: unknown): string => (v == null ? '' : String(v))
  // 同一行可能用大写/小写访问;先扁平化一次,key 全转小写。
  const lower = (row: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(row)) out[k.toLowerCase()] = row[k]
    return out
  }
  return rows.map((raw) => {
    const r = lower(raw)
    const base: SlowRow = {
      sqlText: str(r.sql_text),
      execCount: num(r.exec_count),
      avgMs: num(r.avg_ms),
      totalMs: num(r.total_ms),
      maxMs: num(r.max_ms),
      rowsSent: num(r.rows_sent) || undefined,
    }
    if (family === 'mysql') {
      base.rowsExamined = num(r.rows_examined) || undefined
      base.noIndexCount = num(r.no_index_count) || undefined
      base.firstSeen = str(r.first_seen) || undefined
      base.lastSeen = str(r.last_seen) || undefined
    }
    return base
  })
}

/**
 * 给定方言族 + 一条 SQL,返回 EXPLAIN 语句。
 * 对 MySQL 族用 `EXPLAIN <sql>`；PG 族用 `EXPLAIN <sql>`（不开 ANALYZE 避免真的执行写操作）。
 * 已 trim 结尾分号。
 */
export function explainSqlFor(family: SlowFamily, sql: string): string | null {
  const cleaned = sql.trim().replace(/;\s*$/, '')
  if (!cleaned) return null
  if (family === 'mysql' || family === 'pg') return `EXPLAIN ${cleaned}`
  return null
}

/** 判断 checkSql 返回的结果是否说明「已启用」（MySQL 看 Value 列；PG 看是否有行）。 */
export function isEnabled(family: SlowFamily, rows: Array<Record<string, unknown>>): boolean {
  if (family === 'pg') return rows.length > 0
  if (family === 'mysql') {
    // SHOW VARIABLES 返回 { Variable_name, Value }
    if (!rows.length) return true // 取不到也不当成「未启用」（很多托管 MySQL 不暴露此变量,但 digest 表仍可用）
    const row = rows[0]
    if (!row) return true
    const val = Object.entries(row).find(([k]) => k.toLowerCase() === 'value')?.[1]
    if (val == null) return true
    const s = String(val).toLowerCase()
    // 'ON' / '1' 视为启用；'OFF' / '0' 视为未启用,但只是警告,不阻断（digest 表与 slow_log 是两套）
    return s === 'on' || s === '1'
  }
  return false
}
