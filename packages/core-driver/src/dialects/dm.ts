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
import type { DatabaseDriver, DriverConnection } from '../driver.js'
import { oracleFamilyHelpers } from './base.js'

/**
 * 达梦 dmdb 是原生模块且由达梦官方分发（公共 registry 无 macOS arm64 预编译）。
 * 惰性加载，仅连接时按需 import；部署需自行安装 dmdb + 达梦客户端，桌面端再 electron-rebuild。
 * 达梦 SQL/数据字典与 Oracle 高度兼容（ALL_USERS / ALL_TABLES / ALL_TAB_COLUMNS / DUAL）。
 */

/**
 * dmdb 强制要求 connectString 为完整 URL（`dm://user:pass@host:port`）;
 * 早期版本接受 `host:port` 但 1.0.4xxxx 起会抛 "URL must start with 'dm://'".
 * 用户名/密码里若含 `@/:` 等保留字符需要 percent-encode, 这里统一走 encodeURIComponent.
 */
function buildDmUrl(config: ConnectionConfig): string {
  const user = encodeURIComponent(config.user ?? '')
  const password = encodeURIComponent(config.password ?? '')
  return `dm://${user}:${password}@${config.host}:${config.port}`
}
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

function isSelect(sql: string): boolean {
  return /^\s*(select|with)\b/i.test(sql)
}

/** 达梦分页：包子查询 + OFFSET/FETCH（DM 兼容 SQL 标准 OFFSET/FETCH）。 */
function paginate(sql: string, options?: ExecuteOptions): string {
  if (options?.limit == null || !isSelect(sql)) return sql
  const inner = sql.trim().replace(/;\s*$/, '')
  return `SELECT * FROM (${inner}) OFFSET ${options.offset ?? 0} ROWS FETCH NEXT ${options.limit} ROWS ONLY`
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
        await conn.execute(`SET SCHEMA ${oracleFamilyHelpers.quoteIdentifier(options.schema)}`)
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

  // 与 Oracle 同构，并对齐 MySQL/PG：
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
      {
        kind: MetaNodeKind.Group,
        name: '表',
        path: p,
        group: 'tables',
        hasChildren: true,
        count: tables,
      },
      {
        kind: MetaNodeKind.Group,
        name: '视图',
        path: p,
        group: 'views',
        hasChildren: true,
        count: views,
      },
    ]
  }

  private async tableSubGroups(schema: string, table: string): Promise<MetadataNode[]> {
    const [cols, idx, keys] = await Promise.all([
      this.scalar(
        'SELECT COUNT(*) AS "c" FROM all_tab_columns WHERE owner = :1 AND table_name = :2',
        [schema, table],
      ),
      this.scalar('SELECT COUNT(*) AS "c" FROM all_indexes WHERE owner = :1 AND table_name = :2', [
        schema,
        table,
      ]),
      this.scalar(
        'SELECT COUNT(*) AS "c" FROM all_constraints WHERE owner = :1 AND table_name = :2',
        [schema, table],
      ),
    ])
    const p = [schema, table]
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

export function createDmDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: oracleFamilyHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const dmdb = await loadDmdb()
      const pool = await dmdb.createPool({
        connectString: buildDmUrl(config),
        poolMax: 5,
      })
      return new DmConnection(pool)
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      try {
        const dmdb = await loadDmdb()
        const conn = await dmdb.getConnection({
          connectString: buildDmUrl(config),
        })
        try {
          await conn.execute('SELECT 1 AS "v" FROM dual')
          // Dameng exposes its version via v$version like Oracle. Failure to
          // resolve isn't fatal — connectivity already passed at this point.
          let serverVersion: string | undefined
          try {
            const r: { rows?: Array<{ banner?: string; BANNER?: string }> } = await conn.execute(
              'SELECT BANNER FROM v$version WHERE ROWNUM = 1',
            )
            const banner = r.rows?.[0]?.BANNER ?? r.rows?.[0]?.banner
            if (banner) {
              const m = String(banner).match(/(\d+(?:\.\d+)+)/)
              serverVersion = m ? m[1] : String(banner).trim()
            }
          } catch {
            /* version probe failed, leave serverVersion undefined */
          }
          return { ok: true, serverVersion, latencyMs: Date.now() - start }
        } finally {
          await conn.close()
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}
