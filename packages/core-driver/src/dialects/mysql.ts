import {
  type ConnectionConfig,
  DbDialect,
  type ExecuteOptions,
  type MetadataNode,
  MetaNodeKind,
  type MetaScope,
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
import type { DatabaseDriver, DriverConnection } from '../driver.js'
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
    ...((config.extra as ConnectionOptions) ?? {}),
  }
}

class MysqlConnection implements DriverConnection {
  private activeThreadId: number | null = null

  constructor(private readonly pool: PoolLike) {}

  async execute(
    sql: string,
    params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const conn = await this.pool.getConnection()
    this.activeThreadId = conn.threadId
    const start = Date.now()
    try {
      const useDb = options?.database ?? options?.schema
      if (useDb) {
        await conn.query(`USE ${mysqlFamilyHelpers.quoteIdentifier(useDb)}`)
      }
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
      { kind: MetaNodeKind.Group, name: '表', path: [db], group: 'tables', hasChildren: true, count: tables },
      { kind: MetaNodeKind.Group, name: '视图', path: [db], group: 'views', hasChildren: true, count: views },
      { kind: MetaNodeKind.Group, name: '函数', path: [db], group: 'functions', hasChildren: true, count: funcs },
      { kind: MetaNodeKind.Group, name: '存储过程', path: [db], group: 'procedures', hasChildren: true, count: procs },
      { kind: MetaNodeKind.Group, name: '事件', path: [db], group: 'events', hasChildren: true, count: events },
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
      { kind: MetaNodeKind.Group, name: '列', path: p, group: 'columns', hasChildren: true, count: cols },
      { kind: MetaNodeKind.Group, name: '索引', path: p, group: 'indexes', hasChildren: true, count: idx },
      { kind: MetaNodeKind.Group, name: '键', path: p, group: 'keys', hasChildren: true, count: keys },
      { kind: MetaNodeKind.Group, name: '触发器', path: p, group: 'triggers', hasChildren: true, count: trgs },
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
      const useDb = options?.database ?? options?.schema
      if (useDb) await conn.query(`USE ${mysqlFamilyHelpers.quoteIdentifier(useDb)}`)
      await conn.query('START TRANSACTION')
      try {
        for (const s of statements) await conn.query(s)
        await conn.query('COMMIT')
      } catch (e) {
        await conn.query('ROLLBACK')
        throw e
      }
    } finally {
      conn.release()
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
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
        const [raw] = await conn.query('SELECT VERSION() AS v')
        const rows = raw as RowDataPacket[]
        return {
          ok: true,
          serverVersion: rows[0]?.v ? String(rows[0].v) : undefined,
          latencyMs: Date.now() - start,
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      } finally {
        await conn?.end()
      }
    },
  }
}
