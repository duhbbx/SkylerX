import {
  type CommandRequest,
  type CommandResult,
  type ConnectionConfig,
  type DbDialect,
  type MetadataNode,
  MetaNodeKind,
  type MetaScope,
  type QueryResult,
  type TestResult,
} from '@db-tool/shared-types'
import {
  type DatabaseDriver,
  type DriverConnection,
  driverExtra,
  type SqlDialectHelpers,
} from '../driver.js'

/**
 * Elasticsearch 驱动：REST/HTTP 协议,走 executeCommand 平行通道,不走 SQL。
 *
 * 树形(扁平,无 Database 层):Connection → Index(复用 Table kind) → Field(Column)。
 * 前端按 connection.dialect 走 ES 分支渲染。
 *
 * @elastic/elasticsearch 是可选 peer 依赖:core-driver 加载不依赖它,
 * 仅 connect/test 时按需 import。用非字面量 specifier 绕过编译期模块解析。
 */

const esHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => name, // ES 无标识符转义概念,index/field 原样
  paginate: (sql) => sql, // ES 不走 SQL 分页,留空
}

async function loadElasticsearch(): Promise<any> {
  const spec: string = '@elastic/elasticsearch'
  try {
    const mod: any = await import(spec)
    return mod.default ?? mod
  } catch {
    throw new Error(
      'Elasticsearch 驱动未安装:请在部署环境 `pnpm add @elastic/elasticsearch`。桌面端打包随 apps/desktop 一同安装。',
    )
  }
}

/**
 * 由配置拼装 Elasticsearch Client 构造选项。
 * - node:优先 extra.url(显式 URL,含 scheme/path),否则按 host/port/ssl 拼装
 * - auth:apiKey 优先,其次 user/password,都没有则不设
 * - tls:ssl.enabled 时按 rejectUnauthorized/ca/cert/key 透传
 * - 其它 extra 通过 driverExtra 透传(去掉 url/apiKey/showSystemIndices 这些自管 key)
 */
function buildClientOptions(config: ConnectionConfig): Record<string, unknown> {
  const extra = (driverExtra(config) ?? {}) as Record<string, unknown>
  const {
    url: _url,
    apiKey: _apiKey,
    showSystemIndices: _showSystem,
    ...rest
  } = extra

  const explicitUrl = (config.extra?.url as string | undefined)?.trim()
  const node =
    explicitUrl ||
    `${config.ssl?.enabled ? 'https' : 'http'}://${config.host || 'localhost'}:${config.port || 9200}`

  const opts: Record<string, unknown> = { ...rest, node }

  const apiKey = (config.extra?.apiKey as string | undefined)?.trim()
  if (apiKey) {
    opts.auth = { apiKey }
  } else if (config.user) {
    opts.auth = {
      username: config.user,
      password: config.password ?? '',
    }
  }

  if (config.ssl?.enabled) {
    const tls: Record<string, unknown> = {}
    if (config.ssl.rejectUnauthorized === false) tls.rejectUnauthorized = false
    if (config.ssl.ca) tls.ca = config.ssl.ca
    if (config.ssl.cert) tls.cert = config.ssl.cert
    if (config.ssl.key) tls.key = config.ssl.key
    if (Object.keys(tls).length > 0) opts.tls = tls
  }

  return opts
}

/** ES8 client 默认直接返回 body;兼容老版 { body, statusCode } 形状。 */
function unwrap(res: any): unknown {
  if (res && typeof res === 'object' && 'body' in res && Object.keys(res).length <= 4) {
    // v7 风格:{ body, statusCode, headers, warnings, meta }
    return (res as any).body
  }
  return res
}

class ElasticConnection implements DriverConnection {
  constructor(
    private readonly client: any,
    private readonly showSystemIndices: boolean,
  ) {}

  /** SQL 通道在 ES 上不可用(ES SQL 非 ANSI,后续可选启用)。 */
  async execute(): Promise<QueryResult> {
    throw new Error('SQL_CHANNEL_UNSUPPORTED: Elasticsearch 不支持 SQL,请使用 executeCommand')
  }

  async fetchMetadata(scope: MetaScope): Promise<MetadataNode[]> {
    switch (scope.parentKind) {
      case MetaNodeKind.Connection:
        return this.listIndices()
      case MetaNodeKind.Table:
        return this.listFields(scope.path[0])
      default:
        return []
    }
  }

  private async listIndices(): Promise<MetadataNode[]> {
    const res = await this.client.cat.indices({ format: 'json' })
    const body = unwrap(res) as Array<Record<string, unknown>>
    const arr = Array.isArray(body) ? body : []
    return arr
      .map((row) => String(row.index ?? ''))
      .filter((name) => name && (this.showSystemIndices || !name.startsWith('.')))
      .sort()
      .map((name) => ({
        kind: MetaNodeKind.Table,
        name,
        path: [name],
        sqlName: name,
        hasChildren: true,
      }))
  }

  private async listFields(index: string): Promise<MetadataNode[]> {
    const res = await this.client.indices.getMapping({ index })
    const body = unwrap(res) as Record<string, any>
    // 形如 { [index]: { mappings: { properties: { ... } } } };
    // 若用了 alias/wildcard 取第一个真实 index 的 mappings
    const entry = body?.[index] ?? Object.values(body ?? {})[0]
    const props = (entry?.mappings?.properties ?? {}) as Record<string, any>
    return Object.entries(props)
      .map(([name, prop]) => ({
        kind: MetaNodeKind.Column,
        name,
        path: [index, name],
        hasChildren: false,
        detail: { dataType: String(prop?.type ?? 'object') },
      }))
  }

  async executeCommand(command: CommandRequest): Promise<CommandResult> {
    const start = Date.now()
    const args = (command.args ?? {}) as Record<string, any>
    const op = command.op
    const ctxIndex = command.context?.collection
    const maxRows = command.maxRows

    const needIndex = (): string => {
      const idx = ctxIndex ?? (args.index as string | undefined)
      if (!idx) throw new Error(`MISSING_INDEX: op '${op}' 需要 context.collection 或 args.index`)
      return idx
    }

    switch (op) {
      // ── 文档读 ────────────────────────────────────────────────
      case 'search': {
        const index = needIndex()
        const body = (args.body as Record<string, any>) ?? {}
        const params: Record<string, any> = { index, ...body }
        // 把 maxRows 应用到 size 上,多拿 1 条检测 truncated
        let probeTruncated = false
        if (typeof maxRows === 'number' && body.size == null) {
          params.size = maxRows + 1
          probeTruncated = true
        }
        const res = await this.client.search(params)
        const data = unwrap(res)
        if (probeTruncated && data && typeof data === 'object') {
          const hits = (data as any).hits?.hits
          if (Array.isArray(hits) && hits.length > (maxRows as number)) {
            ;(data as any).hits.hits = hits.slice(0, maxRows)
            return { data, executionTimeMs: Date.now() - start, truncated: true }
          }
        }
        return { data, executionTimeMs: Date.now() - start }
      }
      case 'get': {
        const index = needIndex()
        const id = String(args.id ?? '')
        const res = await this.client.get({ index, id })
        return { data: unwrap(res), executionTimeMs: Date.now() - start }
      }
      case 'count': {
        const index = needIndex()
        const params: Record<string, any> = { index }
        if (args.query) params.query = args.query
        const res = await this.client.count(params)
        return { data: unwrap(res), executionTimeMs: Date.now() - start }
      }

      // ── 文档写 ────────────────────────────────────────────────
      case 'index': {
        const index = needIndex()
        const params: Record<string, any> = { index, document: args.document }
        if (args.id != null) params.id = String(args.id)
        const res = await this.client.index(params)
        return { data: unwrap(res), affected: 1, executionTimeMs: Date.now() - start }
      }
      case 'update': {
        const index = needIndex()
        const id = String(args.id ?? '')
        const params: Record<string, any> = { index, id }
        if (args.doc !== undefined) params.doc = args.doc
        if (args.body && typeof args.body === 'object') Object.assign(params, args.body)
        const res = await this.client.update(params)
        return { data: unwrap(res), affected: 1, executionTimeMs: Date.now() - start }
      }
      case 'delete': {
        const index = needIndex()
        const id = String(args.id ?? '')
        const res = await this.client.delete({ index, id })
        return { data: unwrap(res), affected: 1, executionTimeMs: Date.now() - start }
      }
      case 'bulk': {
        const operations = (args.operations as unknown[]) ?? []
        const res = await this.client.bulk({ operations })
        const body = unwrap(res) as any
        const items = Array.isArray(body?.items) ? body.items : []
        return {
          data: body,
          affected: items.length,
          executionTimeMs: Date.now() - start,
        }
      }

      // ── 索引管理 ──────────────────────────────────────────────
      case 'indices.create':
      case 'indices.delete':
      case 'indices.getMapping':
      case 'indices.refresh': {
        const sub = op.slice('indices.'.length)
        const fn = (this.client.indices as any)[sub]
        if (typeof fn !== 'function') throw new Error(`UNKNOWN_OP: ${op}`)
        const res = await fn.call(this.client.indices, args)
        return { data: unwrap(res), executionTimeMs: Date.now() - start }
      }

      // ── cat API ───────────────────────────────────────────────
      case 'cat.indices':
      case 'cat.health':
      case 'cat.nodes': {
        const sub = op.slice('cat.'.length)
        const fn = (this.client.cat as any)[sub]
        if (typeof fn !== 'function') throw new Error(`UNKNOWN_OP: ${op}`)
        const res = await fn.call(this.client.cat, { format: 'json', ...args })
        return { data: unwrap(res), executionTimeMs: Date.now() - start }
      }

      // ── 任意 REST 透传 ─────────────────────────────────────────
      case 'raw': {
        const res = await this.client.transport.request({
          method: args.method ?? 'GET',
          path: String(args.path ?? '/'),
          body: args.body,
          querystring: args.querystring,
        })
        return { data: unwrap(res), executionTimeMs: Date.now() - start }
      }

      default:
        throw new Error(`UNKNOWN_OP: ${op}`)
    }
  }

  async ping(): Promise<void> {
    await this.client.ping()
  }

  async close(): Promise<void> {
    try {
      await this.client.close()
    } catch {
      /* 已断开等场景忽略 */
    }
  }
}

export function createElasticsearchDriver(dialect: DbDialect): DatabaseDriver {
  return {
    dialect,
    sql: esHelpers,

    async connect(config: ConnectionConfig): Promise<DriverConnection> {
      const es = await loadElasticsearch()
      const Client = es.Client
      const client = new Client(buildClientOptions(config))
      const showSystem = Boolean(config.extra?.showSystemIndices)
      return new ElasticConnection(client, showSystem)
    },

    async test(config: ConnectionConfig): Promise<TestResult> {
      const start = Date.now()
      let client: any
      try {
        const es = await loadElasticsearch()
        const Client = es.Client
        client = new Client(buildClientOptions(config))
        const res = await client.info()
        const body = unwrap(res) as any
        const serverVersion = body?.version?.number ? String(body.version.number) : undefined
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
