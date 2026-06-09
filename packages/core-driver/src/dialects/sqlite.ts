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

// SQLite 驱动:`connection.database` 字段视为本地文件路径(空串 / 缺省 → :memory:)。
// better-sqlite3 同步 API,所有方法包成 Promise 满足 DriverConnection 契约。

const sqliteHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => `"${name.replace(/"/g, '""')}"`,
  paginate: (sql, limit, offset) =>
    `${sql.trim().replace(/;\s*$/, '')} LIMIT ${limit} OFFSET ${offset}`,
}

/**
 * 惰性加载 better-sqlite3:core-driver 加载不依赖它,仅连接时按需 import。
 * 用非字面量 specifier,避免未安装时编译期报"找不到模块"。
 */
async function loadBetterSqlite3(): Promise<any> {
  const spec: string = 'better-sqlite3'
  try {
    const mod: any = await import(spec)
    return mod.default ?? mod
  } catch {
    throw new Error(
      'SQLite 驱动未安装:请在部署环境 `pnpm add better-sqlite3`;桌面端打包还需 electron-rebuild 重建原生模块。',
    )
  }
}

function isSelect(sql: string): boolean {
  return /^\s*(select|with)\b/i.test(sql)
}

/** sqlite_master 类型 → MetaNodeKind 映射。 */
const GROUP_TO_KIND: Record<string, MetaNodeKind> = {
  tables: MetaNodeKind.Table,
  views: MetaNodeKind.View,
  indexes: MetaNodeKind.Index,
  triggers: MetaNodeKind.Trigger,
}
const GROUP_TO_SQLITE_TYPE: Record<string, string> = {
  tables: 'table',
  views: 'view',
  indexes: 'index',
  triggers: 'trigger',
}

class SqliteConnection implements DriverConnection {
  constructor(private readonly db: any) {}

  async execute(
    sql: string,
    params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const start = Date.now()
    // better-sqlite3 不支持 statement-level timeout,timeoutMs 在此忽略。
    // 应用层若要超时控制,可在 IPC/上层包装一层 Promise.race。
    const select = isSelect(sql)
    const finalSql =
      select && options?.limit != null
        ? sqliteHelpers.paginate(sql, options.limit, options.offset ?? 0)
        : sql
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(finalSql)
      // BIGINT 精度保护:开 safeIntegers 后 INTEGER 以 BigInt 返回(不丢精度),
      // 再用 normalizeBigInt 归一(安全范围内仍是 number,超界转字符串)。
      // 某些语句(如部分 PRAGMA)不支持 safeIntegers,失败则降级为旧行为。
      try {
        stmt.safeIntegers(true)
      } catch {
        /* ignore — 该语句不支持,按普通整数返回 */
      }
      const executionTimeMs = () => Date.now() - start
      if (select || stmt.reader) {
        const raw = (params.length ? stmt.all(...params) : stmt.all()) as Array<
          Record<string, unknown>
        >
        const all = raw.map((r) => {
          const o: Record<string, unknown> = {}
          for (const k of Object.keys(r)) o[k] = normalizeBigInt(r[k])
          return o
        })
        let columns: QueryColumn[] = []
        try {
          columns = (stmt.columns() as Array<{ name: string; type: string | null }>).map((c) => {
            const col: QueryColumn = { name: c.name, dataType: c.type ?? 'unknown' }
            // 声明为整数类型的列(INTEGER/INT/BIGINT)标 lossy:超界值已字符串化。
            if (/int/i.test(c.type ?? '')) col.lossy = 'bigint'
            return col
          })
        } catch {
          // 某些语句(如 PRAGMA)columns() 不可用,从首行键推断
          if (all.length) {
            columns = Object.keys(all[0]).map((name) => ({ name, dataType: 'unknown' }))
          }
        }
        const max = options?.maxRows
        const truncated = typeof max === 'number' && all.length > max
        const rows = truncated ? all.slice(0, max) : all
        return {
          columns,
          rows,
          rowCount: rows.length,
          executionTimeMs: executionTimeMs(),
          truncated,
        }
      }
      const info = (params.length ? stmt.run(...params) : stmt.run()) as {
        changes: number
        lastInsertRowid: number | bigint
      }
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: info.changes,
        executionTimeMs: executionTimeMs(),
      }
    })
  }

  async executeBatch(statements: string[]): Promise<void> {
    // better-sqlite3 提供原生事务包装:失败会自动 ROLLBACK。
    const tx = this.db.transaction((stmts: string[]) => {
      for (const s of stmts) this.db.exec(s)
    })
    return Promise.resolve().then(() => tx(statements))
  }

  // SQLite 形状:Connection → Database('main') → Group(tables/views/indexes/triggers)
  //                                            → Table → Group('Columns') → Column
  async fetchMetadata(scope: MetaScope): Promise<MetadataNode[]> {
    switch (scope.parentKind) {
      case MetaNodeKind.Connection:
        return this.listDatabases()
      case MetaNodeKind.Database:
        return this.databaseGroups()
      case MetaNodeKind.Group:
        return this.listGroupObjects(scope.path, scope.group)
      case MetaNodeKind.Table:
      case MetaNodeKind.View:
        return this.tableSubGroups(scope.path)
      default:
        return []
    }
  }

  private listDatabases(): MetadataNode[] {
    // SQLite 一个连接=一个文件,虚拟出固定 'main' 节点贴合通用树形。
    return [
      {
        kind: MetaNodeKind.Database,
        name: 'main',
        path: ['main'],
        hasChildren: true,
      },
    ]
  }

  private databaseGroups(): MetadataNode[] {
    const rows = this.db
      .prepare(
        `SELECT type AS t, COUNT(*) AS c FROM sqlite_master
         WHERE type IN ('table','view','index','trigger') GROUP BY type`,
      )
      .all() as Array<{ t: string; c: number | bigint }>
    const counts: Record<string, number> = {}
    for (const r of rows) counts[r.t] = Number(r.c)
    const p = ['main']
    return [
      {
        kind: MetaNodeKind.Group,
        name: '表',
        path: p,
        group: 'tables',
        hasChildren: true,
        count: counts.table ?? 0,
      },
      {
        kind: MetaNodeKind.Group,
        name: '视图',
        path: p,
        group: 'views',
        hasChildren: true,
        count: counts.view ?? 0,
      },
      {
        kind: MetaNodeKind.Group,
        name: '索引',
        path: p,
        group: 'indexes',
        hasChildren: true,
        count: counts.index ?? 0,
      },
      {
        kind: MetaNodeKind.Group,
        name: '触发器',
        path: p,
        group: 'triggers',
        hasChildren: true,
        count: counts.trigger ?? 0,
      },
    ]
  }

  private listGroupObjects(path: string[], group?: string): MetadataNode[] {
    if (group === 'columns') return this.listColumns(path[1])
    const sqliteType = group ? GROUP_TO_SQLITE_TYPE[group] : undefined
    const kind = group ? GROUP_TO_KIND[group] : undefined
    if (!sqliteType || !kind) return []
    const rows = this.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all(sqliteType) as Array<{ name: string }>
    return rows.map((r) => {
      const name = String(r.name)
      const isTableLike = kind === MetaNodeKind.Table || kind === MetaNodeKind.View
      const node: MetadataNode = {
        kind,
        name,
        path: ['main', name],
        hasChildren: isTableLike,
      }
      if (isTableLike) node.sqlName = sqliteHelpers.quoteIdentifier(name)
      return node
    })
  }

  private tableSubGroups(path: string[]): MetadataNode[] {
    const tableName = path[1]
    const cols = this.db.prepare(`PRAGMA table_info(${sqliteHelpers.quoteIdentifier(tableName)})`).all() as unknown[]
    return [
      {
        kind: MetaNodeKind.Group,
        name: '列',
        path,
        group: 'columns',
        hasChildren: true,
        count: cols.length,
      },
    ]
  }

  private listColumns(tableName: string): MetadataNode[] {
    const rows = this.db
      .prepare(`PRAGMA table_info(${sqliteHelpers.quoteIdentifier(tableName)})`)
      .all() as Array<{
      name: string
      type: string
      notnull: number | bigint
      pk: number | bigint
      dflt_value: string | null
    }>
    return rows.map((r) => ({
      kind: MetaNodeKind.Column,
      name: String(r.name),
      path: ['main', tableName, String(r.name)],
      hasChildren: false,
      detail: {
        dataType: String(r.type ?? '').toUpperCase() || 'unknown',
        nullable: Number(r.notnull) === 0,
        primaryKey: Number(r.pk) > 0,
        defaultValue: r.dflt_value ?? null,
      },
    }))
  }

  async ping(): Promise<void> {
    return Promise.resolve().then(() => {
      this.db.prepare('SELECT 1').get()
    })
  }

  async close(): Promise<void> {
    return Promise.resolve().then(() => {
      try {
        this.db.close()
      } catch {
        // ignore
      }
    })
  }
}

export function createSqliteDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: sqliteHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const BetterSqlite3 = await loadBetterSqlite3()
      const file = config.database?.trim() || ':memory:'
      const readOnly = Boolean((config.extra as Record<string, unknown> | undefined)?.readOnly)
      const db = new BetterSqlite3(file, { readonly: readOnly })
      return new SqliteConnection(db)
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      try {
        const BetterSqlite3 = await loadBetterSqlite3()
        const file = config.database?.trim() || ':memory:'
        const db = new BetterSqlite3(file, { readonly: false })
        try {
          const row = db.prepare('SELECT sqlite_version() AS v').get() as { v?: string } | undefined
          return {
            ok: true,
            serverVersion: row?.v ? String(row.v) : undefined,
            latencyMs: Date.now() - start,
          }
        } finally {
          db.close()
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}
