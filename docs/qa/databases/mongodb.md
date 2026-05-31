# MongoDB — manual QA

**Covers**: MongoDB 5.x – 7.x (standalone / replica set / sharded cluster).
**Driver**: `packages/core-driver/src/dialects/mongo.ts` (`mongodb` npm).
**Channel**: `executeCommand` IPC (NOT SQL channel).

## Setup

- Branch / commit:
- OS:
- Server: <!-- e.g. mongo:7 docker -->
- Test DB: `qa_db`

## Connection

- [ ] Connection string `mongodb://user:pass@host:27017/qa_db` → connects
- [ ] `mongodb+srv://` (DNS SRV record for Atlas) → resolves and connects
- [ ] TLS: `tls=true` + valid cert → works
- [ ] TLS: `tlsAllowInvalidCertificates=true` for self-signed → works
- [ ] Replica set: `replicaSet=rs0` parameter respected
- [ ] Wrong password → MongoServerError with code 18 (Authentication failed)
- [ ] Wrong host → ECONNREFUSED / ETIMEDOUT < 10s
- [ ] Auth source: `authSource=admin` honored
- [ ] Evidence:

## Database / collection

MongoDB hierarchy: cluster → database → collection → document.

- [ ] `use qa_db` (auto-creates on first write)
- [ ] Tree expand → list of DBs
- [ ] Expand a DB → list of collections
- [ ] `db.createCollection('qa_c')` → empty collection
- [ ] Capped collection: `db.createCollection('qa_capped', {capped:true, size:1048576, max:1000})`
- [ ] Time-series collection (Mongo 5+): `db.createCollection('qa_ts', {timeseries:{timeField:'ts', metaField:'meta', granularity:'seconds'}})`
- [ ] `db.qa_c.drop()` → collection removed
- [ ] `db.dropDatabase()` → DB gone
- [ ] Evidence:

## Documents

### Insert
```js
db.users.insertOne({
  _id: ObjectId(),
  name: "Alice",
  email: "alice@example.com",
  age: NumberInt(30),
  salary: NumberDecimal("75000.00"),
  tags: ["dev", "admin"],
  address: { city: "NYC", zip: "10001" },
  created_at: new Date(),
  payload: {
    nested: { deep: { value: 42 } }
  },
  binary_data: BinData(0, "base64string"),
  is_active: true,
  ref_id: NumberLong("9223372036854775807")
})
```

- [ ] Single insert succeeds, returns `insertedId`
- [ ] All BSON types preserved on round-trip read:
  - [ ] ObjectId — must NOT serialize to string by accident
  - [ ] Date — ISO format with timezone
  - [ ] NumberInt32 / NumberInt64 — preserved (no JS number coercion / truncation)
  - [ ] NumberDecimal — full precision
  - [ ] Binary — base64 round-trip
  - [ ] Nested objects — deeply preserved
  - [ ] Arrays — order preserved
- [ ] `insertMany([...])` returns array of IDs
- [ ] Evidence:

### Find / Query
- [ ] `db.users.find({})` → all
- [ ] `db.users.find({name: "Alice"})` → filter
- [ ] `db.users.find({age: {$gt: 25}})` → operators
- [ ] `db.users.find({tags: "dev"})` → matches if array contains
- [ ] `db.users.find({"address.city": "NYC"})` → dot-path nested
- [ ] `db.users.find({"payload.nested.deep.value": 42})` → deep dot-path
- [ ] `db.users.find({tags: {$all: ["dev","admin"]}})` → array all-match
- [ ] `db.users.find({$or: [{age:25}, {age:30}]})` → logical
- [ ] Projection: `db.users.find({}, {name:1, email:1, _id:0})`
- [ ] Sort + skip + limit: `db.users.find().sort({age:-1}).skip(10).limit(5)`
- [ ] Count: `db.users.countDocuments({age: {$gt: 25}})`
- [ ] Distinct: `db.users.distinct("name")`
- [ ] Evidence:

### Update
- [ ] `updateOne({_id: ObjectId(...)}, {$set: {age: 31}})` → matched=1, modified=1
- [ ] `updateMany({active: false}, {$set: {archived: true}})`
- [ ] `replaceOne(filter, newDoc)` → entire doc replaced
- [ ] `$inc`, `$push`, `$pull`, `$addToSet` operators
- [ ] `$rename` field
- [ ] `$unset` field — removes
- [ ] Upsert: `updateOne(filter, update, {upsert: true})` → inserts if not found
- [ ] `findOneAndUpdate` returns the doc (before or after update via `returnDocument`)
- [ ] Evidence:

### Delete
- [ ] `deleteOne({_id: ObjectId(...)})` → deletedCount=1
- [ ] `deleteMany({archived: true})` → bulk delete
- [ ] `db.users.drop()` — drops entire collection

## Aggregation pipeline

```js
db.orders.aggregate([
  { $match: { status: "completed" } },
  { $group: { _id: "$customer", total: { $sum: "$amount" } } },
  { $sort: { total: -1 } },
  { $limit: 10 },
  { $lookup: {
      from: "customers", localField: "_id", foreignField: "_id", as: "customer_info"
    }
  },
  { $unwind: "$customer_info" }
])
```

- [ ] $match / $group / $sort / $limit basic pipeline runs
- [ ] $lookup (join-like) returns matched documents
- [ ] $unwind expands array → multiple rows
- [ ] $project shapes output
- [ ] $facet for multi-output pipelines
- [ ] $bucket / $bucketAuto for histograms
- [ ] $graphLookup for recursive traversal (tree / DAG)
- [ ] $merge / $out to write results to a collection
- [ ] Evidence:

## Indexes

```js
db.users.createIndex({ email: 1 }, { unique: true })
db.users.createIndex({ "address.city": 1, age: -1 })
db.users.createIndex({ tags: 1 })                       // multikey on array
db.users.createIndex({ bio: "text" })                   // text search
db.places.createIndex({ location: "2dsphere" })         // geospatial
db.users.createIndex({ created_at: 1 }, { expireAfterSeconds: 3600 })  // TTL
db.users.createIndex({ age: 1 }, { partialFilterExpression: { age: { $gt: 18 } } })
db.users.createIndex({ email: 1 }, { sparse: true })    // index only docs with field
```

- [ ] Each index type created
- [ ] `db.users.getIndexes()` lists all
- [ ] `db.users.totalIndexSize()` returns bytes
- [ ] `db.users.dropIndex("indexName")`
- [ ] EXPLAIN shows index usage: `db.users.find({email:"…"}).explain("executionStats")`
- [ ] App tree shows indexes per collection
- [ ] Evidence:

## Views

```js
db.createView("qa_view", "users", [
  { $match: { is_active: true } },
  { $project: { _id: 0, name: 1, email: 1 } }
])
```

- [ ] View created → tree shows under views
- [ ] `db.qa_view.find()` works
- [ ] Views are read-only (write fails)
- [ ] `db.qa_view.drop()`

## Constraints

MongoDB enforces:
- [ ] UNIQUE indexes prevent duplicates (E11000 error)
- [ ] Schema validation (Mongo 3.2+): `db.runCommand({collMod:'users', validator: {...}})`
- [ ] Required fields (via JSON schema validator)
- [ ] NO foreign keys (denormalize or use $lookup for cross-ref)

## Users · Roles

MongoDB has built-in role-based auth.

```js
use admin
db.createUser({
  user: "qa_user",
  pwd: "StrongPass!2026",
  roles: [
    { role: "readWrite", db: "qa_db" },
    { role: "readAnyDatabase", db: "admin" }
  ]
})
db.updateUser("qa_user", { roles: [{role:"read", db:"qa_db"}] })
db.dropUser("qa_user")
```

- [ ] User created → visible in `db.getUsers()`
- [ ] Connect with new user → can do covered operations
- [ ] Built-in roles: `read`, `readWrite`, `dbAdmin`, `clusterAdmin`, `userAdmin`, `root`
- [ ] Custom role: `db.createRole({role:"qa_role", privileges:[...], roles:[]})`
- [ ] `db.grantRolesToUser`, `db.revokeRolesFromUser`
- [ ] Evidence:

## Transactions (Mongo 4.0+, replica set required)

```js
session = db.getMongo().startSession()
session.startTransaction()
try {
  session.getDatabase("qa_db").orders.insertOne({...})
  session.getDatabase("qa_db").inventory.updateOne({...}, {$inc:{count:-1}})
  session.commitTransaction()
} catch (e) {
  session.abortTransaction()
}
```

- [ ] Multi-doc TX works on replica set
- [ ] Standalone server (no replica) → TX rejected with specific error
- [ ] Manual-commit mode in UI: needs server to support TX; verify
- [ ] Read concern levels: `majority`, `linearizable`
- [ ] Write concern: `w: "majority"`, `wtimeout`

## Sharding

- [ ] `sh.enableSharding('qa_db')` (on mongos)
- [ ] `sh.shardCollection('qa_db.users', {user_id: 'hashed'})`
- [ ] `sh.status()` → tree may show shards in DBA panel
- [ ] Out of scope unless test cluster is sharded

## Change streams (real-time)

```js
const cs = db.users.watch([{$match: {operationType: "insert"}}])
cs.next()  // blocks until insert
```

- [ ] Change stream works if connected to replica set
- [ ] UI integration: not yet, but server-side functionality verified
- [ ] Skip if no UI hookup

## Dialect-specific quirks

### ObjectId
- [ ] **Regression bait**: ObjectId must round-trip as ObjectId, NOT string ("hex"-form)
- [ ] Insert with ObjectId() → re-find returns same type
- [ ] In grid: rendered as `ObjectId("...")` not plain string

### NumberInt64 / NumberLong
- [ ] Large integers preserved (use BSON Long, not JS number) — important for IDs > 2^53

### Dates with timezone
- [ ] All dates stored as UTC; grid display follows app's locale setting

### Document size limit
- [ ] 16 MB max per document — verify app surfaces specific error if exceeded
- [ ] Use GridFS for larger blobs (separate channel — out of scope)

### Capped collections
- [ ] Insert beyond size → oldest auto-removed (FIFO)
- [ ] Verify tree shows "capped" annotation

### Time-series collections (Mongo 5+)
- [ ] Created with `timeseries` option — internal bucketing
- [ ] Tree shows as time-series; CRUD differs slightly

### Atlas Search (separate service)
- [ ] If MongoDB Atlas + Atlas Search enabled: `db.users.aggregate([{$search:{...}}])` works
- [ ] Out of scope for self-hosted

## Cross-platform

- [ ] mongodb driver pure JS, works on all OS
- [ ] Aggregation pipeline runs identically
- [ ] Evidence:

## Known limitations

- BSON binary subtypes (0-7): app should detect kind label
- Decimal128 round-trip: verify no precision loss
- Change streams need persistent connection — long-lived; verify no leak on app close
- $lookup with very large `from` collection can be slow; warn user
- TX limited to 60s by default — server-side `transactionLifetimeLimitSeconds` setting
