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
 * 达梦 dmdb 是原生模块且由达梦官方分发（公共 registry 无 macOS arm64 预编译）。
 * 惰性加载，仅连接时按需 import；部署需自行安装 dmdb + 达梦客户端，桌面端再 electron-rebuild。
 * 达梦 SQL/数据字典与 Oracle 高度兼容（ALL_USERS / ALL_TABLES / ALL_TAB_COLUMNS / DUAL）。
 */
async function loadDmdb(): Promise<any> {
  const spec: string = 'dmdb'
  try {
    const mod: any = await import(spec)
    const dmdb = mod.default ?? mod
    dmdb.outFormat = dmdb.OUT_FORMAT_OBJECT
    return dmdb
  } catch {
    throw new Error(
      '达梦 驱动未安装：请在部署环境安装达梦官方 `dmdb` 包与客户端；桌面端打包还需 electron-rebuild 重建原生模块。',
    )
  }
}

class DmConnection implements DriverConnection {
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
          `SET SCHEMA ${oracleFamilyHelpers.quoteIdentifier(options.schema)}`,
        )
      }
      const res = await conn.execute(sql, params as unknown[])
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

  // 与 Oracle 同构：Connection → Schema → Group(表/视图) → Table/View → Column
  async fetchMetadata(scope: MetaScope): Promise<MetadataNode[]> {
    switch (scope.parentKind) {
      case MetaNodeKind.Connection:
        return this.listSchemas()
      case MetaNodeKind.Schema:
        return schemaGroups(scope.path)
      case MetaNodeKind.Group:
        return this.listGroupObjects(scope.path, scope.group)
      case MetaNodeKind.Table:
      case MetaNodeKind.View:
        return this.listColumns(scope.path[0], scope.path[1])
      default:
        return []
    }
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

function schemaGroups(path: string[]): MetadataNode[] {
  return [
    { group: 'tables', label: '表' },
    { group: 'views', label: '视图' },
  ].map(({ group, label }) => ({
    kind: MetaNodeKind.Group,
    name: label,
    path,
    group,
    hasChildren: true,
  }))
}

export function createDmDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: oracleFamilyHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const dmdb = await loadDmdb()
      const pool = await dmdb.createPool({
        connectString: `${config.host}:${config.port}`,
        user: config.user,
        password: config.password,
        poolMax: 5,
      })
      return new DmConnection(pool)
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      try {
        const dmdb = await loadDmdb()
        const conn = await dmdb.getConnection({
          connectString: `${config.host}:${config.port}`,
          user: config.user,
          password: config.password,
        })
        try {
          await conn.execute('SELECT 1 AS "v" FROM dual')
          return { ok: true, latencyMs: Date.now() - start }
        } finally {
          await conn.close()
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}
