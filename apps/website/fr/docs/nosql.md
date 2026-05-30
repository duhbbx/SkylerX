# Guide approfondi NoSQL — MongoDB / Redis / Elasticsearch

SkylerX traite NoSQL en citoyen de première classe : même arbre de métadonnées, même gestion de connexions, même assistant IA que les bases SQL, mais avec un **canal parallèle (executeCommand)** au-dessous — voir [ARCHITECTURE](https://github.com/duhbbx/SkylerX/blob/main/ARCHITECTURE.md). Ce chapitre détaille les capacités UI par base, ainsi que les op et paramètres **réellement exposés** par les drivers.

## Vue d'ensemble — Canal parallèle vs canal SQL

`DataClient` expose deux points d'entrée indépendants :

| Canal | Entrée | Pour |
|---|---|---|
| SQL | `connections.execute(sql)` | MySQL / PostgreSQL / Oracle / ... |
| Command | `connections.executeCommand({ op, args, context, maxRows? })` | MongoDB / Redis / Elasticsearch |

`execute()` des drivers NoSQL lève directement `SQL_CHANNEL_UNSUPPORTED` :

```ts
// packages/core-driver/src/dialects/mongo.ts
async execute(): Promise<QueryResult> {
  throw new Error('SQL_CHANNEL_UNSUPPORTED: MongoDB ne supporte pas SQL, utilisez executeCommand')
}
```

`executeCommand` est le vrai point d'entrée, **chaque driver a son propre dictionnaire d'op**. Ce chapitre détaille ces dictionnaires.

Conventions communes :

- `context` porte les **objets cibles** (MongoDB : `database` / `collection`, Redis : `dbIndex`, ES : `collection` = index).
- `args` sont les paramètres de l'op (objet pour Mongo / ES, tableau positionnel pour Redis).
- `maxRows` n'a de sens que sur les lectures qui retournent une collection ; le driver tire `limit/size + 1` pour détecter `truncated`.
- Retour : `CommandResult` : `{ data, executionTimeMs, affected?, truncated? }`.

---

## MongoDB

### Structure arborescente

```
Connection
└── Database (plusieurs)
    └── Group "Collections" (count)
        └── Collection (kind = Table, réutilise le nœud table SQL)
```

Implémentation :

- `listDatabases` appelle `admin().listDatabases()`.
- `databaseGroups` utilise `listCollections({}, { nameOnly: true })` pour le nombre de collections (count).
- `listCollections` triés et exposés en nœuds `kind: Table`, le front affiche via `MongoPane` quand `connection.dialect === 'mongodb'`.

### Explorateur de collection (`MongoPane.vue`)

Ouvrir un nœud Collection charge ce composant, en haut 3 zones :

1. **Fil d'Ariane** `database · collection`, à côté Refresh / Commit changes / Undo changes.
2. **Textarea JSON Filter + limit / skip + bascule tableau / JSON**.
3. **Zone de résultats** — colonnes = union des champs niveau 1 ; ou JSON direct via `rows.value`.

Le bouton d'exécution appelle `find` :

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

Les en-têtes sont calculées dynamiquement de l'union des champs niveau 1, donc une collection schemaless s'affiche aussi. La colonne `_id` est rendue `ObjectId("...")` quand c'est une chaîne 24-hex, rappelant que l'IPC l'a sérialisé en chaîne (BSON ObjectId à l'origine).

### Grille éditable → updateOne (dot-path)

Double-clic cellule hors `_id` pour édition inline (la colonne `_id` est interdite). L'éditeur attend du **JSON valide**, Enter valide. Cellules dirty surlignées, "Commit changes (N)" appelle `updateOne` par modification.

Algorithme diff dans `diffToOps()` :

- Les deux côtés non plain object → `$set` du champ entier (les tableaux ne sont pas dépliés pour éviter les décalages d'index).
- Les deux côtés plain object → union des clés, récursion ; ajout = `$set`, suppression = `$unset`, JSON identique = skip.
- Chemins compressés en dot-path, ex. `addr.city = '...'`.

Requête finale :

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

### Wrapping ObjectId auto (marker `$oid` ↔ driver)

ObjectId perd son type à la frontière IPC (devient chaîne). Convention de **marker bidirectionnel** :

- Côté UI réécriture : `wrapOidStrings()` wrappe récursivement les chaînes 24-hex en `{ $oid: 'hex' }`.
- Côté driver : `normalizeIds()` wrappe les chaînes 24-hex sous `_id` directement en `new ObjectId(hex)`.

Le driver est **conservateur** : seulement les champs nommés `_id`, pas les autres clés. Raison dans le commentaire `mongo.ts` — éviter de casser des chaînes ordinaires ressemblant à ObjectId (certains hash). Si vous interrogez sur `userId / refId` référençant un ObjectId, utilisez vous-même le marker `{ $oid: '...' }` ou écrivez l'EJSON complet.

Les objets opérateur sous `_id` sont aussi traités récursivement, donc tout ceci fonctionne :

```jsonc
{ "_id": "65f1aa..."                                      } // → ObjectId
{ "_id": { "$in": ["65f1aa...", "65f2bb..."]              }} // membres du tableau
{ "_id": { "$eq": "65f1aa...", "$exists": true            }} // objet opérateur
{ "$or": [{ "_id": "65f1aa..." }, { "name": "x" }]         } // requête imbriquée
```

### Pipeline d'agrégation (`MongoAggregationDialog.vue`)

Cartes de stages à gauche (réordonnables, supprimables), résultats à droite. Chaque stage = textarea JSON. `STAGE_TEMPLATES` permet d'insérer 10 stages courants en un clic :

`$match` · `$project` · `$group` · `$sort` · `$limit` · `$skip` · `$unwind` · `$lookup` · `$addFields` · `$count`

À l'exécution, assemblage `{ [stage.op]: JSON.parse(stage.json) }` puis :

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

Échec de parsing JSON d'un stage → erreur sur le pipeline entier. Résultats par défaut affichés en JSON, limit (input 1-1000 dans l'UI). Zone `details` avec "View pipeline JSON", pratique à copier dans mongosh.

### Métadonnées de collection (`MongoCollectionInfoDialog.vue`)

Deux onglets :

**Statistiques** (`collStats`) : `count` / `size` / `avgObjSize` / `storageSize` / `nindexes` / `totalIndexSize`, toutes les tailles en format humain.

**Index** — `listIndexes` + tableau (name / keys / unique / sparse / ttl / size) + formulaire de création. Création :

- Multi-lignes pour les champs, direction `1 / -1 / text / 2dsphere`.
- Optionnels `name / unique / sparse / expireAfterSeconds`.
- Appel `createIndex` op, params `{ key: { field1: 1, field2: -1 }, unique?, sparse?, expireAfterSeconds? }`.

Suppression via `dropIndex`, l'UI empêche de supprimer l'index par défaut `_id_`.

### Op supportées (liste complète)

Switch réel de `mongo.ts` :

| Catégorie | op | args obligatoires | Description |
|---|---|---|---|
| Lecture | `find` | `filter`, `options?` | Curseur toArray ; maxRows → `limit+1` pour truncated |
| Lecture | `findOne` | `filter`, `options?` | Document unique |
| Lecture | `aggregate` | `pipeline`, `options?` | Pipeline, maxRows idem |
| Lecture | `countDocuments` | `filter`, `options?` | |
| Lecture | `distinct` | `field`, `filter?`, `options?` | |
| Écriture | `insertOne` | `document`, `options?` | `affected = acknowledged ? 1 : 0` |
| Écriture | `insertMany` | `documents`, `options?` | `affected = insertedCount` |
| Écriture | `updateOne` / `updateMany` | `filter`, `update`, `options?` | `affected = modifiedCount` |
| Écriture | `replaceOne` | `filter`, `document`, `options?` | |
| Écriture | `deleteOne` / `deleteMany` | `filter`, `options?` | `affected = deletedCount` |
| Base | `runCommand` | tout `args` comme command vers `db.command()` | Entrée bas niveau |
| Base | `listCollections` | `filter?`, `options?` | |
| Base | `createCollection` | `name`, `options?` | |
| Base | `dropCollection` | `name` | |
| Index | `collStats` / `listIndexes` / `createIndex` / `dropIndex` | Voir `MongoCollectionInfoDialog` | Via `runCommand` |

> Op hors tableau = `UNKNOWN_OP`. Pour ajouter, écrivez dans le switch de `mongo.ts`, ne contournez pas via une API client arbitraire.

---

## Redis

### Structure arborescente

```
Connection
└── Database  db0..db15 (16 bases logiques fixes, count via INFO keyspace)
    └── Group "Strings / Hashes / Lists / Sets / Sorted Sets / Streams"
        └── Key (SCAN échantillonnage, limite 200)
```

`listDatabases` : un seul `INFO keyspace` ramène les 16 bases avec `keys=N` ; bases vides sans count pour réduire le bruit.

`listTypeGroups` regarde `DBSIZE` : `<= 100 000` → SCAN complet + pipeline TYPE pour count exact ; bases très grosses → abandon, juste les nœuds de groupe.

`sampleKeysByType` lors de la sélection d'un groupe : SCAN + pipeline TYPE filtré, max `SCAN_SAMPLE_LIMIT = 200`, budget de scan ~ `ROUND_CAP × COUNT = 50 × 200 = 10 000` clés. Si insuffisant, ligne `... (plus, utilisez SCAN)` indique le `RedisSearchDialog`.

### Explorateur de clés (`RedisPane.vue`)

Liste SCAN à gauche + recherche MATCH, à droite la vue correspondant au TYPE de la clé sélectionnée. Bouton bas "Charger plus" continue le curseur jusqu'à cursor='0'.

Flux de chargement :

1. `SCAN <cursor> MATCH <match> COUNT 500` — retourne `[nextCursor, batch]`.
2. Les nouvelles clés sont traitées en chunks (`TYPE_PIPELINE_CHUNK = 200`) pour TYPE en parallèle.
3. Append à `keys.value`, avance le cursor.

Tri par name / type / ttl, asc/desc ; colonne ttl désactivée par défaut, bouton "TTL" pour batch (un `TTL` par clé, chunks de 100 parallèles). Multi-sélection : batch `EXPIRE / PERSIST / UNLINK`.

### Rendu des valeurs par type

Le driver `executeCommand` passe directement à `ioredis.call(op, ...args)`, donc l'UI envoie des commandes Redis natives. Voici ce que `RedisPane` exécute selon la clé sélectionnée :

| TYPE | Petits ensembles (≤ `PAGE_SIZE = 100`) | Grands ensembles (paginés) |
|---|---|---|
| `string` | `GET key` | — |
| `hash` | `HGETALL key` | `HSCAN key cursor COUNT 100` |
| `list` | `LRANGE key 0 LIST_PAGE-1` (`LIST_PAGE = 200`) | `LRANGE` paginé, borné par `LLEN` |
| `set` | `SMEMBERS key` | `SSCAN key cursor COUNT 100` |
| `zset` | `ZRANGE key 0 -1 WITHSCORES` | `ZSCAN key cursor COUNT 100` |
| `stream` | `XRANGE key - + COUNT 50` | — |

Structure d'entrée stream : `[id, [f1, v1, f2, v2, ...]]`, l'UI parse en `{ id, fields: [[k, v], ...] }`.

#### Vues supplémentaires (multiples interprétations d'un TYPE)

Redis met HyperLogLog / Bitmap sur string, Geo sur zset — `TYPE` ne les distingue pas, l'UI offre un bascule manuel en haut :

- **HLL** (string) → `PFCOUNT key` estime la cardinalité, erreur ≈ 0.81%.
- **Bitmap** (string) → `BITCOUNT key` (total) + plage `BITCOUNT key start end` + bit `GETBIT key offset`.
- **Geo** (zset) → `ZRANGE key 0 -1` pour les membres, puis `GEOPOS key m1 m2 ...` pour les lat/lng. Membres absents / non-geo → nil, l'UI affiche `null`.

Erreur de bascule (string ordinaire vu comme HLL) → Redis renvoie `WRONGTYPE`, bandeau d'erreur direct.

### Édition inline

string / hash / list / set / zset supportent l'édition — bouton "Éditer" en haut, l'UI maintient une draft ; à l'enregistrement, commandes minimales selon type :

- string → `SET key value`
- hash → `HDEL key f1 f2 ...` + `HSET key f1 v1 f2 v2 ...`
- list → `LSET key i v` uniquement sur les index modifiés
- set → `SADD key m1 m2 ...` + `SREM key m1 m2 ...`
- zset → `ZREM key m1 m2 ...` + `ZADD key s1 m1 s2 m2 ...`

stream non supporté en édition inline (sémantique trop lourde).

### Création de clé (`RedisNewKeyDialog.vue`)

Création visuelle pour 5 types :

| Type | Commande | Saisie UI |
|---|---|---|
| String | `SET key value` | textarea |
| Hash | `HSET key f1 v1 ...` | lignes field/value (ajout/suppression) |
| List | `RPUSH key v1 v2 ...` | textarea multi-lignes, une entrée par ligne |
| Set | `SADD key m1 m2 ...` | textarea multi-lignes, déduplication |
| Sorted Set | `ZADD key s1 m1 s2 m2 ...` | lignes `<score> <member>` |

TTL optionnel, > 0 ajoute `EXPIRE key ttl`. Avant submit, `EXISTS key` ; existant → refus (pas d'écrasement). stream non supporté — `XADD` (id + field/value) plus pratique au prompt `RedisPane`.

### Champ de commande

Une zone d'éditeur générique en bas de `RedisPane`, split par whitespace :

```ts
const op = tokens[0].toUpperCase()
const args = tokens.slice(1)
await client.connections.executeCommand(conn.id, {
  op,
  args,
  context: { dbIndex },
})
```

Passe directement à `executeCommand` → `client.call(op, ...args)`, donc toutes les commandes Redis fonctionnent (`DEBUG SLEEP`, `OBJECT ENCODING`, `CONFIG REWRITE`, etc.). **Note** : pas de gestion des guillemets, `SET key "value with space"` se split en 4 tokens, pour des valeurs avec espace utilisez `NewKey` ou un script Lua.

### Scanner big keys (`RedisBigKeysDialog.vue`)

SCAN complet + `MEMORY USAGE` par clé (SAMPLES 5 par défaut, échantillonnage O(N)). 20 clés en parallèle par bloc, séquentiel inter-blocs, bouton "Stop" pour interrompre. Tri desc par taille (top 100 par défaut), agrégation par préfixe `:` ("user / cache / session"), top 8 en histogramme — vue claire de quel préfixe consomme le plus.

> Plusieurs centaines de milliers de clés = lent et coûteux CPU, autres clients voient l'impact. Recommandé en heures creuses ou MATCH pour restreindre d'abord.

### Monitoring de commandes temps réel (`RedisMonitorDialog.vue`)

**Compromis clé** : `MONITOR` Redis natif est bloquant, monopolise la connexion, incompatible avec le canal request-response. Ce panneau polle toutes les N secondes (défaut 2000ms) :

- `INFO stats` → `total_commands_processed` / `keyspace_hits` / `keyspace_misses` / `instantaneous_ops_per_sec`
- `INFO clients` → `connected_clients`
- `INFO memory` → `used_memory`

Les 60 dernières mesures en tableau roulant inversé, taux de hit calculé auto. Pour le détail par commande, le texte indique `redis-cli MONITOR` en terminal.

### Panneau serveur (`RedisServerInfoDialog.vue`)

7 onglets, chacun = une / un groupe de commandes admin Redis :

| Onglet | Commande | Contenu |
|---|---|---|
| INFO | `INFO` | Découpé par `# Section`, champs memory en format humain |
| Slow log | `SLOWLOG GET 128` + `CONFIG GET/SET slowlog-log-slower-than` + `SLOWLOG RESET` | id / ts / durée μs / commande / client |
| Clients | `CLIENT LIST` + `CLIENT ID` + `CLIENT KILL ID <id>` | Self marqué vert anti-auto-kill |
| Stats commandes | `INFO commandstats` | Tri desc par `usec_per_call` |
| CONFIG | `CONFIG GET *` + `CONFIG SET k v` | Édition inline, filtre |
| Cluster | `CLUSTER INFO` + `CLUSTER NODES` | Slots (0-16383) coloré par hash master ; non-cluster → erreur explicite |
| Sentinel | `SENTINEL MASTERS` | Non-sentinel → erreur explicite |

Case "Auto-refresh 5s" relance l'onglet courant ; fermeture du dialogue nettoie le timer.

### Lua / Functions (`RedisScriptDialog.vue`)

Deux onglets.

**Lua tab** :

- Éditeur + saisies KEYS / ARGV (séparées par espace).
- `▶ EVAL` → `EVAL <script> <numKeys> KEYS... ARGV...`
- `SCRIPT LOAD` → sha caché dans l'état UI ; `EVALSHA <sha>` rejoue ; `SCRIPT FLUSH` vide côté serveur.
- Sauvegarde locale : `localStorage['skylerx.redis.lua.<connId>']`, persistance inter-sessions.

**Functions tab** (Redis 7+) :

- `FUNCTION LIST WITHCODE` → parse `library_name / engine / functions[].name / library_code` par lib.
- Coller le code de lib dans l'éditeur → `FUNCTION LOAD [REPLACE] <code>`.
- `FUNCTION DELETE <lib>` supprime.
- Clic sur le nom de lib recharge `library_code` dans l'éditeur.

Éditeur = textarea (pas Monaco) — choix volontaire de légèreté, éditez en terminal puis collez si besoin.

### Recherche SCAN globale (`RedisSearchDialog.vue`)

MATCH cross sur les 16 bases :

- Pattern + 16 cases db (toutes par défaut), "Tout / Rien".
- Parcours séquentiel des bases sélectionnées, par db `SCAN cursor MATCH ... COUNT 500` ; hits → `TYPE / TTL` en parallèle.
- Hit > `SCAN_PER_DB_LIMIT = 5000` par db → troncature + toast.
- Tableau résultats → emit `pick(db, key)`, Workspace bascule sur le `RedisPane` correspondant via `pendingKey`.

### Import / export (`RedisImportExportDialog.vue`)

Format JSON custom (pas RDB), facilite la migration cross db / instance :

```json
[
  { "db": 0, "key": "...", "type": "string", "ttl": 3600, "value": "..." },
  { "db": 0, "key": "...", "type": "hash", "ttl": -1, "value": { "f": "v" } },
  { "db": 0, "key": "...", "type": "zset", "ttl": 0, "value": [{ "member": "a", "score": "1" }] },
  { "db": 0, "key": "...", "type": "stream", "ttl": -1, "value": [{ "id": "1-0", "fields": [["f","v"]] }] }
]
```

**Export** : `SCAN MATCH` la db courante, pour chaque clé `TYPE / TTL / structure de données`, dump séquentiel (anti-rafale IPC), `client.files.saveText` ouvre le dialogue natif d'enregistrement.

**Import** : ouverture JSON → commandes par `type` : string → `SET`, hash → `HSET`, list → `RPUSH`, set → `SADD`, zset → `ZADD`, stream → entries `XADD`. Stratégie de conflit `skip` (défaut) / `overwrite` (`DEL` d'abord). `ttl > 0` ajoute `EXPIRE`.

Limites connues : **stream sans consumer group** ; `XINFO` / `XGROUP` à traiter séparément.

---

## Elasticsearch

### Structure arborescente

```
Connection
└── Index (plat, pas de niveau Database)
    └── Field (depuis getMapping properties)
```

Implémentation :

- `listIndices` : `client.cat.indices({ format: 'json' })`, filtre les index système commençant par `.` (désactivable via `extra.showSystemIndices = true`).
- `listFields` : `client.indices.getMapping({ index })`, prend `mappings.properties`, champ `detail.dataType = prop.type` (défaut `object`).

### Panneau de requête (`ElasticPane.vue`)

- Fil d'Ariane (index) + bouton "Rafraîchir" + badge `docs.count` (appel `count` séparé).
- Textarea Query DSL au milieu, `op` à côté : `search` / `count` / `getMapping`.
- Bouton "Exécuter" en bas, bascule "Tableau / JSON brut" à droite.

Exécution :

```ts
await client.connections.executeCommand(conn.id, {
  op,                                  // 'search' | 'count' | 'getMapping'
  args: { index, body },               // body parsé du textarea
  context: { collection: index },      // doublé, fallback driver needIndex()
  maxRows: 500,                        // seulement pour search
})
```

`getMapping` sans body ; `count` traite body comme `{ query: ... }`.

### Tableau vs JSON brut

- `search` : colonnes = `_id` + union des champs de `hits.hits[*]._source`, valeurs via `cellOf(hit, col)` (`_id` via `hit._id`, autres via `hit._source[col]`).
- `total: N · took: M ms` en haut depuis `data.hits.total` (`{ value: N }` ou nombre legacy) + `executionTimeMs`.
- `count` / `getMapping` n'ont pas de "ligne", la vue tableau retombe sur JSON brut.
- Toute op peut basculer en raw JSON en haut.

### Comportement `maxRows` pour `search` (détection truncated)

Cette section du driver mérite attention :

```ts
case 'search': {
  const params = { index, ...body }
  let probeTruncated = false
  if (typeof maxRows === 'number' && body.size == null) {
    params.size = maxRows + 1            // sonde une de plus
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

Points clés :

- **L'utilisateur a écrit `size` dans le DSL = on ne touche pas** (respect de l'intention).
- Sinon : `maxRows + 1` pour sonder ; > maxRows = tronquage + `truncated: true`.
- Préserve la structure ES `{ hits: { hits, total } }`, juste `hits.hits` tronqué.

### Op supportées (liste complète)

Switch réel de `elasticsearch.ts` :

| Catégorie | op | args obligatoires | Méthode client |
|---|---|---|---|
| Document lecture | `search` | `index?`, `body?` | `client.search({ index, ...body })` |
| Document lecture | `get` | `index?`, `id` | `client.get({ index, id })` |
| Document lecture | `count` | `index?`, `query?` | `client.count({ index, query })` |
| Document écriture | `index` | `index?`, `document`, `id?` | `client.index({ index, document, id? })`, `affected = 1` |
| Document écriture | `update` | `index?`, `id`, `doc?`, `body?` | `client.update({ index, id, doc, ...body })`, `affected = 1` |
| Document écriture | `delete` | `index?`, `id` | `client.delete({ index, id })`, `affected = 1` |
| Document écriture | `bulk` | `operations[]` | `client.bulk({ operations })`, `affected = items.length` |
| Gestion index | `indices.create` / `indices.delete` / `indices.getMapping` / `indices.refresh` | passe `args` à `client.indices.<sub>` | |
| cat | `cat.indices` / `cat.health` / `cat.nodes` | passe + `format: 'json'` par défaut | |
| Bas niveau | `raw` | `method`, `path`, `body?`, `querystring?` | `client.transport.request(...)`, REST arbitraire |

`needIndex()` cherche dans `context.collection` ou `args.index` ; aucun des deux → `MISSING_INDEX`.

`unwrap(res)` compatible ES 8 (retourne body directement) et v7 legacy `{ body, statusCode, headers, warnings, meta }`, l'UI n'a pas à connaître la version.

---

## Contrat du canal parallèle (résumé)

Vous remarquerez que les 3 drivers diffèrent énormément, mais le contrat pour le front est toujours le même :

```ts
interface CommandRequest {
  op: string                   // dictionnaire propre au driver
  args?: unknown               // Mongo/ES = objet ; Redis = tableau positionnel
  context?: {                  // cible
    database?: string          // Mongo
    collection?: string        // Mongo / ES (= index)
    dbIndex?: number           // Redis
  }
  maxRows?: number             // le driver implémente le tronquage limit+1
}

interface CommandResult {
  data: unknown
  executionTimeMs: number
  affected?: number            // "rows affected" pour écriture
  truncated?: boolean          // flag de troncature liée à maxRows
}
```

Cette forme est indépendante du canal SQL : `QueryResult` reste réservé au SQL. `execute()` des drivers NoSQL lève toujours `SQL_CHANNEL_UNSUPPORTED`, le front ne l'appelle pas si dialect = mongo/redis/elasticsearch.

---

## Limites connues / Compromis

| Élément | Description |
|---|---|
| Faux positif 24-hex Mongo | De rares chaînes 24-hex ordinaires sont prises pour des ObjectId par le driver. Prix à payer pour ne pas avoir "updateOne 0 match". |
| Référence ObjectId hors `_id` | Le driver ne convertit que les champs nommés `_id` ; pour `userId / refId` etc., utilisez le marker `{ $oid: 'hex' }` dans l'UI ou construisez l'EJSON via `runCommand`. |
| Redis MONITOR | MONITOR natif bloque toute la connexion, conflit avec le canal request-response. Panneau temps réel = polling `INFO stats`, pour le détail par commande utilisez `redis-cli MONITOR`. |
| Parse commande Redis sans guillemets | Le champ commande de `RedisPane` split par whitespace, pas de guillemets / échappement. Pour valeurs avec espace, utilisez `NewKey` ou Lua. |
| Échantillonnage tree Redis | Nœuds de groupe par type max 200 clés en échantillon, budget 10 000. Au-delà → `RedisSearchDialog`. |
| Count par type Redis | DBSIZE > 100 000 → pas de count par catégorie pour éviter le SCAN complet à l'expansion d'arbre. |
| Redis big key MEMORY USAGE | Échantillonnage O(N), lent et coûteux CPU sur grandes bases, recommandé en heures creuses ou MATCH pour restreindre. |
| Import/export Redis stream | Sans consumer group ; `XINFO / XGROUP` à migrer séparément. |
| Création de clé Redis stream | `XADD` sémantique trop lourde, plus pratique au champ commande / Lua. |
| ES SQL | `_xpack/sql` non-ANSI, pas intégré au canal SQL ; à l'avenir possible via `op: 'sql'`. |
| ES `size` écrase `maxRows` | Si l'utilisateur écrit `size` dans le DSL, respect complet, pas de `+1` ; pas de signal `truncated` dans ce cas. |
| ES truncated pour search seulement | `count` / `get` / `getMapping` n'ont pas de "collection", pas concernés. |
| Dépendances drivers NoSQL | `mongodb` / `ioredis` / `@elastic/elasticsearch` sont en **peerDep optionnels**, import paresseux. Bundling desktop = installation avec `apps/desktop` ; backend self-hosted = `pnpm add` manuel, sinon erreur "driver non installé" à la connexion/test. |
