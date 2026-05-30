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
 * oracledb 惰性加载：core-driver 不直接依赖，仅连接时按需 import。
 * 默认 thin 模式(纯 JS,无需 Instant Client,也无需 electron-rebuild)。
 * 仅当显式切到 thick 模式时才需要 Instant Client + electron-rebuild。
 * 用非字面量 specifier,避免未安装时编译期报"找不到模块"。
 */
async function loadOracleDb(): Promise<any> {
  const spec: string = 'oracledb'
  try {
    const mod: any = await import(spec)
    const oracledb = mod.default ?? mod
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
    // CLOB → string: dbms_metadata.get_ddl 返回 CLOB,默认是 Lob 对象;
    // 设这一行后所有 CLOB 列自动 fetch 为 string,前端逻辑能直接读 row.ddl。
    // (LONG 类型用 all_views.text 也建议,但 LONG 由 outFormat OBJECT 默认走 string)
    oracledb.fetchAsString = [oracledb.CLOB]
    return oracledb
  } catch {
    throw new Error(
      'Oracle 驱动未安装: 请执行 `pnpm -F @db-tool/desktop add oracledb` 后重启桌面端 (默认 thin 模式,纯 JS,无需 Instant Client / electron-rebuild)。',
    )
  }
}

function connectString(config: ConnectionConfig): string {
  const service = (config.extra?.serviceName as string) || config.database || 'XEPDB1'
  return `${config.host}:${config.port}/${service}`
}

/**
 * 从 extra.privilege 读取角色,映射到 oracledb 常量。
 * 支持值:'SYSDBA' | 'SYSOPER' | 'SYSASM' | 'SYSBACKUP' | 'SYSDG' | 'SYSKM' | 'SYSRAC'
 * 不设或 NORMAL → 不传 privilege 字段(默认普通登录)。
 */
function privilegeOption(oracledb: any, config: ConnectionConfig): { privilege?: number } {
  const raw = (config.extra?.privilege as string | undefined)?.toUpperCase()
  if (!raw || raw === 'NORMAL') return {}
  const map: Record<string, string> = {
    SYSDBA: 'SYSDBA',
    SYSOPER: 'SYSOPER',
    SYSASM: 'SYSASM',
    SYSBACKUP: 'SYSBACKUP',
    SYSDG: 'SYSDG',
    SYSKM: 'SYSKM',
    SYSRAC: 'SYSRAC',
  }
  const key = map[raw]
  if (!key || typeof oracledb[key] === 'undefined') return {}
  return { privilege: oracledb[key] as number }
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
      // Oracle 默认 autoCommit=false,如果不显式提交 INSERT/UPDATE/DELETE/DDL,
      // 用户在另一个 session(比如查询页)看不到改动,误以为"没生效"。
      // 这里把 autoCommit 设为 true 跟 MySQL/PG 默认行为对齐;
      // 未来引入 manual commit session 时再走 ExecuteOptions.commit=false 分支。
      const res = await conn.execute(paginate(sql, options), params as unknown[], {
        autoCommit: true,
      })
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
    // 一次拉齐 6 类常见对象的计数 (Oracle 表/视图/物化视图/序列/触发器/包+函数+过程+类型 都在
    // all_objects 里按 object_type 区分)。避免 6 次 round-trip 用一条聚合查询。
    const objCounts = await this.q(
      `SELECT object_type AS "t", COUNT(*) AS "c"
         FROM all_objects
        WHERE owner = :1
          AND object_type IN (
            'TABLE','VIEW','MATERIALIZED VIEW','SEQUENCE','TRIGGER',
            'FUNCTION','PROCEDURE','PACKAGE','TYPE','SYNONYM'
          )
        GROUP BY object_type`,
      [schema],
    )
    const cnt = (t: string): number =>
      Number((objCounts.find((r: any) => r.t === t) as { c?: number } | undefined)?.c ?? 0)
    const p = [schema]
    const mk = (name: string, group: string, count: number): MetadataNode => ({
      kind: MetaNodeKind.Group,
      name,
      path: p,
      group,
      hasChildren: count > 0,
      count,
    })
    // 顺序: 表 > 视图 > 物化视图 > 函数 > 存储过程 > 包 > 序列 > 触发器 > 类型 > 同义词
    return [
      mk('表', 'tables', cnt('TABLE')),
      mk('视图', 'views', cnt('VIEW')),
      mk('物化视图', 'mviews', cnt('MATERIALIZED VIEW')),
      mk('函数', 'functions', cnt('FUNCTION')),
      mk('存储过程', 'procedures', cnt('PROCEDURE')),
      mk('包', 'packages', cnt('PACKAGE')),
      mk('序列', 'sequences', cnt('SEQUENCE')),
      mk('触发器', 'triggers', cnt('TRIGGER')),
      mk('类型', 'types', cnt('TYPE')),
      mk('同义词', 'synonyms', cnt('SYNONYM')),
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
    // Oracle 12c+ all_users 有 oracle_maintained 字段 ('Y' = 系统内置如 SYS/SYSTEM/MDSYS/XDB...)
    // 用它精准过滤系统 schema; 12c 以下回落到一条无过滤查询(可接受,旧版本受众小)。
    let rows: any[]
    try {
      rows = await this.q(
        `SELECT username AS "name", oracle_maintained AS "sys"
           FROM all_users
          ORDER BY oracle_maintained, username`,
      )
    } catch {
      rows = await this.q('SELECT username AS "name" FROM all_users ORDER BY username')
    }
    return rows
      .filter((r: any) => r.sys !== 'Y') // 隐藏系统 schema
      .map((r: any) => ({
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
    if (group === 'mviews') {
      const rows = await this.q(
        'SELECT mview_name AS "name" FROM all_mviews WHERE owner = :1 ORDER BY mview_name',
        [schema],
      )
      return rows.map((r: any) => ({
        kind: MetaNodeKind.View,
        name: String(r.name),
        path: [schema, String(r.name)],
        hasChildren: false,
        sqlName: `${quote(schema)}.${quote(String(r.name))}`,
      }))
    }
    // 函数 / 存储过程 / 包 / 类型: 都在 all_procedures or all_objects 里;用 all_objects 通用
    if (
      group === 'functions' ||
      group === 'procedures' ||
      group === 'packages' ||
      group === 'types'
    ) {
      const oracleType =
        group === 'functions'
          ? 'FUNCTION'
          : group === 'procedures'
            ? 'PROCEDURE'
            : group === 'packages'
              ? 'PACKAGE'
              : 'TYPE'
      const rows = await this.q(
        `SELECT object_name AS "name" FROM all_objects
          WHERE owner = :1 AND object_type = :2 ORDER BY object_name`,
        [schema, oracleType],
      )
      const kind =
        group === 'functions'
          ? MetaNodeKind.Function
          : group === 'procedures'
            ? MetaNodeKind.Procedure
            : MetaNodeKind.Function // 包/类型借用 Function 类型(树侧渲染一致),前端无独立 kind
      return rows.map((r: any) => ({
        kind,
        name: String(r.name),
        path: [schema, String(r.name)],
        hasChildren: false,
        sqlName: `${quote(schema)}.${quote(String(r.name))}`,
      }))
    }
    if (group === 'sequences') {
      const rows = await this.q(
        'SELECT sequence_name AS "name" FROM all_sequences WHERE sequence_owner = :1 ORDER BY sequence_name',
        [schema],
      )
      return rows.map((r: any) => ({
        kind: MetaNodeKind.Sequence,
        name: String(r.name),
        path: [schema, String(r.name)],
        hasChildren: false,
        sqlName: `${quote(schema)}.${quote(String(r.name))}`,
      }))
    }
    if (group === 'triggers') {
      const rows = await this.q(
        'SELECT trigger_name AS "name" FROM all_triggers WHERE owner = :1 ORDER BY trigger_name',
        [schema],
      )
      return rows.map((r: any) => ({
        kind: MetaNodeKind.Trigger,
        name: String(r.name),
        path: [schema, String(r.name)],
        hasChildren: false,
        sqlName: `${quote(schema)}.${quote(String(r.name))}`,
      }))
    }
    if (group === 'synonyms') {
      const rows = await this.q(
        `SELECT synonym_name AS "name", table_owner AS "towner", table_name AS "tname"
           FROM all_synonyms WHERE owner = :1 ORDER BY synonym_name`,
        [schema],
      )
      return rows.map((r: any) => ({
        kind: MetaNodeKind.View, // 同义词最像视图(指向另一个对象);前端可读
        // 名字直接带上目标,免去用户点开找跳转
        name: `${String(r.name)} → ${String(r.towner)}.${String(r.tname)}`,
        path: [schema, String(r.name)],
        hasChildren: false,
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
        ...privilegeOption(oracledb, config),
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
          ...privilegeOption(oracledb, config),
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
