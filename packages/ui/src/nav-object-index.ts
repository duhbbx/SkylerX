/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 全库对象索引 / 缓存 (#A v2).
 *
 * 解决 NavTree 搜索只能搜已加载节点的问题: 10w+ 对象的库不可能强制全展开.
 * 改为按连接维护一份 flat 数组缓存(db, schema, name, kind), 一条 catalog SQL
 * 一次拉全, 内存 includes() 扫描, 5MB / 10w 对象 / 10ms 量级.
 *
 * 失效:
 *  - TTL: 10 分钟 (DDL 频率多数场景这个够). 见 isStale().
 *  - 用户主动: 调 invalidate(connId).
 *  - SkylerX 内 CREATE/DROP 后调用方应自行 invalidate (本模块不订阅 IPC).
 *
 * 不持久化磁盘 (v1). 冷启动一切重建. v2 可写 IndexedDB 提速但需额外失效协议.
 */
import { type DataClient, DbDialect } from '@db-tool/shared-types'
import { familyOf } from './ddl'

export type IndexKind =
  | 'table'
  | 'view'
  | 'function'
  | 'procedure'
  | 'sequence'
  | 'trigger'
  | 'index'

export interface ObjectIndexEntry {
  kind: IndexKind
  /** 库名. Oracle/DM 这里塞 schema (它们 conn 直挂 schema). */
  db: string
  /** PG / MSSQL 用; 其它方言空字符串. */
  schema: string
  /** 对象名. */
  name: string
}

export interface ObjectIndex {
  connId: string
  dialect: DbDialect
  entries: ObjectIndexEntry[]
  builtAt: number
}

/** 单条命中, 自带定位用的路径信息. */
export interface IndexHit extends ObjectIndexEntry {
  connId: string
}

const TTL_MS = 10 * 60 * 1000 // 10 分钟

const cache = new Map<string, ObjectIndex>()

export function getCached(connId: string): ObjectIndex | undefined {
  return cache.get(connId)
}

export function isStale(idx: ObjectIndex | undefined, now = Date.now()): boolean {
  if (!idx) return true
  return now - idx.builtAt > TTL_MS
}

export function invalidate(connId: string): void {
  cache.delete(connId)
}

export function invalidateAll(): void {
  cache.clear()
}

/**
 * 全库 catalog SQL — 按方言拼一条 UNION ALL, 返回 {kind, db, schema, name}.
 * 不支持的方言 (NoSQL / SQLite / DuckDB / ClickHouse) 抛 ObjectIndexNotSupported.
 */
export class ObjectIndexNotSupported extends Error {
  constructor(dialect: DbDialect) {
    super(`方言 ${dialect} 不支持全库对象索引 (NoSQL / 文件型 / 列式特殊存储).`)
    this.name = 'ObjectIndexNotSupported'
  }
}

function catalogSql(dialect: DbDialect): string {
  // ClickHouse 单独排除 — system.tables 在大集群上是慢查询, 后续单独优化
  if (dialect === DbDialect.ClickHouse) throw new ObjectIndexNotSupported(dialect)
  if (
    dialect === DbDialect.SQLite ||
    dialect === DbDialect.DuckDB ||
    dialect === DbDialect.Redis ||
    dialect === DbDialect.MongoDB ||
    dialect === DbDialect.Elasticsearch
  ) {
    throw new ObjectIndexNotSupported(dialect)
  }
  switch (familyOf(dialect)) {
    case 'mysql':
      // information_schema 跨 MySQL/MariaDB/OB/TiDB/Doris 都通用. Doris 没 ROUTINES 但
      // UNION 容错 — 列名对齐就行, 缺表会 server error, 暂用主集.
      // Doris/StarRocks 实测 ROUTINES 返回空; TRIGGERS 同样安全.
      return `
        SELECT TABLE_SCHEMA AS db, '' AS \`schema\`, TABLE_NAME AS name,
               CASE WHEN TABLE_TYPE='VIEW' THEN 'view' ELSE 'table' END AS kind
          FROM information_schema.TABLES
          WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
        UNION ALL
        SELECT ROUTINE_SCHEMA AS db, '' AS \`schema\`, ROUTINE_NAME AS name,
               CASE WHEN ROUTINE_TYPE='FUNCTION' THEN 'function' ELSE 'procedure' END AS kind
          FROM information_schema.ROUTINES
          WHERE ROUTINE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
        UNION ALL
        SELECT TRIGGER_SCHEMA AS db, '' AS \`schema\`, TRIGGER_NAME AS name,
               'trigger' AS kind
          FROM information_schema.TRIGGERS
          WHERE TRIGGER_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
        UNION ALL
        SELECT TABLE_SCHEMA AS db, '' AS \`schema\`, INDEX_NAME AS name,
               'index' AS kind
          FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
            AND INDEX_NAME <> 'PRIMARY'
          GROUP BY TABLE_SCHEMA, INDEX_NAME
      `
    case 'pg':
      // 单 query 拉表 / 视图 / 函数 / 序列 / 触发器 / 索引. 排除 pg_catalog / information_schema.
      return `
        SELECT n.nspname AS db_schema, c.relname AS name,
               CASE c.relkind
                 WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'f' THEN 'table'
                 WHEN 'v' THEN 'view' WHEN 'm' THEN 'view'
                 WHEN 'S' THEN 'sequence' WHEN 'i' THEN 'index' END AS kind
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','f','v','m','S','i')
            AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
            AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
        UNION ALL
        SELECT n.nspname AS db_schema, p.proname AS name,
               CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END AS kind
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        UNION ALL
        SELECT n.nspname AS db_schema, t.tgname AS name, 'trigger' AS kind
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE NOT t.tgisinternal
      `
    case 'sqlserver':
      return `
        SELECT
          DB_NAME() AS db, SCHEMA_NAME(o.schema_id) AS [schema], o.name AS name,
          CASE o.type
            WHEN 'U' THEN 'table' WHEN 'V' THEN 'view'
            WHEN 'FN' THEN 'function' WHEN 'IF' THEN 'function' WHEN 'TF' THEN 'function'
            WHEN 'P' THEN 'procedure' WHEN 'TR' THEN 'trigger' WHEN 'SO' THEN 'sequence'
          END AS kind
        FROM sys.objects o
        WHERE o.type IN ('U','V','FN','IF','TF','P','TR','SO')
          AND o.is_ms_shipped = 0
        UNION ALL
        SELECT DB_NAME() AS db, SCHEMA_NAME(t.schema_id) AS [schema],
               i.name AS name, 'index' AS kind
          FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id
          WHERE i.name IS NOT NULL AND i.is_primary_key = 0
      `
    case 'oracle':
      // Oracle/DM: db 列填 schema(=OWNER), schema 列空. tab/view/func/proc/seq/trigger/index
      return `
        SELECT OWNER AS db, '' AS schema_name, OBJECT_NAME AS name,
               LOWER(
                 CASE OBJECT_TYPE
                   WHEN 'TABLE' THEN 'table' WHEN 'VIEW' THEN 'view'
                   WHEN 'FUNCTION' THEN 'function' WHEN 'PROCEDURE' THEN 'procedure'
                   WHEN 'SEQUENCE' THEN 'sequence' WHEN 'TRIGGER' THEN 'trigger'
                   WHEN 'INDEX' THEN 'index'
                 END
               ) AS kind
          FROM ALL_OBJECTS
          WHERE OBJECT_TYPE IN ('TABLE','VIEW','FUNCTION','PROCEDURE','SEQUENCE','TRIGGER','INDEX')
            AND OWNER NOT IN ('SYS','SYSTEM','XDB','MDSYS','CTXSYS','DBSNMP','OUTLN','APEX_040000','APPQOSSYS','GSMADMIN_INTERNAL','OJVMSYS','ORDDATA','ORDSYS','SI_INFORMTN_SCHEMA','WMSYS')
      `
    default:
      throw new ObjectIndexNotSupported(dialect)
  }
}

/**
 * 把驱动返回的行归一成 ObjectIndexEntry[].
 *
 * pg 那条 SQL 把 db 和 schema 合在 db_schema 单列(PG 单连接一般只挂一个 db,
 * 把 nspname 当 schema, db 留空避免树定位歧义). 其它方言列名一致.
 */
function normalize(rows: Array<Record<string, unknown>>, dialect: DbDialect): ObjectIndexEntry[] {
  const fam = familyOf(dialect)
  const out: ObjectIndexEntry[] = []
  for (const r of rows) {
    const kindRaw = r.kind ?? r.KIND
    if (typeof kindRaw !== 'string') continue
    const kind = kindRaw.toLowerCase() as IndexKind
    if (
      kind !== 'table' &&
      kind !== 'view' &&
      kind !== 'function' &&
      kind !== 'procedure' &&
      kind !== 'sequence' &&
      kind !== 'trigger' &&
      kind !== 'index'
    )
      continue
    const nameRaw = r.name ?? r.NAME
    if (typeof nameRaw !== 'string' || !nameRaw) continue

    if (fam === 'pg') {
      const ns = r.db_schema ?? r.DB_SCHEMA
      out.push({
        kind,
        db: '', // PG 单 conn 一般 1 db, schema 才是导航关键
        schema: typeof ns === 'string' ? ns : '',
        name: nameRaw,
      })
    } else if (fam === 'sqlserver') {
      out.push({
        kind,
        db: String(r.db ?? r.DB ?? ''),
        schema: String(r.schema ?? r.SCHEMA ?? r.Schema ?? ''),
        name: nameRaw,
      })
    } else {
      // mysql / oracle / dm — schema 列空, db 是首层导航
      out.push({
        kind,
        db: String(r.db ?? r.DB ?? ''),
        schema: '',
        name: nameRaw,
      })
    }
  }
  return out
}

/**
 * 异步构建索引. 写入 cache 并返回构建好的 ObjectIndex.
 *
 * 不重试; 失败抛错给上层做 UI 提示 (build dialog).
 * client 由调用方传, 保持本模块不依赖具体 IPC.
 */
export async function buildIndex(
  client: DataClient,
  connId: string,
  dialect: DbDialect,
): Promise<ObjectIndex> {
  const sql = catalogSql(dialect) // 抛出时上层 catch ObjectIndexNotSupported
  const res = await client.connections.execute(connId, sql)
  const entries = normalize(res.rows, dialect)
  const idx: ObjectIndex = { connId, dialect, entries, builtAt: Date.now() }
  cache.set(connId, idx)
  return idx
}

/**
 * 在已有索引中搜 — 仅匹配对象 name (不含 db/schema, 用户不想要"碰巧 db 里有这个词"
 * 的杂项命中). 大小写不敏感, includes. 不命中返回 []. 不会自动 build — 调用前
 * 应检查 getCached().
 */
export function searchIndex(idx: ObjectIndex, query: string, limit = 200): IndexHit[] {
  const q = query.trim().toLowerCase()
  if (!q || idx.entries.length === 0) return []
  const out: IndexHit[] = []
  for (const e of idx.entries) {
    if (e.name.toLowerCase().includes(q)) {
      out.push({ ...e, connId: idx.connId })
      if (out.length >= limit) break
    }
  }
  return out
}

/** 跨所有已建索引的连接搜 — NavTree 全局搜索面板用. */
export function searchAllIndexes(query: string, limit = 200): IndexHit[] {
  const all: IndexHit[] = []
  for (const idx of cache.values()) {
    const perConn = searchIndex(idx, query, limit)
    all.push(...perConn)
    if (all.length >= limit) break
  }
  return all.slice(0, limit)
}
