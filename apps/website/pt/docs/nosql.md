# Guia de uso aprofundado de NoSQL — MongoDB / Redis / Elasticsearch

O SkylerX trata NoSQL como cidadão de primeira classe: mesma árvore de metadados, mesmo gerenciamento de conexões, mesma IA — mas o transporte usa o **canal paralelo (executeCommand)** — detalhes em [ARCHITECTURE](https://github.com/duhbbx/SkylerX/blob/main/ARCHITECTURE.md). Este documento descreve por banco as capacidades de UI e os ops + parâmetros **realmente expostos** no driver.

## Visão geral — canal paralelo e canal SQL

`DataClient` expõe duas entradas independentes:

| Canal | Entrada | Aplica a |
|---|---|---|
| SQL | `connections.execute(sql)` | MySQL / PostgreSQL / Oracle / ... |
| Command | `connections.executeCommand({ op, args, context, maxRows? })` | MongoDB / Redis / Elasticsearch |

`execute()` em drivers NoSQL lança `SQL_CHANNEL_UNSUPPORTED`:

```ts
// packages/core-driver/src/dialects/mongo.ts
async execute(): Promise<QueryResult> {
  throw new Error('SQL_CHANNEL_UNSUPPORTED: MongoDB não suporta SQL; use executeCommand')
}
```

`executeCommand` é o ponto de entrada real; **cada driver define seu dicionário de ops**. As próximas seções detalham esse dicionário.

Convenções:

- `context` carrega o **alvo** (Mongo `database` / `collection`, Redis `dbIndex`, ES `collection` = index).
- `args` é o objeto / array de parâmetros do op (objeto em Mongo / ES, array posicional em Redis).
- `maxRows` só faz sentido em ops de leitura que retornam coleção; o driver usa `limit/size + 1` para detectar `truncated`.
- Retorno: `CommandResult` `{ data, executionTimeMs, affected?, truncated? }`.

---

## MongoDB

### Árvore

```
Connection
└── Database (vários)
    └── Group "Collections" (count)
        └── Collection (kind = Table, reusa nó de tabela SQL)
```

No driver:

- `listDatabases` chama `admin().listDatabases()`.
- `databaseGroups` usa `listCollections({}, { nameOnly: true })` para preencher `count`.
- `listCollections` ordenadas, viram `kind: Table`; front renderiza `MongoPane` quando `connection.dialect === 'mongodb'`.

### Navegador da collection (`MongoPane.vue`)

Clicar no nó da Collection abre o componente; topo com 3 áreas:

1. **Breadcrumb** `database · collection`, ao lado de refresh / commit / undo.
2. **Filter JSON (textarea) + limit / skip + alternância tabela / JSON**.
3. **Resultado** — colunas são união de chaves no primeiro nível; ou JSON cru.

O botão de execução chama `find`:

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

Cabeçalhos via união dinâmica das chaves nas linhas, ideal para coleções schemaless. Quando `_id` é string 24-hex, renderiza como `ObjectId("...")` (lembrete: por baixo é BSON ObjectId; IPC serializa como string).

### Grade editável → updateOne (dot-path)

Duplo clique em célula não-`_id` entra em edição (`_id` proibido). Digite **JSON válido**, Enter confirma. Células dirty destacadas; topo "Commit (N)" → `updateOne` linha a linha.

Diff em `diffToOps()`:

- Nenhum lado é plain object → `$set` no campo todo (não desce em array para não bagunçar índices).
- Ambos plain objects → união de chaves recursiva; só novo → `$set`; só antigo → `$unset`; igual → skip.
- Path em dot-path, ex.: `addr.city = '...'`.

Request final:

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

### Wrap automático de ObjectId (`$oid` marker)

ObjectId perde tipo no IPC (vira string). Convenção bidirecional:

- UI ao reenviar: `wrapOidStrings()` envelopa strings 24-hex em `{ $oid: 'hex' }`.
- Driver ao receber: `normalizeIds()` converte strings 24-hex sob chave `_id` em `new ObjectId(hex)`.

O driver é **conservador**: só converte sob chave `_id`; não toca em outras. Motivo nos comentários: evita converter strings de hash que coincidem com formato. Para consultar por `userId / refId` que são ObjectIds, use `{ $oid: '...' }` ou EJSON completo.

Operadores dentro de `_id` também são tratados:

```jsonc
{ "_id": "65f1aa..."                                      } // → ObjectId
{ "_id": { "$in": ["65f1aa...", "65f2bb..."]              }} // array
{ "_id": { "$eq": "65f1aa...", "$exists": true            }} // operadores
{ "$or": [{ "_id": "65f1aa..." }, { "name": "x" }]         } // aninhado
```

### Aggregation pipeline (`MongoAggregationDialog.vue`)

Cards de stages à esquerda (mover / remover); resultado à direita. Cada stage é uma textarea JSON. `STAGE_TEMPLATES` com 10 templates de uso comum:

`$match` · `$project` · `$group` · `$sort` · `$limit` · `$skip` · `$unwind` · `$lookup` · `$addFields` · `$count`

Execução: monta `{ [stage.op]: JSON.parse(stage.json) }` em ordem:

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

Qualquer stage com JSON inválido → erro no pipeline inteiro. Top `limit` (input mini 1-1000) renderizado JSON full. `details` tem "Ver pipeline JSON" para copiar para mongosh.

### Metadados da collection (`MongoCollectionInfoDialog.vue`)

Dois tabs:

**Estatísticas** (`collStats`): `count` / `size` / `avgObjSize` / `storageSize` / `nindexes` / `totalIndexSize` em unidades legíveis.

**Índices** — `listIndexes` + tabela (name / keys / unique / sparse / ttl / size) + form de novo índice:

- Linhas para campos; direção `1 / -1 / text / 2dsphere`.
- `name / unique / sparse / expireAfterSeconds`.
- `createIndex` por trás: `{ key: { field1: 1, field2: -1 }, unique?, sparse?, expireAfterSeconds? }`.

`dropIndex` para remover; UI bloqueia `_id_` (índice default).

### Ops suportados no driver

`mongo.ts` switch real:

| Categoria | op | args obrigatórios | Descrição |
|---|---|---|---|
| Read | `find` | `filter`, `options?` | Cursor toArray; maxRows → `limit+1` para truncated |
| Read | `findOne` | `filter`, `options?` | Single doc |
| Read | `aggregate` | `pipeline`, `options?` | Pipeline, maxRows idem |
| Read | `countDocuments` | `filter`, `options?` | |
| Read | `distinct` | `field`, `filter?`, `options?` | |
| Write | `insertOne` | `document`, `options?` | `affected = acknowledged ? 1 : 0` |
| Write | `insertMany` | `documents`, `options?` | `affected = insertedCount` |
| Write | `updateOne` / `updateMany` | `filter`, `update`, `options?` | `affected = modifiedCount` |
| Write | `replaceOne` | `filter`, `document`, `options?` | |
| Write | `deleteOne` / `deleteMany` | `filter`, `options?` | `affected = deletedCount` |
| DB | `runCommand` | `args` inteiro como command em `db.command()` | escape hatch |
| DB | `listCollections` | `filter?`, `options?` | |
| DB | `createCollection` | `name`, `options?` | |
| DB | `dropCollection` | `name` | |
| Index | `collStats` / `listIndexes` / `createIndex` / `dropIndex` | ver `MongoCollectionInfoDialog` | passa por `runCommand` |

> Ops fora da tabela → `UNKNOWN_OP`. Para adicionar, edite o switch em `mongo.ts`; não use API arbitrária.

---

## Redis

### Árvore

```
Connection
└── Database  db0..db15 (16 lógicos fixos, count via INFO keyspace)
    └── Group "Strings / Hashes / Lists / Sets / Sorted Sets / Streams"
        └── Key (SCAN amostral, max 200)
```

`listDatabases` usa `INFO keyspace` para todos os 16; bancos vazios sem count.

`listTypeGroups` analisa `DBSIZE`: `<= 100 000` faz SCAN integral + pipeline TYPE com count exato; bancos maiores apenas mostram grupos sem contagem.

`sampleKeysByType` ao escolher grupo faz SCAN + pipeline TYPE com filtro, amostragem máxima `SCAN_SAMPLE_LIMIT = 200`, budget de varredura ~`ROUND_CAP × COUNT = 50 × 200 = 10 000` keys. Restante mostra `... (mais, use SCAN)` direcionando ao `RedisSearchDialog`.

### Key browser (`RedisPane.vue`)

Esquerda: lista SCAN + MATCH. Direita: view conforme TYPE da key. Rodapé "Carregar mais" continua o cursor SCAN até retornar `0`.

Carregamento:

1. `SCAN <cursor> MATCH <match> COUNT 500` → `[nextCursor, batch]`.
2. Novos keys → chunks (`TYPE_PIPELINE_CHUNK = 200`) → `TYPE` em paralelo.
3. Append em `keys.value`, avança cursor.

Ordenação por name / type / ttl com desc/asc; TTL escondido por default; o botão "TTL" puxa em batch (`TTL` por key, chunks de 100). Multi-seleção permite `EXPIRE / PERSIST / UNLINK` em batch.

### Render por TYPE

Driver `executeCommand` passa direto a `ioredis.call(op, ...args)`; a UI envia comandos Redis nativos. Ao selecionar:

| TYPE | Pequeno (≤ `PAGE_SIZE = 100`) | Grande (paginado) |
|---|---|---|
| `string` | `GET key` | — |
| `hash` | `HGETALL key` | `HSCAN key cursor COUNT 100` |
| `list` | `LRANGE key 0 LIST_PAGE-1` (`LIST_PAGE = 200`) | `LRANGE` paginado, com `LLEN` |
| `set` | `SMEMBERS key` | `SSCAN key cursor COUNT 100` |
| `zset` | `ZRANGE key 0 -1 WITHSCORES` | `ZSCAN key cursor COUNT 100` |
| `stream` | `XRANGE key - + COUNT 50` | — |

Entries de stream `[id, [f1, v1, f2, v2, ...]]` viram `{ id, fields: [[k, v], ...] }`.

#### Views adicionais (mesmo TYPE base)

HyperLogLog / Bitmap usam string; Geo usa zset — `TYPE` não distingue, então a UI tem toggle manual:

- **HLL** (string) → `PFCOUNT key`, erro ≈ 0.81%.
- **Bitmap** (string) → `BITCOUNT key` (total) + range `BITCOUNT key start end` + bit `GETBIT key offset`.
- **Geo** (zset) → `ZRANGE key 0 -1` para membros + `GEOPOS key m1 m2 ...` em uma só chamada. Membros não-geo retornam nil = `null`.

Tipo errado (ex.: string normal como HLL) → `WRONGTYPE` no banner.

### Edição inline

string / hash / list / set / zset suportam — botão "Editar" no topo; UI mantém draft, no salvar gera comandos mínimos:

- string → `SET key value`
- hash → `HDEL key f1 f2 ...` + `HSET key f1 v1 f2 v2 ...`
- list → `LSET key i v` só onde mudou
- set → `SADD key m1 m2 ...` e `SREM key m1 m2 ...`
- zset → `ZREM key m1 m2 ...` e `ZADD key s1 m1 s2 m2 ...`

stream sem edição inline (semântica pesada).

### Novo key (`RedisNewKeyDialog.vue`)

Cinco tipos visuais:

| Tipo | Comando | Input UI |
|---|---|---|
| String | `SET key value` | textarea |
| Hash | `HSET key f1 v1 ...` | linhas field/value |
| List | `RPUSH key v1 v2 ...` | textarea, uma linha por item |
| Set | `SADD key m1 m2 ...` | textarea, dedup auto |
| Sorted Set | `ZADD key s1 m1 s2 m2 ...` | linhas `<score> <member>` |

TTL opcional; > 0 → `EXPIRE key ttl`. Pre-check com `EXISTS key`; já existe → rejeita (sem overwrite). stream fora — `XADD` requer id + field/value, mais fácil no input de comandos.

### Input de comandos

Topo do `RedisPane`, segunda linha, editor de comando geral; tokens separados por whitespace:

```ts
const op = tokens[0].toUpperCase()
const args = tokens.slice(1)
await client.connections.executeCommand(conn.id, {
  op,
  args,
  context: { dbIndex },
})
```

Vai direto ao `executeCommand` → `client.call(op, ...args)`; todos os comandos Redis (incluindo `DEBUG SLEEP`, `OBJECT ENCODING`, `CONFIG REWRITE`). **Atenção**: sem escape de aspas — `SET key "value with space"` vira 4 tokens; valores com espaço use NewKey ou Lua.

### Big keys (`RedisBigKeysDialog.vue`)

SCAN do banco inteiro + `MEMORY USAGE` por key (default SAMPLES 5, O(N)). Blocos de 20 keys em paralelo, serial entre blocos, botão "Parar". Top N desc (default 100), bucketing por prefixo `:` ("user / cache / session"), top 8 em barras horizontais para ver quem consome memória.

> Centenas de milhares de keys → lento e CPU-intensivo, perceptível por outros clientes. Faça em horário tranquilo ou restrinja com MATCH.

### Stream de comandos (`RedisMonitorDialog.vue`)

**Trade-off-chave**: `MONITOR` nativo é blocking e monopoliza a conexão, conflitando com nosso canal request-response. Solução: polling a cada N segundos (default 2000ms):

- `INFO stats` → `total_commands_processed` / `keyspace_hits` / `keyspace_misses` / `instantaneous_ops_per_sec`
- `INFO clients` → `connected_clients`
- `INFO memory` → `used_memory`

60 amostras em tabela rolante; hit ratio auto. Para detalhe de comando use `redis-cli MONITOR` (a UI deixa isso claro).

### Painel de servidor (`RedisServerInfoDialog.vue`)

Sete tabs, cada um mapeia comandos administrativos:

| Tab | Comandos | Conteúdo |
|---|---|---|
| INFO | `INFO` | Por `# Section`, memória em unidades legíveis |
| Slow log | `SLOWLOG GET 128` + `CONFIG GET/SET slowlog-log-slower-than` + `SLOWLOG RESET` | id / ts / μs / cmd / client |
| Clientes | `CLIENT LIST` + `CLIENT ID` + `CLIENT KILL ID <id>` | self com verde anti-kill |
| Stats de comandos | `INFO commandstats` | Ordem `usec_per_call` desc |
| CONFIG | `CONFIG GET *` + `CONFIG SET k v` | Edição inline, filtro |
| Cluster | `CLUSTER INFO` + `CLUSTER NODES` | Slot bar (0-16383), hash por master; modo não cluster mostra motivo |
| Sentinel | `SENTINEL MASTERS` | Não-sentinel mostra motivo |

Auto-refresh 5s opcional por tab.

### Lua / Functions (`RedisScriptDialog.vue`)

Dois tabs.

**Lua**:

- Editor + KEYS / ARGV (space-separated).
- `▶ EVAL` → `EVAL <script> <numKeys> KEYS... ARGV...`
- `SCRIPT LOAD` retorna sha, cache na UI; `EVALSHA <sha>`; `SCRIPT FLUSH`.
- Save local em `localStorage['skylerx.redis.lua.<connId>']`, cross-session.

**Functions** (Redis 7+):

- `FUNCTION LIST WITHCODE` → `library_name / engine / functions[].name / library_code`.
- Editor com library code → `FUNCTION LOAD [REPLACE] <code>`.
- `FUNCTION DELETE <lib>`.
- Click no nome puxa `library_code` para o editor.

Editor é textarea (não Monaco) — escolha deliberadamente leve; editor pesado é mais fácil no terminal.

### Global SCAN (`RedisSearchDialog.vue`)

Cross 16 dbs:

- Pattern + 16 checkboxes (default all), "Marcar / desmarcar tudo".
- Itera selecionados, `SCAN cursor MATCH ... COUNT 500`; hits + `TYPE / TTL` em paralelo.
- Hit > `SCAN_PER_DB_LIMIT = 5000` por db → corta com toast.
- Click em linha → `pick(db, key)`; Workspace alterna para `RedisPane` correto via `pendingKey`.

### Import / export (`RedisImportExportDialog.vue`)

JSON custom (sem RDB), para cross-instâncias:

```json
[
  { "db": 0, "key": "...", "type": "string", "ttl": 3600, "value": "..." },
  { "db": 0, "key": "...", "type": "hash", "ttl": -1, "value": { "f": "v" } },
  { "db": 0, "key": "...", "type": "zset", "ttl": 0, "value": [{ "member": "a", "score": "1" }] },
  { "db": 0, "key": "...", "type": "stream", "ttl": -1, "value": [{ "id": "1-0", "fields": [["f","v"]] }] }
]
```

**Export**: `SCAN MATCH` no db atual, por key `TYPE / TTL / dado` serial (evita rajada de IPC); finaliza com `client.files.saveText`.

**Import**: parse JSON → restaura comando por `type`: string → `SET`, hash → `HSET`, list → `RPUSH`, set → `SADD`, zset → `ZADD`, stream → `XADD` por entry. Conflito `skip` (default) / `overwrite` (`DEL` antes). `ttl > 0` → `EXPIRE`.

Limitação conhecida: **stream sem consumer group**; `XINFO` / `XGROUP` à parte.

---

## Elasticsearch

### Árvore

```
Connection
└── Index (flat, sem Database)
    └── Field (de getMapping properties)
```

- `listIndices` via `client.cat.indices({ format: 'json' })`, filtra `.` (sistemas; desligável com `extra.showSystemIndices = true`).
- `listFields` via `client.indices.getMapping({ index })`, `mappings.properties`, `detail.dataType = prop.type` (default `object`).

### Painel de query (`ElasticPane.vue`)

- Topo: breadcrumb (index) + Refresh + badge `docs.count` (chamada `count` independente).
- Meio: textarea para Query DSL + `op`: `search` / `count` / `getMapping`.
- Rodapé: Executar + toggle tabela / JSON.

Execução:

```ts
await client.connections.executeCommand(conn.id, {
  op,                                  // 'search' | 'count' | 'getMapping'
  args: { index, body },               // body do textarea como JSON
  context: { collection: index },      // ambos preenchidos, driver tem needIndex()
  maxRows: 500,                        // só vale para search
})
```

`getMapping` sem body; `count` passa body como `{ query: ... }`.

### Tabela vs JSON

- `search`: colunas = `_id` + união de campos `hits.hits[*]._source`; valor por `cellOf(hit, col)` (`_id` → `hit._id`, demais → `hit._source[col]`).
- Topo `total: N · took: M ms` do `data.hits.total` (`{ value: N }` ou number antigo) + `executionTimeMs`.
- `count` / `getMapping` sem "linhas" → cai direto em JSON.
- Toggle para raw JSON em qualquer op.

### Truncated em `search`

```ts
case 'search': {
  const params = { index, ...body }
  let probeTruncated = false
  if (typeof maxRows === 'number' && body.size == null) {
    params.size = maxRows + 1            // probe extra
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

- **`size` no DSL pelo usuário é respeitado**.
- Sem `size` → `maxRows + 1` para probe; hit > maxRows → corta e `truncated: true`.
- Retorna estrutura ES original `{ hits: { hits, total } }`, apenas `hits.hits` truncado.

### Ops suportados

`elasticsearch.ts`:

| Categoria | op | args | Método |
|---|---|---|---|
| Doc read | `search` | `index?`, `body?` | `client.search({ index, ...body })` |
| Doc read | `get` | `index?`, `id` | `client.get({ index, id })` |
| Doc read | `count` | `index?`, `query?` | `client.count({ index, query })` |
| Doc write | `index` | `index?`, `document`, `id?` | `client.index({ index, document, id? })`, `affected = 1` |
| Doc write | `update` | `index?`, `id`, `doc?`, `body?` | `client.update({ index, id, doc, ...body })`, `affected = 1` |
| Doc write | `delete` | `index?`, `id` | `client.delete({ index, id })`, `affected = 1` |
| Doc write | `bulk` | `operations[]` | `client.bulk({ operations })`, `affected = items.length` |
| Index | `indices.create` / `indices.delete` / `indices.getMapping` / `indices.refresh` | passa `args` para `client.indices.<sub>` | |
| cat | `cat.indices` / `cat.health` / `cat.nodes` | passa + default `format: 'json'` | |
| Fallback | `raw` | `method`, `path`, `body?`, `querystring?` | `client.transport.request(...)`, REST direto |

`needIndex()` extrai de `context.collection` ou `args.index`; ausente → `MISSING_INDEX`.

`unwrap(res)` compatível com ES 8 (body direto) e v7 (`{ body, statusCode, headers, warnings, meta }`); UI não precisa se preocupar.

---

## Contrato do canal paralelo (resumo)

Os 3 drivers diferem muito, mas o contrato para o front é estável:

```ts
interface CommandRequest {
  op: string                   // dicionário do driver
  args?: unknown               // Mongo/ES = obj; Redis = array posicional
  context?: {                  // alvo
    database?: string          // Mongo
    collection?: string        // Mongo / ES (= index)
    dbIndex?: number           // Redis
  }
  maxRows?: number             // driver implementa truncado com limit+1
}

interface CommandResult {
  data: unknown
  executionTimeMs: number
  affected?: number            // rows afetadas em writes
  truncated?: boolean          // flag de truncamento
}
```

Independente de SQL: `QueryResult` só para SQL. Drivers NoSQL `execute()` lançam `SQL_CHANNEL_UNSUPPORTED`; com dialect = mongo/redis/elasticsearch, o front nem chama.

---

## Limitações / trade-offs

| Item | Descrição |
|---|---|
| Mongo 24-hex false-positive | Strings 24-hex que não são ObjectIds podem ser convertidas. Preço para corrigir "updateOne nunca hit". |
| Mongo ObjectId em campo não-`_id` | Driver só converte `_id` automaticamente; `userId / refId` precisam de `{ $oid: 'hex' }` ou EJSON manual via `runCommand`. |
| Redis MONITOR | Blocking; polling de `INFO stats` é o substituto. Detalhe por comando: `redis-cli MONITOR`. |
| Redis parser sem aspas | `RedisPane` tokeniza por whitespace, sem escape. Valores com espaço use NewKey ou Lua. |
| Redis SCAN amostral | Cada grupo de tipo mostra max 200 keys, budget 10k. Maior: use global SCAN (`RedisSearchDialog`). |
| Redis tipos sem count | DBSIZE > 100 000 → sem count para evitar SCAN lento na árvore. |
| Redis big keys MEMORY USAGE | O(N), lento e CPU-pesado. Restrinja com MATCH ou rode fora de pico. |
| Redis import/export stream | Sem consumer group; `XINFO / XGROUP` à parte. |
| Redis new key sem stream | `XADD` semântica pesada; use input de comandos / Lua. |
| ES SQL | `_xpack/sql` não ANSI; sem canal SQL no momento; abra `op: 'sql'` se precisar. |
| ES `size` explícito | DSL com `size` é respeitado, sem `+1` probe; sem flag `truncated`. |
| ES truncated só em search | `count` / `get` / `getMapping` não têm coleção. |
| Deps NoSQL | `mongodb` / `ioredis` / `@elastic/elasticsearch` são **peerDeps opcionais**, import lazy. Desktop já vem; backend self-hosted precisa `pnpm add`, senão `connect/test` lança "driver não instalado". |
