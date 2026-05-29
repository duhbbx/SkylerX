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
import { Pool, type PoolClient, type PoolConfig } from 'pg'
import { type DatabaseDriver, type DriverConnection, driverExtra } from '../driver.js'
import { pgFamilyHelpers } from './base.js'

/** 常见 PostgreSQL 类型 OID → 类型名（结果列展示用）。 */
const PG_TYPES: Record<number, string> = {
  16: 'bool',
  17: 'bytea',
  18: 'char',
  20: 'int8',
  21: 'int2',
  23: 'int4',
  25: 'text',
  26: 'oid',
  114: 'json',
  700: 'float4',
  701: 'float8',
  1042: 'bpchar',
  1043: 'varchar',
  1082: 'date',
  1083: 'time',
  1114: 'timestamp',
  1184: 'timestamptz',
  1700: 'numeric',
  2950: 'uuid',
  3802: 'jsonb',
}

function pgTypeName(oid: number): string {
  return PG_TYPES[oid] ?? `oid:${oid}`
}

function isSelect(sql: string): boolean {
  return /^\s*(select|with)\b/i.test(sql)
}

/** SELECT 设置了 limit 时包子查询做分页（PG：LIMIT count OFFSET offset）。 */
function applyPaging(sql: string, options?: ExecuteOptions): string {
  if (options?.limit == null || !isSelect(sql)) return sql
  const inner = sql.trim().replace(/;\s*$/, '')
  return `SELECT * FROM (${inner}) AS _pg LIMIT ${options.limit} OFFSET ${options.offset ?? 0}`
}

function buildPoolConfig(config: ConnectionConfig): PoolConfig {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database || 'postgres',
    ssl: config.ssl?.enabled
      ? {
          rejectUnauthorized: config.ssl.rejectUnauthorized ?? true,
          ca: config.ssl.ca,
          cert: config.ssl.cert,
          key: config.ssl.key,
        }
      : undefined,
    max: 5,
    connectionTimeoutMillis: 10_000,
    // 剥掉应用层元数据（env / readOnly 等）再透传给 pg
    ...((driverExtra(config) as PoolConfig | undefined) ?? {}),
  }
}

class PgConnection implements DriverConnection {
  private activePid: number | null = null
  /** 手动提交模式下钉住的 PoolClient：sessionId → client */
  private readonly sessions = new Map<string, PoolClient>()
  private sessionSeq = 0

  constructor(
    private readonly pool: Pool,
    /** 本连接所在数据库（pg 一个连接对应一个库） */
    private readonly database: string,
  ) {}

  async execute(
    sql: string,
    params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const start = Date.now()
    const text = applyPaging(sql, options)
    // 始终用独占 client：既支持 search_path 会话态，也能记录 backend pid 以便取消
    const client = await this.pool.connect()
    this.activePid = (client as { processID?: number }).processID ?? null
    let res: {
      fields: Array<{ name: string; dataTypeID: number }>
      rows: unknown[]
      rowCount: number | null
    }
    try {
      if (options?.schema) {
        await client.query(`SET search_path TO ${pgFamilyHelpers.quoteIdentifier(options.schema)}`)
      }
      res = await client.query({ text, values: params })
    } finally {
      this.activePid = null
      client.release()
    }
    const executionTimeMs = Date.now() - start

    const columns: QueryColumn[] = res.fields.map((f) => ({
      name: f.name,
      dataType: pgTypeName(f.dataTypeID),
    }))

    // 有列定义 = 结果集（SELECT 等）；否则是 DML/DDL，用 rowCount 作为影响行数
    if (res.fields.length > 0) {
      const all = res.rows as Array<Record<string, unknown>>
      const max = options?.maxRows
      const truncated = typeof max === 'number' && all.length > max
      const rows = truncated ? all.slice(0, max) : all
      return { columns, rows, rowCount: rows.length, executionTimeMs, truncated }
    }
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      affectedRows: res.rowCount ?? 0,
      executionTimeMs,
    }
  }

  // PG 树形（比 MySQL 多一层 schema）：
  //   Connection → Database → Schema → Group(表/视图/函数/序列) → Table/View → Column
  async fetchMetadata(scope: MetaScope): Promise<MetadataNode[]> {
    switch (scope.parentKind) {
      case MetaNodeKind.Connection:
        // pg 一个连接对应一个库
        return [
          {
            kind: MetaNodeKind.Database,
            name: this.database,
            path: [this.database],
            hasChildren: true,
          },
        ]
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

  private async scalar(sql: string, params: unknown[]): Promise<number> {
    const res = await this.pool.query(sql, params)
    const rows = res.rows as Array<Record<string, unknown>>
    return Number(rows[0]?.c ?? 0)
  }

  private async schemaGroups(path: string[]): Promise<MetadataNode[]> {
    const [, schema] = path
    const [tables, views, funcs, seqs] = await Promise.all([
      this.scalar(
        "SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'",
        [schema],
      ),
      this.scalar(
        "SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema=$1 AND table_type='VIEW'",
        [schema],
      ),
      this.scalar(
        "SELECT COUNT(*) c FROM information_schema.routines WHERE routine_schema=$1 AND routine_type='FUNCTION'",
        [schema],
      ),
      this.scalar('SELECT COUNT(*) c FROM information_schema.sequences WHERE sequence_schema=$1', [
        schema,
      ]),
    ])
    return [
      {
        kind: MetaNodeKind.Group,
        name: '表',
        path,
        group: 'tables',
        hasChildren: true,
        count: tables,
      },
      {
        kind: MetaNodeKind.Group,
        name: '视图',
        path,
        group: 'views',
        hasChildren: true,
        count: views,
      },
      {
        kind: MetaNodeKind.Group,
        name: '函数',
        path,
        group: 'functions',
        hasChildren: true,
        count: funcs,
      },
      {
        kind: MetaNodeKind.Group,
        name: '序列',
        path,
        group: 'sequences',
        hasChildren: true,
        count: seqs,
      },
    ]
  }

  private async tableSubGroups(path: string[]): Promise<MetadataNode[]> {
    const [, schema, table] = path
    const [cols, idx, keys, trgs] = await Promise.all([
      this.scalar(
        'SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',
        [schema, table],
      ),
      this.scalar('SELECT COUNT(*) c FROM pg_indexes WHERE schemaname=$1 AND tablename=$2', [
        schema,
        table,
      ]),
      this.scalar(
        'SELECT COUNT(*) c FROM information_schema.table_constraints WHERE table_schema=$1 AND table_name=$2',
        [schema, table],
      ),
      this.scalar(
        'SELECT COUNT(DISTINCT trigger_name) c FROM information_schema.triggers WHERE trigger_schema=$1 AND event_object_table=$2',
        [schema, table],
      ),
    ])
    return [
      {
        kind: MetaNodeKind.Group,
        name: '列',
        path,
        group: 'columns',
        hasChildren: true,
        count: cols,
      },
      {
        kind: MetaNodeKind.Group,
        name: '索引',
        path,
        group: 'indexes',
        hasChildren: true,
        count: idx,
      },
      { kind: MetaNodeKind.Group, name: '键', path, group: 'keys', hasChildren: true, count: keys },
      {
        kind: MetaNodeKind.Group,
        name: '触发器',
        path,
        group: 'triggers',
        hasChildren: true,
        count: trgs,
      },
    ]
  }

  private async listSchemas(db: string): Promise<MetadataNode[]> {
    const res = await this.pool.query(
      'SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name',
    )
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      kind: MetaNodeKind.Schema,
      name: String(r.name),
      path: [db, String(r.name)],
      hasChildren: true,
    }))
  }

  private async listGroupObjects(path: string[], group?: string): Promise<MetadataNode[]> {
    const [db, schema] = path
    const q = pgFamilyHelpers.quoteIdentifier
    switch (group) {
      case 'tables':
      case 'views': {
        const wanted = group === 'views' ? 'VIEW' : 'BASE TABLE'
        const res = await this.pool.query(
          'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1 AND table_type = $2 ORDER BY table_name',
          [schema, wanted],
        )
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          kind: group === 'views' ? MetaNodeKind.View : MetaNodeKind.Table,
          name: String(r.name),
          path: [db, schema, String(r.name)],
          hasChildren: true,
          sqlName: `${q(schema)}.${q(String(r.name))}`,
        }))
      }
      case 'functions': {
        const res = await this.pool.query(
          "SELECT routine_name AS name FROM information_schema.routines WHERE routine_schema = $1 AND routine_type = 'FUNCTION' ORDER BY routine_name",
          [schema],
        )
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          kind: MetaNodeKind.Function,
          name: String(r.name),
          path: [db, schema, String(r.name)],
          hasChildren: false,
        }))
      }
      case 'sequences': {
        const res = await this.pool.query(
          'SELECT sequence_name AS name FROM information_schema.sequences WHERE sequence_schema = $1 ORDER BY sequence_name',
          [schema],
        )
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          kind: MetaNodeKind.Sequence,
          name: String(r.name),
          path: [db, schema, String(r.name)],
          hasChildren: false,
        }))
      }
      case 'triggers': {
        // 表级：path=[db, schema, table]
        const res = await this.pool.query(
          'SELECT DISTINCT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = $1 AND event_object_table = $2 ORDER BY trigger_name',
          [schema, path[2]],
        )
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          kind: MetaNodeKind.Trigger,
          name: String(r.name),
          path: [...path, String(r.name)],
          hasChildren: false,
        }))
      }
      case 'columns':
        return this.listColumns(schema, path[2])
      case 'indexes': {
        const res = await this.pool.query(
          'SELECT indexname AS name FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 ORDER BY indexname',
          [schema, path[2]],
        )
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          kind: MetaNodeKind.Index,
          name: String(r.name),
          path: [...path, String(r.name)],
          hasChildren: false,
        }))
      }
      case 'keys': {
        const res = await this.pool.query(
          'SELECT constraint_name AS name, constraint_type AS t FROM information_schema.table_constraints WHERE table_schema=$1 AND table_name=$2 ORDER BY constraint_name',
          [schema, path[2]],
        )
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          kind: MetaNodeKind.Index,
          name: `${String(r.name)} (${String(r.t)})`,
          path: [...path, String(r.name)],
          hasChildren: false,
        }))
      }
      default:
        return []
    }
  }

  private async listColumns(schema: string, table: string): Promise<MetadataNode[]> {
    const pkRes = await this.pool.query(
      `SELECT kcu.column_name AS name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
      [schema, table],
    )
    const pks = new Set((pkRes.rows as Array<Record<string, unknown>>).map((r) => String(r.name)))

    const res = await this.pool.query(
      `SELECT column_name AS name,
              CASE WHEN data_type = 'USER-DEFINED' THEN udt_name ELSE data_type END AS datatype,
              is_nullable AS isnullable,
              column_default AS defaultvalue
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [schema, table],
    )
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      kind: MetaNodeKind.Column,
      name: String(r.name),
      path: [schema, table, String(r.name)],
      hasChildren: false,
      detail: {
        dataType: String(r.datatype),
        nullable: r.isnullable === 'YES',
        primaryKey: pks.has(String(r.name)),
        defaultValue: (r.defaultvalue as string | null) ?? null,
      },
    }))
  }

  async executeBatch(statements: string[], options?: ExecuteOptions): Promise<void> {
    const client = await this.pool.connect()
    try {
      if (options?.schema) {
        await client.query(`SET search_path TO ${pgFamilyHelpers.quoteIdentifier(options.schema)}`)
      }
      await client.query('BEGIN')
      try {
        for (const s of statements) await client.query(s)
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      }
    } finally {
      client.release()
    }
  }

  // ── 手动提交会话（PG）─────────────────────────────────────────────
  // PG 的 PoolClient 是 LIFO 的「钉一条 backend」；在它身上 BEGIN/COMMIT/ROLLBACK，
  // 直到 endSession 才 release 回池。commit/rollback 后自动 BEGIN，匹配编辑器期望。
  async beginSession(options?: ExecuteOptions): Promise<string> {
    const client = await this.pool.connect()
    try {
      if (options?.schema) {
        await client.query(`SET search_path TO ${pgFamilyHelpers.quoteIdentifier(options.schema)}`)
      }
      await client.query('BEGIN')
    } catch (e) {
      client.release()
      throw e
    }
    const sid = `pg-s${++this.sessionSeq}-${Date.now()}`
    this.sessions.set(sid, client)
    return sid
  }

  async executeInSession(
    sessionId: string,
    sql: string,
    params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const client = this.sessions.get(sessionId)
    if (!client) throw new Error('SESSION_NOT_FOUND')
    const start = Date.now()
    const text = applyPaging(sql, options)
    const res = await client.query({ text, values: params })
    const executionTimeMs = Date.now() - start
    const columns: QueryColumn[] = res.fields.map((f) => ({
      name: f.name,
      dataType: pgTypeName(f.dataTypeID),
    }))
    if (res.fields.length > 0) {
      const all = res.rows as Array<Record<string, unknown>>
      const max = options?.maxRows
      const truncated = typeof max === 'number' && all.length > max
      const rows = truncated ? all.slice(0, max) : all
      return { columns, rows, rowCount: rows.length, executionTimeMs, truncated }
    }
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      affectedRows: res.rowCount ?? 0,
      executionTimeMs,
    }
  }

  async commitSession(sessionId: string): Promise<void> {
    const client = this.sessions.get(sessionId)
    if (!client) throw new Error('SESSION_NOT_FOUND')
    await client.query('COMMIT')
    await client.query('BEGIN')
  }

  async rollbackSession(sessionId: string): Promise<void> {
    const client = this.sessions.get(sessionId)
    if (!client) throw new Error('SESSION_NOT_FOUND')
    await client.query('ROLLBACK')
    await client.query('BEGIN')
  }

  async endSession(sessionId: string): Promise<void> {
    const client = this.sessions.get(sessionId)
    if (!client) return
    this.sessions.delete(sessionId)
    try {
      await client.query('ROLLBACK')
    } catch {
      /* 已经被外部 commit/rollback 也无所谓 */
    }
    client.release()
  }

  async cancelActive(): Promise<void> {
    const pid = this.activePid
    if (pid == null) return
    const client = await this.pool.connect()
    try {
      await client.query('SELECT pg_cancel_backend($1)', [pid])
    } catch {
      /* 查询可能已结束，忽略 */
    } finally {
      client.release()
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

/** 构建 PostgreSQL 系驱动（PostgreSQL / KingbaseES 协议兼容，共用实现）。 */
export function createPostgresDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: pgFamilyHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const pool = new Pool(buildPoolConfig(config))
      // 空闲连接报错兜底，避免未处理错误导致主进程崩溃
      pool.on('error', (err) => console.error('[pg] pool error:', err.message))
      return new PgConnection(pool, config.database || 'postgres')
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      const pool = new Pool(buildPoolConfig(config))
      try {
        const res = await pool.query('SELECT version() AS v')
        const raw = String((res.rows[0] as Record<string, unknown> | undefined)?.v ?? '')
        const match = raw.match(/PostgreSQL ([\d.]+)/)
        return {
          ok: true,
          serverVersion: match ? match[1] : raw || undefined,
          latencyMs: Date.now() - start,
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      } finally {
        await pool.end()
      }
    },
  }
}
