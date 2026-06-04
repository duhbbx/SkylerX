/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type ConnectionConfig,
  DbDialect,
  type ExecuteOptions,
  MetaNodeKind,
  type MetaScope,
  type MetadataNode,
  type QueryColumn,
  type QueryResult,
  type TestResult,
} from '@db-tool/shared-types'
import { Pool, type PoolClient, type PoolConfig } from 'pg'
// openGauss 内核（openGauss / GaussDB / Vastbase）用自研 sha256 / SM3 口令认证，标准 pg
// 握不上手。pg-opengauss 是 pg 的认证适配 fork（纯 JS，API 同构），仅给这几类方言用。
// @ts-expect-error pg-opengauss 不自带类型声明；运行时与 pg 同构，下面 cast 成 pg.Pool 使用。
import { Pool as OpenGaussPool } from 'pg-opengauss'
import { type DatabaseDriver, type DriverConnection, driverExtra } from '../driver.js'
import { pgFamilyHelpers } from './base.js'

/** openGauss 内核方言：连接走 pg-opengauss（自研 sha256/SM3 认证），其余 PG 系走标准 pg。 */
const OPENGAUSS_KERNEL: ReadonlySet<DbDialect> = new Set([
  DbDialect.OpenGauss,
  DbDialect.GaussDB,
  DbDialect.Vastbase,
  DbDialect.MogDB, // openGauss 内核（云和恩墨）→ 走 pg-opengauss
  DbDialect.Panweidb, // openGauss 内核（中国移动磐维）→ 走 pg-opengauss
  // 注：HighGo 是标准 PostgreSQL 系（非 openGauss 内核），用标准 pg 即可，不在此列
])
/** 按方言挑 Pool 实现：openGauss 内核 → pg-opengauss，否则标准 pg。两者 API 同构。 */
function pickPool(dialect: DbDialect): typeof Pool {
  return OPENGAUSS_KERNEL.has(dialect) ? (OpenGaussPool as typeof Pool) : Pool
}

/**
 * 把 ES2021 AggregateError 拆成可读单条消息.
 *
 * Node `dns.lookup({ all: true })` 会同时解析 IPv4 + IPv6 (e.g. localhost →
 * 127.0.0.1 + ::1), pg ≥8 在连这两条都失败时把多个 underlying errors
 * 打包成 AggregateError. AggregateError 的默认 .message = "AggregateError",
 * .toString() 也只显示这串, inner errors 全在 .errors 数组里. 直接抛给上层
 * → UI 只看到 "AggregateError" 完全不知道为啥连不上 (用户报: 双击 PG 连接报
 * 'Error invoking remote method connections:metadata: AggregateError').
 *
 * 拆开 .errors 拼成 "msg1; msg2" 形式, 让 ECONNREFUSED / EHOSTUNREACH /
 * authentication failed 这些有用信息真正传到用户眼前.
 */
function unwrapAggregate(e: unknown): Error {
  if (e && typeof e === 'object' && Array.isArray((e as { errors?: unknown[] }).errors)) {
    const inners = (e as { errors: unknown[] }).errors
      .map((x) => (x instanceof Error ? x.message : String(x)))
      .filter((s) => s && s !== 'undefined')
    if (inners.length) return new Error(inners.join('; '))
  }
  return e instanceof Error ? e : new Error(String(e))
}

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
    /** 方言：openGauss 内核(openGauss/Vastbase/MogDB/磐维/GaussDB)额外展示「包」等专属对象 */
    private readonly dialect: DbDialect = DbDialect.PostgreSQL,
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
        return this.listSchemas(scope.path[0], scope.showSystem)
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
    const og = OPENGAUSS_KERNEL.has(this.dialect)
    const zero = Promise.resolve(0)
    // openGauss/Vastbase 内核额外有:存储过程(routines PROCEDURE)、自定义类型(pg_type)、
    // 同义词(pg_synonym)、物化视图(relkind='m')。标准 PG / 金仓跳过这些查询(直接 0),
    // 避免 pg_synonym 不存在报错;均已在真 Vastbase 上验证查询可用。
    const [tables, views, funcs, seqs, pkgs, mviews, procs, types, syns] = await Promise.all([
      this.scalar(
        "SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'",
        [schema],
      ),
      this.scalar(
        "SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema=$1 AND table_type='VIEW'",
        [schema],
      ),
      // openGauss 把存储过程也算进 information_schema.routines 的 FUNCTION,得用 pg_proc.prokind
      // 区分(prokind='p' 是过程)。标准 PG 旧版没有 prokind,继续走 routines。
      og
        ? this.scalar(
            "SELECT COUNT(*) c FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind<>'p'",
            [schema],
          )
        : this.scalar(
            "SELECT COUNT(*) c FROM information_schema.routines WHERE routine_schema=$1 AND routine_type='FUNCTION'",
            [schema],
          ),
      this.scalar('SELECT COUNT(*) c FROM information_schema.sequences WHERE sequence_schema=$1', [
        schema,
      ]),
      og
        ? this.scalar(
            'SELECT COUNT(*) c FROM gs_package gp JOIN pg_namespace n ON n.oid = gp.pkgnamespace WHERE n.nspname=$1',
            [schema],
          )
        : zero,
      og
        ? this.scalar(
            "SELECT COUNT(*) c FROM pg_class k JOIN pg_namespace n ON n.oid=k.relnamespace WHERE k.relkind='m' AND n.nspname=$1",
            [schema],
          )
        : zero,
      og
        ? this.scalar(
            "SELECT COUNT(*) c FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind='p'",
            [schema],
          )
        : zero,
      og
        ? this.scalar(
            "SELECT COUNT(*) c FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND (t.typtype IN ('e','d') OR (t.typtype='c' AND NOT EXISTS (SELECT 1 FROM pg_class k WHERE k.reltype=t.oid AND k.relkind<>'c')))",
            [schema],
          )
        : zero,
      og
        ? this.scalar(
            'SELECT COUNT(*) c FROM pg_synonym s JOIN pg_namespace n ON n.oid=s.synnamespace WHERE n.nspname=$1',
            [schema],
          )
        : zero,
    ])
    const groups: MetadataNode[] = [
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
    if (og) {
      const g = (name: string, group: string, count: number): MetadataNode => ({
        kind: MetaNodeKind.Group,
        name,
        path,
        group,
        hasChildren: count > 0,
        count,
      })
      groups.push(
        g('物化视图', 'mviews', mviews),
        g('存储过程', 'procedures', procs),
        g('包', 'packages', pkgs),
        g('类型', 'types', types),
        g('同义词', 'synonyms', syns),
      )
    }
    return groups
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

  private async listSchemas(db: string, showSystem = false): Promise<MetadataNode[]> {
    // 默认过滤内置系统 schema：PG/openGauss 给用户创建的对象分配 OID >= 16384(FirstNormalObjectId)，
    // 内置 schema OID 更小。用 OID 而非硬编码名单——openGauss/Vastbase 有 30+ 个内置 schema
    // (dbe_perf / cstore / blockchain / dbms_* / sys …) 会把树塞满，且随版本变化。public 始终保留；
    // pg_% (pg_catalog / pg_temp_* / pg_toast*) 一并排除。跟 Oracle/DM 驱动按 oracle_maintained 过滤同理。
    // showSystem=true(设置「显示系统对象」)时不过滤，全量返回。
    const where = showSystem
      ? ''
      : "WHERE (oid >= 16384 OR nspname = 'public') AND nspname NOT LIKE 'pg_%'"
    const res = await this.pool.query(
      `SELECT nspname AS name FROM pg_namespace ${where} ORDER BY nspname`,
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
        // openGauss:用 prokind 排除过程(prokind='p'),否则过程会重复出现在「函数」组。
        const res = OPENGAUSS_KERNEL.has(this.dialect)
          ? await this.pool.query(
              "SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind<>'p' ORDER BY p.proname",
              [schema],
            )
          : await this.pool.query(
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
      case 'packages': {
        // openGauss 内核专属:包(gs_package)。仅在 schemaGroups 为 openGauss 内核挂了「包」组时到这。
        const res = await this.pool.query(
          'SELECT pkgname AS name FROM gs_package gp JOIN pg_namespace n ON n.oid = gp.pkgnamespace WHERE n.nspname=$1 ORDER BY pkgname',
          [schema],
        )
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          kind: MetaNodeKind.Package,
          name: String(r.name),
          path: [db, schema, String(r.name)],
          hasChildren: false,
          sqlName: `${q(schema)}.${q(String(r.name))}`,
        }))
      }
      case 'mviews': {
        // openGauss/Vastbase 物化视图(relkind='m')。
        const res = await this.pool.query(
          "SELECT k.relname AS name FROM pg_class k JOIN pg_namespace n ON n.oid=k.relnamespace WHERE k.relkind='m' AND n.nspname=$1 ORDER BY k.relname",
          [schema],
        )
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          kind: MetaNodeKind.MaterializedView,
          name: String(r.name),
          path: [db, schema, String(r.name)],
          hasChildren: false,
          sqlName: `${q(schema)}.${q(String(r.name))}`,
        }))
      }
      case 'procedures': {
        const res = await this.pool.query(
          "SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind='p' ORDER BY p.proname",
          [schema],
        )
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          kind: MetaNodeKind.Procedure,
          name: String(r.name),
          path: [db, schema, String(r.name)],
          hasChildren: false,
          sqlName: `${q(schema)}.${q(String(r.name))}`,
        }))
      }
      case 'types': {
        const res = await this.pool.query(
          "SELECT t.typname AS name FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND (t.typtype IN ('e','d') OR (t.typtype='c' AND NOT EXISTS (SELECT 1 FROM pg_class k WHERE k.reltype=t.oid AND k.relkind<>'c'))) ORDER BY t.typname",
          [schema],
        )
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          kind: MetaNodeKind.Type,
          name: String(r.name),
          path: [db, schema, String(r.name)],
          hasChildren: false,
          sqlName: `${q(schema)}.${q(String(r.name))}`,
        }))
      }
      case 'synonyms': {
        const res = await this.pool.query(
          'SELECT synname AS name FROM pg_synonym s JOIN pg_namespace n ON n.oid=s.synnamespace WHERE n.nspname=$1 ORDER BY synname',
          [schema],
        )
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          kind: MetaNodeKind.Synonym,
          name: String(r.name),
          path: [db, schema, String(r.name)],
          hasChildren: false,
          sqlName: `${q(schema)}.${q(String(r.name))}`,
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
  const PoolImpl = pickPool(dialect)
  return {
    dialect,
    sql: pgFamilyHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const pool = new PoolImpl(buildPoolConfig(config))
      // 空闲连接报错兜底，避免未处理错误导致主进程崩溃
      pool.on('error', (err) => console.error('[pg] pool error:', err.message))
      // pg.Pool 是 lazy connection（new Pool 不真连,要等第一次 query 才连）.
      // 用户报告"PG 连不上不报错" — 因为 connect() 直接返回 PgConnection 不抛错,
      // 错误延迟到 fetchMetadata 第一次 query 时才暴露,UI 这边看上去"没反应".
      // 主动跑一次轻量 ping 让连接错误在 connect() 阶段就抛出,UI 立刻能弹编辑框.
      try {
        await pool.query('SELECT 1')
      } catch (e) {
        await pool.end().catch(() => {
          /* 关闭失败不影响抛原始错误 */
        })
        throw unwrapAggregate(e)
      }
      return new PgConnection(pool, config.database || 'postgres', dialect)
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      const pool = new PoolImpl(buildPoolConfig(config))
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
        const err = unwrapAggregate(e)
        return { ok: false, message: err.message }
      } finally {
        await pool.end()
      }
    },
  }
}
