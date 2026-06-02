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
 *
 * ⚠️ `loginEncrypt=0` — 必须加, 否则 dmdb 协议级密码握手会协商 DES-CFB cipher,
 * 但 Node 18+ / Electron 22+ 的 OpenSSL 3 已彻底删除 DES-CFB (legacy provider 也没),
 * 触发 "Unknown cipher" 错误. 这条参数让 dmdb 跳过这段加密, 直接用明文协议传递密码.
 * 安全影响仅限本机回环 / 受信网络; 跨网必须配 SSL 隧道. 详见 dmdb/src/net/access.js.
 */
function buildDmUrl(config: ConnectionConfig): string {
  const user = encodeURIComponent(config.user ?? '')
  const password = encodeURIComponent(config.password ?? '')
  return `dm://${user}:${password}@${config.host}:${config.port}?loginEncrypt=0`
}
async function loadDmdb(): Promise<any> {
  const spec: string = 'dmdb'
  try {
    const mod: any = await import(spec)
    const dmdb = mod.default ?? mod
    dmdb.outFormat = dmdb.OUT_FORMAT_OBJECT
    // 必须强制 CLOB 直接返回 string, 否则 dmdb 返回 Lob 句柄(带 read() / close()
    // 方法), Electron IPC 走 structured clone 会抛 "An object could not be cloned".
    // 表现就是用户点"编辑视图定义" / "复制 DDL"等读 ALL_VIEWS.TEXT / ALL_SOURCE.TEXT
    // 的操作都报错. 跟 oracle.ts 的设置一致.
    if (dmdb.CLOB != null) dmdb.fetchAsString = [dmdb.CLOB]
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

  /** 手动提交会话：sessionId → 钉住的 dmdb 连接（statement 走 autoCommit:false）。 */
  private readonly sessions = new Map<string, any>()
  private sessionSeq = 0

  /** dmdb 结果 → QueryResult（execute 与 executeInSession 共用，避免重复）。 */
  private mapResult(res: any, start: number, options?: ExecuteOptions): QueryResult {
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
  }

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
      // 达梦/dmdb 默认 autoCommit=false（同 oracledb），不显式提交则改动不落库、归还连接池后还被
      // 回滚。这里 autoCommit=true 对齐 MySQL/PG；手动事务走 executeInSession(autoCommit:false)。
      const res = await conn.execute(paginate(sql, options), params as unknown[], {
        autoCommit: true,
      })
      return this.mapResult(res, start, options)
    } finally {
      await conn.close()
    }
  }

  // ── 手动提交事务会话（与 oracle.ts 同构）─────────────────────────
  async beginSession(options?: ExecuteOptions): Promise<string> {
    const conn = await this.pool.getConnection()
    try {
      if (options?.schema) {
        await conn.execute(`SET SCHEMA ${oracleFamilyHelpers.quoteIdentifier(options.schema)}`)
      }
    } catch (e) {
      await conn.close().catch(() => {})
      throw e
    }
    const sid = `dm-s${++this.sessionSeq}-${Date.now()}`
    this.sessions.set(sid, conn)
    return sid
  }

  async executeInSession(
    sessionId: string,
    sql: string,
    params: unknown[] = [],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const conn = this.sessions.get(sessionId)
    if (!conn) throw new Error('SESSION_NOT_FOUND')
    const start = Date.now()
    const res = await conn.execute(paginate(sql, options), params as unknown[], {
      autoCommit: false,
    })
    return this.mapResult(res, start, options)
  }

  async commitSession(sessionId: string): Promise<void> {
    const conn = this.sessions.get(sessionId)
    if (!conn) throw new Error('SESSION_NOT_FOUND')
    await conn.commit()
  }

  async rollbackSession(sessionId: string): Promise<void> {
    const conn = this.sessions.get(sessionId)
    if (!conn) throw new Error('SESSION_NOT_FOUND')
    await conn.rollback()
  }

  async endSession(sessionId: string): Promise<void> {
    const conn = this.sessions.get(sessionId)
    if (!conn) return
    this.sessions.delete(sessionId)
    try {
      await conn.rollback()
    } catch {
      /* 已提交/回滚:忽略 */
    }
    await conn.close().catch(() => {})
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
    // 跟 Oracle 同款一次性聚合 — DM 的 all_objects.object_type 覆盖 TABLE / VIEW /
    // SEQUENCE / TRIGGER / FUNCTION / PROCEDURE / PACKAGE / SYNONYM / TYPE / MATERIALIZED VIEW.
    // 之前只列 表 + 视图, 用户报告 DM 下 schema 看不到序列 / 触发器 / 函数 / 过程 — 补齐.
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
    // 之前只看 all_users — 在 DM 里 schema 是独立对象(可以跟用户同名也可以不同名:
    // CREATE SCHEMA name 不创建用户). 用户报告"新建 schema 后不显示" 根因就是这里:
    // 新 schema 没有对应的 all_users 行. 改成 SYS.SYSOBJECTS WHERE TYPE$='SCH', 这是
    // DM 系统表里专门记 schema 的入口, 用户+非用户 schema 都覆盖. 失败回 all_users 兜底.
    let rows: any[]
    try {
      rows = await this.q(
        `SELECT NAME AS "name" FROM SYS.SYSOBJECTS WHERE TYPE$ = 'SCH' ORDER BY NAME`,
      )
    } catch {
      rows = await this.q('SELECT username AS "name" FROM all_users ORDER BY username')
    }
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
    if (
      group === 'functions' ||
      group === 'procedures' ||
      group === 'packages' ||
      group === 'types' ||
      group === 'synonyms'
    ) {
      const dmType =
        group === 'functions'
          ? 'FUNCTION'
          : group === 'procedures'
            ? 'PROCEDURE'
            : group === 'packages'
              ? 'PACKAGE'
              : group === 'types'
                ? 'TYPE'
                : 'SYNONYM'
      const rows = await this.q(
        `SELECT object_name AS "name" FROM all_objects
          WHERE owner = :1 AND object_type = :2 ORDER BY object_name`,
        [schema, dmType],
      )
      const kind =
        group === 'functions'
          ? MetaNodeKind.Function
          : group === 'procedures'
            ? MetaNodeKind.Procedure
            : group === 'packages'
              ? MetaNodeKind.Package
              : group === 'types'
                ? MetaNodeKind.Type
                : MetaNodeKind.Synonym
      return rows.map((r: any) => ({
        kind,
        name: String(r.name),
        path: [schema, String(r.name)],
        hasChildren: false,
        group,
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

/**
 * 进程内单调递增，给每个 dmdb 池一个唯一 poolAlias。
 * dmdb 1.0.49630 对省略 poolAlias 的池一律登记为 "default"(driver/pool.js)，
 * 同一进程里第二个就抛 [20006] ECJS_POOL_ALIAS_CONFLICT（多开一个 DM 连接即触发）。
 * oracledb 不会——省略即不登记到 cache。DmConnection 直接持有 pool 句柄、从不按
 * alias 反查，故任意唯一串都安全；close() 时 dmdb 会把该 alias 从全局表删除。
 */
let dmPoolSeq = 0

export function createDmDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: oracleFamilyHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const dmdb = await loadDmdb()
      const pool = await dmdb.createPool({
        connectString: buildDmUrl(config),
        // ⚠️ poolMin 必须 ≥ 1: dmdb 1.0.49630 在 poolMin=0(默认) 时只是占位 pool,
        // 不预热任何 worker, 之后 getConnection 全部排队 → ECJS_POOL_QUEUE_TIMEOUT [20017].
        // 与 oracledb 行为不同 (Oracle 默认 poolMin=0 也能工作).
        poolMin: 1,
        poolMax: 5,
        // 唯一 alias，避免多个 DM 池共享 "default" 而冲突（见上方 dmPoolSeq 说明）。
        poolAlias: `skylerx-dm-${++dmPoolSeq}`,
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
