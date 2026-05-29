/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
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
import type { DatabaseDriver, DriverConnection, SqlDialectHelpers } from '../driver.js'

/**
 * @tdengine/websocket 是可选 peerDep（仅在桌面端 / 部署环境需要时安装），
 * 惰性加载：core-driver 加载不依赖它，仅连接时按需 import。
 * 用非字面量 specifier，避免未安装时编译期报"找不到模块"。
 */
async function loadTDengine(): Promise<any> {
  const spec: string = '@tdengine/websocket'
  try {
    const mod: any = await import(spec)
    return mod.default ?? mod
  } catch {
    throw new Error(
      'TDengine 驱动未安装：请在部署环境 `pnpm add @tdengine/websocket`（WebSocket 客户端，无原生依赖，需 TDengine 3.3.2.0+）。',
    )
  }
}

const tdengineHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => `\`${name.replace(/`/g, '``')}\``,
  paginate: (sql, limit, offset) =>
    `${sql.trim().replace(/;\s*$/, '')} LIMIT ${limit} OFFSET ${offset}`,
}

function isSelect(sql: string): boolean {
  return /^\s*(select|show|describe|desc)\b/i.test(sql)
}

function applyPaging(sql: string, options?: ExecuteOptions): string {
  if (options?.limit == null || !isSelect(sql)) return sql
  return tdengineHelpers.paginate(sql, options.limit, options.offset ?? 0)
}

function buildUrl(config: ConnectionConfig): string {
  const fromExtra = config.extra?.url
  if (typeof fromExtra === 'string' && fromExtra.length > 0) return fromExtra
  const host = config.host || 'localhost'
  const port = config.port || 6041
  const proto = config.ssl?.enabled ? 'wss' : 'ws'
  return `${proto}://${host}:${port}`
}

/** 构造一个已开启 / 已登录的 WsSql 实例（不绑定库时不调 setDb）。 */
async function openWs(config: ConnectionConfig, withDb: boolean): Promise<any> {
  const td = await loadTDengine()
  const WSConfig = td.WSConfig
  const WsSql = td.WsSql
  if (!WSConfig || !WsSql) {
    throw new Error('TDengine 驱动加载失败：缺少 WSConfig / WsSql 导出（版本不兼容?）')
  }
  const conf = new WSConfig(buildUrl(config))
  if (config.user) conf.setUser(config.user)
  if (config.password) conf.setPwd(config.password)
  if (withDb && config.database) conf.setDb(config.database)
  return await WsSql.open(conf)
}

/** 系统库默认隐藏；用户可在 extra.showSystemDatabases = true 显示。 */
const SYSTEM_DATABASES = new Set(['information_schema', 'performance_schema'])

/** 从 TaosResult 提取列 / 行（getMeta 返回 {name, type, length}，type 已是字符串）。 */
function toQueryResult(ts: any, executionTimeMs: number, options?: ExecuteOptions): QueryResult {
  const meta: Array<{ name: string; type: string; length: number }> =
    (typeof ts?.getMeta === 'function' ? ts.getMeta() : null) ?? []
  const columns: QueryColumn[] = meta.map((m) => ({
    name: String(m.name),
    dataType: String(m.type ?? 'unknown'),
  }))
  const raw: Array<any[]> = (typeof ts?.getData === 'function' ? ts.getData() : null) ?? []
  const all: Array<Record<string, unknown>> = raw.map((row) => {
    const rec: Record<string, unknown> = {}
    for (let i = 0; i < columns.length; i++) {
      rec[columns[i].name] = row[i]
    }
    return rec
  })
  const max = options?.maxRows
  const truncated = typeof max === 'number' && all.length > max
  const rows = truncated ? all.slice(0, max) : all
  return { columns, rows, rowCount: rows.length, executionTimeMs, truncated }
}

class TDengineConnection implements DriverConnection {
  /** 连接级 ws,connect 时通常绑了默认库。元数据查询走全库限定名,可复用。 */
  constructor(private readonly ws: any) {}

  showSystem = false

  async execute(
    sql: string,
    _params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    // TAOS SQL 不走位置参数(没有 ? 占位);params 暂忽略,签名保留以满足契约。
    const start = Date.now()
    const finalSql = applyPaging(sql, options)
    const ts = await this.ws.exec(finalSql)
    const executionTimeMs = Date.now() - start

    if (isSelect(sql)) {
      return toQueryResult(ts, executionTimeMs, options)
    }
    const affected =
      typeof ts?.getAffectRows === 'function' ? (ts.getAffectRows() ?? 0) : 0
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      affectedRows: Number(affected) || 0,
      executionTimeMs,
    }
  }

  // TDengine 树形(无独立 schema 层,数据库下分超级表 / 普通表):
  //   Connection → Database → Group(stables / tables, 带计数) → Table → Group(列) → Column
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

  /** 跑一条 SELECT,按列名转 records(复用 toQueryResult 的列对齐)。 */
  private async q(sql: string): Promise<Array<Record<string, unknown>>> {
    const ts = await this.ws.exec(sql)
    return toQueryResult(ts, 0).rows
  }

  private async scalar(sql: string): Promise<number> {
    const rows = await this.q(sql)
    const first = rows[0]
    if (!first) return 0
    const v = Object.values(first)[0]
    return Number(v ?? 0)
  }

  private static escLit(s: string): string {
    return s.replace(/'/g, "''")
  }

  private async listDatabases(): Promise<MetadataNode[]> {
    // SHOW DATABASES 在不同版本里列名不一(name / db_name),走 information_schema 更稳。
    const rows = await this.q(
      'SELECT name FROM information_schema.ins_databases ORDER BY name',
    )
    return rows
      .map((r) => String(r.name ?? ''))
      .filter((name) => name && (this.showSystem || !SYSTEM_DATABASES.has(name)))
      .map((name) => ({
        kind: MetaNodeKind.Database,
        name,
        path: [name],
        hasChildren: true,
      }))
  }

  private async databaseGroups(db: string): Promise<MetadataNode[]> {
    const dbLit = `'${TDengineConnection.escLit(db)}'`
    const [stables, tables] = await Promise.all([
      this.scalar(
        `SELECT COUNT(*) AS c FROM information_schema.ins_stables WHERE db_name = ${dbLit}`,
      ),
      this.scalar(
        `SELECT COUNT(*) AS c FROM information_schema.ins_tables WHERE db_name = ${dbLit}`,
      ),
    ])
    const p = [db]
    return [
      {
        kind: MetaNodeKind.Group,
        name: '超级表',
        path: p,
        group: 'stables',
        hasChildren: true,
        count: stables,
      },
      {
        kind: MetaNodeKind.Group,
        name: '普通表',
        path: p,
        group: 'tables',
        hasChildren: true,
        count: tables,
      },
    ]
  }

  private async tableSubGroups(db: string, table: string): Promise<MetadataNode[]> {
    const q = tdengineHelpers.quoteIdentifier
    // DESCRIBE 返回列数即表列数(含 tag);避免再起一查,直接用 DESCRIBE 行数估算。
    let cols = 0
    try {
      const rows = await this.q(`DESCRIBE ${q(db)}.${q(table)}`)
      cols = rows.length
    } catch {
      cols = 0
    }
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
    const q = tdengineHelpers.quoteIdentifier
    const db = path[0]
    const dbLit = `'${TDengineConnection.escLit(db)}'`
    switch (group) {
      case 'stables': {
        const rows = await this.q(
          `SELECT stable_name AS name FROM information_schema.ins_stables WHERE db_name = ${dbLit} ORDER BY stable_name`,
        )
        return rows.map((r) => {
          const name = String(r.name ?? '')
          return {
            kind: MetaNodeKind.Table,
            name,
            path: [db, name],
            hasChildren: true,
            sqlName: `${q(db)}.${q(name)}`,
          }
        })
      }
      case 'tables': {
        const rows = await this.q(
          `SELECT table_name AS name FROM information_schema.ins_tables WHERE db_name = ${dbLit} ORDER BY table_name`,
        )
        return rows.map((r) => {
          const name = String(r.name ?? '')
          return {
            kind: MetaNodeKind.Table,
            name,
            path: [db, name],
            hasChildren: true,
            sqlName: `${q(db)}.${q(name)}`,
          }
        })
      }
      case 'columns': {
        const table = path[1]
        // DESCRIBE 输出列形如:field / type / length / note(TAG/空)
        const rows = await this.q(`DESCRIBE ${q(db)}.${q(table)}`)
        return rows.map((r) => {
          // 不同版本字段名大小写 / 命名略不同,兼容性提取。
          const name = String(r.field ?? r.Field ?? r.name ?? '')
          const dtype = String(r.type ?? r.Type ?? '')
          const note = String(r.note ?? r.Note ?? '')
          return {
            kind: MetaNodeKind.Column,
            name,
            path: [db, table, name],
            hasChildren: false,
            detail: {
              dataType: dtype,
              comment: note ? note : undefined,
            },
          }
        })
      }
      default:
        return []
    }
  }

  async ping(): Promise<void> {
    await this.ws.exec('SELECT SERVER_VERSION()')
  }

  async close(): Promise<void> {
    try {
      await this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

export function createTDengineDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: tdengineHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const ws = await openWs(config, true)
      const conn = new TDengineConnection(ws)
      conn.showSystem = Boolean(config.extra?.showSystemDatabases)
      return conn
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      let ws: any
      try {
        // 测试连接不绑库,避免目标库不存在导致 open 失败。
        ws = await openWs(config, false)
        const ts = await ws.exec('SELECT SERVER_VERSION()')
        const rows = (typeof ts?.getData === 'function' ? ts.getData() : null) ?? []
        const first = rows[0] as unknown[] | undefined
        const v = first?.[0] != null ? String(first[0]) : undefined
        return {
          ok: true,
          serverVersion: v,
          latencyMs: Date.now() - start,
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      } finally {
        if (ws) {
          try {
            await ws.close()
          } catch {
            /* ignore */
          }
        }
      }
    },
  }
}
