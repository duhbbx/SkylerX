/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type CommandRequest,
  type CommandResult,
  type ConnectionConfig,
  type DbDialect,
  MetaNodeKind,
  type MetaScope,
  type MetadataNode,
  type QueryResult,
  type TestResult,
} from '@db-tool/shared-types'
import {
  type DatabaseDriver,
  type DriverConnection,
  type SqlDialectHelpers,
  driverExtra,
} from '../driver.js'

/**
 * MongoDB 驱动：走 executeCommand 通道，不走 SQL。
 *
 * 树形：Connection → Database → Group(collections) → Collection（复用 Table kind，
 *      前端按 connection.dialect 走 Mongo 分支渲染）。
 *
 * mongodb 是可选 peer 依赖（peerDependenciesMeta.optional=true）：
 * core-driver 加载不依赖它，仅 connect/test 时按需 import。
 * 用非字面量 specifier，避免未安装时编译期"找不到模块"。
 */

const mongoHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => name, // Mongo 没有标识符转义概念，保留原样
  paginate: (sql) => sql, // Mongo 不走 SQL 分页，留空
}

async function loadMongoDb(): Promise<any> {
  const spec: string = 'mongodb'
  try {
    const mod: any = await import(spec)
    return mod.default ?? mod
  } catch {
    throw new Error(
      'MongoDB 驱动未安装：请在部署环境 `pnpm add mongodb`。桌面端打包随 apps/desktop 一同安装。',
    )
  }
}

/** 由配置拼装 MongoClient 的 URI；优先用用户在 extra.uri 里直接给的连接串。 */
function buildUri(config: ConnectionConfig): string {
  const fromExtra = (config.extra?.uri as string | undefined)?.trim()
  if (fromExtra) return fromExtra
  const auth = config.user
    ? `${encodeURIComponent(config.user)}${config.password ? `:${encodeURIComponent(config.password)}` : ''}@`
    : ''
  const host = config.host || 'localhost'
  const port = config.port || 27017
  const db = config.database ? `/${encodeURIComponent(config.database)}` : ''
  return `mongodb://${auth}${host}:${port}${db}`
}

/** 取已剥离应用层元数据的 extra，并去掉 uri（uri 不是 MongoClient option）。 */
function buildClientOptions(config: ConnectionConfig): Record<string, unknown> {
  const extra = driverExtra(config) ?? {}
  const { uri: _uri, ...rest } = extra as Record<string, unknown>
  const opts: Record<string, unknown> = { ...rest }
  if (config.ssl?.enabled) {
    opts.tls = true
    if (config.ssl.rejectUnauthorized === false) opts.tlsAllowInvalidCertificates = true
  }
  return opts
}

const HEX24 = /^[a-fA-F0-9]{24}$/

/**
 * 递归遍历 value，把任何键名 === '_id' 且值为 24-hex 字符串的字段
 * 自动 wrap 成 ObjectId。同时处理：
 *  - 顶层 _id
 *  - $in / $nin / $eq 等操作符内的 _id（其 value 可能是数组或标量）
 *  - $or / $and / $nor 数组里嵌套的 _id
 *  - 嵌套对象里出现的 _id 字段
 *
 * 不动其它字段：用户显式传 ObjectId(...) 的不会走这里（它在 IPC 端就不是 string，
 * 会以 BSON / 已是对象的形式抵达）。
 *
 * 已知 trade-off：若用户故意把恰好 24-hex 的字符串当普通 _id 字面值使用，
 * 这里会被误转。这是为修复"updateOne 永远 0 命中"问题的合理代价。
 */
function normalizeIds(value: unknown, ObjectId: any): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeIds(v, ObjectId))
  }
  if (value !== null && typeof value === 'object') {
    // ObjectId 本身或其它 BSON 包装类型：保持原样，不要递归打散其内部结构
    if (ObjectId && value instanceof ObjectId) return value
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '_id') {
        if (typeof v === 'string' && HEX24.test(v)) {
          out[k] = new ObjectId(v)
        } else if (v !== null && typeof v === 'object') {
          // _id 是操作符对象，例如 { $in: [...], $eq: '...' }：递归内部把 hex 串转掉
          out[k] = normalizeIdOperator(v, ObjectId)
        } else {
          out[k] = v
        }
      } else {
        out[k] = normalizeIds(v, ObjectId)
      }
    }
    return out
  }
  return value
}

/**
 * 处理 _id 下挂的操作符对象（{ $in: [...], $eq: '...' } 之类）：
 * 把里面的 24-hex 字符串值全部 wrap 成 ObjectId，数组逐个处理；
 * 其它非字符串值原样保留（例如 $exists: true、$type: 'objectId'）。
 */
function normalizeIdOperator(value: object, ObjectId: any): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' && HEX24.test(v) ? new ObjectId(v) : v))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      out[k] = v.map((it) => (typeof it === 'string' && HEX24.test(it) ? new ObjectId(it) : it))
    } else if (typeof v === 'string' && HEX24.test(v)) {
      out[k] = new ObjectId(v)
    } else {
      out[k] = v
    }
  }
  return out
}

class MongoConnection implements DriverConnection {
  constructor(
    private readonly client: any,
    private readonly defaultDb: string | undefined,
    private readonly ObjectId: any,
  ) {}

  /** SQL 通道在 Mongo 上不可用。 */
  async execute(): Promise<QueryResult> {
    throw new Error('SQL_CHANNEL_UNSUPPORTED: MongoDB 不支持 SQL，请使用 executeCommand')
  }

  async fetchMetadata(scope: MetaScope): Promise<MetadataNode[]> {
    switch (scope.parentKind) {
      case MetaNodeKind.Connection:
        return this.listDatabases()
      case MetaNodeKind.Database:
        return this.databaseGroups(scope.path[0])
      case MetaNodeKind.Group:
        if (scope.group === 'collections') return this.listCollections(scope.path[0])
        return []
      default:
        return []
    }
  }

  private async listDatabases(): Promise<MetadataNode[]> {
    const res = await this.client.db().admin().listDatabases()
    const dbs = (res?.databases ?? []) as Array<{ name: string }>
    return dbs.map((d) => ({
      kind: MetaNodeKind.Database,
      name: String(d.name),
      path: [String(d.name)],
      hasChildren: true,
    }))
  }

  private async databaseGroups(db: string): Promise<MetadataNode[]> {
    const cols = await this.client.db(db).listCollections({}, { nameOnly: true }).toArray()
    return [
      {
        kind: MetaNodeKind.Group,
        name: '集合',
        path: [db, 'collections'],
        group: 'collections',
        hasChildren: true,
        count: cols.length,
      },
    ]
  }

  private async listCollections(db: string): Promise<MetadataNode[]> {
    const cols = (await this.client
      .db(db)
      .listCollections({}, { nameOnly: true })
      .toArray()) as Array<{ name: string }>
    return cols
      .map((c) => String(c.name))
      .sort()
      .map((name) => ({
        kind: MetaNodeKind.Table,
        name,
        path: [db, name],
        sqlName: name,
        hasChildren: false,
      }))
  }

  async executeCommand(command: CommandRequest): Promise<CommandResult> {
    const start = Date.now()
    const dbName = command.context?.database ?? this.defaultDb
    const db = this.client.db(dbName)
    const colName = command.context?.collection
    const col = colName ? db.collection(colName) : undefined

    const args = (command.args ?? {}) as Record<string, unknown>
    const op = command.op
    const maxRows = command.maxRows

    const needCol = (): any => {
      if (!col) throw new Error(`MISSING_COLLECTION: op '${op}' 需要 context.collection`)
      return col
    }

    switch (op) {
      // ── 读类（游标）─────────────────────────────────────────
      case 'find': {
        const c = needCol()
        const filter = normalizeIds(
          (args.filter as Record<string, unknown>) ?? {},
          this.ObjectId,
        ) as Record<string, unknown>
        const options = (args.options as Record<string, unknown>) ?? {}
        let cursor = c.find(filter, options)
        if (typeof maxRows === 'number') cursor = cursor.limit(maxRows + 1)
        const all = (await cursor.toArray()) as unknown[]
        const truncated = typeof maxRows === 'number' && all.length > maxRows
        const data = truncated ? all.slice(0, maxRows) : all
        return { data, executionTimeMs: Date.now() - start, truncated }
      }
      case 'findOne': {
        const c = needCol()
        const filter = normalizeIds(
          (args.filter as Record<string, unknown>) ?? {},
          this.ObjectId,
        ) as Record<string, unknown>
        const options = (args.options as Record<string, unknown>) ?? {}
        const data = await c.findOne(filter, options)
        return { data, executionTimeMs: Date.now() - start }
      }
      case 'aggregate': {
        const c = needCol()
        const pipeline = normalizeIds(
          (args.pipeline as unknown[]) ?? [],
          this.ObjectId,
        ) as unknown[]
        const options = (args.options as Record<string, unknown>) ?? {}
        let cursor = c.aggregate(pipeline, options)
        if (typeof maxRows === 'number') cursor = cursor.limit(maxRows + 1)
        const all = (await cursor.toArray()) as unknown[]
        const truncated = typeof maxRows === 'number' && all.length > maxRows
        const data = truncated ? all.slice(0, maxRows) : all
        return { data, executionTimeMs: Date.now() - start, truncated }
      }
      case 'countDocuments': {
        const c = needCol()
        const filter = normalizeIds(
          (args.filter as Record<string, unknown>) ?? {},
          this.ObjectId,
        ) as Record<string, unknown>
        const options = (args.options as Record<string, unknown>) ?? {}
        const data = await c.countDocuments(filter, options)
        return { data, executionTimeMs: Date.now() - start }
      }
      case 'distinct': {
        const c = needCol()
        const field = String(args.field ?? '')
        const filter = normalizeIds(
          (args.filter as Record<string, unknown>) ?? {},
          this.ObjectId,
        ) as Record<string, unknown>
        const options = (args.options as Record<string, unknown>) ?? {}
        const data = await c.distinct(field, filter, options)
        return { data, executionTimeMs: Date.now() - start }
      }

      // ── 写类 ────────────────────────────────────────────────
      case 'insertOne': {
        const c = needCol()
        const doc = normalizeIds(
          (args.document as Record<string, unknown>) ?? {},
          this.ObjectId,
        ) as Record<string, unknown>
        const options = (args.options as Record<string, unknown>) ?? {}
        const r = await c.insertOne(doc, options)
        return { data: r, affected: r?.acknowledged ? 1 : 0, executionTimeMs: Date.now() - start }
      }
      case 'insertMany': {
        const c = needCol()
        const docs = normalizeIds((args.documents as unknown[]) ?? [], this.ObjectId) as unknown[]
        const options = (args.options as Record<string, unknown>) ?? {}
        const r = await c.insertMany(docs, options)
        return {
          data: r,
          affected: Number(r?.insertedCount ?? 0),
          executionTimeMs: Date.now() - start,
        }
      }
      case 'updateOne':
      case 'updateMany': {
        const c = needCol()
        const filter = normalizeIds(
          (args.filter as Record<string, unknown>) ?? {},
          this.ObjectId,
        ) as Record<string, unknown>
        const update = normalizeIds(
          (args.update as Record<string, unknown>) ?? {},
          this.ObjectId,
        ) as Record<string, unknown>
        const options = (args.options as Record<string, unknown>) ?? {}
        const r =
          op === 'updateOne'
            ? await c.updateOne(filter, update, options)
            : await c.updateMany(filter, update, options)
        return {
          data: r,
          affected: Number(r?.modifiedCount ?? 0),
          executionTimeMs: Date.now() - start,
        }
      }
      case 'replaceOne': {
        const c = needCol()
        const filter = normalizeIds(
          (args.filter as Record<string, unknown>) ?? {},
          this.ObjectId,
        ) as Record<string, unknown>
        const replacement = normalizeIds(
          (args.document as Record<string, unknown>) ?? {},
          this.ObjectId,
        ) as Record<string, unknown>
        const options = (args.options as Record<string, unknown>) ?? {}
        const r = await c.replaceOne(filter, replacement, options)
        return {
          data: r,
          affected: Number(r?.modifiedCount ?? 0),
          executionTimeMs: Date.now() - start,
        }
      }
      case 'deleteOne':
      case 'deleteMany': {
        const c = needCol()
        const filter = normalizeIds(
          (args.filter as Record<string, unknown>) ?? {},
          this.ObjectId,
        ) as Record<string, unknown>
        const options = (args.options as Record<string, unknown>) ?? {}
        const r =
          op === 'deleteOne'
            ? await c.deleteOne(filter, options)
            : await c.deleteMany(filter, options)
        return {
          data: r,
          affected: Number(r?.deletedCount ?? 0),
          executionTimeMs: Date.now() - start,
        }
      }

      // ── 库级 ────────────────────────────────────────────────
      case 'runCommand': {
        const data = await db.command(args)
        return { data, executionTimeMs: Date.now() - start }
      }
      case 'listCollections': {
        const filter = (args.filter as Record<string, unknown>) ?? {}
        const options = (args.options as Record<string, unknown>) ?? {}
        const data = await db.listCollections(filter, options).toArray()
        return { data, executionTimeMs: Date.now() - start }
      }
      case 'createCollection': {
        const name = String(args.name ?? '')
        const options = (args.options as Record<string, unknown>) ?? {}
        const r = await db.createCollection(name, options)
        return {
          data: { ok: true, name: r?.collectionName ?? name },
          executionTimeMs: Date.now() - start,
        }
      }
      case 'dropCollection': {
        const name = String(args.name ?? '')
        const r = await db.dropCollection(name)
        return { data: { ok: Boolean(r) }, executionTimeMs: Date.now() - start }
      }

      default:
        throw new Error(`UNKNOWN_OP: ${op}`)
    }
  }

  async ping(): Promise<void> {
    await this.client.db('admin').command({ ping: 1 })
  }

  async close(): Promise<void> {
    try {
      await this.client.close()
    } catch {
      /* 已断开等场景忽略 */
    }
  }
}

export function createMongoDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: mongoHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const mongodb = await loadMongoDb()
      const MongoClient = mongodb.MongoClient
      const client = new MongoClient(buildUri(config), buildClientOptions(config))
      await client.connect()
      return new MongoConnection(client, config.database || undefined, mongodb.ObjectId)
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      let client: any
      try {
        const mongodb = await loadMongoDb()
        const MongoClient = mongodb.MongoClient
        client = new MongoClient(buildUri(config), buildClientOptions(config))
        await client.connect()
        await client.db('admin').command({ ping: 1 })
        let serverVersion: string | undefined
        try {
          const info = await client.db('admin').command({ buildInfo: 1 })
          if (info?.version) serverVersion = String(info.version)
        } catch {
          /* buildInfo 在受限权限下可能拒绝，忽略 */
        }
        return { ok: true, serverVersion, latencyMs: Date.now() - start }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      } finally {
        try {
          await client?.close()
        } catch {
          /* 忽略关闭异常 */
        }
      }
    },
  }
}
