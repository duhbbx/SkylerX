# Guía avanzada NoSQL — MongoDB / Redis / Elasticsearch

SkylerX trata NoSQL como ciudadano de primera clase: comparte el mismo árbol de metadatos, la misma gestión de conexiones y el mismo asistente de IA que las bases SQL, pero por debajo va por un **canal paralelo (executeCommand)** — ver [ARCHITECTURE](https://github.com/duhbbx/SkylerX/blob/main/ARCHITECTURE.md). Este documento detalla, por base, las capacidades de UI y los ops y argumentos **realmente expuestos** por el driver.

## Resumen — relación entre el canal paralelo y el canal SQL

`DataClient` expone dos entradas independientes:

| Canal | Entrada | Aplica a |
|---|---|---|
| SQL | `connections.execute(sql)` | MySQL / PostgreSQL / Oracle / ... |
| Comandos | `connections.executeCommand({ op, args, context, maxRows? })` | MongoDB / Redis / Elasticsearch |

El `execute()` de los drivers NoSQL lanza directamente `SQL_CHANNEL_UNSUPPORTED`:

```ts
// packages/core-driver/src/dialects/mongo.ts
async execute(): Promise<QueryResult> {
  throw new Error('SQL_CHANNEL_UNSUPPORTED: MongoDB 不支持 SQL,请使用 executeCommand')
}
```

`executeCommand` es la verdadera vía de trabajo, **cada driver define su propio diccionario de ops**. El resto del documento detalla ese diccionario.

Convenciones generales:

- `context` lleva el **objetivo** (MongoDB: `database` / `collection`; Redis: `dbIndex`; ES: `collection` = índice).
- `args` es el objeto/array de parámetros propio de cada op (Mongo / ES usan objeto, Redis array posicional).
- `maxRows` solo tiene sentido en lecturas que devuelven colecciones; el driver pide `limit/size + 1` para detectar `truncated`.
- El valor devuelto es `CommandResult`: `{ data, executionTimeMs, affected?, truncated? }`.

---

## MongoDB

### Estructura en árbol

```
Connection
└── Database (多个)
    └── Group "集合" (count)
        └── Collection (kind = Table, 沿用 SQL 表节点)
```

Implementación en el driver:

- `listDatabases` llama a `admin().listDatabases()`.
- `databaseGroups` usa `listCollections({}, { nameOnly: true })` para llenar el `count`.
- `listCollections` ordena y produce nodos `kind: Table`; el frontend, al detectar `connection.dialect === 'mongodb'`, usa `MongoPane` para renderizar.

### Navegador de colecciones (`MongoPane.vue`)

Al abrir un nodo de Collection se carga este componente; arriba hay tres bloques:

1. **Breadcrumb** `database · collection`, junto a refresco / aplicar cambios / deshacer cambios.
2. **Textarea JSON Filter + limit / skip + toggle Tabla / JSON**.
3. **Área de resultados** — la vista tabla usa la unión de los campos de primer nivel de las filas como columnas, o renderiza directamente el JSON de `rows.value`.

El botón Ejecutar invoca a `find`:

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

Las cabeceras se calculan dinámicamente con la unión de claves de primer nivel de `rows`, así que las colecciones sin schema también se ven. Si `_id` es un string 24-hex, se renderiza como `ObjectId("...")` para recordar que por debajo es un BSON ObjectId (IPC ya lo serializa a string).

### Cuadrícula editable → updateOne (dot-path)

Doble clic en una celda que no sea `_id` entra en edición inline (`_id` queda bloqueada). Introduce **JSON válido** y Enter confirma. Las celdas dirty se resaltan; "Aplicar cambios (N)" arriba llama a `updateOne` por cada celda.

Algoritmo del diff en `diffToOps()`:

- Si ninguno es plain object → `$set` completo sobre el campo (los arrays no se descomponen para evitar errores de índice).
- Si ambos son plain object → unión de claves, recursión; solo en nuevo → `$set`; solo en viejo → `$unset`; equivalentes JSON → omitir.
- Las rutas se aplanan a dot-path, p. ej. `addr.city = '...'`.

La petición final se ve así:

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

### Envoltura automática de ObjectId (`$oid` marker ↔ driver)

ObjectId pierde su tipo al cruzar el IPC (se vuelve string); por eso se acuerda un **marker bidireccional**:

- Cuando la UI escribe: `wrapOidStrings()` envuelve recursivamente las cadenas 24-hex como `{ $oid: 'hex' }`.
- Cuando lo recibe el driver: `normalizeIds()` envuelve directamente como `new ObjectId(hex)` los campos `_id` con 24-hex.

A nivel de driver hay una **estrategia conservadora**: solo se convierten automáticamente los campos cuyo nombre es exactamente `_id`, sin tocar otros. La razón está en los comentarios de `mongo.ts`: evitar romper strings que casualmente parezcan ObjectId (por ejemplo, ciertos hash IDs). Esto implica que para consultar por referencias `userId / refId` (ObjectId), uses tú `{ $oid: '...' }` o EJSON completo.

Los objetos de operador en `_id` se tratan recursivamente; las siguientes formas funcionan:

```jsonc
{ "_id": "65f1aa..."                                      } // → ObjectId
{ "_id": { "$in": ["65f1aa...", "65f2bb..."]              }} // miembros de array
{ "_id": { "$eq": "65f1aa...", "$exists": true            }} // operadores
{ "$or": [{ "_id": "65f1aa..." }, { "name": "x" }]         } // anidado
```

### Pipeline de agregación (`MongoAggregationDialog.vue`)

A la izquierda, tarjetas de stages (reordenables y borrables); a la derecha, resultados. Cada stage es su propia textarea JSON. `STAGE_TEMPLATES` inserta diez stages comunes con un clic:

`$match` · `$project` · `$group` · `$sort` · `$limit` · `$skip` · `$unwind` · `$lookup` · `$addFields` · `$count`

Al ejecutar, ensambla el pipeline `{ [stage.op]: JSON.parse(stage.json) }` y llama:

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

Si el JSON de algún stage no parsea, falla el pipeline entero y se muestra el error. Por defecto, se ven los primeros `limit` documentos completos (caja mini en la UI, 1-1000). En `details` hay "ver pipeline JSON" para copiar a mongosh y reproducir.

### Información de colección (`MongoCollectionInfoDialog.vue`)

Dos pestañas:

**Estadísticas** (`collStats`): `count` / `size` / `avgObjSize` / `storageSize` / `nindexes` / `totalIndexSize`; los tamaños se muestran en unidades legibles.

**Índices** — `listIndexes` + tabla (name / keys / unique / sparse / ttl / size) + formulario para crear índice. Al crear:

- Se añaden varias filas de campos; dirección `1 / -1 / text / 2dsphere`.
- Opcionales `name / unique / sparse / expireAfterSeconds`.
- Lanza el op `createIndex`, con args como `{ key: { field1: 1, field2: -1 }, unique?, sparse?, expireAfterSeconds? }`.

Eliminar índice usa `dropIndex`; la UI bloquea borrar el índice por defecto `_id_`.

### Ops soportados por el driver (lista completa)

Del switch real en `mongo.ts`:

| Categoría | op | args necesarios | Notas |
|---|---|---|---|
| Lectura | `find` | `filter`, `options?` | `toArray` sobre cursor; con `maxRows` → `limit+1` para detectar truncated |
| Lectura | `findOne` | `filter`, `options?` | Un solo documento |
| Lectura | `aggregate` | `pipeline`, `options?` | Pipeline; `maxRows` igual que arriba |
| Lectura | `countDocuments` | `filter`, `options?` | |
| Lectura | `distinct` | `field`, `filter?`, `options?` | |
| Escritura | `insertOne` | `document`, `options?` | `affected = acknowledged ? 1 : 0` |
| Escritura | `insertMany` | `documents`, `options?` | `affected = insertedCount` |
| Escritura | `updateOne` / `updateMany` | `filter`, `update`, `options?` | `affected = modifiedCount` |
| Escritura | `replaceOne` | `filter`, `document`, `options?` | |
| Escritura | `deleteOne` / `deleteMany` | `filter`, `options?` | `affected = deletedCount` |
| Base | `runCommand` | todo el `args` pasa directo a `db.command()` | Entrada de escape |
| Base | `listCollections` | `filter?`, `options?` | |
| Base | `createCollection` | `name`, `options?` | |
| Base | `dropCollection` | `name` | |
| Índices | `collStats` / `listIndexes` / `createIndex` / `dropIndex` | Ver `MongoCollectionInfoDialog` | Pasa por `runCommand` |

> Cualquier op fuera de esta tabla devuelve `UNKNOWN_OP`. Las novedades se añaden al switch de `mongo.ts`; no rodear con APIs del cliente.

---

## Redis

### Estructura en árbol

```
Connection
└── Database  db0..db15 (16 个固定逻辑库, count 来自 INFO keyspace)
    └── Group "Strings / Hashes / Lists / Sets / Sorted Sets / Streams"
        └── Key (SCAN 抽样, 上限 200)
```

`listDatabases` usa un solo `INFO keyspace` para obtener `keys=N` de las 16 bases; las vacías no muestran count para evitar ruido.

`listTypeGroups` revisa `DBSIZE`: si `<= 100 000`, hace SCAN + pipeline TYPE para contar exactamente cada grupo; en bases enormes, omite los conteos y solo cuelga los nodos de grupo.

`sampleKeysByType`, al seleccionar un grupo, hace SCAN + pipeline TYPE filtrado; muestrea hasta `SCAN_SAMPLE_LIMIT = 200`; presupuesto de escaneo aprox. `ROUND_CAP × COUNT = 50 × 200 = 10.000` keys. Si no llega, añade una fila `... (más; usa el comando SCAN)` que sugiere `RedisSearchDialog`.

### Navegador de keys (`RedisPane.vue`)

Izquierda con la lista del SCAN + caja MATCH; derecha renderiza la vista según el TYPE de la key seleccionada. "Cargar más" continúa el cursor del SCAN hasta `cursor='0'`.

Flujo:

1. `SCAN <cursor> MATCH <match> COUNT 500` → `[nextCursor, batch]`.
2. Sobre las nuevas keys, en chunks (`TYPE_PIPELINE_CHUNK = 200`), pipeline `TYPE`.
3. Anexa a `keys.value` y avanza el cursor.

Soporta ordenación por nombre / tipo / ttl, asc/desc; la columna TTL viene desactivada por defecto, al pulsar "TTL" se pide en lote (`TTL` por key, chunks de 100 en paralelo). Selección múltiple permite `EXPIRE / PERSIST / UNLINK` masivos.

### Renderizado por tipo

`executeCommand` del driver pasa al `ioredis.call(op, ...args)`, así que la UI envía comandos Redis nativos. Al seleccionar una key, `RedisPane` lanza automáticamente:

| TYPE | Colección pequeña (≤ `PAGE_SIZE = 100`) | Colección grande (paginada) |
|---|---|---|
| `string` | `GET key` | — |
| `hash` | `HGETALL key` | `HSCAN key cursor COUNT 100` |
| `list` | `LRANGE key 0 LIST_PAGE-1` (`LIST_PAGE = 200`) | Paginación con `LRANGE`, comparada contra `LLEN` |
| `set` | `SMEMBERS key` | `SSCAN key cursor COUNT 100` |
| `zset` | `ZRANGE key 0 -1 WITHSCORES` | `ZSCAN key cursor COUNT 100` |
| `stream` | `XRANGE key - + COUNT 50` | — |

Las entradas de stream tienen forma `[id, [f1, v1, f2, v2, ...]]`; la UI las parsea como `{ id, fields: [[k, v], ...] }`.

#### Vistas extra (interpretaciones distintas sobre el mismo TYPE)

Redis pone HyperLogLog y Bitmap encima de string, y Geo sobre zset; `TYPE` no los distingue, así que la UI ofrece toggle manual:

- **HLL** (string) → `PFCOUNT key`, error ≈ 0.81%.
- **Bitmap** (string) → `BITCOUNT key` (total) + `BITCOUNT key start end` + `GETBIT key offset`.
- **Geo** (zset) → primero `ZRANGE key 0 -1` para los miembros; luego `GEOPOS key m1 m2 ...` para todas las posiciones. `GEOPOS` devuelve nil para miembros inexistentes o no geo; la UI muestra `null`.

Si la interpretación es incorrecta (por ejemplo, tratar un string normal como HLL), Redis devuelve `WRONGTYPE`; el banner de error lo muestra directamente.

### Edición en línea

string / hash / list / set / zset soportan modo edición (botón "Editar" arriba); la UI mantiene un draft y al guardar genera el conjunto mínimo de comandos por tipo:

- string → `SET key value`
- hash → `HDEL key f1 f2 ...` + `HSET key f1 v1 f2 v2 ...`
- list → solo en los índices modificados: `LSET key i v`
- set → `SADD key m1 m2 ...` y `SREM key m1 m2 ...`
- zset → `ZREM key m1 m2 ...` y `ZADD key s1 m1 s2 m2 ...`

stream no admite edición inline (semántica demasiado pesada).

### Crear key (`RedisNewKeyDialog.vue`)

Creación visual de cinco tipos:

| Tipo | Comando | Entrada en UI |
|---|---|---|
| String | `SET key value` | textarea |
| Hash | `HSET key f1 v1 ...` | filas field/value (añadir/quitar) |
| List | `RPUSH key v1 v2 ...` | textarea de varias líneas, una por elemento |
| Set | `SADD key m1 m2 ...` | textarea de varias líneas; auto-deduplicado |
| Sorted Set | `ZADD key s1 m1 s2 m2 ...` | varias líneas `<score> <member>` |

TTL opcional, si > 0 añade `EXPIRE key ttl`. Antes de enviar, `EXISTS key` precheckea y rechaza si ya existe (no sobreescribe). stream no se soporta — `XADD` necesita id + field/value y va más cómodo en la caja de comandos del `RedisPane`.

### Caja de comandos

La segunda fila arriba del `RedisPane` es un editor genérico de comandos; tras hacer split por espacios:

```ts
const op = tokens[0].toUpperCase()
const args = tokens.slice(1)
await client.connections.executeCommand(conn.id, {
  op,
  args,
  context: { dbIndex },
})
```

Va directo al `executeCommand` del driver → `client.call(op, ...args)`; así corren todos los comandos de Redis (incluidos `DEBUG SLEEP`, `OBJECT ENCODING`, `CONFIG REWRITE`, etc.). **Atención**: la tokenización no maneja comillas/escapes, así que `SET key "value with space"` se trocea en cuatro tokens; para valores con espacios usa el diálogo `NewKey` o un script Lua.

### Escaneo de big keys (`RedisBigKeysDialog.vue`)

SCAN completo + `MEMORY USAGE` por key (por defecto SAMPLES 5, muestreo O(N)). Concurrencia de 20 por chunk, secuencial entre chunks; botón "Detener" para abortar. Los resultados se muestran en orden descendente por bytes (top N, por defecto 100) y se agrupan por prefijo `:` (segmentación tipo "user / cache / session"); los 8 primeros se pintan como gráfica de barras horizontal para ver de un vistazo qué prefijo consume más memoria.

> En bases de cientos de miles de keys es lento y consume CPU; el resto de clientes lo notará. Recomendado en valle de tráfico o con MATCH para acotar.

### Monitor en vivo (`RedisMonitorDialog.vue`)

**Compromiso clave**: el `MONITOR` nativo es bloqueante y monopoliza la conexión, choca con nuestro canal petición-respuesta. Por eso este panel hace polling cada N segundos (por defecto 2000ms):

- `INFO stats` → `total_commands_processed` / `keyspace_hits` / `keyspace_misses` / `instantaneous_ops_per_sec`
- `INFO clients` → `connected_clients`
- `INFO memory` → `used_memory`

Los últimos 60 puntos se muestran como tabla con scroll inverso, calculando el hit ratio automáticamente. Para ver el detalle por comando, usa `redis-cli MONITOR` en terminal; el panel lo indica.

### Panel del servidor (`RedisServerInfoDialog.vue`)

Siete pestañas, cada una asociada a un comando o grupo:

| Pestaña | Comandos | Contenido |
|---|---|---|
| INFO | `INFO` | Secciona por `# Section`; los campos de memoria se convierten a unidades legibles |
| Slow log | `SLOWLOG GET 128` + `CONFIG GET/SET slowlog-log-slower-than` + `SLOWLOG RESET` | id / ts / duración μs / comando / cliente |
| Clientes | `CLIENT LIST` + `CLIENT ID` + `CLIENT KILL ID <id>` | La fila "self" se marca en verde para evitar matarse a uno mismo |
| Stats de comandos | `INFO commandstats` | Orden descendente por `usec_per_call` |
| CONFIG | `CONFIG GET *` + `CONFIG SET k v` | Edición inline por fila, con filtro |
| Cluster | `CLUSTER INFO` + `CLUSTER NODES` | Barra de slots (0-16383) coloreada por hash del master id; en modos no cluster, error explícito |
| Sentinel | `SENTINEL MASTERS` | Igual: nodos no sentinel dan error explícito |

El check "Auto-refresh 5s" arriba refresca la pestaña actual de forma periódica; al cerrar el modal se limpia el timer.

### Lua / Functions (`RedisScriptDialog.vue`)

Dos pestañas.

**Lua**:

- Editor + KEYS / ARGV (separados por espacios).
- `▶ EVAL` → `EVAL <script> <numKeys> KEYS... ARGV...`
- `SCRIPT LOAD` devuelve sha, se cachea en estado de UI; `EVALSHA <sha>` reproduce; `SCRIPT FLUSH` limpia el servidor.
- Guardado local: `localStorage['skylerx.redis.lua.<connId>']`, persiste entre sesiones.

**Functions** (Redis 7+):

- `FUNCTION LIST WITHCODE` → parsea `library_name / engine / functions[].name / library_code` por library.
- Pega el library code en el editor → `FUNCTION LOAD [REPLACE] <code>`.
- `FUNCTION DELETE <lib>` borra.
- Pulsa el nombre de la library para cargar `library_code` en el editor.

El editor es un textarea (no Monaco) por elección de ligereza; para algo más complejo, edita en terminal y pega.

### Búsqueda SCAN global (`RedisSearchDialog.vue`)

MATCH a través de las 16 bases:

- Patrón arriba + 16 checkboxes de db (todos marcados por defecto), "Seleccionar todos / ninguno".
- Recorre secuencialmente las dbs marcadas; `SCAN cursor MATCH ... COUNT 500`; sobre los hits hace `TYPE / TTL` en paralelo.
- Si una db acumula `> SCAN_PER_DB_LIMIT = 5000` hits, trunca y muestra toast.
- Click en una fila → `emit pick(db, key)`; Workspace cambia al `RedisPane` correspondiente y posiciona vía `pendingKey`.

### Importar / Exportar (`RedisImportExportDialog.vue`)

Se usa un JSON propio (no RDB) para migración entre bases / instancias:

```json
[
  { "db": 0, "key": "...", "type": "string", "ttl": 3600, "value": "..." },
  { "db": 0, "key": "...", "type": "hash", "ttl": -1, "value": { "f": "v" } },
  { "db": 0, "key": "...", "type": "zset", "ttl": 0, "value": [{ "member": "a", "score": "1" }] },
  { "db": 0, "key": "...", "type": "stream", "ttl": -1, "value": [{ "id": "1-0", "fields": [["f","v"]] }] }
]
```

**Export**: `SCAN MATCH` sobre la db actual; por cada key extrae `TYPE / TTL / datos`; dump secuencial para no inundar IPC; finaliza con `client.files.saveText` y abre el diálogo nativo.

**Import**: abre el JSON → reconstruye según `type`: string → `SET`, hash → `HSET`, list → `RPUSH`, set → `SADD`, zset → `ZADD`, stream → `XADD` entry a entry. Estrategia de conflicto `skip` (por defecto) / `overwrite` (primero `DEL`). Si `ttl > 0` se añade `EXPIRE`.

Limitación: **stream no incluye consumer groups**; `XINFO` / `XGROUP` deben tratarse aparte.

---

## Elasticsearch

### Estructura en árbol

```
Connection
└── Index (扁平, 没有 Database 这一层)
    └── Field (来自 getMapping 的 properties)
```

Implementación:

- `listIndices` → `client.cat.indices({ format: 'json' })`, filtrando los índices del sistema que empiezan por `.` (desactivable con `extra.showSystemIndices = true` en la conexión).
- `listFields` → `client.indices.getMapping({ index })`; toma `mappings.properties`; `detail.dataType = prop.type` (por defecto `object`).

### Panel de consulta (`ElasticPane.vue`)

- Breadcrumb arriba (index) + botón "Refrescar" + badge `docs.count` (lo carga una llamada `count` independiente).
- En el centro, textarea para Query DSL; al lado, selector de `op`: `search` / `count` / `getMapping`.
- Abajo "Ejecutar"; a la derecha, toggle "Tabla / JSON crudo".

Ejecución:

```ts
await client.connections.executeCommand(conn.id, {
  op,                                  // 'search' | 'count' | 'getMapping'
  args: { index, body },               // body 是 textarea 解析出的 JSON
  context: { collection: index },      // 两路都填,驱动 needIndex() 兜底
  maxRows: 500,                        // 仅对 search 真正生效
})
```

`getMapping` no necesita body; `count` envía el body como `{ query: ... }`.

### Vista tabla vs JSON crudo

- Resultados de `search`: columnas = `_id` + unión de campos de `hits.hits[*]._source`; los valores se toman con `cellOf(hit, col)` (`_id` de `hit._id`, el resto de `hit._source[col]`).
- `total: N · took: M ms` arriba vienen de `data.hits.total` (`{ value: N }` o número antiguo) + `executionTimeMs`.
- `count` / `getMapping` no tienen concepto de "filas"; la vista tabla cae directamente a JSON crudo.
- En cualquier op, el toggle superior vuelve al JSON crudo.

### Comportamiento de `maxRows` en `search` (detección de truncated)

El código merece atención:

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

Puntos clave:

- **Si el usuario pone `size` en el DSL, no se toca** (se respeta su intención).
- Si no hay `size`, se sondea con `maxRows + 1`; si supera maxRows, se recorta y se devuelve `truncated: true`.
- Se conserva la estructura ES original `{ hits: { hits, total } }`; solo `hits.hits` queda recortado.

### Ops soportados por el driver (lista completa)

Del switch real en `elasticsearch.ts`:

| Categoría | op | args necesarios | Método del cliente |
|---|---|---|---|
| Lectura doc | `search` | `index?`, `body?` | `client.search({ index, ...body })` |
| Lectura doc | `get` | `index?`, `id` | `client.get({ index, id })` |
| Lectura doc | `count` | `index?`, `query?` | `client.count({ index, query })` |
| Escritura doc | `index` | `index?`, `document`, `id?` | `client.index({ index, document, id? })`, `affected = 1` |
| Escritura doc | `update` | `index?`, `id`, `doc?`, `body?` | `client.update({ index, id, doc, ...body })`, `affected = 1` |
| Escritura doc | `delete` | `index?`, `id` | `client.delete({ index, id })`, `affected = 1` |
| Escritura doc | `bulk` | `operations[]` | `client.bulk({ operations })`, `affected = items.length` |
| Índices | `indices.create` / `indices.delete` / `indices.getMapping` / `indices.refresh` | Pasa `args` a `client.indices.<sub>` | |
| cat | `cat.indices` / `cat.health` / `cat.nodes` | Pasa con `format: 'json'` por defecto | |
| Escape | `raw` | `method`, `path`, `body?`, `querystring?` | `client.transport.request(...)`, REST arbitrario |

`needIndex()` obtiene el índice objetivo desde `context.collection` o `args.index`; si no hay ninguno, lanza `MISSING_INDEX`.

`unwrap(res)` compatibiliza ES 8 (devuelve body directamente) y v7 (estructura `{ body, statusCode, headers, warnings, meta }`); la UI no debe preocuparse de la versión.

---

## Contrato del canal paralelo (resumen)

A estas alturas se nota que los tres drivers son muy distintos, pero su contrato hacia el frontend es siempre el mismo:

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

Este formato es independiente del canal SQL: `QueryResult` se reserva para SQL. Los drivers NoSQL siempre lanzan `SQL_CHANNEL_UNSUPPORTED` en `execute()`; cuando `dialect = mongo/redis/elasticsearch`, el frontend no lo llama.

---

## Limitaciones conocidas / Compromisos

| Punto | Descripción |
|---|---|
| Mongo falso positivo de 24-hex | Algún string raro de 24 hexadecimales se trata como ObjectId. Es el precio de evitar "updateOne con 0 aciertos". |
| Referencias ObjectId en campos que no son `_id` | El driver solo auto-convierte los `_id`; para `userId / refId`, usa el marker `{ $oid: 'hex' }` o construye EJSON con `runCommand`. |
| Redis MONITOR | El MONITOR nativo bloquea la conexión y choca con el canal petición-respuesta. El panel en vivo recurre a polling de `INFO stats`; para detalle por comando usa `redis-cli MONITOR`. |
| Parser de comandos Redis sin comillas | La caja de comandos hace split por espacios sin comillas/escapes. Para valores con espacios usa `NewKey` o Lua. |
| Muestreo del árbol Redis | Los nodos por tipo muestrean hasta 200 keys con un presupuesto de 10.000 keys. Para más, usa la búsqueda SCAN global (`RedisSearchDialog`). |
| Conteo por tipo en Redis | DBSIZE > 100.000 desactiva los conteos por categoría para no ralentizar el árbol. |
| MEMORY USAGE en big keys | Muestreo O(N), lento y consumidor de CPU en bases grandes; valles de tráfico o MATCH antes. |
| Import/export de streams | Sin consumer group; `XINFO / XGROUP` van aparte. |
| New Key no soporta stream | `XADD` es pesado, mejor usar la caja de comandos o Lua. |
| ES SQL | `_xpack/sql` no es ANSI; aún no se conecta al canal SQL; si hace falta, se abrirá `op: 'sql'`. |
| ES `size` explícito sobreescribe `maxRows` | Si el DSL trae `size`, se respeta del todo y no hay sonda `+1`; en ese caso, no hay señal `truncated`. |
| ES truncated solo en search | `count` / `get` / `getMapping` no tienen concepto de "colección" y no participan en el truncado. |
| Dependencias de los drivers NoSQL | `mongodb` / `ioredis` / `@elastic/elasticsearch` son **peerDeps opcionales** con import perezoso. La build de escritorio los empaqueta junto con `apps/desktop`; un backend custom debe instalarlos con `pnpm add`, o connect/test lanzará "driver no instalado". |
