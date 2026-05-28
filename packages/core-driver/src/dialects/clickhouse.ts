import {
  type ConnectionConfig,
  type DbDialect,
  type ExecuteOptions,
  type MetadataNode,
  MetaNodeKind,
  type MetaScope,
  type QueryColumn,
  type QueryResult,
  type TestResult,
} from '@db-tool/shared-types'
import { type DatabaseDriver, type DriverConnection, driverExtra, type SqlDialectHelpers } from '../driver.js'

/**
 * @clickhouse/client 是可选 peerDep，惰性加载：core-driver 加载不依赖它，
 * 仅连接时按需 import。用非字面量 specifier，避免未安装时编译期报"找不到模块"。
 */
async function loadClickhouseClient(): Promise<{ createClient: (opts: ClickhouseClientOptions) => ClickhouseClient }> {
  const spec: string = '@clickhouse/client'
  try {
    const mod: any = await import(spec)
    const createClient = mod.createClient ?? mod.default?.createClient
    if (typeof createClient !== 'function') {
      throw new Error('createClient export missing')
    }
    return { createClient }
  } catch {
    throw new Error(
      'ClickHouse 驱动未安装：请在部署环境 `pnpm add @clickhouse/client`（HTTP 客户端，无原生依赖）。',
    )
  }
}

// ── 客户端最小 facade（避免直接依赖 @clickhouse/client 类型） ────────────────
interface ClickhouseClientOptions {
  url?: string
  username?: string
  password?: string
  database?: string
  [k: string]: unknown
}
interface ClickhouseQueryResult {
  json<T = unknown>(): Promise<T>
}
interface ClickhouseClient {
  query(params: { query: string; format?: string; query_params?: Record<string, unknown> }): Promise<ClickhouseQueryResult>
  command(params: { query: string }): Promise<unknown>
  ping(): Promise<{ success: boolean } | boolean | unknown>
  close(): Promise<void>
}

// ── SQL 助手 ─────────────────────────────────────────────────────────────────
const clickhouseHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => `\`${name.replace(/`/g, '``')}\``,
  paginate: (sql, limit, offset) =>
    `${sql.trim().replace(/;\s*$/, '')} LIMIT ${limit} OFFSET ${offset}`,
}

function isSelect(sql: string): boolean {
  return /^\s*(select|with|describe|desc|show|explain)\b/i.test(sql)
}

function applyPaging(sql: string, options?: ExecuteOptions): string {
  if (options?.limit == null || !isSelect(sql)) return sql
  return clickhouseHelpers.paginate(sql, options.limit, options.offset ?? 0)
}

function buildUrl(config: ConnectionConfig): string {
  const fromExtra = config.extra?.url
  if (typeof fromExtra === 'string' && fromExtra.length > 0) return fromExtra
  const proto = config.ssl?.enabled ? 'https' : 'http'
  const host = config.host || 'localhost'
  const port = config.port || (config.ssl?.enabled ? 8443 : 8123)
  return `${proto}://${host}:${port}`
}

/** 系统库默认隐藏；用户可在 extra.showSystemDatabases = true 显示。 */
const SYSTEM_DATABASES = new Set(['system', 'information_schema', 'INFORMATION_SCHEMA'])

class ClickhouseConnection implements DriverConnection {
  constructor(private readonly client: ClickhouseClient) {}

  async execute(
    sql: string,
    _params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    // 说明：ClickHouse 客户端使用 *命名* 参数（query_params: {name: value}），
    // 与上层"位置占位 + 数组 params"的契约不一致。此处先不支持 params，
    // 上层目前也没有 ClickHouse 专用参数路径；待引入命名占位语义后再放开。
    const start = Date.now()
    const finalSql = applyPaging(sql, options)

    if (isSelect(sql)) {
      const rs = await this.client.query({ query: finalSql, format: 'JSON' })
      const payload = (await rs.json<ClickhouseJsonPayload>()) ?? { meta: [], data: [] }
      const executionTimeMs = Date.now() - start
      const columns: QueryColumn[] = (payload.meta ?? []).map((m) => ({
        name: m.name,
        dataType: m.type,
        nullable: typeof m.type === 'string' && /^Nullable\(/i.test(m.type),
      }))
      const all = (payload.data ?? []) as Array<Record<string, unknown>>
      const max = options?.maxRows
      const truncated = typeof max === 'number' && all.length > max
      const rows = truncated ? all.slice(0, max) : all
      return { columns, rows, rowCount: rows.length, executionTimeMs, truncated }
    }

    // 非 SELECT：DDL / INSERT / ALTER / OPTIMIZE / ...
    // ClickHouse 在 HTTP 协议下通常不返回 affectedRows（除非走 X-ClickHouse-Summary
    // header 解析；本期不做），统一为 undefined。
    await this.client.command({ query: finalSql })
    const executionTimeMs = Date.now() - start
    return { columns: [], rows: [], rowCount: 0, affectedRows: undefined, executionTimeMs }
  }

  /**
   * ClickHouse 不支持跨语句事务（实验性 EXPERIMENTAL_TRANSACTIONS 仅作用于 MergeTree，
   * 默认关闭，且不跨连接）。此实现仅"串行执行";任何一条失败立即抛，
   * 已执行的语句**无法回滚**。调用方需在业务上自行幂等/补偿。
   */
  async executeBatch(statements: string[]): Promise<void> {
    for (const s of statements) {
      await this.client.command({ query: s })
    }
  }

  // ClickHouse 树形（无独立 schema 层，库即顶层）：
  //   Connection → Database → Group(表/视图, 带计数) → Table/View
  //                  → Group(列, 带计数) → Column
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

  private async q<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const rs = await this.client.query({ query: sql, format: 'JSONEachRow' })
    return (await rs.json<T[]>()) ?? []
  }

  private async scalar(sql: string): Promise<number> {
    const rows = await this.q<{ c?: number | string }>(sql)
    return Number(rows[0]?.c ?? 0)
  }

  private static esc(literal: string): string {
    // ClickHouse 字符串字面量转义：单引号 → \'，反斜杠 → \\
    return literal.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  }

  private async listDatabases(): Promise<MetadataNode[]> {
    const rows = await this.q<{ name: string }>(
      'SELECT name FROM system.databases ORDER BY name',
    )
    return rows
      .filter((r) => this.showSystem || !SYSTEM_DATABASES.has(String(r.name)))
      .map((r) => ({
        kind: MetaNodeKind.Database,
        name: String(r.name),
        path: [String(r.name)],
        hasChildren: true,
      }))
  }

  /** 由 connect 时回填，决定是否在导航中暴露 system / information_schema 库。 */
  showSystem = false

  private async databaseGroups(db: string): Promise<MetadataNode[]> {
    const dbLit = `'${ClickhouseConnection.esc(db)}'`
    const [tables, views] = await Promise.all([
      this.scalar(
        `SELECT count() AS c FROM system.tables WHERE database = ${dbLit} AND engine NOT LIKE '%View%'`,
      ),
      this.scalar(
        `SELECT count() AS c FROM system.tables WHERE database = ${dbLit} AND engine LIKE '%View%'`,
      ),
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
    ]
  }

  private async tableSubGroups(db: string, table: string): Promise<MetadataNode[]> {
    const dbLit = `'${ClickhouseConnection.esc(db)}'`
    const tblLit = `'${ClickhouseConnection.esc(table)}'`
    const cols = await this.scalar(
      `SELECT count() AS c FROM system.columns WHERE database = ${dbLit} AND table = ${tblLit}`,
    )
    return [
      {
        kind: MetaNodeKind.Group,
        name: '列',
        path: [db, table],
        group: 'columns',
        hasChildren: true,
        count: cols,
      },
    ]
  }

  private async listGroupObjects(path: string[], group?: string): Promise<MetadataNode[]> {
    const q = clickhouseHelpers.quoteIdentifier
    const db = path[0]
    const dbLit = `'${ClickhouseConnection.esc(db)}'`
    switch (group) {
      case 'tables': {
        const rows = await this.q<{ name: string }>(
          `SELECT name FROM system.tables WHERE database = ${dbLit} AND engine NOT LIKE '%View%' ORDER BY name`,
        )
        return rows.map((r) => ({
          kind: MetaNodeKind.Table,
          name: String(r.name),
          path: [db, String(r.name)],
          hasChildren: true,
          sqlName: `${q(db)}.${q(String(r.name))}`,
        }))
      }
      case 'views': {
        const rows = await this.q<{ name: string }>(
          `SELECT name FROM system.tables WHERE database = ${dbLit} AND engine LIKE '%View%' ORDER BY name`,
        )
        return rows.map((r) => ({
          kind: MetaNodeKind.View,
          name: String(r.name),
          path: [db, String(r.name)],
          hasChildren: true,
          sqlName: `${q(db)}.${q(String(r.name))}`,
        }))
      }
      case 'columns': {
        const tblLit = `'${ClickhouseConnection.esc(path[1])}'`
        const rows = await this.q<{
          name: string
          type: string
          is_nullable: number | string
          default_expression: string | null
          is_in_primary_key: number | string
        }>(
          `SELECT name, type,
                  (type LIKE 'Nullable(%') AS is_nullable,
                  default_expression,
                  is_in_primary_key
             FROM system.columns
            WHERE database = ${dbLit} AND table = ${tblLit}
            ORDER BY position`,
        )
        return rows.map((r) => ({
          kind: MetaNodeKind.Column,
          name: String(r.name),
          path: [db, path[1], String(r.name)],
          hasChildren: false,
          detail: {
            dataType: String(r.type),
            nullable: Number(r.is_nullable) === 1,
            primaryKey: Number(r.is_in_primary_key) === 1,
            defaultValue: r.default_expression ? String(r.default_expression) : null,
          },
        }))
      }
      default:
        return []
    }
  }

  async ping(): Promise<void> {
    const r = (await this.client.ping()) as { success?: boolean } | boolean
    const ok = typeof r === 'boolean' ? r : r?.success !== false
    if (!ok) throw new Error('ClickHouse ping failed')
  }

  async close(): Promise<void> {
    await this.client.close()
  }
}

interface ClickhouseJsonPayload {
  meta?: Array<{ name: string; type: string }>
  data?: Array<Record<string, unknown>>
  rows?: number
  statistics?: unknown
}

function buildClientOptions(config: ConnectionConfig): ClickhouseClientOptions {
  // driverExtra 已剥离 env/readOnly/agentId/commitMode 等应用层字段；
  // 此外再剥掉 url / showSystemDatabases —— 它们由我们自管，不该透传给底层。
  const extra = driverExtra(config) ?? {}
  const { url: _url, showSystemDatabases: _shown, ...passthrough } = extra as Record<string, unknown>
  return {
    url: buildUrl(config),
    username: config.user || 'default',
    password: config.password ?? '',
    database: config.database || 'default',
    ...passthrough,
  }
}

export function createClickhouseDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: clickhouseHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const { createClient } = await loadClickhouseClient()
      const client = createClient(buildClientOptions(config))
      const conn = new ClickhouseConnection(client)
      conn.showSystem = Boolean(config.extra?.showSystemDatabases)
      return conn
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      const { createClient } = await loadClickhouseClient()
      const client = createClient(buildClientOptions(config))
      try {
        const pingRes = (await client.ping()) as { success?: boolean } | boolean
        const ok = typeof pingRes === 'boolean' ? pingRes : pingRes?.success !== false
        if (!ok) return { ok: false, message: 'ClickHouse ping failed' }
        const rs = await client.query({ query: 'SELECT version() AS v', format: 'JSONEachRow' })
        const rows = (await rs.json<Array<{ v?: string }>>()) ?? []
        return {
          ok: true,
          serverVersion: rows[0]?.v ? String(rows[0].v) : undefined,
          latencyMs: Date.now() - start,
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      } finally {
        try {
          await client.close()
        } catch {
          /* ignore */
        }
      }
    },
  }
}
