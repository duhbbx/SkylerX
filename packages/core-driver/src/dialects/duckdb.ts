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

// DuckDB 驱动:`connection.database` 字段视为本地文件路径(空串 / 缺省 → :memory:)。
// @duckdb/node-api 1.5.x 实测 API:
//   const instance = await DuckDBInstance.create(path)
//   const conn = await instance.connect()
//   const result = await conn.run(sql, values?)  // 返回 DuckDBMaterializedResult
//     result.columnNames(): string[]
//     result.columnTypes(): DuckDBType[]    (.toString() 得到类型名)
//     result.rowsChanged: number            (DML 影响行数)
//     await result.getRowObjects(): Record<string, DuckDBValue>[]
//   conn.closeSync() / instance.closeSync()

const duckdbHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => `"${name.replace(/"/g, '""')}"`,
  paginate: (sql, limit, offset) =>
    `${sql.trim().replace(/;\s*$/, '')} LIMIT ${limit} OFFSET ${offset}`,
}

/**
 * 惰性加载 @duckdb/node-api:core-driver 加载不依赖它,仅连接时按需 import。
 * 用非字面量 specifier,避免未安装时编译期报"找不到模块"。
 */
async function loadDuckDb(): Promise<any> {
  const spec: string = '@duckdb/node-api'
  try {
    const mod: any = await import(spec)
    return mod.default ?? mod
  } catch {
    throw new Error(
      'DuckDB 驱动未安装:请在部署环境 `pnpm add @duckdb/node-api`;桌面端打包还需 electron-rebuild 重建原生绑定。',
    )
  }
}

function isSelect(sql: string): boolean {
  return /^\s*(select|with|show|describe|pragma|explain)\b/i.test(sql)
}

function typeToString(t: unknown): string {
  if (t == null) return 'unknown'
  if (typeof t === 'string') return t
  try {
    const s = (t as { toString?: () => string }).toString?.()
    return s || 'unknown'
  } catch {
    return 'unknown'
  }
}

// 这些类型在 JS 中以 BigInt 形态出现,IPC/JSON 序列化必须 toString(),
// 因此对应列被标记 lossy='bigint',提示 UI 该列已字符串化以保留精度。
const BIGINT_TYPES = new Set(['BIGINT', 'HUGEINT', 'UBIGINT', 'UHUGEINT'])
function isBigintType(dataType: string): boolean {
  return BIGINT_TYPES.has(dataType.toUpperCase())
}

/** DuckDB 值规整为 JSON-safe:BigInt → string,其它原样透传。 */
function normalizeValue(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString()
  return v
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(row)) out[k] = normalizeValue(row[k])
  return out
}

class DuckdbConnection implements DriverConnection {
  constructor(
    private readonly instance: any,
    private readonly conn: any,
  ) {}

  async execute(
    sql: string,
    params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const start = Date.now()
    const select = isSelect(sql)
    const finalSql =
      select && options?.limit != null
        ? duckdbHelpers.paginate(sql, options.limit, options.offset ?? 0)
        : sql
    // timeoutMs:DuckDB 没有直接的 statement-level timeout,这里忽略;
    // 如需取消可调用 conn.interrupt()(由上层 cancelActive 触发,本驱动未实现)。
    const result = params.length
      ? await this.conn.run(finalSql, params as unknown[])
      : await this.conn.run(finalSql)
    const executionTimeMs = Date.now() - start

    const names: string[] = result.columnNames?.() ?? []
    const types: unknown[] = result.columnTypes?.() ?? []
    const columns: QueryColumn[] = names.map((n, i) => {
      const dt = typeToString(types[i])
      const col: QueryColumn = { name: n, dataType: dt }
      if (isBigintType(dt)) col.lossy = 'bigint'
      return col
    })

    if (select && columns.length > 0) {
      const raw = (await result.getRowObjects()) as Array<Record<string, unknown>>
      const max = options?.maxRows
      const truncated = typeof max === 'number' && raw.length > max
      const slice = truncated ? raw.slice(0, max) : raw
      const rows = slice.map(normalizeRow)
      return { columns, rows, rowCount: rows.length, executionTimeMs, truncated }
    }

    // DML / DDL:rowsChanged 仅对 DML 有意义,DDL 通常为 0。
    const changed = Number(result.rowsChanged ?? 0)
    return {
      columns,
      rows: [],
      rowCount: 0,
      affectedRows: changed,
      executionTimeMs,
    }
  }

  // DuckDB 形状:Connection → Database(catalog) → Schema → Group(tables/views/sequences)
  //                                                       → Table → Group('Columns') → Column
  // 信息全部走 information_schema / duckdb_databases() / duckdb_sequences()。
  async fetchMetadata(scope: MetaScope): Promise<MetadataNode[]> {
    switch (scope.parentKind) {
      case MetaNodeKind.Connection:
        return this.listDatabases()
      case MetaNodeKind.Database:
        return this.listSchemas(scope.path[0])
      case MetaNodeKind.Schema:
        return this.schemaGroups(scope.path[0], scope.path[1])
      case MetaNodeKind.Group:
        return this.listGroupObjects(scope.path, scope.group)
      case MetaNodeKind.Table:
      case MetaNodeKind.View:
        return this.tableSubGroups(scope.path)
      default:
        return []
    }
  }

  private async q(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
    const result = params.length ? await this.conn.run(sql, params) : await this.conn.run(sql)
    const rows = (await result.getRowObjects()) as Array<Record<string, unknown>>
    return rows.map(normalizeRow)
  }

  private async scalar(sql: string, params: unknown[] = []): Promise<number> {
    const rows = await this.q(sql, params)
    const v = (rows[0] as { c?: unknown })?.c
    return Number(v ?? 0)
  }

  private async listDatabases(): Promise<MetadataNode[]> {
    // duckdb_databases() 列出已 ATTACH 的所有 catalog(含 'system' / 'temp'),过滤掉内部。
    const rows = await this.q(
      `SELECT database_name AS name FROM duckdb_databases()
       WHERE database_name NOT IN ('system','temp') ORDER BY database_name`,
    )
    if (!rows.length) {
      // 退路:若 duckdb_databases() 不可用或为空,至少给一个默认 catalog。
      return [
        { kind: MetaNodeKind.Database, name: 'memory', path: ['memory'], hasChildren: true },
      ]
    }
    return rows.map((r) => ({
      kind: MetaNodeKind.Database,
      name: String(r.name),
      path: [String(r.name)],
      hasChildren: true,
    }))
  }

  private async listSchemas(database: string): Promise<MetadataNode[]> {
    const rows = await this.q(
      `SELECT schema_name AS name FROM information_schema.schemata
       WHERE catalog_name = ? AND schema_name NOT IN ('information_schema','pg_catalog')
       ORDER BY schema_name`,
      [database],
    )
    return rows.map((r) => ({
      kind: MetaNodeKind.Schema,
      name: String(r.name),
      path: [database, String(r.name)],
      hasChildren: true,
    }))
  }

  private async schemaGroups(database: string, schema: string): Promise<MetadataNode[]> {
    const [tables, views, seqs] = await Promise.all([
      this.scalar(
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_catalog = ? AND table_schema = ? AND table_type = 'BASE TABLE'`,
        [database, schema],
      ),
      this.scalar(
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_catalog = ? AND table_schema = ? AND table_type = 'VIEW'`,
        [database, schema],
      ),
      this.scalar(
        `SELECT COUNT(*) AS c FROM duckdb_sequences()
         WHERE database_name = ? AND schema_name = ?`,
        [database, schema],
      ).catch(() => 0),
    ])
    const p = [database, schema]
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
      {
        kind: MetaNodeKind.Group,
        name: '序列',
        path: p,
        group: 'sequences',
        hasChildren: true,
        count: seqs,
      },
    ]
  }

  private async listGroupObjects(path: string[], group?: string): Promise<MetadataNode[]> {
    const database = path[0]
    const schema = path[1]
    const quote = duckdbHelpers.quoteIdentifier
    if (group === 'columns') return this.listColumns(database, schema, path[2])
    if (group === 'tables' || group === 'views') {
      const kind = group === 'views' ? MetaNodeKind.View : MetaNodeKind.Table
      const tableType = group === 'views' ? 'VIEW' : 'BASE TABLE'
      const rows = await this.q(
        `SELECT table_name AS name FROM information_schema.tables
         WHERE table_catalog = ? AND table_schema = ? AND table_type = ?
         ORDER BY table_name`,
        [database, schema, tableType],
      )
      return rows.map((r) => {
        const name = String(r.name)
        return {
          kind,
          name,
          path: [database, schema, name],
          hasChildren: true,
          sqlName: `${quote(database)}.${quote(schema)}.${quote(name)}`,
        }
      })
    }
    if (group === 'sequences') {
      try {
        const rows = await this.q(
          `SELECT sequence_name AS name FROM duckdb_sequences()
           WHERE database_name = ? AND schema_name = ? ORDER BY sequence_name`,
          [database, schema],
        )
        return rows.map((r) => ({
          kind: MetaNodeKind.Sequence,
          name: String(r.name),
          path: [database, schema, String(r.name)],
          hasChildren: false,
        }))
      } catch {
        return []
      }
    }
    return []
  }

  private async tableSubGroups(path: string[]): Promise<MetadataNode[]> {
    const [database, schema, table] = path
    const cols = await this.scalar(
      `SELECT COUNT(*) AS c FROM information_schema.columns
       WHERE table_catalog = ? AND table_schema = ? AND table_name = ?`,
      [database, schema, table],
    )
    return [
      {
        kind: MetaNodeKind.Group,
        name: '列',
        path,
        group: 'columns',
        hasChildren: true,
        count: cols,
      },
    ]
  }

  private async listColumns(
    database: string,
    schema: string,
    table: string,
  ): Promise<MetadataNode[]> {
    const rows = await this.q(
      `SELECT column_name AS name, data_type AS dtype, is_nullable AS nullable, column_default AS dflt
       FROM information_schema.columns
       WHERE table_catalog = ? AND table_schema = ? AND table_name = ?
       ORDER BY ordinal_position`,
      [database, schema, table],
    )
    return rows.map((r) => ({
      kind: MetaNodeKind.Column,
      name: String(r.name),
      path: [database, schema, table, String(r.name)],
      hasChildren: false,
      detail: {
        dataType: String(r.dtype ?? 'unknown'),
        nullable: String(r.nullable ?? 'YES').toUpperCase() === 'YES',
        defaultValue: r.dflt == null ? null : String(r.dflt),
      },
    }))
  }

  async ping(): Promise<void> {
    await this.conn.run('SELECT 1')
  }

  async close(): Promise<void> {
    try {
      this.conn.closeSync?.()
    } catch {
      // ignore
    }
    try {
      this.instance.closeSync?.()
    } catch {
      // ignore
    }
  }
}

export function createDuckdbDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: duckdbHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const mod = await loadDuckDb()
      const file = config.database?.trim() || ':memory:'
      const instance = await mod.DuckDBInstance.create(file)
      const conn = await instance.connect()
      return new DuckdbConnection(instance, conn)
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      try {
        const mod = await loadDuckDb()
        const file = config.database?.trim() || ':memory:'
        const instance = await mod.DuckDBInstance.create(file)
        const conn = await instance.connect()
        try {
          const result = await conn.run('SELECT version() AS v')
          const rows = (await result.getRowObjects()) as Array<{ v?: unknown }>
          const v = rows[0]?.v
          return {
            ok: true,
            serverVersion: v != null ? String(v) : undefined,
            latencyMs: Date.now() - start,
          }
        } finally {
          try {
            conn.closeSync?.()
          } catch {
            // ignore
          }
          try {
            instance.closeSync?.()
          } catch {
            // ignore
          }
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}
