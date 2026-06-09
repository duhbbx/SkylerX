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
import { normalizeBigInt } from './base.js'

/**
 * snowflake-sdk 是可选 peerDep，惰性加载：core-driver 加载不依赖它，仅连接时按需 import。
 * 用非字面量 specifier，避免未安装时编译期报"找不到模块"。
 */
async function loadSnowflake(): Promise<any> {
  const spec: string = 'snowflake-sdk'
  try {
    const mod: any = await import(spec)
    return mod.default ?? mod
  } catch {
    throw new Error(
      'Snowflake 驱动未安装：请在部署环境 `pnpm add snowflake-sdk`（纯 JS，无需原生构建）。',
    )
  }
}

const snowflakeHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => `"${name.replace(/"/g, '""')}"`,
  paginate: (sql, limit, offset) =>
    `${sql.trim().replace(/;\s*$/, '')} LIMIT ${limit} OFFSET ${offset}`,
}

function isSelect(sql: string): boolean {
  return /^\s*(select|with|show|describe|desc)\b/i.test(sql)
}

function applyPaging(sql: string, options?: ExecuteOptions): string {
  if (options?.limit == null || !isSelect(sql)) return sql
  return snowflakeHelpers.paginate(sql, options.limit, options.offset ?? 0)
}

/** 从 ConnectionConfig 构造 snowflake-sdk createConnection options。 */
function buildConnectOptions(config: ConnectionConfig): Record<string, unknown> {
  const extra = (config.extra ?? {}) as Record<string, unknown>
  const account = (extra.account as string) || config.host
  const privateKey = extra.privateKey as string | undefined
  const privateKeyPath = extra.privateKeyPath as string | undefined
  const usePrivateKey = Boolean(privateKey || privateKeyPath)

  const opts: Record<string, unknown> = {
    account,
    username: config.user,
    warehouse: extra.warehouse,
    database: config.database,
    schema: extra.schema,
    role: extra.role,
    // BIGINT 精度保护:整数列(NUMBER scale=0)以 BigInt 返回,execute 再用 normalizeBigInt
    // 归一(安全范围内仍是 number,超界转字符串)。否则 18 位整数会被截成 53bit。
    jsTreatIntegerAsBigInt: true,
  }
  if (usePrivateKey) {
    if (privateKey) opts.privateKey = privateKey
    if (privateKeyPath) opts.privateKeyPath = privateKeyPath
    if (extra.privateKeyPass) opts.privateKeyPass = extra.privateKeyPass
  } else if (config.password) {
    opts.password = config.password
  }
  if (typeof extra.authenticator === 'string') opts.authenticator = extra.authenticator
  // 过滤掉 undefined，避免 SDK 校验
  for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k]
  return opts
}

/** Promisify snowflake-sdk Connection.connect */
function pConnect(conn: any): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    conn.connect((err: Error | undefined) => (err ? reject(err) : resolve()))
  })
}

/** Promisify snowflake-sdk Connection.destroy */
function pDestroy(conn: any): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      conn.destroy((err: Error | undefined) => {
        if (err) console.error('[snowflake] destroy error:', err.message)
        resolve()
      })
    } catch {
      resolve()
    }
  })
}

/** Promisify snowflake-sdk Connection.execute；返回 { stmt, rows }。 */
function pExecute(
  conn: any,
  sqlText: string,
  binds?: unknown[],
  timeoutMs?: number,
): Promise<{ stmt: any; rows: any[] }> {
  return new Promise((resolve, reject) => {
    const req: Record<string, unknown> = { sqlText }
    if (binds && binds.length > 0) req.binds = binds as any
    if (typeof timeoutMs === 'number') req.streamResult = false
    req.complete = (err: Error | undefined, stmt: any, rows: any[]) =>
      err ? reject(err) : resolve({ stmt, rows: rows ?? [] })
    conn.execute(req)
  })
}

function isWriteStmt(sql: string): boolean {
  return /^\s*(insert|update|delete|merge|create|drop|alter|truncate|grant|revoke|use|set)\b/i.test(
    sql,
  )
}

class SnowflakeConnection implements DriverConnection {
  constructor(private readonly conn: any) {}

  async execute(
    sql: string,
    params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const start = Date.now()
    if (options?.database) {
      await pExecute(this.conn, `USE DATABASE ${snowflakeHelpers.quoteIdentifier(options.database)}`)
    }
    if (options?.schema) {
      await pExecute(this.conn, `USE SCHEMA ${snowflakeHelpers.quoteIdentifier(options.schema)}`)
    }
    const text = applyPaging(sql, options)
    const { stmt, rows } = await pExecute(this.conn, text, params, options?.timeoutMs)
    const executionTimeMs = Date.now() - start

    const cols: any[] = typeof stmt?.getColumns === 'function' ? (stmt.getColumns() ?? []) : []
    const columns: QueryColumn[] = cols.map((c: any) => {
      const type =
        typeof c?.getType === 'function' ? String(c.getType()) : String(c?.type ?? 'unknown')
      const scale = typeof c?.getScale === 'function' ? Number(c.getScale() ?? 0) : 0
      const col: QueryColumn = {
        name: typeof c?.getName === 'function' ? String(c.getName()) : String(c?.name ?? ''),
        dataType: type,
      }
      // 整数列(fixed/number/integer 且 scale<=0)可能超界,已 BigInt→字符串,标 lossy。
      if (/fixed|number|numeric|integer|bigint/i.test(type) && scale <= 0) col.lossy = 'bigint'
      return col
    })

    if (columns.length > 0 && !isWriteStmt(sql)) {
      const src = (rows ?? []) as Array<Record<string, unknown>>
      const all = src.map((r) => {
        const o: Record<string, unknown> = {}
        for (const k of Object.keys(r)) o[k] = normalizeBigInt(r[k])
        return o
      })
      const max = options?.maxRows
      const truncated = typeof max === 'number' && all.length > max
      const out = truncated ? all.slice(0, max) : all
      return { columns, rows: out, rowCount: out.length, executionTimeMs, truncated }
    }

    let affected = 0
    try {
      if (typeof stmt?.getNumUpdatedRows === 'function') affected = Number(stmt.getNumUpdatedRows())
      if (!affected && typeof stmt?.getNumRows === 'function') affected = Number(stmt.getNumRows())
    } catch {
      affected = 0
    }
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      affectedRows: Number.isFinite(affected) ? affected : 0,
      executionTimeMs,
    }
  }

  async executeBatch(statements: string[], options?: ExecuteOptions): Promise<void> {
    if (options?.database) {
      await pExecute(this.conn, `USE DATABASE ${snowflakeHelpers.quoteIdentifier(options.database)}`)
    }
    if (options?.schema) {
      await pExecute(this.conn, `USE SCHEMA ${snowflakeHelpers.quoteIdentifier(options.schema)}`)
    }
    await pExecute(this.conn, 'BEGIN')
    try {
      for (const s of statements) await pExecute(this.conn, s)
      await pExecute(this.conn, 'COMMIT')
    } catch (e) {
      try {
        await pExecute(this.conn, 'ROLLBACK')
      } catch {
        /* ignore */
      }
      throw e
    }
  }

  // Snowflake 树形：Connection → Database → Schema → Group(表/视图) → Table/View → Group(列) → Column
  async fetchMetadata(scope: MetaScope): Promise<MetadataNode[]> {
    switch (scope.parentKind) {
      case MetaNodeKind.Connection:
        return this.listDatabases()
      case MetaNodeKind.Database:
        return this.listSchemas(scope.path[0])
      case MetaNodeKind.Schema:
        return this.schemaGroups(scope.path)
      case MetaNodeKind.Group:
        return this.listGroupObjects(scope.path, scope.group)
      case MetaNodeKind.Table:
      case MetaNodeKind.View:
        return this.tableSubGroups(scope.path)
      default:
        return []
    }
  }

  private async q(sql: string, binds?: unknown[]): Promise<Array<Record<string, unknown>>> {
    const { rows } = await pExecute(this.conn, sql, binds)
    return (rows ?? []) as Array<Record<string, unknown>>
  }

  private showSystemSchemas(): boolean {
    // 通过 conn 没办法回查 config，这里默认隐藏 INFORMATION_SCHEMA。
    return false
  }

  private async listDatabases(): Promise<MetadataNode[]> {
    const rows = await this.q('SHOW DATABASES')
    return rows.map((r) => {
      const name = String(r.name ?? r.NAME ?? '')
      return {
        kind: MetaNodeKind.Database,
        name,
        path: [name],
        hasChildren: true,
      }
    })
  }

  private async listSchemas(db: string): Promise<MetadataNode[]> {
    const rows = await this.q(`SHOW SCHEMAS IN DATABASE ${snowflakeHelpers.quoteIdentifier(db)}`)
    const hideSys = !this.showSystemSchemas()
    return rows
      .map((r) => String(r.name ?? r.NAME ?? ''))
      .filter((name) => !!name && (!hideSys || name.toUpperCase() !== 'INFORMATION_SCHEMA'))
      .map((name) => ({
        kind: MetaNodeKind.Schema,
        name,
        path: [db, name],
        hasChildren: true,
      }))
  }

  private async schemaGroups(path: string[]): Promise<MetadataNode[]> {
    return [
      { kind: MetaNodeKind.Group, name: '表', path, group: 'tables', hasChildren: true },
      { kind: MetaNodeKind.Group, name: '视图', path, group: 'views', hasChildren: true },
    ]
  }

  private async tableSubGroups(path: string[]): Promise<MetadataNode[]> {
    return [
      { kind: MetaNodeKind.Group, name: '列', path, group: 'columns', hasChildren: true },
    ]
  }

  private async listGroupObjects(path: string[], group?: string): Promise<MetadataNode[]> {
    const q = snowflakeHelpers.quoteIdentifier
    const [db, schema, table] = path
    if (group === 'tables') {
      const rows = await this.q(`SHOW TABLES IN SCHEMA ${q(db)}.${q(schema)}`)
      return rows
        .map((r) => String(r.name ?? r.NAME ?? ''))
        .filter(Boolean)
        .map((name) => ({
          kind: MetaNodeKind.Table,
          name,
          path: [db, schema, name],
          hasChildren: true,
          sqlName: `${q(db)}.${q(schema)}.${q(name)}`,
        }))
    }
    if (group === 'views') {
      const rows = await this.q(`SHOW VIEWS IN SCHEMA ${q(db)}.${q(schema)}`)
      return rows
        .map((r) => String(r.name ?? r.NAME ?? ''))
        .filter(Boolean)
        .map((name) => ({
          kind: MetaNodeKind.View,
          name,
          path: [db, schema, name],
          hasChildren: true,
          sqlName: `${q(db)}.${q(schema)}.${q(name)}`,
        }))
    }
    if (group === 'columns') {
      const rows = await this.q(
        `SHOW COLUMNS IN TABLE ${q(db)}.${q(schema)}.${q(table)}`,
      )
      return rows.map((r) => {
        const name = String(r.column_name ?? r.COLUMN_NAME ?? r.name ?? '')
        const dataType = String(r.data_type ?? r.DATA_TYPE ?? '')
        const nullableRaw = (r.null ?? r.NULL ?? r['null?']) as unknown
        const nullable =
          typeof nullableRaw === 'string'
            ? nullableRaw.toUpperCase() === 'Y' || nullableRaw.toUpperCase() === 'YES'
            : Boolean(nullableRaw)
        return {
          kind: MetaNodeKind.Column,
          name,
          path: [db, schema, table, name],
          hasChildren: false,
          detail: { dataType, nullable },
        }
      })
    }
    return []
  }

  async ping(): Promise<void> {
    try {
      // SDK 提供 isUp() 同步检测，缺省时回退 SELECT 1
      if (typeof this.conn?.isUp === 'function' && this.conn.isUp() !== true) {
        throw new Error('PING_FAILED')
      }
      await pExecute(this.conn, 'SELECT 1')
    } catch (e) {
      throw e instanceof Error ? e : new Error('PING_FAILED')
    }
  }

  async close(): Promise<void> {
    await pDestroy(this.conn)
  }
}

export function createSnowflakeDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: snowflakeHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const snowflake = await loadSnowflake()
      const conn = snowflake.createConnection(buildConnectOptions(config))
      await pConnect(conn)
      return new SnowflakeConnection(conn)
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      let conn: any
      try {
        const snowflake = await loadSnowflake()
        conn = snowflake.createConnection(buildConnectOptions(config))
        await pConnect(conn)
        const { rows } = await pExecute(conn, 'SELECT CURRENT_VERSION() AS V')
        const v = String(
          (rows?.[0] as Record<string, unknown> | undefined)?.V ??
            (rows?.[0] as Record<string, unknown> | undefined)?.v ??
            '',
        )
        return {
          ok: true,
          serverVersion: v || undefined,
          latencyMs: Date.now() - start,
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      } finally {
        if (conn) await pDestroy(conn)
      }
    },
  }
}
