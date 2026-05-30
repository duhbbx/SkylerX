# NoSQL 深度使用指南 — MongoDB / Redis / Elasticsearch

SkylerX 把 NoSQL 当成一等公民,跟 SQL 数据库走的是同一棵元数据树、同一份连接管理、同一套 AI 助手,但底层走的是 **平行通道(executeCommand)** —— 详见 [ARCHITECTURE](https://github.com/duhbbx/SkylerX/blob/main/ARCHITECTURE.md)。本文按数据库逐节讲 UI 能力,以及驱动里 **真实暴露** 的 op 与参数。

## 概述 — 平行通道与 SQL 通道的关系

`DataClient` 暴露两个相互独立的入口:

| 通道 | 入口 | 适用 |
|---|---|---|
| SQL | `connections.execute(sql)` | MySQL / PostgreSQL / Oracle / ... |
| 命令 | `connections.executeCommand({ op, args, context, maxRows? })` | MongoDB / Redis / Elasticsearch |

NoSQL 驱动的 `execute()` 直接抛 `SQL_CHANNEL_UNSUPPORTED`:

```ts
// packages/core-driver/src/dialects/mongo.ts
async execute(): Promise<QueryResult> {
  throw new Error('SQL_CHANNEL_UNSUPPORTED: MongoDB 不支持 SQL,请使用 executeCommand')
}
```

`executeCommand` 是真正干活的入口,**每个驱动自定义自己的 op 字典**。本文剩下的章节就是把这个字典讲清楚。

通用约定:

- `context` 携带 **目标对象**(MongoDB 的 `database` / `collection`、Redis 的 `dbIndex`、ES 的 `collection` = index)。
- `args` 是该 op 自己的参数对象 / 数组(Mongo / ES 是对象,Redis 是位置参数数组)。
- `maxRows` 仅对会返回集合的读操作有意义,驱动会用 `limit/size + 1` 多拉一条来识别 `truncated`。
- 返回值都是 `CommandResult`:`{ data, executionTimeMs, affected?, truncated? }`。

---

## MongoDB

### 树形结构

```
Connection
└── Database (多个)
    └── Group "集合" (count)
        └── Collection (kind = Table, 沿用 SQL 表节点)
```

驱动里的实现:

- `listDatabases` 调 `admin().listDatabases()`。
- `databaseGroups` 用 `listCollections({}, { nameOnly: true })` 拿到集合数填到 `count`。
- `listCollections` 排序后做成 `kind: Table` 节点,前端按 `connection.dialect === 'mongodb'` 走 `MongoPane` 渲染。

### 集合浏览器(`MongoPane.vue`)

打开一个 Collection 节点会落到这个组件,顶部三段:

1. **面包屑** `database · collection`,跟刷新 / 提交修改 / 撤销修改并排。
2. **JSON Filter textarea + limit / skip + 表格 / JSON 视图切换**。
3. **结果区** —— 表格视图按行集第一层字段并集做列,或者直接渲染 `rows.value` 的 JSON。

执行按钮真正调的就是 `find`:

```ts
await client.connections.executeCommand(conn.id, {
  op: 'find',
  args: {
    filter,
    options: { limit, skip },
  },
  context: { database, collection },
  maxRows: 500,
})
```

表头列由 `rows` 第一层字段并集动态计算,所以 schemaless 集合也能展示。`_id` 列是 24-hex 字符串时会渲染成 `ObjectId("...")` 提示用户底层是 BSON ObjectId(IPC 已经把它序列化成字符串了)。

### 可编辑网格 → updateOne(dot-path)

双击非 `_id` cell 进入 inline 编辑(`_id` 列禁止)。编辑器里输入 **合法 JSON**,Enter 确认。dirty cell 会高亮,顶部"提交修改 (N)"逐条调用 `updateOne`。

diff 算法在 `diffToOps()`:

- 两侧都不是 plain object → 整字段 `$set`(数组不展开,避免索引错位)。
- 两侧都是 plain object → 取 key 并集递归;仅新增 → `$set`;仅旧有 → `$unset`;JSON 等价 → 跳过。
- 路径压成 dot-path,例如 `addr.city = '...'`。

最终请求形如:

```ts
{
  op: 'updateOne',
  args: {
    filter: { _id: { $oid: '65f1...' } },
    update: { $set: { 'addr.city': 'BJ' }, $unset: { 'addr.zip': true } },
    options: {},
  },
  context: { database, collection },
}
```

### ObjectId 自动包装(`$oid` marker ↔ driver 实现)

ObjectId 在 IPC 边界丢失原类型(变字符串),所以约定一个 **双向 marker**:

- UI 回写时:`wrapOidStrings()` 递归把所有 24-hex 字符串包成 `{ $oid: 'hex' }`。
- 驱动收到后:`normalizeIds()` 把 `_id` 字段下的 24-hex 字符串直接 wrap 成 `new ObjectId(hex)`。

驱动这一层是 **保守策略**:只对键名 === `_id` 的字段自动转,不动其它键。理由在 `mongo.ts` 注释里写得很直白 —— 避免误把恰好长得像 ObjectId 的普通字符串(比如某些哈希 ID)弄坏。这意味着如果你要按 `userId / refId` 这类引用 ObjectId 字段查,记得自己用 `{ $oid: '...' }` marker 或者写完整的 `EJSON`。

`_id` 操作符对象也会递归处理,所以下面这些都正常工作:

```jsonc
{ "_id": "65f1aa..."                                      } // → ObjectId
{ "_id": { "$in": ["65f1aa...", "65f2bb..."]              }} // 数组成员
{ "_id": { "$eq": "65f1aa...", "$exists": true            }} // 操作符对象
{ "$or": [{ "_id": "65f1aa..." }, { "name": "x" }]         } // 嵌套查询
```

### Aggregation 管道(`MongoAggregationDialog.vue`)

左侧 stage 卡片列表(可上下移、可删),右侧结果。每个 stage 是独立 JSON textarea。`STAGE_TEMPLATES` 一键插入十种常用 stage:

`$match` · `$project` · `$group` · `$sort` · `$limit` · `$skip` · `$unwind` · `$lookup` · `$addFields` · `$count`

执行时按顺序 `{ [stage.op]: JSON.parse(stage.json) }` 组装管道,再调:

```ts
{
  op: 'aggregate',
  args: {
    pipeline,
    options: { allowDiskUse: true, maxTimeMS: 30000 },
  },
  context: { database, collection },
}
```

任一 stage JSON 解析失败 → 整个 pipeline 报错并显示。结果默认前 `limit`(UI 上的 mini 输入框,1-1000)条 JSON 全文展示。`details` 区有"查看 pipeline JSON",方便复制到 mongosh 复现。

### 集合元信息(`MongoCollectionInfoDialog.vue`)

两个 tab:

**统计**(`collStats`):`count` / `size` / `avgObjSize` / `storageSize` / `nindexes` / `totalIndexSize`,所有大小走人类可读单位。

**索引** —— `listIndexes` + 表格(name / keys / unique / sparse / ttl / size)+ 新建索引表单。新建索引时:

- 字段行可加多行,方向选 `1 / -1 / text / 2dsphere`。
- 可选 `name / unique / sparse / expireAfterSeconds`。
- 后台调 `createIndex` op,参数形如 `{ key: { field1: 1, field2: -1 }, unique?, sparse?, expireAfterSeconds? }`。

删除索引调 `dropIndex` op,UI 拦住 `_id_` 默认索引不让删。

### 驱动支持的 op(完整列表)

`mongo.ts` 里 switch 真实列出的 op:

| 类别 | op | 必需 args | 说明 |
|---|---|---|---|
| 读 | `find` | `filter`, `options?` | 游标 toArray;maxRows → `limit+1` 检测 truncated |
| 读 | `findOne` | `filter`, `options?` | 单文档 |
| 读 | `aggregate` | `pipeline`, `options?` | 管道,maxRows 同上 |
| 读 | `countDocuments` | `filter`, `options?` | |
| 读 | `distinct` | `field`, `filter?`, `options?` | |
| 写 | `insertOne` | `document`, `options?` | `affected = acknowledged ? 1 : 0` |
| 写 | `insertMany` | `documents`, `options?` | `affected = insertedCount` |
| 写 | `updateOne` / `updateMany` | `filter`, `update`, `options?` | `affected = modifiedCount` |
| 写 | `replaceOne` | `filter`, `document`, `options?` | |
| 写 | `deleteOne` / `deleteMany` | `filter`, `options?` | `affected = deletedCount` |
| 库 | `runCommand` | 整个 `args` 作为 command 直接 `db.command()` | 兜底入口 |
| 库 | `listCollections` | `filter?`, `options?` | |
| 库 | `createCollection` | `name`, `options?` | |
| 库 | `dropCollection` | `name` | |
| 索引 | `collStats` / `listIndexes` / `createIndex` / `dropIndex` | 见 `MongoCollectionInfoDialog` | 通过 `runCommand` 走 |

> 不在表内的 op 一律 `UNKNOWN_OP`。需要新增写在 `mongo.ts` 的 switch 里,不要绕过去用客户端任意 API。

---

## Redis

### 树形结构

```
Connection
└── Database  db0..db15 (16 个固定逻辑库, count 来自 INFO keyspace)
    └── Group "Strings / Hashes / Lists / Sets / Sorted Sets / Streams"
        └── Key (SCAN 抽样, 上限 200)
```

`listDatabases` 用一次 `INFO keyspace` 把 16 个库的 `keys=N` 全拿到,空库不挂 count 避免噪音。

`listTypeGroups` 看 `DBSIZE`:`<= 100 000` 时会整库 SCAN + pipeline TYPE,统计出每个组的精确 count;超大库直接放弃统计,只挂分组节点。

`sampleKeysByType` 在选中分组时 SCAN + pipeline TYPE 过滤,最多采样 `SCAN_SAMPLE_LIMIT = 200` 条,扫描预算约 `ROUND_CAP × COUNT = 50 × 200 = 1 万 key`。够不上的会挂一行 `... (更多,使用 SCAN 命令)` 提示用户走 `RedisSearchDialog`。

### Key 浏览器(`RedisPane.vue`)

左侧 SCAN 列表 + MATCH 搜索框,右侧按当前选中 key 的 TYPE 渲染对应视图。底部"加载更多"继续推 SCAN 游标,直到驱动返回 cursor='0'。

加载流程:

1. `SCAN <cursor> MATCH <match> COUNT 500` — 拿 `[nextCursor, batch]`。
2. 对新增的 key 分块(`TYPE_PIPELINE_CHUNK = 200`)并发拉 `TYPE`。
3. 追加到 `keys.value`,推进 cursor。

排序支持 name / type / ttl 三种,降序 / 升序切换;ttl 列默认关闭,点击 "TTL" 按钮才会批量拉(每个 key 一次 `TTL`,分块 100 并发)。多选后可以批量 `EXPIRE / PERSIST / UNLINK`。

### 各类型 value 渲染

驱动 `executeCommand` 透传给 `ioredis.call(op, ...args)`,所以 UI 直接发原生 Redis 命令。下面是 `RedisPane` 选中 key 后自动跑的命令:

| TYPE | 小集合(≤ `PAGE_SIZE = 100`)| 大集合(分页加载) |
|---|---|---|
| `string` | `GET key` | — |
| `hash` | `HGETALL key` | `HSCAN key cursor COUNT 100` |
| `list` | `LRANGE key 0 LIST_PAGE-1`(`LIST_PAGE = 200`) | 翻页继续 `LRANGE`,跟 `LLEN` 比对边界 |
| `set` | `SMEMBERS key` | `SSCAN key cursor COUNT 100` |
| `zset` | `ZRANGE key 0 -1 WITHSCORES` | `ZSCAN key cursor COUNT 100` |
| `stream` | `XRANGE key - + COUNT 50` | — |

stream entry 的结构是 `[id, [f1, v1, f2, v2, ...]]`,UI 自己解析成 `{ id, fields: [[k, v], ...] }`。

#### 额外视图(同一底层 TYPE 的多种解读)

Redis 把 HyperLogLog / Bitmap 都放在 string 上,Geo 放在 zset 上 —— `TYPE` 命令分不出来,所以 UI 顶部提供手动切换:

- **HLL**(string)→ `PFCOUNT key` 估算基数,误差 ≈ 0.81%。
- **Bitmap**(string)→ `BITCOUNT key`(总数)+ 区间 `BITCOUNT key start end` + 单 bit `GETBIT key offset`。
- **Geo**(zset)→ 先 `ZRANGE key 0 -1` 拿成员,再单次 `GEOPOS key m1 m2 ...` 拿全部经纬度。GEOPOS 对不存在 / 非 geo 成员返回 nil,UI 用 `null` 表示。

切错(例如把普通 string 当 HLL)Redis 会回 `WRONGTYPE`,错误 banner 上直接显示。

### 行内编辑

string / hash / list / set / zset 都支持编辑模式 —— 顶部"编辑"按钮进入,UI 维护一份 draft,保存时按类型生成最小命令集:

- string → `SET key value`
- hash → `HDEL key f1 f2 ...` + `HSET key f1 v1 f2 v2 ...`
- list → 仅对变化的 index 调 `LSET key i v`
- set → `SADD key m1 m2 ...` 和 `SREM key m1 m2 ...`
- zset → `ZREM key m1 m2 ...` 和 `ZADD key s1 m1 s2 m2 ...`

stream 暂不支持行内编辑(语义太重)。

### 新建 key(`RedisNewKeyDialog.vue`)

支持五种类型的可视化新建:

| 类型 | 命令 | UI 输入 |
|---|---|---|
| String | `SET key value` | textarea |
| Hash | `HSET key f1 v1 ...` | field/value 行(可增可减) |
| List | `RPUSH key v1 v2 ...` | 多行 textarea,一行一项 |
| Set | `SADD key m1 m2 ...` | 多行 textarea,自动去重 |
| Sorted Set | `ZADD key s1 m1 s2 m2 ...` | 多行 `<score> <member>` |

TTL 可选,> 0 时追加 `EXPIRE key ttl`。提交前先 `EXISTS key` 预检,已存在直接拒绝(不允许覆盖)。stream 不支持 —— `XADD` 需要 id + field/value,在 `RedisPane` 的命令输入框直接发更顺手。

### 命令输入框

`RedisPane` 顶部第二行有一个通用命令编辑器,按空白拆词后:

```ts
const op = tokens[0].toUpperCase()
const args = tokens.slice(1)
await client.connections.executeCommand(conn.id, {
  op,
  args,
  context: { dbIndex },
})
```

直接走驱动的 `executeCommand` → `client.call(op, ...args)`,所以 Redis 所有命令都能在这里跑(包括 `DEBUG SLEEP`、`OBJECT ENCODING`、`CONFIG REWRITE` 这些)。**注意**:命令解析没有处理引号转义,所以 `SET key "value with space"` 会被拆成四个 token,有空格的值请用 `NewKey` 弹窗或 Lua 脚本。

### 大 key 扫描(`RedisBigKeysDialog.vue`)

整库 SCAN + 每 key `MEMORY USAGE`(默认 SAMPLES 5,O(N) 采样)。每块 20 个 key 并发,跨块串行,有"停止"按钮可中断。结果倒序按字节展示前 N(默认 100),并按 `:` 前缀聚合出 "user / cache / session" 这种业务分桶,top 8 渲染成横向条形图,直观看出哪个前缀最吃内存。

> 几十万 key 的库慢且占 CPU,扫描时其它客户端会有感知。建议低峰跑或先用 MATCH 缩范围。

### 实时命令流监控(`RedisMonitorDialog.vue`)

**关键 trade-off**:Redis 原生 `MONITOR` 是 blocking 模式,会独占当前连接,跟我们的请求-响应通道冲突。所以这个面板退而求其次,每 N 秒(默认 2000ms)拉一次:

- `INFO stats` → `total_commands_processed` / `keyspace_hits` / `keyspace_misses` / `instantaneous_ops_per_sec`
- `INFO clients` → `connected_clients`
- `INFO memory` → `used_memory`

最近 60 个采样点以倒序滚动表呈现,自动算命中率。要看每条命令明细的请在终端 `redis-cli MONITOR`,文案里也明确这么提示。

### 服务端面板(`RedisServerInfoDialog.vue`)

七个 tab,每个都对应一条 / 一组 Redis 管理命令:

| Tab | 命令 | 内容 |
|---|---|---|
| INFO | `INFO` | 按 `# Section` 分块,memory 字段自动转人类可读 |
| 慢日志 | `SLOWLOG GET 128` + `CONFIG GET/SET slowlog-log-slower-than` + `SLOWLOG RESET` | id / ts / 耗时 μs / 命令 / 客户端 |
| 客户端 | `CLIENT LIST` + `CLIENT ID` + `CLIENT KILL ID <id>` | self 行打绿标防误杀 |
| 命令统计 | `INFO commandstats` | 按 `usec_per_call` 倒序 |
| CONFIG | `CONFIG GET *` + `CONFIG SET k v` | 点击行内编辑,支持过滤 |
| Cluster | `CLUSTER INFO` + `CLUSTER NODES` | slot 分布彩条(0-16383),按 master id 哈希配色;非 cluster 模式会报错并明示原因 |
| Sentinel | `SENTINEL MASTERS` | 非 sentinel 节点同样明示原因 |

顶部勾选"5s 自动刷新"会按当前 tab 反复 refresh,关弹窗自动清理 timer。

### Lua / Functions(`RedisScriptDialog.vue`)

两个 tab。

**Lua tab**:

- 编辑器 + KEYS / ARGV 输入(空格分)。
- `▶ EVAL` → `EVAL <script> <numKeys> KEYS... ARGV...`
- `SCRIPT LOAD` 拿 sha,缓存在 UI 状态;`EVALSHA <sha>` 重放;`SCRIPT FLUSH` 清空 server。
- 本地保存:存到 `localStorage['skylerx.redis.lua.<connId>']`,跨会话保留。

**Functions tab**(Redis 7+):

- `FUNCTION LIST WITHCODE` → 解析每个库的 `library_name / engine / functions[].name / library_code`。
- 编辑器贴 library code → `FUNCTION LOAD [REPLACE] <code>`。
- `FUNCTION DELETE <lib>` 删库。
- 点库名可以把 `library_code` 拉回编辑器。

注意编辑器是 textarea(不是 Monaco)—— 是有意的轻量选择,要更复杂的编辑器在终端编辑后粘进来即可。

### 全局 SCAN 搜索(`RedisSearchDialog.vue`)

跨 16 个逻辑库的 MATCH 搜索:

- 顶部输入 pattern + 16 个 db 复选框(默认全选),"全选 / 全不选"。
- 顺序遍历选中的 db,每个 db `SCAN cursor MATCH ... COUNT 500`;命中后并发 `TYPE / TTL`。
- 单库命中 `> SCAN_PER_DB_LIMIT = 5000` 直接截断并 toast 提示。
- 结果表点行 → emit `pick(db, key)`,外层 Workspace 切换到对应 `RedisPane` 并通过 `pendingKey` 定位。

### 导入 / 导出(`RedisImportExportDialog.vue`)

格式约定一份自定义 JSON(不走 RDB),便于跨库 / 跨实例迁移:

```json
[
  { "db": 0, "key": "...", "type": "string", "ttl": 3600, "value": "..." },
  { "db": 0, "key": "...", "type": "hash", "ttl": -1, "value": { "f": "v" } },
  { "db": 0, "key": "...", "type": "zset", "ttl": 0, "value": [{ "member": "a", "score": "1" }] },
  { "db": 0, "key": "...", "type": "stream", "ttl": -1, "value": [{ "id": "1-0", "fields": [["f","v"]] }] }
]
```

**导出**:`SCAN MATCH` 当前 db,对每个 key 拉 `TYPE / TTL / 对应结构数据`,串行 dump 避免一次性几十个 IPC 并发,最后走 `client.files.saveText` 弹原生保存对话框。

**导入**:打开 JSON → 按 `type` 还原命令:string → `SET`、hash → `HSET`、list → `RPUSH`、set → `SADD`、zset → `ZADD`、stream → 逐 entry `XADD`。冲突策略 `skip`(默认)/ `overwrite`(先 `DEL`)。`ttl > 0` 时追加 `EXPIRE`。

已知限制:**stream 不带 consumer group**;`XINFO` / `XGROUP` 之类需要单独处理。

---

## Elasticsearch

### 树形结构

```
Connection
└── Index (扁平, 没有 Database 这一层)
    └── Field (来自 getMapping 的 properties)
```

实现:

- `listIndices` 走 `client.cat.indices({ format: 'json' })`,过滤 `.` 开头的系统索引(可在连接 `extra.showSystemIndices = true` 关闭过滤)。
- `listFields` 走 `client.indices.getMapping({ index })`,取 `mappings.properties`,字段 `detail.dataType = prop.type`(默认 `object`)。

### 查询面板(`ElasticPane.vue`)

- 顶部面包屑(index)+ "刷新"按钮 + 顶部 `docs.count` badge(独立 `count` 调用拉)。
- 中部 textarea 写 Query DSL,旁边 `op` 选择:`search` / `count` / `getMapping`。
- 底部"执行",右侧"表格 / 原始 JSON"视图切换。

执行时:

```ts
await client.connections.executeCommand(conn.id, {
  op,                                  // 'search' | 'count' | 'getMapping'
  args: { index, body },               // body 是 textarea 解析出的 JSON
  context: { collection: index },      // 两路都填,驱动 needIndex() 兜底
  maxRows: 500,                        // 仅对 search 真正生效
})
```

`getMapping` 不需要 body;`count` 会把 body 当做 `{ query: ... }` 透传。

### 表格视图 vs 原始 JSON

- `search` 结果:列 = `_id` + `hits.hits[*]._source` 字段并集,值通过 `cellOf(hit, col)` 取(`_id` 走 `hit._id`,其余走 `hit._source[col]`)。
- 顶部 `total: N · took: M ms` 来自 `data.hits.total`(`{ value: N }` 或老版 number)+ `executionTimeMs`。
- `count` / `getMapping` 因为没有"行"概念,表格视图也直接落到原始 JSON。
- 任何 op 都能用顶部 toggle 切到 raw JSON。

### `search` 的 `maxRows` 行为(truncated 检测)

驱动这一段特别值得注意:

```ts
case 'search': {
  const params = { index, ...body }
  let probeTruncated = false
  if (typeof maxRows === 'number' && body.size == null) {
    params.size = maxRows + 1            // 多探一条
    probeTruncated = true
  }
  const res = await this.client.search(params)
  const data = unwrap(res)
  if (probeTruncated && data?.hits?.hits?.length > maxRows) {
    data.hits.hits = hits.slice(0, maxRows)
    return { data, executionTimeMs, truncated: true }
  }
  return { data, executionTimeMs }
}
```

要点:

- **用户在 DSL 里显式写了 `size` 就不动**(尊重用户意图)。
- 没写 `size` 才用 `maxRows + 1` 探测;命中 > maxRows 就裁掉并返回 `truncated: true`。
- 返回结构保留 ES 原本 `{ hits: { hits, total } }`,只是 `hits.hits` 被裁短了。

### 驱动支持的 op(完整列表)

`elasticsearch.ts` 里 switch 真实列出的:

| 类别 | op | 必需 args | 走的 client 方法 |
|---|---|---|---|
| 文档读 | `search` | `index?`, `body?` | `client.search({ index, ...body })` |
| 文档读 | `get` | `index?`, `id` | `client.get({ index, id })` |
| 文档读 | `count` | `index?`, `query?` | `client.count({ index, query })` |
| 文档写 | `index` | `index?`, `document`, `id?` | `client.index({ index, document, id? })`,`affected = 1` |
| 文档写 | `update` | `index?`, `id`, `doc?`, `body?` | `client.update({ index, id, doc, ...body })`,`affected = 1` |
| 文档写 | `delete` | `index?`, `id` | `client.delete({ index, id })`,`affected = 1` |
| 文档写 | `bulk` | `operations[]` | `client.bulk({ operations })`,`affected = items.length` |
| 索引管理 | `indices.create` / `indices.delete` / `indices.getMapping` / `indices.refresh` | 透传 `args` 给 `client.indices.<sub>` | |
| cat | `cat.indices` / `cat.health` / `cat.nodes` | 透传 + 默认 `format: 'json'` | |
| 兜底 | `raw` | `method`, `path`, `body?`, `querystring?` | `client.transport.request(...)`,任意 REST 透传 |

`needIndex()` 从 `context.collection` 或 `args.index` 兜底取目标索引;两个都没有抛 `MISSING_INDEX`。

`unwrap(res)` 同时兼容 ES 8(默认直接返回 body)和老版 v7 `{ body, statusCode, headers, warnings, meta }` 结构,UI 不用关心客户端版本。

---

## 平行通道契约(简提)

读到这里你会发现三个驱动差异很大,但对前端来说契约始终一致:

```ts
interface CommandRequest {
  op: string                   // 驱动自定义字典
  args?: unknown               // Mongo/ES 是对象;Redis 是位置数组
  context?: {                  // 目标对象
    database?: string          // Mongo
    collection?: string        // Mongo / ES (= index)
    dbIndex?: number           // Redis
  }
  maxRows?: number             // 驱动负责实现 limit+1 截断
}

interface CommandResult {
  data: unknown
  executionTimeMs: number
  affected?: number            // 写操作的"影响条数"
  truncated?: boolean          // maxRows 触发的截断标志
}
```

这套形态独立于 SQL 通道:`QueryResult` 仍然只用于 SQL。NoSQL 驱动 `execute()` 一律抛 `SQL_CHANNEL_UNSUPPORTED`,前端在 dialect = mongo/redis/elasticsearch 时不会调它。

---

## 已知限制 / Trade-off

| 项 | 说明 |
|---|---|
| Mongo 24-hex 误判 | 极少数恰好长 24 位 16 进制的普通字符串会被驱动当成 ObjectId。这是修 "updateOne 永远 0 命中" 必付的代价。 |
| Mongo 非 `_id` 字段 ObjectId 引用 | 驱动只对键名 `_id` 做自动转;`userId / refId` 等引用 ObjectId 需要在 UI 用 `{ $oid: 'hex' }` marker 或在 `runCommand` 里手动构造 EJSON。 |
| Redis MONITOR | 原生 MONITOR blocking 整个连接,跟请求-响应通道冲突。实时面板退化到 `INFO stats` 轮询,要看每条命令请用 `redis-cli MONITOR`。 |
| Redis 命令解析无引号 | `RedisPane` 顶部命令编辑器按空白拆词,不处理引号 / 转义。含空格的值请用 `NewKey` 弹窗或 Lua 脚本。 |
| Redis 树形抽样 | 类型分组节点最多挂 200 个 key 抽样,扫描预算 1 万。超出请用全局 SCAN 搜索 (`RedisSearchDialog`)。 |
| Redis 类型分组 count | DBSIZE > 100 000 的大库不统计每类 count,避免整库 SCAN 拖慢左侧树展开。 |
| Redis 大 key MEMORY USAGE | 是 O(N) 采样,大库扫描慢且占 CPU,建议低峰跑或先 MATCH 缩范围。 |
| Redis 导入导出 stream | 不带 consumer group;`XINFO / XGROUP` 之类要单独迁。 |
| Redis 新建 key 不支持 stream | `XADD` 语义太重,在 `RedisPane` 命令输入框 / Lua 脚本里发更顺手。 |
| ES SQL | `_xpack/sql` 非 ANSI,目前不接入 SQL 通道;有需要再开 `op: 'sql'` 入口。 |
| ES `size` 显式覆盖 `maxRows` | 用户在 DSL 写了 `size` 就完全尊重,不再附加 `+1` 探测;此时不会有 `truncated` 信号。 |
| ES truncated 仅对 search 生效 | `count` / `get` / `getMapping` 没有"集合"概念,不参与截断。 |
| 所有 NoSQL 驱动依赖 | `mongodb` / `ioredis` / `@elastic/elasticsearch` 都是 **可选 peerDep**,惰性 import。桌面端打包随 `apps/desktop` 安装;自建后端需 `pnpm add` 对应包,否则 connect/test 阶段会抛"驱动未安装"。 |
