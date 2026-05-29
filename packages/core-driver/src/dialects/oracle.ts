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
import type { DatabaseDriver, DriverConnection } from '../driver.js'
import { oracleFamilyHelpers } from './base.js'

/**
 * oracledb 是原生模块，惰性加载：core-driver 加载不依赖它，仅连接时按需 import。
 * 默认 thin 模式（纯 JS，无需 Instant Client）。桌面端打包需 electron-rebuild。
 * 用非字面量 specifier，避免未安装时编译期报"找不到模块"。
 */
async function loadOracleDb(): Promise<any> {
  const spec: string = 'oracledb'
  try {
    const mod: any = await import(spec)
    const oracledb = mod.default ?? mod
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
    return oracledb
  } catch {
    throw new Error(
      'Oracle 驱动未安装：请在部署环境 `pnpm add oracledb`（默认 thin 模式，无需 Instant Client）；桌面端打包还需 electron-rebuild 重建原生模块。',
    )
  }
}

function connectString(config: ConnectionConfig): string {
  const service = (config.extra?.serviceName as string) || config.database || 'XEPDB1'
  return `${config.host}:${config.port}/${service}`
}

function isSelect(sql: string): boolean {
  return /^\s*(select|with)\b/i.test(sql)
}

/** Oracle 12c+ 分页：包子查询 + OFFSET/FETCH（Oracle 允许子查询内 ORDER BY）。 */
function paginate(sql: string, options?: ExecuteOptions): string {
  if (options?.limit == null || !isSelect(sql)) return sql
  const inner = sql.trim().replace(/;\s*$/, '')
  return `SELECT * FROM (${inner}) OFFSET ${options.offset ?? 0} ROWS FETCH NEXT ${options.limit} ROWS ONLY`
}

class OracleConnection implements DriverConnection {
  constructor(private readonly pool: any) {}

  async execute(
    sql: string,
    params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const start = Date.now()
    const conn = await this.pool.getConnection()
    try {
      if (options?.schema) {
        await conn.execute(
          `ALTER SESSION SET CURRENT_SCHEMA = ${oracleFamilyHelpers.quoteIdentifier(options.schema)}`,
        )
      }
      const res = await conn.execute(paginate(sql, options), params as unknown[])
      const executionTimeMs = Date.now() - start
      if (res.metaData) {
        const columns: QueryColumn[] = res.metaData.map((m: any) => ({
          name: m.name,
          dataType: m.dbTypeName ?? 'unknown',
        }))
        const all = (res.rows ?? []) as Array<Record<string, unknown>>
        const max = options?.maxRows
        const truncated = typeof max === 'number' && all.length > max
        const rows = truncated ? all.slice(0, max) : all
        return { columns, rows, rowCount: rows.length, executionTimeMs, truncated }
      }
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: res.rowsAffected ?? 0,
        executionTimeMs,
      }
    } finally {
      await conn.close()
    }
  }

  // Oracle 无独立 database 层（一连接=一实例），schema=用户，与 MySQL/PG 对齐：
  //   Connection → Schema → Group(表/视图, 带计数) → Table/View
  //                  → Group(列/索引/键, 带计数) → Column/Index/Key
  async fetchMetadata(scope: MetaScope): Promise<MetadataNode[]> {
    switch (scope.parentKind) {
      case MetaNodeKind.Connection:
        return this.listSchemas()
      case MetaNodeKind.Schema:
        return this.schemaGroups(scope.path[0])
      case MetaNodeKind.Group:
        return this.listGroupObjects(scope.path, scope.group)
      case MetaNodeKind.Table:
      case MetaNodeKind.View:
        return this.tableSubGroups(scope.path[0], scope.path[1])
      default:
        return []
    }
  }

  private async scalar(sql: string, binds: unknown[]): Promise<number> {
    const rows = await this.q(sql, binds)
    return Number((rows[0] as { c?: number })?.c ?? 0)
  }

  private async schemaGroups(schema: string): Promise<MetadataNode[]> {
    const [tables, views] = await Promise.all([
      this.scalar('SELECT COUNT(*) AS "c" FROM all_tables WHERE owner = :1', [schema]),
      this.scalar('SELECT COUNT(*) AS "c" FROM all_views WHERE owner = :1', [schema]),
    ])
    const p = [schema]
    return [
      { kind: MetaNodeKind.Group, name: '表', path: p, group: 'tables', hasChildren: true, count: tables },
      { kind: MetaNodeKind.Group, name: '视图', path: p, group: 'views', hasChildren: true, count: views },
    ]
  }

  private async tableSubGroups(schema: string, table: string): Promise<MetadataNode[]> {
    const [cols, idx, keys] = await Promise.all([
      this.scalar('SELECT COUNT(*) AS "c" FROM all_tab_columns WHERE owner = :1 AND table_name = :2', [schema, table]),
      this.scalar('SELECT COUNT(*) AS "c" FROM all_indexes WHERE owner = :1 AND table_name = :2', [schema, table]),
      this.scalar('SELECT COUNT(*) AS "c" FROM all_constraints WHERE owner = :1 AND table_name = :2', [schema, table]),
    ])
    const p = [schema, table]
    return [
      { kind: MetaNodeKind.Group, name: '列', path: p, group: 'columns', hasChildren: true, count: cols },
      { kind: MetaNodeKind.Group, name: '索引', path: p, group: 'indexes', hasChildren: true, count: idx },
      { kind: MetaNodeKind.Group, name: '键', path: p, group: 'keys', hasChildren: true, count: keys },
    ]
  }

  private async q(sql: string, binds: unknown[] = []): Promise<any[]> {
    const conn = await this.pool.getConnection()
    try {
      const r = await conn.execute(sql, binds)
      return r.rows ?? []
    } finally {
      await conn.close()
    }
  }

  private async listSchemas(): Promise<MetadataNode[]> {
    const rows = await this.q('SELECT username AS "name" FROM all_users ORDER BY username')
    return rows.map((r: any) => ({
      kind: MetaNodeKind.Schema,
      name: String(r.name),
      path: [String(r.name)],
      hasChildren: true,
    }))
  }

  private async listGroupObjects(path: string[], group?: string): Promise<MetadataNode[]> {
    const schema = path[0]
    const quote = oracleFamilyHelpers.quoteIdentifier
    if (group === 'columns') return this.listColumns(schema, path[1])
    if (group === 'indexes') {
      const rows = await this.q(
        'SELECT index_name AS "name" FROM all_indexes WHERE owner = :1 AND table_name = :2 ORDER BY index_name',
        [schema, path[1]],
      )
      return rows.map((r: any) => ({
        kind: MetaNodeKind.Index,
        name: String(r.name),
        path: [...path, String(r.name)],
        hasChildren: false,
      }))
    }
    if (group === 'keys') {
      const rows = await this.q(
        'SELECT constraint_name AS "name", constraint_type AS "t" FROM all_constraints WHERE owner = :1 AND table_name = :2 ORDER BY constraint_name',
        [schema, path[1]],
      )
      return rows.map((r: any) => ({
        kind: MetaNodeKind.Index,
        name: `${String(r.name)} (${String(r.t)})`,
        path: [...path, String(r.name)],
        hasChildren: false,
      }))
    }
    if (group === 'tables') {
      const rows = await this.q(
        'SELECT table_name AS "name" FROM all_tables WHERE owner = :1 ORDER BY table_name',
        [schema],
      )
      return rows.map((r: any) => ({
        kind: MetaNodeKind.Table,
        name: String(r.name),
        path: [schema, String(r.name)],
        hasChildren: true,
        sqlName: `${quote(schema)}.${quote(String(r.name))}`,
      }))
    }
    if (group === 'views') {
      const rows = await this.q(
        'SELECT view_name AS "name" FROM all_views WHERE owner = :1 ORDER BY view_name',
        [schema],
      )
      return rows.map((r: any) => ({
        kind: MetaNodeKind.View,
        name: String(r.name),
        path: [schema, String(r.name)],
        hasChildren: true,
        sqlName: `${quote(schema)}.${quote(String(r.name))}`,
      }))
    }
    return []
  }

  private async listColumns(schema: string, table: string): Promise<MetadataNode[]> {
    const rows = await this.q(
      `SELECT column_name AS "name", data_type AS "dtype", nullable AS "nullable"
         FROM all_tab_columns WHERE owner = :1 AND table_name = :2 ORDER BY column_id`,
      [schema, table],
    )
    return rows.map((r: any) => ({
      kind: MetaNodeKind.Column,
      name: String(r.name),
      path: [schema, table, String(r.name)],
      hasChildren: false,
      detail: { dataType: String(r.dtype), nullable: r.nullable === 'Y' },
    }))
  }

  async ping(): Promise<void> {
    await this.q('SELECT 1 FROM dual')
  }

  async close(): Promise<void> {
    await this.pool.close(0)
  }
}

export function createOracleDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: oracleFamilyHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const oracledb = await loadOracleDb()
      const pool = await oracledb.createPool({
        user: config.user,
        password: config.password,
        connectString: connectString(config),
        poolMax: 5,
      })
      return new OracleConnection(pool)
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      try {
        const oracledb = await loadOracleDb()
        const conn = await oracledb.getConnection({
          user: config.user,
          password: config.password,
          connectString: connectString(config),
        })
        try {
          const r = await conn.execute('SELECT banner AS "v" FROM v$version WHERE rownum = 1')
          const v = String((r.rows?.[0] as any)?.v ?? '')
          return {
            ok: true,
            serverVersion: v.match(/(\d+\.\d+\.\d+)/)?.[1] ?? (v || undefined),
            latencyMs: Date.now() - start,
          }
        } finally {
          await conn.close()
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}
