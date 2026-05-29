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
import type { DatabaseDriver, DriverConnection, SqlDialectHelpers } from '../driver.js'

// Redis 驱动:NoSQL 平行通道
//   - execute(sql) 抛 'SQL_CHANNEL_UNSUPPORTED'
//   - executeCommand(payload) 是真实入口,args 直接喂 ioredis.call(op, ...args)
//   - fetchMetadata 形状:Connection→Database(0..15)→Group(by type 抽样)→Key

const redisHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => name,
  paginate: (sql) => sql,
}

/**
 * ioredis 是可选 peerDep,惰性加载:用非字面量 specifier,避免未安装时编译期报"找不到模块"。
 */
async function loadIORedis(): Promise<any> {
  const spec: string = 'ioredis'
  try {
    const mod: any = await import(spec)
    return mod.default ?? mod
  } catch {
    throw new Error(
      'Redis 驱动未安装:请在部署环境 `pnpm add ioredis`。桌面端已在 apps/desktop 内置。',
    )
  }
}

/** 6 个内置数据结构组(对应 Redis TYPE 命令返回值)。 */
const TYPE_GROUPS: Array<{ name: string; group: string; type: string }> = [
  { name: 'Strings', group: 'strings', type: 'string' },
  { name: 'Hashes', group: 'hashes', type: 'hash' },
  { name: 'Lists', group: 'lists', type: 'list' },
  { name: 'Sets', group: 'sets', type: 'set' },
  { name: 'Sorted Sets', group: 'zsets', type: 'zset' },
  { name: 'Streams', group: 'streams', type: 'stream' },
]

/** SCAN 抽样上限,超出加一条提示节点。 */
const SCAN_SAMPLE_LIMIT = 200

function buildClientOptions(config: ConnectionConfig): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    host: config.host,
    port: config.port,
    username: config.user || undefined,
    password: config.password || undefined,
    db: 0,
    lazyConnect: true,
  }
  if (config.ssl?.enabled) {
    opts.tls = {
      rejectUnauthorized: config.ssl.rejectUnauthorized ?? true,
      ca: config.ssl.ca,
      cert: config.ssl.cert,
      key: config.ssl.key,
    }
  }
  return opts
}

/** 解析 `INFO server` 输出中的 redis_version 字段。 */
function parseServerVersion(info: string): string | undefined {
  const m = info.match(/redis_version:([^\r\n]+)/)
  return m ? m[1].trim() : undefined
}

class RedisConnection implements DriverConnection {
  /** 当前 SELECT 的库索引,缓存避免重复切换。 */
  private currentDb = 0

  constructor(private readonly client: any) {}

  async execute(): Promise<QueryResult> {
    throw new Error('SQL_CHANNEL_UNSUPPORTED: Redis 不支持 SQL,请使用 executeCommand')
  }

  async executeCommand(command: CommandRequest): Promise<CommandResult> {
    const start = Date.now()
    const dbIndex = command.context?.dbIndex
    if (typeof dbIndex === 'number' && dbIndex !== this.currentDb) {
      await this.client.select(dbIndex)
      this.currentDb = dbIndex
    }
    const args = Array.isArray(command.args) ? (command.args as unknown[]) : []
    const data = await this.client.call(command.op, ...args)
    const executionTimeMs = Date.now() - start
    // DEL / SET(NX 等) / SADD / HSET / ZADD / LPUSH ... 这类返回数字 N 的,顺手填 affected。
    const opUpper = command.op.toUpperCase()
    const affectedOps = new Set([
      'DEL',
      'UNLINK',
      'SADD',
      'SREM',
      'HSET',
      'HDEL',
      'ZADD',
      'ZREM',
      'LPUSH',
      'RPUSH',
      'LPUSHX',
      'RPUSHX',
      'XADD',
      'EXPIRE',
      'PERSIST',
    ])
    const affected =
      affectedOps.has(opUpper) && typeof data === 'number' ? (data as number) : undefined
    return { data, executionTimeMs, affected }
  }

  async fetchMetadata(scope: MetaScope): Promise<MetadataNode[]> {
    switch (scope.parentKind) {
      case MetaNodeKind.Connection:
        return this.listDatabases()
      case MetaNodeKind.Database:
        return this.listTypeGroups(scope.path[0])
      case MetaNodeKind.Group:
        return this.sampleKeysByType(scope.path[0], scope.group)
      default:
        return []
    }
  }

  private listDatabases(): MetadataNode[] {
    // 16 个逻辑库:不提前算 dbsize(并发 SELECT 太重),全部展示为可展开。
    const nodes: MetadataNode[] = []
    for (let i = 0; i < 16; i++) {
      nodes.push({
        kind: MetaNodeKind.Database,
        name: `db${i}`,
        path: [String(i)],
        hasChildren: true,
      })
    }
    return nodes
  }

  private listTypeGroups(dbIndex: string): MetadataNode[] {
    return TYPE_GROUPS.map((g) => ({
      kind: MetaNodeKind.Group,
      name: g.name,
      path: [dbIndex, g.group],
      group: g.group,
      hasChildren: true,
    }))
  }

  private async sampleKeysByType(dbIndex: string, group?: string): Promise<MetadataNode[]> {
    const tg = TYPE_GROUPS.find((g) => g.group === group)
    if (!tg) return []
    const idx = Number(dbIndex)
    if (idx !== this.currentDb) {
      await this.client.select(idx)
      this.currentDb = idx
    }
    // SCAN 抽样:游标遍历,按 TYPE 过滤,最多收集 SCAN_SAMPLE_LIMIT 条。
    // 命中条数大概率 < SCAN 总扫描条数,所以加 cap 防止恶意/大库下无限扫。
    const matched: string[] = []
    let cursor = '0'
    let scannedRounds = 0
    const ROUND_CAP = 50 // 每轮 COUNT 200,最多 50 轮 ≈ 1 万 key 扫描预算
    do {
      const [next, batch] = (await this.client.call('SCAN', cursor, 'COUNT', '200')) as [
        string,
        string[],
      ]
      cursor = next
      if (batch.length > 0) {
        // 用 pipeline 批量 TYPE,避免一条条 round-trip。
        const pipeline = this.client.pipeline()
        for (const k of batch) pipeline.type(k)
        const results = (await pipeline.exec()) as Array<[Error | null, string]> | null
        if (results) {
          for (let i = 0; i < batch.length; i++) {
            const t = results[i]?.[1]
            if (t === tg.type) {
              matched.push(batch[i])
              if (matched.length >= SCAN_SAMPLE_LIMIT) break
            }
          }
        }
      }
      scannedRounds++
      if (matched.length >= SCAN_SAMPLE_LIMIT) break
    } while (cursor !== '0' && scannedRounds < ROUND_CAP)

    const nodes: MetadataNode[] = matched.slice(0, SCAN_SAMPLE_LIMIT).map((key) => ({
      kind: MetaNodeKind.Column,
      name: key,
      path: [dbIndex, tg.group, key],
      hasChildren: false,
    }))
    // 若达到上限 或 未扫完 而抽样已满,提示用户继续 SCAN。
    if (matched.length >= SCAN_SAMPLE_LIMIT || (cursor !== '0' && scannedRounds >= ROUND_CAP)) {
      nodes.push({
        kind: MetaNodeKind.Column,
        name: '... (更多,使用 SCAN 命令)',
        path: [dbIndex, tg.group, '__more__'],
        hasChildren: false,
      })
    }
    return nodes
  }

  async ping(): Promise<void> {
    await this.client.ping()
  }

  async close(): Promise<void> {
    try {
      await this.client.quit()
    } catch {
      // quit 失败时强制断开,避免句柄泄漏。
      try {
        this.client.disconnect()
      } catch {
        /* ignore */
      }
    }
  }
}

export function createRedisDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: redisHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const IORedis = await loadIORedis()
      const client = new IORedis(buildClientOptions(config))
      await client.connect()
      await client.ping()
      return new RedisConnection(client)
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      const IORedis = await loadIORedis()
      const client = new IORedis(buildClientOptions(config))
      try {
        await client.connect()
        await client.ping()
        const info: string = await client.call('INFO', 'server')
        const latencyMs = Date.now() - start
        return {
          ok: true,
          serverVersion: parseServerVersion(info),
          latencyMs,
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      } finally {
        try {
          await client.quit()
        } catch {
          try {
            client.disconnect()
          } catch {
            /* ignore */
          }
        }
      }
    },
  }
}
