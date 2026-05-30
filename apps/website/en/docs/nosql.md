# NoSQL Deep Dive — MongoDB / Redis / Elasticsearch

SkylerX treats NoSQL as a first-class citizen — same metadata tree, same connection management, same AI assistant as SQL databases — but under the hood it goes through a **parallel channel (executeCommand)** — see [ARCHITECTURE](https://github.com/duhbbx/SkylerX/blob/main/ARCHITECTURE.md). This page covers the UI capabilities per database and the ops + args **actually exposed** by each driver.

## Overview — parallel channel vs SQL channel

`DataClient` exposes two independent entries:

| Channel | Entry | For |
|---|---|---|
| SQL | `connections.execute(sql)` | MySQL / PostgreSQL / Oracle / ... |
| Command | `connections.executeCommand({ op, args, context, maxRows? })` | MongoDB / Redis / Elasticsearch |

NoSQL drivers throw `SQL_CHANNEL_UNSUPPORTED` from `execute()`:

```ts
// packages/core-driver/src/dialects/mongo.ts
async execute(): Promise<QueryResult> {
  throw new Error('SQL_CHANNEL_UNSUPPORTED: MongoDB does not support SQL — use executeCommand')
}
```

`executeCommand` is where the real work happens, and **each driver defines its own op dictionary**. The rest of this page makes that dictionary concrete.

Common conventions:

- `context` carries the **target object** (MongoDB's `database` / `collection`, Redis's `dbIndex`, ES's `collection` = index).
- `args` is the op's own params object/array (Mongo / ES use objects; Redis uses positional arrays).
- `maxRows` is only meaningful for read ops that return collections — drivers use `limit/size + 1` to detect `truncated`.
- All return `CommandResult`: `{ data, executionTimeMs, affected?, truncated? }`.

---

## MongoDB

### Tree structure

```
Connection
└── Database (multiple)
    └── Group "Collections" (count)
        └── Collection (kind = Table, reuses SQL table nodes)
```

Driver implementation:

- `listDatabases` calls `admin().listDatabases()`.
- `databaseGroups` uses `listCollections({}, { nameOnly: true })` to get the collection count for `count`.
- `listCollections` returns sorted `kind: Table` nodes; the frontend uses `MongoPane` when `connection.dialect === 'mongodb'`.

### Collection browser (`MongoPane.vue`)

Opening a Collection node lands you here. Three sections from the top:

1. **Breadcrumb** `database · collection` alongside refresh / commit / undo.
2. **JSON filter textarea + limit / skip + table / JSON view toggle**.
3. **Result area** — table view uses the union of first-level fields as columns, or renders `rows.value` as raw JSON.

The execute button calls `find`:

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

Headers are computed from the union of top-level fields in `rows`, so schemaless collections render fine. When `_id` is a 24-hex string, it's rendered as `ObjectId("...")` to remind the user it's a BSON ObjectId underneath (IPC has serialized it to a string).

### Editable grid → updateOne (dot-path)

Double-click a non-`_id` cell to enter inline edit (`_id` is read-only). Enter valid JSON, hit Enter. Dirty cells are highlighted; "Commit (N)" calls `updateOne` per-row.

The diff algorithm `diffToOps()`:

- Both sides are non-plain-objects → `$set` the whole field (arrays aren't decomposed to avoid index drift).
- Both sides plain objects → recursive union of keys; new only → `$set`; old only → `$unset`; JSON-equal → skipped.
- Paths are dot-joined, e.g. `addr.city = '...'`.

The final request looks like:

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

### ObjectId auto-wrap (`$oid` marker ↔ driver impl)

ObjectId loses its type at the IPC boundary (becomes a string), so we use a **two-way marker**:

- On the UI write-back: `wrapOidStrings()` recursively wraps every 24-hex string as `{ $oid: 'hex' }`.
- Driver-side: `normalizeIds()` wraps 24-hex strings under the `_id` field as `new ObjectId(hex)`.

The driver is **conservative** here: only fields keyed exactly `_id` get auto-converted; other fields don't. The comment in `mongo.ts` is honest — this avoids turning random strings that happen to look like ObjectIds (some hash IDs) into bad ObjectIds. As a result, if you want to query by a `userId / refId` field that references an ObjectId, use the `{ $oid: '...' }` marker explicitly or write proper `EJSON`.

Operator objects under `_id` are processed recursively, so all of these work:

```jsonc
{ "_id": "65f1aa..."                                      } // → ObjectId
{ "_id": { "$in": ["65f1aa...", "65f2bb..."]              }} // array members
{ "_id": { "$eq": "65f1aa...", "$exists": true            }} // operator object
{ "$or": [{ "_id": "65f1aa..." }, { "name": "x" }]         } // nested query
```

### Aggregation pipeline (`MongoAggregationDialog.vue`)

Left: stage cards (up/down reorder, delete). Right: results. Each stage is its own JSON textarea. `STAGE_TEMPLATES` provides one-click insertion of ten common stages:

`$match` · `$project` · `$group` · `$sort` · `$limit` · `$skip` · `$unwind` · `$lookup` · `$addFields` · `$count`

On run, stages are assembled in order as `{ [stage.op]: JSON.parse(stage.json) }` and called:

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

A JSON parse failure in any stage → whole pipeline errors. Results default to the first `limit` (mini input, 1-1000) JSON docs in full. The `details` section has "View pipeline JSON" for easy copy-paste into mongosh.

### Collection info (`MongoCollectionInfoDialog.vue`)

Two tabs:

**Stats** (`collStats`): `count` / `size` / `avgObjSize` / `storageSize` / `nindexes` / `totalIndexSize`, sizes in human-readable units.

**Indexes** — `listIndexes` + table (name / keys / unique / sparse / ttl / size) + a "create index" form. When creating:

- Field rows are repeatable; direction = `1 / -1 / text / 2dsphere`.
- Optional `name / unique / sparse / expireAfterSeconds`.
- Backend uses `createIndex` op, args like `{ key: { field1: 1, field2: -1 }, unique?, sparse?, expireAfterSeconds? }`.

Dropping an index uses `dropIndex`; the UI blocks dropping the default `_id_`.

### Driver-supported ops (complete list)

From the `mongo.ts` switch:

| Category | op | Required args | Notes |
|---|---|---|---|
| read | `find` | `filter`, `options?` | cursor toArray; maxRows → `limit+1` detects truncated |
| read | `findOne` | `filter`, `options?` | Single doc |
| read | `aggregate` | `pipeline`, `options?` | Pipeline; same truncation logic |
| read | `countDocuments` | `filter`, `options?` | |
| read | `distinct` | `field`, `filter?`, `options?` | |
| write | `insertOne` | `document`, `options?` | `affected = acknowledged ? 1 : 0` |
| write | `insertMany` | `documents`, `options?` | `affected = insertedCount` |
| write | `updateOne` / `updateMany` | `filter`, `update`, `options?` | `affected = modifiedCount` |
| write | `replaceOne` | `filter`, `document`, `options?` | |
| write | `deleteOne` / `deleteMany` | `filter`, `options?` | `affected = deletedCount` |
| db | `runCommand` | whole `args` as command, passed to `db.command()` | Escape hatch |
| db | `listCollections` | `filter?`, `options?` | |
| db | `createCollection` | `name`, `options?` | |
| db | `dropCollection` | `name` | |
| index | `collStats` / `listIndexes` / `createIndex` / `dropIndex` | See `MongoCollectionInfoDialog` | Via `runCommand` |

> Anything not in this table returns `UNKNOWN_OP`. To add an op, add it to the `mongo.ts` switch — don't bypass it with raw client APIs.

---

## Redis

### Tree structure

```
Connection
└── Database  db0..db15 (16 fixed logical DBs, count from INFO keyspace)
    └── Group "Strings / Hashes / Lists / Sets / Sorted Sets / Streams"
        └── Key (SCAN sample, cap 200)
```

`listDatabases` does one `INFO keyspace` to grab `keys=N` for all 16; empty DBs omit the count to avoid noise.

`listTypeGroups` checks `DBSIZE`: when `<= 100,000` it SCANs the whole DB + pipelined TYPE to compute precise per-group counts; on bigger DBs counts are skipped and the group nodes are mounted without numbers.

`sampleKeysByType` is invoked on group selection — SCAN + pipelined TYPE filter, capped at `SCAN_SAMPLE_LIMIT = 200`. The scan budget is roughly `ROUND_CAP × COUNT = 50 × 200 = 10k keys`. If the group has more, a "… (more, use SCAN)" entry hints at the global `RedisSearchDialog`.

### Key browser (`RedisPane.vue`)

Left: SCAN list + MATCH search box. Right: TYPE-specific view of the selected key. Bottom "Load more" advances the SCAN cursor until the driver returns cursor='0'.

Load flow:

1. `SCAN <cursor> MATCH <match> COUNT 500` → `[nextCursor, batch]`.
2. New keys are chunked (`TYPE_PIPELINE_CHUNK = 200`) and `TYPE` is fetched in parallel.
3. Append to `keys.value`, advance cursor.

Sort by name / type / ttl (asc/desc). The TTL column is off by default — clicking "TTL" batches a `TTL` call per key (chunks of 100). Multi-select enables bulk `EXPIRE / PERSIST / UNLINK`.

### Per-type value rendering

The driver forwards `executeCommand` straight to `ioredis.call(op, ...args)`, so the UI sends raw Redis commands. The commands `RedisPane` runs on key selection:

| TYPE | Small (≤ `PAGE_SIZE = 100`) | Large (paged) |
|---|---|---|
| `string` | `GET key` | — |
| `hash` | `HGETALL key` | `HSCAN key cursor COUNT 100` |
| `list` | `LRANGE key 0 LIST_PAGE-1` (`LIST_PAGE = 200`) | `LRANGE` paging, bounded by `LLEN` |
| `set` | `SMEMBERS key` | `SSCAN key cursor COUNT 100` |
| `zset` | `ZRANGE key 0 -1 WITHSCORES` | `ZSCAN key cursor COUNT 100` |
| `stream` | `XRANGE key - + COUNT 50` | — |

Stream entries come as `[id, [f1, v1, f2, v2, ...]]`; the UI parses to `{ id, fields: [[k, v], ...] }`.

#### Extra views (multiple interpretations of the same TYPE)

Redis stores HyperLogLog / Bitmap as strings and Geo as zsets — `TYPE` can't distinguish, so the UI offers explicit switches at the top:

- **HLL** (string) → `PFCOUNT key` for cardinality (~0.81% error).
- **Bitmap** (string) → `BITCOUNT key` (total) + range `BITCOUNT key start end` + single bit `GETBIT key offset`.
- **Geo** (zset) → `ZRANGE key 0 -1` for members, then a single `GEOPOS key m1 m2 ...` for all coordinates. GEOPOS returns nil for missing / non-geo members — shown as `null`.

Switching incorrectly (e.g. treating a string as HLL) makes Redis return `WRONGTYPE`; the error banner shows the raw message.

### Inline editing

string / hash / list / set / zset all support edit mode — click "Edit" at the top to enter; the UI maintains a draft; saving produces the minimal command set per type:

- string → `SET key value`
- hash → `HDEL key f1 f2 ...` + `HSET key f1 v1 f2 v2 ...`
- list → only changed indices via `LSET key i v`
- set → `SADD key m1 m2 ...` and `SREM key m1 m2 ...`
- zset → `ZREM key m1 m2 ...` and `ZADD key s1 m1 s2 m2 ...`

stream isn't inline-editable (semantics are heavy).

### New key (`RedisNewKeyDialog.vue`)

Five types, visual creation:

| Type | Command | UI |
|---|---|---|
| String | `SET key value` | textarea |
| Hash | `HSET key f1 v1 ...` | field/value rows (add/remove) |
| List | `RPUSH key v1 v2 ...` | multi-line textarea, one per line |
| Set | `SADD key m1 m2 ...` | multi-line textarea, dedup automatically |
| Sorted Set | `ZADD key s1 m1 s2 m2 ...` | multi-line `<score> <member>` |

TTL is optional; when > 0, an `EXPIRE key ttl` is appended. Before submitting, `EXISTS key` pre-checks; existing keys are rejected (no overwrite). Stream is not supported — `XADD` needs an id + fields, easier to send via the command input.

### Command input

The second row of `RedisPane` is a generic command editor; split on whitespace:

```ts
const op = tokens[0].toUpperCase()
const args = tokens.slice(1)
await client.connections.executeCommand(conn.id, {
  op,
  args,
  context: { dbIndex },
})
```

Goes straight to the driver's `executeCommand` → `client.call(op, ...args)`, so any Redis command works here (`DEBUG SLEEP`, `OBJECT ENCODING`, `CONFIG REWRITE` etc.). **Note**: parsing doesn't handle quote escaping — `SET key "value with space"` becomes four tokens. For values with spaces, use the NewKey dialog or a Lua script.

### Big key scan (`RedisBigKeysDialog.vue`)

Full DB SCAN + `MEMORY USAGE` per key (default SAMPLES 5, O(N)). 20 keys per chunk in parallel, chunks serially; "Stop" button to abort. Results ordered by bytes desc (top N, default 100), and aggregated by `:` prefix to surface "user / cache / session" type business buckets — top 8 rendered as a horizontal bar chart, making it obvious which prefix eats memory.

> A few hundred thousand keys is slow and CPU-heavy; other clients will feel it. Run during off-peak or narrow with MATCH first.

### Live command stream monitor (`RedisMonitorDialog.vue`)

**Key trade-off**: native Redis `MONITOR` is blocking and monopolizes the connection, conflicting with our request-response channel. So this panel does the next best thing — every N seconds (default 2000ms), poll:

- `INFO stats` → `total_commands_processed` / `keyspace_hits` / `keyspace_misses` / `instantaneous_ops_per_sec`
- `INFO clients` → `connected_clients`
- `INFO memory` → `used_memory`

The last 60 samples scroll in a reverse table, hit ratio computed automatically. For per-command detail, the UI tells users to use `redis-cli MONITOR`.

### Server panel (`RedisServerInfoDialog.vue`)

Seven tabs, each mapping to one or a few Redis admin commands:

| Tab | Commands | Content |
|---|---|---|
| INFO | `INFO` | Sectioned by `# Section`; memory fields auto-converted to human-readable |
| Slow log | `SLOWLOG GET 128` + `CONFIG GET/SET slowlog-log-slower-than` + `SLOWLOG RESET` | id / ts / μs / command / client |
| Clients | `CLIENT LIST` + `CLIENT ID` + `CLIENT KILL ID <id>` | The self row gets a green badge to prevent accidental kill |
| Command stats | `INFO commandstats` | Sorted by `usec_per_call` desc |
| CONFIG | `CONFIG GET *` + `CONFIG SET k v` | Inline edit on click, filterable |
| Cluster | `CLUSTER INFO` + `CLUSTER NODES` | Slot distribution bar (0-16383), color by master id hash; non-cluster mode shows the reason |
| Sentinel | `SENTINEL MASTERS` | Non-sentinel nodes show the reason |

Check "5s auto-refresh" at the top to re-fetch the current tab; closing the dialog clears the timer.

### Lua / Functions (`RedisScriptDialog.vue`)

Two tabs.

**Lua tab**:

- Editor + KEYS / ARGV inputs (space-separated).
- `▶ EVAL` → `EVAL <script> <numKeys> KEYS... ARGV...`
- `SCRIPT LOAD` returns sha (cached in UI state); `EVALSHA <sha>` replays; `SCRIPT FLUSH` clears the server.
- Local save: stored in `localStorage['skylerx.redis.lua.<connId>']`, persists across sessions.

**Functions tab** (Redis 7+):

- `FUNCTION LIST WITHCODE` → parse per-library `library_name / engine / functions[].name / library_code`.
- Paste library code in the editor → `FUNCTION LOAD [REPLACE] <code>`.
- `FUNCTION DELETE <lib>` to drop.
- Click a library name to load `library_code` back into the editor.

The editor is a textarea (not Monaco) — a deliberate lightweight choice. For heavier editing, do it in a terminal and paste.

### Global SCAN search (`RedisSearchDialog.vue`)

MATCH search across all 16 logical DBs:

- Pattern input + 16 db checkboxes (all checked by default), "Select all / none".
- Iterates selected dbs in order; per db `SCAN cursor MATCH ... COUNT 500`; concurrent `TYPE / TTL` on hits.
- Per-db hits over `SCAN_PER_DB_LIMIT = 5000` are truncated with a toast.
- Click a row → emit `pick(db, key)`; the outer Workspace switches to that `RedisPane` and uses `pendingKey` to locate.

### Import / export (`RedisImportExportDialog.vue`)

A custom JSON format (not RDB) for cross-DB / cross-instance migration:

```json
[
  { "db": 0, "key": "...", "type": "string", "ttl": 3600, "value": "..." },
  { "db": 0, "key": "...", "type": "hash", "ttl": -1, "value": { "f": "v" } },
  { "db": 0, "key": "...", "type": "zset", "ttl": 0, "value": [{ "member": "a", "score": "1" }] },
  { "db": 0, "key": "...", "type": "stream", "ttl": -1, "value": [{ "id": "1-0", "fields": [["f","v"]] }] }
]
```

**Export**: `SCAN MATCH` the current db; for each key fetch `TYPE / TTL / payload`; serial dump (no IPC flood of dozens at once); save via `client.files.saveText`.

**Import**: open JSON → reconstruct per type: string → `SET`; hash → `HSET`; list → `RPUSH`; set → `SADD`; zset → `ZADD`; stream → per-entry `XADD`. Conflict strategy: `skip` (default) / `overwrite` (`DEL` first). `ttl > 0` adds `EXPIRE`.

Known limitation: **streams don't carry consumer groups** — `XINFO` / `XGROUP` etc. need separate handling.

---

## Elasticsearch

### Tree structure

```
Connection
└── Index (flat, no Database layer)
    └── Field (from getMapping properties)
```

Implementation:

- `listIndices` calls `client.cat.indices({ format: 'json' })` and filters out system indices starting with `.` (toggle via connection `extra.showSystemIndices = true`).
- `listFields` calls `client.indices.getMapping({ index })` and reads `mappings.properties`; field `detail.dataType = prop.type` (default `object`).

### Query panel (`ElasticPane.vue`)

- Top: breadcrumb (index) + "refresh" button + `docs.count` badge (from a separate `count` call).
- Middle: textarea for Query DSL, `op` selector: `search` / `count` / `getMapping`.
- Bottom: "run", right-side "table / raw JSON" toggle.

On run:

```ts
await client.connections.executeCommand(conn.id, {
  op,                                  // 'search' | 'count' | 'getMapping'
  args: { index, body },               // body = JSON parsed from textarea
  context: { collection: index },      // both filled; driver's needIndex() will resolve
  maxRows: 500,                        // only applies to search in practice
})
```

`getMapping` needs no body; `count` passes body through as `{ query: ... }`.

### Table view vs raw JSON

- `search` results: columns = `_id` + union of `hits.hits[*]._source` fields; values via `cellOf(hit, col)` (`_id` from `hit._id`, others from `hit._source[col]`).
- Top bar `total: N · took: M ms` comes from `data.hits.total` (`{ value: N }` or old-style number) + `executionTimeMs`.
- `count` / `getMapping` have no "row" concept; table view falls back to raw JSON.
- Any op can be toggled to raw JSON.

### `search` `maxRows` behavior (truncation detection)

This bit deserves attention:

```ts
case 'search': {
  const params = { index, ...body }
  let probeTruncated = false
  if (typeof maxRows === 'number' && body.size == null) {
    params.size = maxRows + 1            // probe one extra
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

Highlights:

- **If the user wrote `size` explicitly in DSL, don't touch it** (respect user intent).
- Otherwise probe with `maxRows + 1`; if hits > maxRows, trim and return `truncated: true`.
- The return shape preserves ES's `{ hits: { hits, total } }` — only `hits.hits` is trimmed.

### Driver-supported ops (complete list)

From `elasticsearch.ts` switch:

| Category | op | Required args | Underlying client call |
|---|---|---|---|
| doc read | `search` | `index?`, `body?` | `client.search({ index, ...body })` |
| doc read | `get` | `index?`, `id` | `client.get({ index, id })` |
| doc read | `count` | `index?`, `query?` | `client.count({ index, query })` |
| doc write | `index` | `index?`, `document`, `id?` | `client.index({ index, document, id? })`, `affected = 1` |
| doc write | `update` | `index?`, `id`, `doc?`, `body?` | `client.update({ index, id, doc, ...body })`, `affected = 1` |
| doc write | `delete` | `index?`, `id` | `client.delete({ index, id })`, `affected = 1` |
| doc write | `bulk` | `operations[]` | `client.bulk({ operations })`, `affected = items.length` |
| index admin | `indices.create` / `indices.delete` / `indices.getMapping` / `indices.refresh` | passes `args` through to `client.indices.<sub>` | |
| cat | `cat.indices` / `cat.health` / `cat.nodes` | pass-through + default `format: 'json'` | |
| escape hatch | `raw` | `method`, `path`, `body?`, `querystring?` | `client.transport.request(...)`, arbitrary REST passthrough |

`needIndex()` resolves the target index from `context.collection` or `args.index`; if neither, throws `MISSING_INDEX`.

`unwrap(res)` handles both ES 8 (body returned directly) and old v7 `{ body, statusCode, headers, warnings, meta }`, so the UI doesn't care about client version.

---

## Parallel channel contract (in brief)

You've seen the three drivers differ widely, but the contract to the frontend is consistent:

```ts
interface CommandRequest {
  op: string                   // driver-defined dictionary
  args?: unknown               // Mongo/ES use objects; Redis uses positional arrays
  context?: {                  // target object
    database?: string          // Mongo
    collection?: string        // Mongo / ES (= index)
    dbIndex?: number           // Redis
  }
  maxRows?: number             // driver implements limit+1 truncation
}

interface CommandResult {
  data: unknown
  executionTimeMs: number
  affected?: number            // "rows affected" for writes
  truncated?: boolean          // signaled when maxRows trimmed
}
```

This shape is independent of the SQL channel — `QueryResult` remains SQL-only. NoSQL drivers always throw `SQL_CHANNEL_UNSUPPORTED` from `execute()`, and the frontend doesn't call it when dialect = mongo/redis/elasticsearch.

---

## Known limitations / trade-offs

| Item | Notes |
|---|---|
| Mongo 24-hex misjudgment | A rare ordinary string that happens to be 24 hex chars gets ObjectId-wrapped. This is the price of fixing "updateOne never hits". |
| Mongo non-`_id` ObjectId refs | Driver only auto-converts under the `_id` key. For `userId / refId` referencing ObjectIds, use the `{ $oid: 'hex' }` marker in the UI or hand-build EJSON in `runCommand`. |
| Redis MONITOR | Native MONITOR blocks the connection and conflicts with the request-response channel. Live panel degrades to `INFO stats` polling; for per-command detail use `redis-cli MONITOR`. |
| Redis command parser is quote-free | Top-bar command input splits on whitespace, no quote handling. For values with spaces use the NewKey dialog or a Lua script. |
| Redis tree sampling | Type-group nodes sample at most 200 keys with a 10k budget. Use global SCAN search (`RedisSearchDialog`) for more. |
| Redis type-group counts | DBs with `DBSIZE > 100,000` don't compute per-group counts to avoid sluggish tree expansion. |
| Redis big-key MEMORY USAGE | O(N) sampling — slow and CPU-heavy on big DBs; run off-peak or narrow via MATCH. |
| Redis import/export streams | No consumer groups; `XINFO / XGROUP` etc. need separate migration. |
| Redis NewKey doesn't support streams | `XADD` semantics are heavy; use `RedisPane` command input or Lua. |
| ES SQL | `_xpack/sql` is non-ANSI and not wired to the SQL channel; we can add `op: 'sql'` if there's demand. |
| ES `size` overrides `maxRows` | Explicit `size` in DSL is respected fully — no `+1` probe, so no `truncated` signal. |
| ES truncation is search-only | `count` / `get` / `getMapping` have no "collection" concept; no truncation. |
| All NoSQL driver deps | `mongodb` / `ioredis` / `@elastic/elasticsearch` are **optional peerDeps**, lazy-imported. Desktop bundle ships them via `apps/desktop`; self-hosted backends need `pnpm add` of the package, otherwise connect/test throws "driver not installed". |
