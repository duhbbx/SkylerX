# Redis — manual QA

**Covers**: Redis 6.x / 7.x (standalone / sentinel / cluster), Redis Stack (with modules).
**Driver**: `packages/core-driver/src/dialects/redis.ts` (`ioredis` npm).
**Channel**: `executeCommand` IPC.

## Setup

- Branch / commit:
- OS:
- Server: <!-- e.g. redis:7 docker -->
- Test DB: 0 (default)

## Connection

- [ ] Host + port + password (if AUTH set) → green toast, version (`INFO server`)
- [ ] No password → connects (if server allows)
- [ ] ACL user + password (Redis 6+): `username` field exposed
- [ ] TLS: `tls=true` for `rediss://` → works with valid cert
- [ ] TLS with self-signed: `tls:{ rejectUnauthorized:false }` fallback
- [ ] Sentinel mode: master name + sentinel hosts → routed correctly
- [ ] Cluster mode: any node in cluster → discovers full topology
- [ ] Wrong password → WRONGPASS or NOAUTH error
- [ ] Wrong host → ECONNREFUSED < 10s
- [ ] Evidence:

## Database

Redis has 16 (default) numeric DBs (0-15). Cluster mode forces DB 0.

- [ ] `SELECT 1` → switch to DB 1
- [ ] Tree shows all DBs with key count per DB
- [ ] Cluster: tree shows only DB 0, but key tree spans all slots / shards
- [ ] `FLUSHDB` clears current DB
- [ ] `FLUSHALL` clears all DBs (production-flagged → confirm modal)
- [ ] Evidence:

## Keys

### Browse via SCAN (NEVER KEYS *)

- [ ] Tree key browser uses SCAN with COUNT=100, paginates
- [ ] Pattern filter: `user:*` → MATCH parameter passed
- [ ] Type filter: TYPE parameter passed
- [ ] 100k+ keys → tree loads incrementally, no freeze
- [ ] Evidence:

### Basic ops
- [ ] `SET k v` → OK
- [ ] `GET k` → "v"
- [ ] `EXISTS k` → 1
- [ ] `TYPE k` → "string"
- [ ] `DEL k` → 1
- [ ] `UNLINK k` → async delete (preferred for large keys)
- [ ] `EXPIRE k 60` + `TTL k` → countdown
- [ ] `PERSIST k` → removes TTL
- [ ] `RENAME k newk`
- [ ] `COPY k newk` (Redis 6.2+)
- [ ] Evidence:

## Data structure types

### String
- [ ] `SET`, `GET`, `INCR`, `INCRBY`, `APPEND`, `STRLEN`, `GETRANGE`
- [ ] Binary-safe values (insert non-UTF8) → viewer shows hex
- [ ] `SET k v EX 60 NX` (options) → only-if-not-exists
- [ ] Evidence:

### List
- [ ] `RPUSH lst a b c`, `LPUSH lst z`, `LRANGE lst 0 -1`
- [ ] `LPOP`, `RPOP`, `BLPOP` (blocking)
- [ ] `LINSERT`, `LREM`, `LTRIM`
- [ ] List viewer renders ordered items with indices
- [ ] Evidence:

### Hash
- [ ] `HSET h f1 v1 f2 v2`, `HGET h f1`, `HGETALL h`
- [ ] `HINCRBY h count 1`
- [ ] `HSCAN h 0 COUNT 100` for large hashes
- [ ] Hash viewer renders 2-column field/value table
- [ ] Evidence:

### Set
- [ ] `SADD s a b c`, `SMEMBERS s`, `SISMEMBER s a`
- [ ] Set ops: `SUNION`, `SINTER`, `SDIFF`
- [ ] `SRANDMEMBER`, `SPOP`
- [ ] Set viewer renders unordered, dedup
- [ ] Evidence:

### Sorted Set (ZSet)
- [ ] `ZADD z 1 a 2 b 3 c`
- [ ] `ZRANGE z 0 -1 WITHSCORES`, `ZRANGEBYSCORE z 1 2`
- [ ] `ZINCRBY`, `ZRANK`, `ZREVRANK`
- [ ] `ZPOPMIN`, `ZPOPMAX`
- [ ] Viewer renders ordered by score, score visible
- [ ] Evidence:

### Stream (Redis 5+)
- [ ] `XADD stream * field1 value1 field2 value2` → returns ID `ts-seq`
- [ ] `XLEN stream` → entry count
- [ ] `XRANGE stream - +` → all entries
- [ ] `XREAD COUNT 10 STREAMS stream 0` → batch read
- [ ] Consumer groups: `XGROUP CREATE stream g1 $`, `XREADGROUP`, `XACK`
- [ ] Stream viewer renders append-only timeline
- [ ] Evidence:

### Bitmap
- [ ] `SETBIT k 7 1`, `GETBIT k 7`
- [ ] `BITCOUNT k`, `BITOP AND dest k1 k2`
- [ ] Bitmap viewer renders as a grid of bits
- [ ] Evidence:

### HyperLogLog
- [ ] `PFADD hll a b c`, `PFCOUNT hll` → cardinality estimate
- [ ] `PFMERGE dest hll1 hll2`
- [ ] Viewer shows estimate vs raw
- [ ] Evidence:

### Geo
- [ ] `GEOADD geo 13.361 38.115 "Palermo"`
- [ ] `GEOSEARCH geo FROMLONLAT 15 37 BYRADIUS 200 km`
- [ ] Geo viewer shows points (map or list with coords)
- [ ] Evidence:

### JSON (ReJSON module — Redis Stack)
- [ ] `JSON.SET k . '{"a":1,"b":[2,3]}'`
- [ ] `JSON.GET k`, `JSON.GET k .a` (path access)
- [ ] `JSON.ARRAPPEND k .b 4`
- [ ] JSON viewer renders tree
- [ ] Evidence:

### TimeSeries (Redis Stack)
- [ ] `TS.CREATE ts1 RETENTION 86400000 LABELS sensor 1`
- [ ] `TS.ADD ts1 * 42.5`
- [ ] `TS.RANGE ts1 - +`
- [ ] TS viewer renders chart
- [ ] Evidence:

### Search (RediSearch module)
- [ ] `FT.CREATE idx ON HASH PREFIX 1 user: SCHEMA name TEXT email TEXT`
- [ ] Insert hashes that match prefix → indexed automatically
- [ ] `FT.SEARCH idx "term"`
- [ ] Tree shows search indexes
- [ ] Evidence:

## Constraints / schema

- Redis has NO schema enforcement.
- Type per key is dynamic; reusing a key for different type → WRONGTYPE error.
- Skip section.

## Functions / Stored procedures

- Redis 7+ has FUNCTION (Lua-based, persistent):
  - `FUNCTION LOAD …` to register Lua function
  - `FCALL func_name args` to invoke
- [ ] Lua function loads and invokes
- [ ] `FUNCTION LIST`
- [ ] Tree shows functions
- [ ] Evidence:

### Lua scripts (legacy)
- [ ] `EVAL "return KEYS[1]" 1 mykey` works
- [ ] `EVALSHA` for cached scripts
- [ ] `SCRIPT LOAD` → returns SHA1

## Pub/Sub

- [ ] `SUBSCRIBE chan1` in one window
- [ ] `PUBLISH chan1 "hello"` from another window → first receives
- [ ] `PSUBSCRIBE news.*` for pattern
- [ ] `UNSUBSCRIBE` to leave
- [ ] If UI exposes pub/sub panel, verify subscriber count tracked
- [ ] Evidence:

## Transactions

Redis "transactions" via MULTI / EXEC are simpler than RDBMS TX (no isolation, no rollback on error).

- [ ] `MULTI` → command queue
- [ ] `SET k1 v1`, `INCR counter` (queued)
- [ ] `EXEC` → all execute atomically
- [ ] `DISCARD` to abort
- [ ] `WATCH k` → optimistic locking; if k changes before EXEC, abort
- [ ] Manual-commit mode UI: maps to MULTI/EXEC pattern? Or disable? Verify decision documented
- [ ] Evidence:

## Users · ACL (Redis 6+)

```
ACL SETUSER qa_user on >StrongPass!2026 ~user:* +get +set
ACL LIST
ACL DELUSER qa_user
```

- [ ] User created with limited commands + key patterns
- [ ] Connect as qa_user → restricted commands fail with NOPERM
- [ ] ACL categories: `+@read`, `-@write`, `+@admin`
- [ ] Default user: ACLs on `default` user manage anonymous access
- [ ] Evidence:

## Indexes

- Redis: no traditional indexes; secondary lookup via sorted set or RediSearch.
- Skip section.

## Sharding / Cluster

- [ ] `CLUSTER INFO`, `CLUSTER NODES`, `CLUSTER SLOTS`
- [ ] Slots distributed across master shards
- [ ] Key with `{tag}` forces same slot
- [ ] Tree may show cluster topology in DBA panel
- [ ] Cross-shard MULTI/EXEC NOT allowed
- [ ] Evidence:

## Triggers

- Redis has NO triggers.
- Keyspace notifications (pub/sub on key events): `CONFIG SET notify-keyspace-events KEA`, then SUBSCRIBE to `__keyspace@0__:mykey`
- [ ] If exposed in UI, verify works
- [ ] Skip section otherwise

## Persistence + admin

- [ ] `INFO persistence` → RDB / AOF status
- [ ] `BGSAVE` triggers snapshot
- [ ] `LASTSAVE` returns timestamp of last save
- [ ] `CONFIG GET maxmemory`, `CONFIG SET maxmemory 1gb`
- [ ] `MEMORY USAGE k` → bytes used by key
- [ ] `DBSIZE` → key count
- [ ] `CLIENT LIST` → active connections

## Dialect-specific quirks

### Cluster gotchas
- [ ] Multi-key commands across shards fail with CROSSSLOT
- [ ] Pipelining across shards: app's driver should handle
- [ ] MOVED / ASK redirects: ioredis handles transparently

### Large keys
- [ ] Hash / List / Set / ZSet with millions of members: viewer must paginate via *SCAN
- [ ] `UNLINK` instead of `DEL` for large keys (async)

### Memory eviction
- [ ] `maxmemory-policy allkeys-lru` / `noeviction` etc.
- [ ] Filling DB beyond maxmemory: OOM error returned to client
- [ ] App should NOT cache eagerly

### TLS-only servers
- [ ] Some setups (Redis Cloud) require TLS — verify auto-detect or clear error

### Module discovery
- [ ] `MODULE LIST` → ReJSON / RediSearch / RedisTimeSeries / RedisGears
- [ ] App should detect modules and enable relevant viewers

## Cross-platform

- [ ] ioredis pure JS, works on all OS
- [ ] Cluster failover handling — verify it survives a primary kill during testing
- [ ] Evidence:

## Known limitations

- ioredis vs node-redis: app uses ioredis, watch for any behavioral diff if migrating
- Pub/Sub uses a separate connection; cannot also issue commands on that connection
- MULTI/EXEC is NOT a true ACID transaction — no read isolation, no rollback on logic error
- ACL category coverage: may need to update as Redis adds new commands
- RESP3 protocol (Redis 6+): app's driver may not yet use; verify if needed for newer features
- Active-Active CRDT (Redis Enterprise): out of scope
