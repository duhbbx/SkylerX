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

function isSelect(sql: string): boolean {
  return /^\s*(select|with)\b/i.test(sql)
}

/**
 * SQL Server 分页：包子查询 + `ORDER BY (SELECT NULL)` + OFFSET/FETCH。
 * 注意：内层查询不可自带 ORDER BY（SQL Server 派生表限制）；浏览类分页均无内层排序。
 */
function paginate(sql: string, options?: ExecuteOptions): string {
  if (options?.limit == null || !isSelect(sql)) return sql
  const inner = sql.trim().replace(/;\s*$/, '')
  return `SELECT * FROM (${inner}) AS _pg ORDER BY (SELECT NULL) OFFSET ${options.offset ?? 0} ROWS FETCH NEXT ${options.limit} ROWS ONLY`
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
    const paged = paginate(sql, options)
    // 切库：批处理前置 USE（mssql 连接池下同批次生效）
    const text = options?.database ? `USE ${brq(options.database)};\n${paged}` : paged
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

  // SQL Server 树形（用三段式名跨库），与 MySQL/PG 对齐：
  //   Connection → Database → Schema → Group(表/视图, 带计数) → Table/View
  //                  → Group(列/索引/键, 带计数) → Column/Index/Key
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
        return this.tableSubGroups(scope.path[0], scope.path[1], scope.path[2])
      default:
        return []
    }
  }

  private async scalar(sql: string, binds: Record<string, unknown>): Promise<number> {
    const req = this.pool.request()
    for (const [k, v] of Object.entries(binds)) req.input(k, v)
    const r = await req.query(sql)
    const rows = r.recordset as unknown as Array<{ c: number }>
    return Number(rows[0]?.c ?? 0)
  }

  private async schemaGroups(db: string, schema: string): Promise<MetadataNode[]> {
    const tablesSql = `SELECT COUNT(*) c FROM ${brq(db)}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=@s AND TABLE_TYPE=@t`
    const [tables, views] = await Promise.all([
      this.scalar(tablesSql, { s: schema, t: 'BASE TABLE' }),
      this.scalar(tablesSql, { s: schema, t: 'VIEW' }),
    ])
    const p = [db, schema]
    return [
      { kind: MetaNodeKind.Group, name: '表', path: p, group: 'tables', hasChildren: true, count: tables },
      { kind: MetaNodeKind.Group, name: '视图', path: p, group: 'views', hasChildren: true, count: views },
    ]
  }

  private async tableSubGroups(db: string, schema: string, table: string): Promise<MetadataNode[]> {
    const [cols, idx, keys] = await Promise.all([
      this.scalar(
        `SELECT COUNT(*) c FROM ${brq(db)}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@s AND TABLE_NAME=@t`,
        { s: schema, t: table },
      ),
      this.scalar(
        `SELECT COUNT(*) c FROM ${brq(db)}.sys.indexes i JOIN ${brq(db)}.sys.objects o ON i.object_id=o.object_id JOIN ${brq(db)}.sys.schemas sc ON o.schema_id=sc.schema_id WHERE sc.name=@s AND o.name=@t AND i.name IS NOT NULL`,
        { s: schema, t: table },
      ),
      this.scalar(
        `SELECT COUNT(*) c FROM ${brq(db)}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=@s AND TABLE_NAME=@t`,
        { s: schema, t: table },
      ),
    ])
    const p = [db, schema, table]
    return [
      { kind: MetaNodeKind.Group, name: '列', path: p, group: 'columns', hasChildren: true, count: cols },
      { kind: MetaNodeKind.Group, name: '索引', path: p, group: 'indexes', hasChildren: true, count: idx },
      { kind: MetaNodeKind.Group, name: '键', path: p, group: 'keys', hasChildren: true, count: keys },
    ]
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
    switch (group) {
      case 'tables':
      case 'views': {
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
      case 'columns':
        return this.listColumns(db, schema, path[2])
      case 'indexes': {
        const r = await this.pool
          .request()
          .input('s', schema)
          .input('t', path[2])
          .query(
            `SELECT i.name AS name FROM ${brq(db)}.sys.indexes i JOIN ${brq(db)}.sys.objects o ON i.object_id=o.object_id JOIN ${brq(db)}.sys.schemas sc ON o.schema_id=sc.schema_id WHERE sc.name=@s AND o.name=@t AND i.name IS NOT NULL ORDER BY i.name`,
          )
        return (r.recordset as unknown as Array<{ name: string }>).map((row) => ({
          kind: MetaNodeKind.Index,
          name: row.name,
          path: [...path, row.name],
          hasChildren: false,
        }))
      }
      case 'keys': {
        const r = await this.pool
          .request()
          .input('s', schema)
          .input('t', path[2])
          .query(
            `SELECT CONSTRAINT_NAME AS name, CONSTRAINT_TYPE AS t FROM ${brq(db)}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=@s AND TABLE_NAME=@t ORDER BY CONSTRAINT_NAME`,
          )
        return (r.recordset as unknown as Array<{ name: string; t: string }>).map((row) => ({
          kind: MetaNodeKind.Index,
          name: `${row.name} (${row.t})`,
          path: [...path, row.name],
          hasChildren: false,
        }))
      }
      default:
        return []
    }
  }

  private async listColumns(db: string, schema: string, table: string): Promise<MetadataNode[]> {
    const r = await this.pool
      .request()
      .input('s', schema)
      .input('t', table)
      .query(
        `SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS datatype, c.IS_NULLABLE AS isnullable, c.COLUMN_DEFAULT AS dflt,
                CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS ispk
           FROM ${brq(db)}.INFORMATION_SCHEMA.COLUMNS c
           LEFT JOIN (
             SELECT ku.COLUMN_NAME
               FROM ${brq(db)}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
               JOIN ${brq(db)}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
                 ON tc.CONSTRAINT_NAME=ku.CONSTRAINT_NAME AND tc.TABLE_SCHEMA=ku.TABLE_SCHEMA AND tc.TABLE_NAME=ku.TABLE_NAME
              WHERE tc.CONSTRAINT_TYPE='PRIMARY KEY' AND tc.TABLE_SCHEMA=@s AND tc.TABLE_NAME=@t
           ) pk ON pk.COLUMN_NAME=c.COLUMN_NAME
          WHERE c.TABLE_SCHEMA=@s AND c.TABLE_NAME=@t ORDER BY c.ORDINAL_POSITION`,
      )
    return (r.recordset as unknown as Array<Record<string, unknown>>).map((row) => ({
      kind: MetaNodeKind.Column,
      name: String(row.name),
      path: [db, schema, table, String(row.name)],
      hasChildren: false,
      detail: {
        dataType: String(row.datatype),
        nullable: row.isnullable === 'YES',
        primaryKey: Number(row.ispk) === 1,
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
