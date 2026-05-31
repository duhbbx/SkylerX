# NoSQL Channels — manual QA

Covers: MongoDB, Redis, Elasticsearch — the parallel `executeCommand` IPC channel (NOT the SQL channel).

> Run when changing: `packages/core-driver/src/dialects/mongo.ts`, `redis.ts`, `elasticsearch.ts`, `apps/desktop/src/main/ipc/connections.ts` (executeCommand handler), respective UI panels.

## Setup

- Branch / commit:
- OS:
- Active NoSQL connection: <!-- specify which -->

---

# MongoDB

## Connect + browse

- [ ] Test connection → green toast, server version + replica set / standalone
- [ ] Tree expand → list of databases
- [ ] Expand a database → list of collections
- [ ] Expand a collection → first 100 docs (or stat) shown
- [ ] Evidence:

## Find / query

- [ ] `db.users.find({}).limit(10)` → grid renders 10 docs
- [ ] BSON types render correctly:
  - [ ] `ObjectId` shown with `ObjectId("...")` notation
  - [ ] `Date` shown as ISO string
  - [ ] `Long` / `Int64` not truncated
  - [ ] `Decimal128` preserved
  - [ ] Binary subtype shown with kind label
- [ ] Filter with dot-path: `db.users.find({'address.city': 'NYC'})` → works
- [ ] Projection: `db.users.find({}, {name:1, email:1})` → only those fields shown
- [ ] Evidence: paste sample docs

## Aggregation

- [ ] Pipeline: `db.orders.aggregate([{$group: {_id: '$customer', total: {$sum: '$amount'}}}])` → renders
- [ ] `$lookup` pipeline (join-like) → renders
- [ ] `$match` + `$sort` + `$limit` → optimized via cursor
- [ ] Evidence:

## CRUD

- [ ] `insertOne({...})` → returns inserted_id, re-find shows new doc
- [ ] `insertMany([...])` → returns array of ids
- [ ] `updateOne(filter, {$set: {...}})` → matchedCount + modifiedCount returned
- [ ] `replaceOne(filter, newDoc)` → replaced
- [ ] `deleteOne(filter)` → deletedCount = 1
- [ ] `deleteMany(filter)` → deletedCount matches
- [ ] Evidence: paste command + result

## Index / admin

- [ ] List indexes on a collection → all shown with key + options
- [ ] Create index → succeeds, appears in list
- [ ] Drop index → succeeds, gone from list
- [ ] Collection stats: `db.users.stats()` → renders nicely (size, count, avg obj size)
- [ ] Evidence:

## Edit document (in grid)

- [ ] Double-click a document cell → JSON editor opens
- [ ] Edit field, save → backend `updateOne` issued
- [ ] Re-find proves update
- [ ] Invalid JSON → save button disabled with error
- [ ] Evidence:

## Known MongoDB quirks
- ObjectId round-trip must NOT convert to string by mistake (regression: filed in v0.4.x, must not regress)
- Multi-doc transactions: separate UI track, out of scope for v1 NoSQL channel

---

# Redis

## Connect + browse

- [ ] Test connection → INFO returned, version + role (master/replica/sentinel)
- [ ] Tree expand → DB count (0-15 or replica setup)
- [ ] Expand a DB → key tree (uses SCAN, paginated — no `KEYS *`)
- [ ] Evidence:

## Key operations

- [ ] `SET foo bar` → OK
- [ ] `GET foo` → "bar"
- [ ] `EXISTS foo` → 1
- [ ] `DEL foo` → 1; re-GET → nil
- [ ] `EXPIRE k 60` → 1
- [ ] `TTL k` → countdown
- [ ] Evidence:

## Data structure viewers

For each, populate sample data then verify viewer renders:

| Type | Sample population | Viewer renders? | Status |
|---|---|:---:|:---:|
| String | `SET k v` | text | [ ] |
| List | `RPUSH l a b c` | ordered list | [ ] |
| Hash | `HSET h f1 v1 f2 v2` | key-value table | [ ] |
| Set | `SADD s a b c` | unordered list, dedup | [ ] |
| ZSet (sorted set) | `ZADD z 1 a 2 b` | ordered by score | [ ] |
| Stream | `XADD s * field value` | append-only log | [ ] |
| Bitmap | `SETBIT bk 7 1` | bitmap viewer | [ ] |
| HyperLogLog | `PFADD hll a b c` | cardinality estimate | [ ] |
| Geo | `GEOADD g 13.36 38.11 "Palermo"` | map / list with coords | [ ] |
| JSON (ReJSON module) | `JSON.SET k . '{"a":1}'` | JSON tree viewer | [ ] |

Evidence per type: screenshot.

## SCAN-based browsing

- [ ] DB with 100k keys → tree expands without freeze (SCAN with COUNT=100)
- [ ] Scroll → next batch loads incrementally
- [ ] Filter pattern (e.g. `user:*`) → MATCH parameter sent to SCAN
- [ ] Evidence:

## Binary values

- [ ] `SET k "$(echo -ne '\x00\x01\x02')"` (binary bytes) → viewer shows hex
- [ ] No crash on non-UTF8 data
- [ ] Evidence:

## Pub/Sub (if exposed in UI)

- [ ] SUBSCRIBE channel → listener active
- [ ] Other window: PUBLISH channel "msg" → received in first window
- [ ] UNSUBSCRIBE → listener stops
- [ ] Evidence:

## Cluster mode (if applicable)

- [ ] Connect to Redis Cluster (3+ shards) → tree shows all nodes
- [ ] Key on shard 1, key on shard 3 → both browsable from same connection
- [ ] Evidence:

---

# Elasticsearch

## Connect + browse

- [ ] Test connection → cluster name, version, health (green/yellow/red)
- [ ] Tree expand → list of indices
- [ ] Index expand → shows mapping + settings
- [ ] Evidence:

## Search

- [ ] `GET /_cat/indices?v` → table renders
- [ ] `GET /myindex/_search` → top 10 hits in grid
- [ ] `GET /myindex/_search { "query": { "match": { "field": "value" } } }` → filtered hits
- [ ] Aggregation: terms aggregation → bucket counts shown
- [ ] Evidence:

## Index admin

- [ ] `PUT /newindex { "mappings": ... }` → created, appears in tree
- [ ] Update mapping (e.g. add field) → reflected
- [ ] `POST /myindex/_doc { ... }` → returns created id
- [ ] `PUT /myindex/_doc/123 { ... }` → upsert; returns updated
- [ ] `DELETE /myindex/_doc/123` → deleted
- [ ] `DELETE /myindex` → index gone from tree
- [ ] Evidence:

## Templates / aliases

- [ ] List index templates → renders
- [ ] List aliases → renders
- [ ] Create alias → succeeds
- [ ] Evidence:

## Bulk

- [ ] `POST /_bulk` with multiple ops → response shows per-op status
- [ ] Streaming-ish: large bulk doesn't OOM the renderer
- [ ] Evidence:

## Auth

- [ ] Basic auth (user / password) → works
- [ ] API key auth → works
- [ ] No auth (open cluster) → works without warning
- [ ] HTTPS with self-signed cert → option to skip TLS verify (with warning UI)
- [ ] Evidence:

---

## Cross-platform (all 3 NoSQL)

- [ ] All viewers render correctly on macOS / Windows / Linux
- [ ] Copy as JSON / copy as command line both work
- [ ] Evidence:

## Force-kill safety

- [ ] Open a NoSQL connection → run several commands → `pkill -9 Electron` → restart → connection still configured
- [ ] Evidence:

## Known limitations

- MongoDB change streams: not yet wired into UI (v1 doesn't have real-time)
- Redis Streams consumer groups: read-only viewer, no group management UI yet
- Elasticsearch Painless scripts: send via raw DSL, no syntax helper
