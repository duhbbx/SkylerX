# Elasticsearch — manual QA

**Covers**: Elasticsearch 7.x / 8.x (self-hosted or Elastic Cloud).
**Driver**: `packages/core-driver/src/dialects/elasticsearch.ts` (`@elastic/elasticsearch` npm).
**Channel**: `executeCommand` IPC (HTTP REST).

## Setup

- Branch / commit:
- OS:
- Server: <!-- e.g. elasticsearch:8 docker, port 9200 -->
- Test index: `qa_users`

## Connection

- [ ] HTTP host + port + user + password → green toast with version + cluster name
- [ ] HTTPS with valid CA → works
- [ ] HTTPS self-signed: `tls.rejectUnauthorized=false` fallback (warns user)
- [ ] API key auth (no user/pass): apiKey field exposed
- [ ] Cloud ID + API key: combined cloud auth — works
- [ ] Wrong password → 401 with `security_exception`
- [ ] No auth (open cluster) → warns but connects
- [ ] Wrong host → ECONNREFUSED / ETIMEDOUT
- [ ] Multiple node URLs (cluster) → round-robin
- [ ] Evidence:

## Cluster info

- [ ] `GET /_cluster/health` → green / yellow / red status
- [ ] `GET /_cluster/state` → big JSON, renders without UI freeze
- [ ] `GET /_nodes` → node list
- [ ] `GET /_cat/nodes?v` → table view
- [ ] `GET /_cat/health?v` → cluster health
- [ ] DBA panel shows shard distribution / unassigned shards
- [ ] Evidence:

## Indices

### Create
```http
PUT /qa_users
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0,
    "analysis": {
      "analyzer": {
        "edge_n": {
          "tokenizer": "edge_ngram_tokenizer"
        }
      },
      "tokenizer": {
        "edge_ngram_tokenizer": {
          "type": "edge_ngram",
          "min_gram": 2,
          "max_gram": 10
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "id":         { "type": "long" },
      "name":       { "type": "text", "analyzer": "edge_n" },
      "name.kw":    { "type": "keyword" },
      "email":      { "type": "keyword" },
      "age":        { "type": "integer" },
      "salary":     { "type": "scaled_float", "scaling_factor": 100 },
      "bio":        { "type": "text" },
      "tags":       { "type": "keyword" },
      "address":    { "type": "object", "properties": {
                       "city": { "type": "keyword" },
                       "zip":  { "type": "keyword" }
                     } },
      "geo":        { "type": "geo_point" },
      "is_active":  { "type": "boolean" },
      "payload":    { "type": "flattened" },
      "vector":     { "type": "dense_vector", "dims": 384 },
      "created_at": { "type": "date" }
    }
  }
}
```

- [ ] Index created → tree shows mapping + settings
- [ ] Mapping persists across reconnects
- [ ] All field types render in mapping viewer
- [ ] Evidence:

### Update / inspect
- [ ] `GET /qa_users/_mapping` → mapping JSON
- [ ] `GET /qa_users/_settings` → settings JSON
- [ ] Add new field to mapping (dynamic): index a doc with new field → mapping auto-updated (if dynamic=true)
- [ ] Explicit add: `PUT /qa_users/_mapping {"properties":{"newfield":{"type":"keyword"}}}`
- [ ] Cannot change existing field type — must reindex; verify clear error
- [ ] Update settings: `PUT /qa_users/_settings {"number_of_replicas":1}`
- [ ] Close / Open: `POST /qa_users/_close`, `POST /qa_users/_open`
- [ ] Delete: `DELETE /qa_users`
- [ ] Evidence:

### Aliases
- [ ] `POST /_aliases {"actions":[{"add":{"index":"qa_users","alias":"users_alias"}}]}`
- [ ] Query via alias: `GET /users_alias/_search`
- [ ] Atomic alias swap (zero-downtime reindex pattern)
- [ ] Tree shows aliases as separate nodes
- [ ] Evidence:

### Templates
- [ ] Index template: `PUT /_index_template/qa_template {"index_patterns":["qa_*"], "template":{...}}`
- [ ] New indices matching pattern auto-use template
- [ ] Tree shows templates
- [ ] Evidence:

### Lifecycle (ILM)
- [ ] `PUT /_ilm/policy/qa_policy {"policy":{"phases":{...}}}`
- [ ] Attach to template: hot / warm / cold / delete phases
- [ ] Out of UI scope for now; verify command works

## Documents

### Index (insert / upsert)
- [ ] `POST /qa_users/_doc {"id":1,"name":"Alice",...}` → auto-generated _id
- [ ] `PUT /qa_users/_doc/123 {...}` → explicit _id (upsert)
- [ ] `PUT /qa_users/_create/123 {...}` → fails if exists (create-only)
- [ ] `POST /qa_users/_update/123 {"doc":{"age":31}}` → partial update
- [ ] `POST /qa_users/_update/123 {"script":{"source":"ctx._source.age += 1"}}` → script update
- [ ] `POST /qa_users/_update/123 {"doc":{"age":30}, "upsert":{...}}` → upsert pattern
- [ ] `DELETE /qa_users/_doc/123`
- [ ] Evidence:

### Bulk
```http
POST /_bulk
{ "index": { "_index": "qa_users", "_id": "1" } }
{ "name": "A", "age": 20 }
{ "index": { "_index": "qa_users", "_id": "2" } }
{ "name": "B", "age": 30 }
{ "delete": { "_index": "qa_users", "_id": "5" } }
```

- [ ] Bulk runs, response shows per-op status (200 / 201 / 404)
- [ ] Failure on one item doesn't fail the whole batch
- [ ] Large bulk (10k ops) succeeds within reasonable time
- [ ] Evidence:

## Queries

### Match all
- [ ] `GET /qa_users/_search { "query": { "match_all": {} } }` → all hits
- [ ] Pagination: `from`/`size`, or `search_after` for deep paging
- [ ] Source filtering: `"_source": ["name","email"]`

### Term-level
- [ ] `match`: full-text, analyzed
- [ ] `term`: exact, on keyword fields
- [ ] `terms`: array of values
- [ ] `range`: gte/lte on numeric / date
- [ ] `exists`: field is present
- [ ] `wildcard`: pattern with *
- [ ] `prefix`
- [ ] `regexp`
- [ ] `fuzzy`
- [ ] Evidence:

### Compound
- [ ] `bool`: `must` / `should` / `must_not` / `filter`
- [ ] Nested boolean queries
- [ ] `constant_score` wrapper for filter-only query
- [ ] `boosting` to influence ranking
- [ ] Evidence:

### Sort + highlight
- [ ] Sort by field: `"sort": [{"created_at": "desc"}]`
- [ ] Multi-sort with score: `"sort": ["_score", {"date":"desc"}]`
- [ ] Highlight: `"highlight": {"fields":{"bio":{}}}` → hits include highlighted snippets
- [ ] Evidence:

### Geo queries
- [ ] `geo_distance`: `{"distance": "100km", "geo": {"lat":..., "lon":...}}`
- [ ] `geo_bounding_box`
- [ ] `geo_polygon`
- [ ] Evidence:

### Vector search (kNN, ES 8.x)
- [ ] `POST /qa_users/_knn_search { "knn": {...}, "fields":["name"] }`
- [ ] Hybrid: combine kNN + text
- [ ] Evidence:

### Aggregations
- [ ] Bucket: `terms`, `histogram`, `date_histogram`, `range`, `geo_grid`, `composite`
- [ ] Metric: `sum`, `avg`, `min`, `max`, `stats`, `cardinality` (HLL)
- [ ] Pipeline: `cumulative_sum`, `derivative`, `bucket_sort`
- [ ] Nested aggs: terms → date_histogram → sum
- [ ] Each renders in the result grid
- [ ] Evidence:

### SQL API (ES SQL)
- [ ] `POST /_sql { "query": "SELECT * FROM qa_users WHERE age > 25 LIMIT 10" }` → returns rows
- [ ] Translate SQL to DSL: `POST /_sql/translate { "query": "..." }`
- [ ] Limited SQL surface — verify which features ES SQL supports
- [ ] Evidence:

### EQL (Event Query Language)
- [ ] Used for security / SIEM workloads
- [ ] Out of scope unless test data fits

## Reindex / update-by-query

- [ ] `POST /_reindex {"source":{"index":"qa_users"},"dest":{"index":"qa_users_v2"}}` → progress visible
- [ ] `POST /qa_users/_update_by_query {"script":{"source":"..."}, "query":{...}}` → updates matching
- [ ] `POST /qa_users/_delete_by_query {"query":{...}}` → bulk delete

## Snapshots / restore

- [ ] `PUT /_snapshot/qa_repo {"type":"fs","settings":{"location":"/snapshots"}}` → repo registered
- [ ] `PUT /_snapshot/qa_repo/snap1` → snapshot
- [ ] `POST /_snapshot/qa_repo/snap1/_restore` → restore
- [ ] Out of UI scope, but commands should work via Raw panel

## Users · Roles · API keys (X-Pack security)

- [ ] `POST /_security/user/qa_user {"password":"…","roles":["viewer"]}` → user created
- [ ] `POST /_security/role/qa_role {"cluster":["monitor"], "indices":[{"names":["qa_*"], "privileges":["read"]}]}`
- [ ] `POST /_security/api_key {"name":"qa_key","role_descriptors":{...}}` → API key for app integration
- [ ] `DELETE /_security/user/qa_user`
- [ ] Built-in roles: `superuser`, `kibana_admin`, `viewer`, `editor`
- [ ] `GET /_security/_authenticate` → who am I
- [ ] Evidence:

## Constraints / Schema-on-write

- [ ] Mapping enforces types
- [ ] `dynamic: strict` → unknown fields rejected
- [ ] `dynamic: false` → unknown fields ignored (not indexed)
- [ ] `dynamic: true` → auto-add to mapping (default)
- [ ] `dynamic_templates` for runtime field shaping
- [ ] Evidence:

## Functions / Painless scripts

```http
GET /qa_users/_search
{
  "script_fields": {
    "double_age": {
      "script": { "source": "doc['age'].value * 2" }
    }
  }
}
```

- [ ] Painless script runs
- [ ] Update with script: `"script": {"source":"ctx._source.x = …"}`
- [ ] Stored script: `PUT /_scripts/qa_script {"script":{"source":"..."}}` → callable by ID

## Triggers / sequences / TX

- ES has NO triggers, NO sequences, NO ACID transactions (each doc op is atomic per shard).
- Manual-commit mode UI: should be DISABLED for ES connections.
- Skip these sections.

## Dialect-specific quirks

### Versioning (optimistic concurrency)
- [ ] Index doc → response has `_version`, `_seq_no`, `_primary_term`
- [ ] Conditional update: `?if_seq_no=N&if_primary_term=M` → fails if mismatch (409)
- [ ] Used for optimistic concurrency control

### Refresh interval
- [ ] By default, indexed doc not searchable for ~1s (refresh interval)
- [ ] Force refresh: `?refresh=true` on index op (small cost; avoid in bulk)
- [ ] `POST /qa_users/_refresh`

### Mapping conflicts
- [ ] Try to index doc with `age: "twenty"` (string into integer field) → 400 mapper_parsing_exception
- [ ] Mapping cannot be changed once set for a field — must reindex

### Index naming
- [ ] Lowercase only; no `\`, `/`, `*`, `?`, `<`, `>`, `|`, ` `, `,`, `#`
- [ ] Cannot start with `_`, `-`, `+`
- [ ] Max 255 bytes encoded

### Shard management
- [ ] Number of primary shards fixed at creation; cannot change
- [ ] Replicas can be added/removed
- [ ] `_cluster/reroute` for manual shard movement (DBA)

### Multi-cluster search (CCS)
- [ ] Cross-cluster search: `GET /cluster_a:qa_users,cluster_b:qa_users/_search` if remote clusters configured
- [ ] Out of scope for app

## Cross-platform

- [ ] @elastic/elasticsearch is pure JS, works on all OS
- [ ] HTTP timeouts configurable
- [ ] Evidence:

## Known limitations

- ES 7 → 8 migration: some deprecated APIs (types `_doc` always since 7) — verify driver targets 8
- Bulk requests have implicit max size (default 100MB on server) — large bulks chunked
- Document size soft limit: 100MB per doc (don't store giant blobs in ES)
- Nested fields: each nested doc indexed as separate hidden doc; reaches limits
- Vector search performance depends on shard size + HNSW index params; tune for use case
- Hot-warm-cold architecture (ILM) requires per-node `data` role config
