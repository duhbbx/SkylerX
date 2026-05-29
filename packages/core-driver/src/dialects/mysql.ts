/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type ConnectionConfig,
  type DbDialect,
  type ExecuteOptions,
  MetaNodeKind,
  type MetaScope,
  type MetadataNode,
  type QueryColumn,
  type QueryResult,
  type TestResult,
} from '@db-tool/shared-types'
import { createConnection, createPool } from 'mysql2/promise'
import type {
  ConnectionOptions,
  FieldPacket,
  QueryOptions,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise'
import { type DatabaseDriver, type DriverConnection, driverExtra } from '../driver.js'
import { mysqlFamilyHelpers } from './base.js'

// mysql2 的 Pool/Connection 是 mixin 类型，其 query 方法在 moduleResolution=Bundler
// 下无法被 TS 解析出来。这里只用其纯数据类型，并为我们真正用到的"可查询面"定义
// 一个轻量 facade，再对工厂返回值做断言——比和 mysql2 的 mixin 类型缠斗更稳。
type RawResult = RowDataPacket[] | RowDataPacket[][] | ResultSetHeader | ResultSetHeader[]

interface Queryable {
  query(sql: string | QueryOptions, values?: unknown[]): Promise<[RawResult, FieldPacket[]]>
}
interface PoolLike extends Queryable {
  getConnection(): Promise<PoolConnLike>
  end(): Promise<void>
}
interface PoolConnLike extends Queryable {
  release(): void
  threadId: number
}
interface ConnLike extends Queryable {
  end(): Promise<void>
}

/** 常见 mysql2 字段类型码 → 可读类型名（仅用于结果列展示）。 */
const TYPE_NAMES: Record<number, string> = {
  0: 'DECIMAL',
  1: 'TINYINT',
  2: 'SMALLINT',
  3: 'INT',
  4: 'FLOAT',
  5: 'DOUBLE',
  7: 'TIMESTAMP',
  8: 'BIGINT',
  9: 'MEDIUMINT',
  10: 'DATE',
  11: 'TIME',
  12: 'DATETIME',
  13: 'YEAR',
  15: 'VARCHAR',
  16: 'BIT',
  245: 'JSON',
  246: 'DECIMAL',
  252: 'TEXT',
  253: 'VARCHAR',
  254: 'CHAR',
}

const NOT_NULL_FLAG = 1

function isSelect(sql: string): boolean {
  return /^\s*(select|with)\b/i.test(sql)
}

/** SELECT 设置了 limit 时包子查询做分页（MySQL：LIMIT offset, count）。 */
function applyPaging(sql: string, options?: ExecuteOptions): string {
  if (options?.limit == null || !isSelect(sql)) return sql
  const inner = sql.trim().replace(/;\s*$/, '')
  return `SELECT * FROM (${inner}) AS _pg LIMIT ${options.offset ?? 0}, ${options.limit}`
}

function typeName(code?: number): string {
  if (code === undefined) return 'UNKNOWN'
  return TYPE_NAMES[code] ?? `TYPE_${code}`
}

function mapColumns(fields?: FieldPacket[]): QueryColumn[] {
  if (!fields) return []
  return fields.map((f) => ({
    name: f.name,
    dataType: typeName(f.type),
    nullable: typeof f.flags === 'number' ? (f.flags & NOT_NULL_FLAG) === 0 : undefined,
  }))
}

function buildConnectionOptions(config: ConnectionConfig): ConnectionOptions {
  const ssl = config.ssl?.enabled
    ? {
        rejectUnauthorized: config.ssl.rejectUnauthorized ?? true,
        ca: config.ssl.ca,
        cert: config.ssl.cert,
        key: config.ssl.key,
      }
    : undefined
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database || undefined,
    ssl,
    // 让 DATE/DATETIME 以字符串返回，避免时区漂移
    dateStrings: true,
    connectTimeout: 10_000,
    // 只透传已剥离应用层元数据（env/readOnly/...）的安全 extra；
    // 否则 mysql2 会对未知配置项报 invalid configuration option，将来还会升级为 throw。
    ...((driverExtra(config) as ConnectionOptions | undefined) ?? {}),
  }
}

class MysqlConnection implements DriverConnection {
  private activeThreadId: number | null = null
  /** 手动提交模式下钉住的 PoolConnLike：sessionId → conn */
  private readonly sessions = new Map<string, PoolConnLike>()
  private sessionSeq = 0
  /**
   * 用户上一次成功的 `USE xxx` 目标库，持久化在驱动实例上。
   * 因为 mysql2 是连接池：每次 execute() 从池里随机拿一条连接，`USE` 在原生协议里
   * 是「当前连接级别」的状态——release 回池后，下一次 execute() 拿到的可能是另一条
   * 仍指向初始 database 的连接。如果不缓存重放，用户写「USE x; SELECT…」会一半看不见表。
   * 这里在每次 execute 前重放，并在用户 SQL 成功后检测捕获新的 USE。
   */
  private currentDb: string | null = null

  constructor(private readonly pool: PoolLike) {}

  /**
   * 提取 SQL 是否是「单语句 USE xxx」，是则返回目标库名（去掉转义），否则 null。
   * 支持 `USE x` / `` USE `x` `` / `USE "x"`，允许 trailing 分号与空白。
   * 多语句已由上层 sqlSplit 拆开，单条 execute 只会看到一句。
   */
  private extractUseTarget(sql: string): string | null {
    const m = /^\s*use\s+(?:`([^`]+)`|"([^"]+)"|([A-Za-z0-9_$]+))\s*;?\s*$/i.exec(sql)
    if (!m) return null
    return m[1] || m[2] || m[3] || null
  }

  async execute(
    sql: string,
    params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const conn = await this.pool.getConnection()
    this.activeThreadId = conn.threadId
    const start = Date.now()
    try {
      // 优先 options 指定，其次回放缓存的 currentDb。两者都没就保持连接初始库。
      const useDb = options?.database ?? options?.schema ?? this.currentDb ?? undefined
      if (useDb) {
        await conn.query(`USE ${mysqlFamilyHelpers.quoteIdentifier(useDb)}`)
      }
      const queryOptions: QueryOptions = { sql: applyPaging(sql, options), values: params }
      if (options?.timeoutMs) queryOptions.timeout = options.timeoutMs

      const [raw, fields] = await conn.query(queryOptions)
      // 用户 SQL 成功执行——若是 USE xxx 则把目标库记下来，下次 execute 自动续上
      const useTarget = this.extractUseTarget(sql)
      if (useTarget) this.currentDb = useTarget
      const executionTimeMs = Date.now() - start

      if (Array.isArray(raw)) {
        const all = raw as RowDataPacket[]
        const max = options?.maxRows
        const truncated = typeof max === 'number' && all.length > max
        const rows = truncated ? all.slice(0, max) : all
        return {
          columns: mapColumns(fields),
          rows: rows as Array<Record<string, unknown>>,
          rowCount: rows.length,
          executionTimeMs,
          truncated,
        }
      }

      const header = raw as ResultSetHeader
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: header.affectedRows,
        executionTimeMs,
      }
    } finally {
      this.activeThreadId = null
      conn.release()
    }
  }

  async cancelActive(): Promise<void> {
    const tid = this.activeThreadId
    if (tid == null) return
    const conn = await this.pool.getConnection()
    try {
      await conn.query(`KILL QUERY ${tid}`)
    } catch {
      /* 查询可能已结束，忽略 */
    } finally {
      conn.release()
    }
  }

  // MySQL 系树形（Navicat 式，无独立 schema 层，库即 schema）：
  //   Connection → Database → Group(表/视图/函数/过程, 带计数) → Table/View
  //                  → Group(列/索引/键, 带计数) → Column/Index/Key
  async fetchMetadata(scope: MetaScope): Promise<MetadataNode[]> {
    switch (scope.parentKind) {
      case MetaNodeKind.Connection:
        return this.listDatabases()
      case MetaNodeKind.Database:
        return this.databaseGroups(scope.path[0])
      case MetaNodeKind.Group:
        return this.listGroupObjects(scope.path, scope.group)
      case MetaNodeKind.Table:
      case MetaNodeKind.View:
        return this.tableSubGroups(scope.path[0], scope.path[1])
      default:
        return []
    }
  }

  private async scalar(sql: string, params: unknown[]): Promise<number> {
    const [raw] = await this.pool.query(sql, params)
    const rows = raw as RowDataPacket[]
    return Number(rows[0]?.c ?? 0)
  }

  private async listDatabases(): Promise<MetadataNode[]> {
    const [raw] = await this.pool.query(
      'SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name',
    )
    return (raw as RowDataPacket[]).map((r) => ({
      kind: MetaNodeKind.Database,
      name: String(r.name),
      path: [String(r.name)],
      hasChildren: true,
    }))
  }

  private async databaseGroups(db: string): Promise<MetadataNode[]> {
    const [tables, views, funcs, procs, events] = await Promise.all([
      this.scalar(
        "SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE'",
        [db],
      ),
      this.scalar('SELECT COUNT(*) c FROM information_schema.views WHERE table_schema=?', [db]),
      this.scalar(
        "SELECT COUNT(*) c FROM information_schema.routines WHERE routine_schema=? AND routine_type='FUNCTION'",
        [db],
      ),
      this.scalar(
        "SELECT COUNT(*) c FROM information_schema.routines WHERE routine_schema=? AND routine_type='PROCEDURE'",
        [db],
      ),
      this.scalar('SELECT COUNT(*) c FROM information_schema.events WHERE event_schema=?', [db]),
    ])
    return [
      {
        kind: MetaNodeKind.Group,
        name: '表',
        path: [db],
        group: 'tables',
        hasChildren: true,
        count: tables,
      },
      {
        kind: MetaNodeKind.Group,
        name: '视图',
        path: [db],
        group: 'views',
        hasChildren: true,
        count: views,
      },
      {
        kind: MetaNodeKind.Group,
        name: '函数',
        path: [db],
        group: 'functions',
        hasChildren: true,
        count: funcs,
      },
      {
        kind: MetaNodeKind.Group,
        name: '存储过程',
        path: [db],
        group: 'procedures',
        hasChildren: true,
        count: procs,
      },
      {
        kind: MetaNodeKind.Group,
        name: '事件',
        path: [db],
        group: 'events',
        hasChildren: true,
        count: events,
      },
    ]
  }

  private async tableSubGroups(db: string, table: string): Promise<MetadataNode[]> {
    const [cols, idx, keys, trgs] = await Promise.all([
      this.scalar(
        'SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema=? AND table_name=?',
        [db, table],
      ),
      this.scalar(
        'SELECT COUNT(DISTINCT index_name) c FROM information_schema.statistics WHERE table_schema=? AND table_name=?',
        [db, table],
      ),
      this.scalar(
        'SELECT COUNT(*) c FROM information_schema.table_constraints WHERE table_schema=? AND table_name=?',
        [db, table],
      ),
      this.scalar(
        'SELECT COUNT(*) c FROM information_schema.triggers WHERE trigger_schema=? AND event_object_table=?',
        [db, table],
      ),
    ])
    const p = [db, table]
    return [
      {
        kind: MetaNodeKind.Group,
        name: '列',
        path: p,
        group: 'columns',
        hasChildren: true,
        count: cols,
      },
      {
        kind: MetaNodeKind.Group,
        name: '索引',
        path: p,
        group: 'indexes',
        hasChildren: true,
        count: idx,
      },
      {
        kind: MetaNodeKind.Group,
        name: '键',
        path: p,
        group: 'keys',
        hasChildren: true,
        count: keys,
      },
      {
        kind: MetaNodeKind.Group,
        name: '触发器',
        path: p,
        group: 'triggers',
        hasChildren: true,
        count: trgs,
      },
    ]
  }

  private async listGroupObjects(path: string[], group?: string): Promise<MetadataNode[]> {
    const q = mysqlFamilyHelpers.quoteIdentifier
    const db = path[0]
    switch (group) {
      case 'tables':
      case 'views': {
        const wanted = group === 'views' ? 'VIEW' : 'BASE TABLE'
        const [raw] = await this.pool.query(
          'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = ? ORDER BY table_name',
          [db, wanted],
        )
        return (raw as RowDataPacket[]).map((r) => ({
          kind: group === 'views' ? MetaNodeKind.View : MetaNodeKind.Table,
          name: String(r.name),
          path: [db, String(r.name)],
          hasChildren: true,
          sqlName: `${q(db)}.${q(String(r.name))}`,
        }))
      }
      case 'functions':
      case 'procedures': {
        const routineType = group === 'functions' ? 'FUNCTION' : 'PROCEDURE'
        const [raw] = await this.pool.query(
          'SELECT routine_name AS name FROM information_schema.routines WHERE routine_schema = ? AND routine_type = ? ORDER BY routine_name',
          [db, routineType],
        )
        return (raw as RowDataPacket[]).map((r) => ({
          kind: group === 'functions' ? MetaNodeKind.Function : MetaNodeKind.Procedure,
          name: String(r.name),
          path: [db, String(r.name)],
          hasChildren: false,
        }))
      }
      case 'triggers': {
        // 表级：path=[db, table]
        const [raw] = await this.pool.query(
          'SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema=? AND event_object_table=? ORDER BY trigger_name',
          [db, path[1]],
        )
        return (raw as RowDataPacket[]).map((r) => ({
          kind: MetaNodeKind.Trigger,
          name: String(r.name),
          path: [...path, String(r.name)],
          hasChildren: false,
        }))
      }
      case 'events': {
        const [raw] = await this.pool.query(
          'SELECT event_name AS name FROM information_schema.events WHERE event_schema=? ORDER BY event_name',
          [db],
        )
        return (raw as RowDataPacket[]).map((r) => ({
          kind: MetaNodeKind.Event,
          name: String(r.name),
          path: [db, String(r.name)],
          hasChildren: false,
        }))
      }
      case 'columns':
        return this.listColumns(db, path[1])
      case 'indexes': {
        const [raw] = await this.pool.query(
          'SELECT DISTINCT index_name AS name FROM information_schema.statistics WHERE table_schema=? AND table_name=? ORDER BY index_name',
          [db, path[1]],
        )
        return (raw as RowDataPacket[]).map((r) => ({
          kind: MetaNodeKind.Index,
          name: String(r.name),
          path: [...path, String(r.name)],
          hasChildren: false,
        }))
      }
      case 'keys': {
        const [raw] = await this.pool.query(
          'SELECT constraint_name AS name, constraint_type AS t FROM information_schema.table_constraints WHERE table_schema=? AND table_name=? ORDER BY constraint_name',
          [db, path[1]],
        )
        return (raw as RowDataPacket[]).map((r) => ({
          kind: MetaNodeKind.Index,
          name: `${String(r.name)} (${String(r.t)})`,
          path: [...path, String(r.name)],
          hasChildren: false,
        }))
      }
      default:
        return []
    }
  }

  private async listColumns(db: string, table: string): Promise<MetadataNode[]> {
    const [raw] = await this.pool.query(
      `SELECT column_name AS name, column_type AS dataType, is_nullable AS isNullable,
              column_key AS columnKey, column_default AS defaultValue, column_comment AS comment
         FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position`,
      [db, table],
    )
    return (raw as RowDataPacket[]).map((r) => ({
      kind: MetaNodeKind.Column,
      name: String(r.name),
      path: [db, table, String(r.name)],
      hasChildren: false,
      detail: {
        dataType: String(r.dataType),
        nullable: r.isNullable === 'YES',
        primaryKey: r.columnKey === 'PRI',
        defaultValue: r.defaultValue ?? null,
        comment: r.comment ? String(r.comment) : undefined,
      },
    }))
  }

  async executeBatch(statements: string[], options?: ExecuteOptions): Promise<void> {
    const conn = await this.pool.getConnection()
    try {
      const useDb = options?.database ?? options?.schema ?? this.currentDb ?? undefined
      if (useDb) await conn.query(`USE ${mysqlFamilyHelpers.quoteIdentifier(useDb)}`)
      await conn.query('START TRANSACTION')
      try {
        for (const s of statements) {
          await conn.query(s)
          // 批中遇到 USE xxx 持续更新缓存，让批后续语句 + 后续 execute 都看得见
          const useTarget = this.extractUseTarget(s)
          if (useTarget) this.currentDb = useTarget
        }
        await conn.query('COMMIT')
      } catch (e) {
        await conn.query('ROLLBACK')
        throw e
      }
    } finally {
      conn.release()
    }
  }

  // ── 手动提交会话 ─────────────────────────────────────────────────
  // 一个 session 钉一条 PoolConnLike，期间 START TRANSACTION → 执行 → COMMIT/ROLLBACK
  // → 再 START TRANSACTION（让用户继续编辑无需再 begin）。endSession 才真正 release。
  async beginSession(options?: ExecuteOptions): Promise<string> {
    const conn = await this.pool.getConnection()
    try {
      // session 起手也回放 currentDb：用户已经 USE 过的库不希望开 session 后又回到初始库
      const useDb = options?.database ?? options?.schema ?? this.currentDb ?? undefined
      if (useDb) await conn.query(`USE ${mysqlFamilyHelpers.quoteIdentifier(useDb)}`)
      await conn.query('START TRANSACTION')
    } catch (e) {
      conn.release()
      throw e
    }
    const sid = `mysql-s${++this.sessionSeq}-${Date.now()}`
    this.sessions.set(sid, conn)
    return sid
  }

  async executeInSession(
    sessionId: string,
    sql: string,
    params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const conn = this.sessions.get(sessionId)
    if (!conn) throw new Error('SESSION_NOT_FOUND')
    // 注意：session 期间用户自己 USE xxx 只作用于这条钉住的连接（mysql2 协议级），
    // 不同步到 driver.currentDb——避免「在 session 里临时切库」污染 session 之外的 execute。
    // 这是有意为之的隔离：session 是局部上下文（事务 + 临时切库），结束后回到原状态。
    const start = Date.now()
    const queryOptions: QueryOptions = { sql: applyPaging(sql, options), values: params }
    if (options?.timeoutMs) queryOptions.timeout = options.timeoutMs
    const [raw, fields] = await conn.query(queryOptions)
    const executionTimeMs = Date.now() - start
    if (Array.isArray(raw)) {
      const all = raw as RowDataPacket[]
      const max = options?.maxRows
      const truncated = typeof max === 'number' && all.length > max
      const rows = truncated ? all.slice(0, max) : all
      return {
        columns: mapColumns(fields),
        rows: rows as Array<Record<string, unknown>>,
        rowCount: rows.length,
        executionTimeMs,
        truncated,
      }
    }
    const header = raw as ResultSetHeader
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      affectedRows: header.affectedRows,
      executionTimeMs,
    }
  }

  async commitSession(sessionId: string): Promise<void> {
    const conn = this.sessions.get(sessionId)
    if (!conn) throw new Error('SESSION_NOT_FOUND')
    await conn.query('COMMIT')
    await conn.query('START TRANSACTION') // 自动开下一段
  }

  async rollbackSession(sessionId: string): Promise<void> {
    const conn = this.sessions.get(sessionId)
    if (!conn) throw new Error('SESSION_NOT_FOUND')
    await conn.query('ROLLBACK')
    await conn.query('START TRANSACTION')
  }

  async endSession(sessionId: string): Promise<void> {
    const conn = this.sessions.get(sessionId)
    if (!conn) return // 幂等
    this.sessions.delete(sessionId)
    // 未显式 commit 的事务视为放弃 → ROLLBACK 然后归还
    try {
      await conn.query('ROLLBACK')
    } catch {
      /* 已经被外部提交/回滚也无所谓 */
    }
    conn.release()
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

/**
 * 取服务端版本(best-effort):优先 MySQL 风格的 `VERSION()`,失败回退 OceanBase Oracle 租户 / Oracle 风格。
 * 都失败返 undefined(不阻断连接判定)。
 */
async function detectMysqlFamilyVersion(conn: ConnLike): Promise<string | undefined> {
  // MySQL / MariaDB / TiDB / Doris / StarRocks / OB MySQL 租户:VERSION() 都返回字符串
  try {
    const [raw] = await conn.query('SELECT VERSION() AS server_version')
    const v = (raw as RowDataPacket[])[0]?.server_version
    if (v) return String(v)
  } catch {
    /* fallthrough */
  }
  // OceanBase Oracle 租户:用 Oracle 风格的 v$version
  try {
    const [raw] = await conn.query('SELECT BANNER AS server_version FROM v$version WHERE ROWNUM = 1')
    const v = (raw as RowDataPacket[])[0]?.server_version
    if (v) return String(v)
  } catch {
    /* fallthrough */
  }
  return undefined
}

/**
 * 构建 MySQL 系驱动（MySQL / MariaDB / OceanBase 共用同一实现，仅 dialect 标识不同）。
 */
export function createMysqlFamilyDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: mysqlFamilyHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const raw = createPool({
        ...buildConnectionOptions(config),
        connectionLimit: 5,
        waitForConnections: true,
      })
      // 池内连接异常兜底，避免未处理错误导致主进程崩溃
      ;(raw as unknown as { on(e: string, cb: (err: Error) => void): void }).on('error', (err) =>
        console.error('[mysql] pool error:', err.message),
      )
      return new MysqlConnection(raw as unknown as PoolLike)
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      let conn: ConnLike | undefined
      try {
        conn = (await createConnection(buildConnectionOptions(config))) as unknown as ConnLike
        // 探活:`SELECT 1 FROM DUAL` 在 MySQL / MariaDB / OB MySQL租户 / OB Oracle租户 / TiDB / Doris / StarRocks 都支持。
        // 早期版本用 `SELECT VERSION() AS v` 在 OceanBase Oracle 租户报 ORA-00900(无 VERSION() 函数,且单字符
        // 别名 `v` 与 v$xxx 系统视图易冲突)。
        await conn.query('SELECT 1 FROM DUAL')
        // 取版本:best-effort,失败不影响连接成功判定。优先 MySQL 风格,失败回退 OB Oracle 风格。
        const serverVersion = await detectMysqlFamilyVersion(conn)
        return { ok: true, serverVersion, latencyMs: Date.now() - start }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      } finally {
        await conn?.end()
      }
    },
  }
}
