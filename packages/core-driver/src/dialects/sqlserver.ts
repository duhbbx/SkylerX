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
import mssql from 'mssql'
import type { DatabaseDriver, DriverConnection } from '../driver.js'
import { sqlServerHelpers } from './base.js'

/** 方括号转义标识符（用于库名插值，参数无法绑定标识符）。 */
function brq(id: string): string {
  return '[' + id.replace(/]/g, ']]') + ']'
}

function buildConfig(config: ConnectionConfig): mssql.config {
  return {
    server: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database || undefined,
    options: {
      encrypt: config.ssl?.enabled ?? false,
      trustServerCertificate: !(config.ssl?.rejectUnauthorized ?? false),
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  }
}

class MssqlConnection implements DriverConnection {
  constructor(private readonly pool: mssql.ConnectionPool) {}

  async execute(
    sql: string,
    params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const start = Date.now()
    const req = this.pool.request()
    params.forEach((p, i) => req.input(`p${i}`, p))
    // 切库：批处理前置 USE（mssql 连接池下同批次生效）
    const text = options?.database ? `USE ${brq(options.database)};\n${sql}` : sql
    const result = await req.query(text)
    const executionTimeMs = Date.now() - start

    const recordset = result.recordset
    if (recordset) {
      const columns: QueryColumn[] = recordset.columns
        ? Object.values(recordset.columns).map((c) => ({
            name: c.name,
            dataType: (c.type as { declaration?: string })?.declaration ?? 'unknown',
          }))
        : []
      const all = recordset as unknown as Array<Record<string, unknown>>
      const max = options?.maxRows
      const truncated = typeof max === 'number' && all.length > max
      const rows = truncated ? all.slice(0, max) : [...all]
      return { columns, rows, rowCount: rows.length, executionTimeMs, truncated }
    }
    const affectedRows = (result.rowsAffected ?? []).reduce((a, b) => a + b, 0)
    return { columns: [], rows: [], rowCount: 0, affectedRows, executionTimeMs }
  }

  // SQL Server 树形（库 → schema → 对象，用三段式名跨库）：
  //   Connection → Database → Schema → Group(表/视图) → Table/View → Column
  async fetchMetadata(scope: MetaScope): Promise<MetadataNode[]> {
    switch (scope.parentKind) {
      case MetaNodeKind.Connection:
        return this.listDatabases()
      case MetaNodeKind.Database:
        return this.listSchemas(scope.path[0])
      case MetaNodeKind.Schema:
        return schemaGroups(scope.path)
      case MetaNodeKind.Group:
        return this.listGroupObjects(scope.path, scope.group)
      case MetaNodeKind.Table:
      case MetaNodeKind.View:
        return this.listColumns(scope.path[0], scope.path[1], scope.path[2])
      default:
        return []
    }
  }

  private async listDatabases(): Promise<MetadataNode[]> {
    const r = await this.pool.request().query('SELECT name FROM sys.databases ORDER BY name')
    return (r.recordset as unknown as Array<{ name: string }>).map((row) => ({
      kind: MetaNodeKind.Database,
      name: row.name,
      path: [row.name],
      hasChildren: true,
    }))
  }

  private async listSchemas(db: string): Promise<MetadataNode[]> {
    const r = await this.pool
      .request()
      .query(`SELECT name FROM ${brq(db)}.sys.schemas WHERE schema_id < 16384 ORDER BY name`)
    return (r.recordset as unknown as Array<{ name: string }>).map((row) => ({
      kind: MetaNodeKind.Schema,
      name: row.name,
      path: [db, row.name],
      hasChildren: true,
    }))
  }

  private async listGroupObjects(path: string[], group?: string): Promise<MetadataNode[]> {
    const [db, schema] = path
    if (group === 'columns') return this.listColumns(db, schema, path[2])
    if (group !== 'tables' && group !== 'views') return []
    const wanted = group === 'views' ? 'VIEW' : 'BASE TABLE'
    const r = await this.pool
      .request()
      .input('s', schema)
      .input('t', wanted)
      .query(
        `SELECT TABLE_NAME AS name FROM ${brq(db)}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=@s AND TABLE_TYPE=@t ORDER BY TABLE_NAME`,
      )
    return (r.recordset as unknown as Array<{ name: string }>).map((row) => ({
      kind: group === 'views' ? MetaNodeKind.View : MetaNodeKind.Table,
      name: row.name,
      path: [db, schema, row.name],
      hasChildren: true,
      sqlName: `${brq(db)}.${brq(schema)}.${brq(row.name)}`,
    }))
  }

  private async listColumns(db: string, schema: string, table: string): Promise<MetadataNode[]> {
    const r = await this.pool
      .request()
      .input('s', schema)
      .input('t', table)
      .query(
        `SELECT COLUMN_NAME AS name, DATA_TYPE AS datatype, IS_NULLABLE AS isnullable, COLUMN_DEFAULT AS dflt
           FROM ${brq(db)}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@s AND TABLE_NAME=@t ORDER BY ORDINAL_POSITION`,
      )
    return (r.recordset as unknown as Array<Record<string, unknown>>).map((row) => ({
      kind: MetaNodeKind.Column,
      name: String(row.name),
      path: [db, schema, table, String(row.name)],
      hasChildren: false,
      detail: {
        dataType: String(row.datatype),
        nullable: row.isnullable === 'YES',
        defaultValue: (row.dflt as string | null) ?? null,
      },
    }))
  }

  async ping(): Promise<void> {
    await this.pool.request().query('SELECT 1')
  }

  async close(): Promise<void> {
    await this.pool.close()
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

export function createSqlServerDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: sqlServerHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const pool = new mssql.ConnectionPool(buildConfig(config))
      await pool.connect()
      return new MssqlConnection(pool)
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      const pool = new mssql.ConnectionPool(buildConfig(config))
      try {
        await pool.connect()
        const r = await pool.request().query('SELECT @@VERSION AS v')
        const v = String((r.recordset as unknown as Array<{ v: string }>)[0]?.v ?? '')
        return {
          ok: true,
          serverVersion: v.split('\n')[0]?.trim() || undefined,
          latencyMs: Date.now() - start,
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      } finally {
        await pool.close()
      }
    },
  }
}
