# NoSQL 詳細活用ガイド — MongoDB / Redis / Elasticsearch

SkylerX は NoSQL をファーストクラスとして扱い、SQL データベースと同じメタデータツリー、同じ接続管理、同じ AI アシスタントを利用しますが、内部では **並列チャネル(executeCommand)** を経由します — 詳細は [ARCHITECTURE](https://github.com/duhbbx/SkylerX/blob/main/ARCHITECTURE.md) を参照。本稿はデータベース単位で UI 機能、およびドライバが **実際に公開している** op とパラメータを節ごとに解説します。

## 概要 — 並列チャネルと SQL チャネルの関係

`DataClient` は相互に独立した 2 つのエントリを公開します:

| チャネル | エントリ | 適用 |
|---|---|---|
| SQL | `connections.execute(sql)` | MySQL / PostgreSQL / Oracle / ... |
| コマンド | `connections.executeCommand({ op, args, context, maxRows? })` | MongoDB / Redis / Elasticsearch |

NoSQL ドライバの `execute()` は直接 `SQL_CHANNEL_UNSUPPORTED` をスローします:

```ts
// packages/core-driver/src/dialects/mongo.ts
async execute(): Promise<QueryResult> {
  throw new Error('SQL_CHANNEL_UNSUPPORTED: MongoDB は SQL をサポートしません、executeCommand を使用してください')
}
```

`executeCommand` が実際に機能するエントリで、**各ドライバが独自の op 辞書を定義**します。本稿の残りはこの辞書を明確に説明することにあります。

共通約束:

- `context` は **対象オブジェクト** を保持(MongoDB の `database` / `collection`、Redis の `dbIndex`、ES の `collection` = index)。
- `args` はその op 自身のパラメータオブジェクト / 配列(Mongo / ES はオブジェクト、Redis は位置パラメータ配列)。
- `maxRows` はコレクション返却の読み取り操作にのみ意味を持ち、ドライバが `limit/size + 1` で 1 件追加取得して `truncated` を検出します。
- 戻り値はすべて `CommandResult`:`{ data, executionTimeMs, affected?, truncated? }`。

---

## MongoDB

### ツリー構造

```
Connection
└── Database (複数)
    └── Group "コレクション" (count)
        └── Collection (kind = Table、SQL テーブルノードを流用)
```

ドライバの実装:

- `listDatabases` は `admin().listDatabases()` を呼ぶ。
- `databaseGroups` は `listCollections({}, { nameOnly: true })` でコレクション数を取得し `count` に入れる。
- `listCollections` ソート後 `kind: Table` ノードを作成、フロントエンドは `connection.dialect === 'mongodb'` の場合 `MongoPane` でレンダリング。

### コレクションブラウザ(`MongoPane.vue`)

Collection ノードを開くとこのコンポーネントに到達、上部 3 セクション:

1. **パンくず** `database · collection`、更新 / 変更コミット / 変更取り消しと並列。
2. **JSON Filter textarea + limit / skip + テーブル / JSON ビュー切替**。
3. **結果エリア** — テーブルビューは行集の第 1 層フィールド和集合を列とし、または `rows.value` の JSON を直接レンダリング。

実行ボタンが実際に呼ぶのは `find` です:

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

表頭の列は `rows` の第 1 層フィールド和集合で動的計算、schemaless コレクションも表示可能です。`_id` 列が 24-hex 文字列なら `ObjectId("...")` としてレンダリングし、内部が BSON ObjectId であることをユーザーに示します(IPC で文字列にシリアライズ済み)。

### 編集可能グリッド → updateOne(dot-path)

`_id` 以外のセルをダブルクリックでインライン編集に入る(`_id` 列は編集禁止)。エディタに **有効な JSON** を入力、Enter で確定。dirty セルはハイライト、上部の「変更コミット (N)」で 1 件ずつ `updateOne` を呼ぶ。

diff アルゴリズムは `diffToOps()`:

- 両側とも plain object でない → 全フィールド `$set`(配列は展開しない、インデックスずれ防止)。
- 両側とも plain object → key 和集合を取り再帰、新規のみ → `$set`、旧のみ → `$unset`、JSON 等価 → スキップ。
- パスは dot-path に圧縮、例 `addr.city = '...'`。

最終リクエストはこのような形:

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

### ObjectId 自動ラップ(`$oid` marker ↔ ドライバ実装)

ObjectId は IPC 境界で元型を失う(文字列になる)ため、**双方向 marker** を約束:

- UI 書き戻し時:`wrapOidStrings()` がすべての 24-hex 文字列を再帰的に `{ $oid: 'hex' }` でラップ。
- ドライバ受信後:`normalizeIds()` が `_id` フィールド配下の 24-hex 文字列を `new ObjectId(hex)` にラップ。

ドライバ層は **保守的戦略**:キー名 === `_id` のフィールドのみ自動変換、他のキーは触らない。理由は `mongo.ts` のコメントで率直に — たまたま ObjectId のように見える通常文字列(例えば一部のハッシュ ID)を壊さないため。これは、`userId / refId` のような参照 ObjectId フィールドで検索したい場合、自分で `{ $oid: '...' }` marker を使うか完全な `EJSON` を書く必要があるという意味です。

`_id` 演算子オブジェクトも再帰処理されるため、以下はすべて正常動作:

```jsonc
{ "_id": "65f1aa..."                                      } // → ObjectId
{ "_id": { "$in": ["65f1aa...", "65f2bb..."]              }} // 配列メンバー
{ "_id": { "$eq": "65f1aa...", "$exists": true            }} // 演算子オブジェクト
{ "$or": [{ "_id": "65f1aa..." }, { "name": "x" }]         } // ネストクエリ
```

### Aggregation パイプライン(`MongoAggregationDialog.vue`)

左側に stage カードリスト(上下移動 / 削除可能)、右側に結果。各 stage は独立した JSON textarea。`STAGE_TEMPLATES` で 10 種類の常用 stage をワンクリック挿入可能:

`$match` · `$project` · `$group` · `$sort` · `$limit` · `$skip` · `$unwind` · `$lookup` · `$addFields` · `$count`

実行時に順次 `{ [stage.op]: JSON.parse(stage.json) }` でパイプラインを組み立て:

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

いずれかの stage JSON 解析失敗 → パイプライン全体がエラーで表示。結果はデフォルトで先頭 `limit`(UI 上のミニ入力欄、1-1000)件の JSON 全文表示。`details` エリアに「パイプライン JSON を見る」、mongosh で再現するためのコピーに便利。

### コレクションメタ情報(`MongoCollectionInfoDialog.vue`)

2 タブ:

**統計**(`collStats`):`count` / `size` / `avgObjSize` / `storageSize` / `nindexes` / `totalIndexSize`、すべてのサイズは人間可読単位。

**インデックス** — `listIndexes` + テーブル(name / keys / unique / sparse / ttl / size)+ 新規インデックスフォーム。新規インデックス時:

- フィールド行は複数追加可、方向は `1 / -1 / text / 2dsphere` から選択。
- `name / unique / sparse / expireAfterSeconds` はオプション。
- バックグラウンドで `createIndex` op を呼ぶ、パラメータは `{ key: { field1: 1, field2: -1 }, unique?, sparse?, expireAfterSeconds? }`。

インデックス削除は `dropIndex` op、UI は `_id_` デフォルトインデックスの削除を阻止。

### ドライバがサポートする op(完全リスト)

`mongo.ts` の switch で実際にリストされている op:

| カテゴリ | op | 必須 args | 説明 |
|---|---|---|---|
| 読 | `find` | `filter`, `options?` | カーソル toArray、maxRows → `limit+1` で truncated 検出 |
| 読 | `findOne` | `filter`, `options?` | 単一ドキュメント |
| 読 | `aggregate` | `pipeline`, `options?` | パイプライン、maxRows 同上 |
| 読 | `countDocuments` | `filter`, `options?` | |
| 読 | `distinct` | `field`, `filter?`, `options?` | |
| 書 | `insertOne` | `document`, `options?` | `affected = acknowledged ? 1 : 0` |
| 書 | `insertMany` | `documents`, `options?` | `affected = insertedCount` |
| 書 | `updateOne` / `updateMany` | `filter`, `update`, `options?` | `affected = modifiedCount` |
| 書 | `replaceOne` | `filter`, `document`, `options?` | |
| 書 | `deleteOne` / `deleteMany` | `filter`, `options?` | `affected = deletedCount` |
| 管理 | `runCommand` | `args` 全体を command として直接 `db.command()` に | フォールバックエントリ |
| 管理 | `listCollections` | `filter?`, `options?` | |
| 管理 | `createCollection` | `name`, `options?` | |
| 管理 | `dropCollection` | `name` | |
| インデックス | `collStats` / `listIndexes` / `createIndex` / `dropIndex` | `MongoCollectionInfoDialog` 参照 | `runCommand` 経由 |

> 表外の op は一律 `UNKNOWN_OP`。追加が必要な場合は `mongo.ts` の switch に書き、クライアントの任意 API を迂回しないこと。

---

## Redis

### ツリー構造

```
Connection
└── Database  db0..db15 (16 個の固定論理 DB、count は INFO keyspace から)
    └── Group "Strings / Hashes / Lists / Sets / Sorted Sets / Streams"
        └── Key (SCAN サンプリング、上限 200)
```

`listDatabases` は 1 回の `INFO keyspace` で 16 個 DB の `keys=N` を全取得、空 DB は count を表示せずノイズ回避。

`listTypeGroups` は `DBSIZE` を確認:`<= 100 000` の場合は DB 全体 SCAN + pipeline TYPE で各グループの正確 count を集計、超大 DB は集計を諦めグループノードのみ表示。

`sampleKeysByType` はグループ選択時に SCAN + pipeline TYPE フィルタ、最大 `SCAN_SAMPLE_LIMIT = 200` 件サンプリング、スキャン予算は約 `ROUND_CAP × COUNT = 50 × 200 = 1 万 key`。足りない場合は `... (もっと表示するには SCAN コマンドを使用)` 行を表示、`RedisSearchDialog` への誘導。

### Key ブラウザ(`RedisPane.vue`)

左側 SCAN リスト + MATCH 検索欄、右側は現在選択中の key の TYPE に応じて対応ビューをレンダリング。下部の「さらに読み込む」で SCAN カーソルを進め、ドライバが cursor='0' を返すまで継続。

ロードフロー:

1. `SCAN <cursor> MATCH <match> COUNT 500` — `[nextCursor, batch]` を取得。
2. 新規 key をチャンク化(`TYPE_PIPELINE_CHUNK = 200`)して並行 `TYPE` 取得。
3. `keys.value` に追加、cursor を進める。

ソートは name / type / ttl の 3 種、降順 / 昇順切替可。ttl 列はデフォルト無効、"TTL" ボタンクリックで一括取得(各 key 1 回の `TTL`、チャンク 100 並行)。複数選択後に一括 `EXPIRE / PERSIST / UNLINK` 可能。

### 各タイプ value のレンダリング

ドライバ `executeCommand` は `ioredis.call(op, ...args)` にスルー、UI は直接生 Redis コマンドを送信。以下は `RedisPane` で key 選択後に自動実行されるコマンド:

| TYPE | 小集合(≤ `PAGE_SIZE = 100`) | 大集合(ページング) |
|---|---|---|
| `string` | `GET key` | — |
| `hash` | `HGETALL key` | `HSCAN key cursor COUNT 100` |
| `list` | `LRANGE key 0 LIST_PAGE-1`(`LIST_PAGE = 200`) | ページめくりで `LRANGE` 継続、`LLEN` で境界比較 |
| `set` | `SMEMBERS key` | `SSCAN key cursor COUNT 100` |
| `zset` | `ZRANGE key 0 -1 WITHSCORES` | `ZSCAN key cursor COUNT 100` |
| `stream` | `XRANGE key - + COUNT 50` | — |

stream エントリの構造は `[id, [f1, v1, f2, v2, ...]]`、UI 自身で `{ id, fields: [[k, v], ...] }` に解析。

#### 追加ビュー(同じ基底 TYPE の複数解釈)

Redis は HyperLogLog / Bitmap を string に、Geo を zset に置く — `TYPE` コマンドで区別できないため、UI 上部で手動切替を提供:

- **HLL**(string)→ `PFCOUNT key` で基数推定、誤差 ≈ 0.81%。
- **Bitmap**(string)→ `BITCOUNT key`(総数)+ 区間 `BITCOUNT key start end` + 単一 bit `GETBIT key offset`。
- **Geo**(zset)→ まず `ZRANGE key 0 -1` でメンバー取得、次に 1 回の `GEOPOS key m1 m2 ...` で全経緯度取得。GEOPOS は存在しない / 非 geo メンバーに対し nil を返す、UI は `null` で表示。

誤切替(例:通常 string を HLL として扱う)は Redis が `WRONGTYPE` を返し、エラーバナーに直接表示。

### インライン編集

string / hash / list / set / zset は編集モードをサポート — 上部「編集」ボタンで進入、UI はドラフトを保持、保存時にタイプ別に最小コマンドセットを生成:

- string → `SET key value`
- hash → `HDEL key f1 f2 ...` + `HSET key f1 v1 f2 v2 ...`
- list → 変化した index のみ `LSET key i v`
- set → `SADD key m1 m2 ...` と `SREM key m1 m2 ...`
- zset → `ZREM key m1 m2 ...` と `ZADD key s1 m1 s2 m2 ...`

stream はインライン編集未対応(セマンティクスが重すぎる)。

### 新規 key(`RedisNewKeyDialog.vue`)

5 種類のタイプの可視化新規作成をサポート:

| タイプ | コマンド | UI 入力 |
|---|---|---|
| String | `SET key value` | textarea |
| Hash | `HSET key f1 v1 ...` | field/value 行(増減可) |
| List | `RPUSH key v1 v2 ...` | 複数行 textarea、1 行 1 項目 |
| Set | `SADD key m1 m2 ...` | 複数行 textarea、自動重複排除 |
| Sorted Set | `ZADD key s1 m1 s2 m2 ...` | 複数行 `<score> <member>` |

TTL はオプション、> 0 で `EXPIRE key ttl` を追加。提出前に `EXISTS key` 事前チェック、存在する場合は拒否(上書き不可)。stream は非対応 — `XADD` は id + field/value が必要、`RedisPane` のコマンド入力欄から直接送る方がスムーズ。

### コマンド入力欄

`RedisPane` の上部 2 行目に汎用コマンドエディタ、空白でトークン分割後:

```ts
const op = tokens[0].toUpperCase()
const args = tokens.slice(1)
await client.connections.executeCommand(conn.id, {
  op,
  args,
  context: { dbIndex },
})
```

ドライバの `executeCommand` → `client.call(op, ...args)` に直接流れるので、Redis の全コマンドがここで実行可能(`DEBUG SLEEP`、`OBJECT ENCODING`、`CONFIG REWRITE` 等含む)。**注意**:コマンド解析はクォートエスケープを処理しないため、`SET key "value with space"` は 4 トークンに分割される、空白を含む値は `NewKey` ダイアログまたは Lua スクリプトを使用してください。

### 大 key スキャン(`RedisBigKeysDialog.vue`)

DB 全体 SCAN + 各 key `MEMORY USAGE`(デフォルト SAMPLES 5、O(N) サンプリング)。20 個ずつのチャンクで並行、チャンク間は直列、「停止」ボタンで中断可。結果はバイト数降順で先頭 N(デフォルト 100)を表示、`:` プレフィックスで「user / cache / session」のような業務分桶に集約、上位 8 を横向き棒グラフでレンダリング、どのプレフィックスが最もメモリを消費しているか直観的に確認可能。

> 数十万 key の DB は遅く CPU を占有、スキャン中は他のクライアントが感じます。低負荷時に実行するか、先に MATCH で範囲を絞ることを推奨。

### リアルタイムコマンドフロー監視(`RedisMonitorDialog.vue`)

**重要なトレードオフ**:Redis ネイティブの `MONITOR` はブロッキングモードで現在の接続を占有、リクエスト-レスポンスチャネルと衝突します。そのため、このパネルは妥協して N 秒(デフォルト 2000ms)ごとに取得:

- `INFO stats` → `total_commands_processed` / `keyspace_hits` / `keyspace_misses` / `instantaneous_ops_per_sec`
- `INFO clients` → `connected_clients`
- `INFO memory` → `used_memory`

直近 60 サンプリングポイントを逆順スクロールテーブルで表示、ヒット率を自動計算。各コマンド詳細を見たい場合はターミナルで `redis-cli MONITOR`、文言にも明確に提示。

### サーバーサイドパネル(`RedisServerInfoDialog.vue`)

7 タブ、それぞれが 1 つ / 1 組の Redis 管理コマンドに対応:

| Tab | コマンド | 内容 |
|---|---|---|
| INFO | `INFO` | `# Section` 別に分割、memory フィールドは人間可読に自動変換 |
| スローログ | `SLOWLOG GET 128` + `CONFIG GET/SET slowlog-log-slower-than` + `SLOWLOG RESET` | id / ts / 所要時間 μs / コマンド / クライアント |
| クライアント | `CLIENT LIST` + `CLIENT ID` + `CLIENT KILL ID <id>` | self 行に緑マークで誤 kill 防止 |
| コマンド統計 | `INFO commandstats` | `usec_per_call` 降順 |
| CONFIG | `CONFIG GET *` + `CONFIG SET k v` | 行インライン編集、フィルタ対応 |
| Cluster | `CLUSTER INFO` + `CLUSTER NODES` | slot 分布カラーバー(0-16383)、master id ハッシュで色付け、非 cluster モードはエラーで原因明示 |
| Sentinel | `SENTINEL MASTERS` | 非 sentinel ノードも原因明示 |

上部の「5s 自動更新」をチェックすると現在の tab を繰り返し refresh、ダイアログを閉じると自動でタイマークリーンアップ。

### Lua / Functions(`RedisScriptDialog.vue`)

2 タブ。

**Lua tab**:

- エディタ + KEYS / ARGV 入力(空白区切り)。
- `▶ EVAL` → `EVAL <script> <numKeys> KEYS... ARGV...`
- `SCRIPT LOAD` で sha 取得、UI 状態にキャッシュ、`EVALSHA <sha>` でリプレイ、`SCRIPT FLUSH` でサーバークリア。
- ローカル保存:`localStorage['skylerx.redis.lua.<connId>']` に保存、セッションをまたぐ保持。

**Functions tab**(Redis 7+):

- `FUNCTION LIST WITHCODE` → 各ライブラリの `library_name / engine / functions[].name / library_code` を解析。
- エディタに library code を貼り付け → `FUNCTION LOAD [REPLACE] <code>`。
- `FUNCTION DELETE <lib>` でライブラリ削除。
- ライブラリ名をクリックで `library_code` をエディタに引き戻し可。

エディタは textarea(Monaco ではない) — 意図的な軽量選択、より複雑な編集はターミナルで編集後に貼り付け。

### グローバル SCAN 検索(`RedisSearchDialog.vue`)

16 論理 DB をまたぐ MATCH 検索:

- 上部に pattern 入力 + 16 個 db チェックボックス(デフォルト全選択)、「全選択 / 全解除」。
- 選択された db を順次走査、各 db で `SCAN cursor MATCH ... COUNT 500`、ヒット後に並行 `TYPE / TTL`。
- 単一 DB のヒットが `> SCAN_PER_DB_LIMIT = 5000` の場合、直接切り詰めて toast で通知。
- 結果テーブルの行クリック → emit `pick(db, key)`、外側 Workspace が対応する `RedisPane` に切替え、`pendingKey` で位置決め。

### インポート / エクスポート(`RedisImportExportDialog.vue`)

カスタム JSON 形式(RDB ではない)を約束、DB / インスタンス間マイグレーションに便利:

```json
[
  { "db": 0, "key": "...", "type": "string", "ttl": 3600, "value": "..." },
  { "db": 0, "key": "...", "type": "hash", "ttl": -1, "value": { "f": "v" } },
  { "db": 0, "key": "...", "type": "zset", "ttl": 0, "value": [{ "member": "a", "score": "1" }] },
  { "db": 0, "key": "...", "type": "stream", "ttl": -1, "value": [{ "id": "1-0", "fields": [["f","v"]] }] }
]
```

**エクスポート**:現在の db を `SCAN MATCH`、各 key の `TYPE / TTL / 対応構造データ` を取得、直列 dump で一度に数十の IPC 並行を回避、最後に `client.files.saveText` でネイティブ保存ダイアログ表示。

**インポート**:JSON 読み込み → `type` 別にコマンド復元:string → `SET`、hash → `HSET`、list → `RPUSH`、set → `SADD`、zset → `ZADD`、stream → entry 別 `XADD`。衝突戦略 `skip`(デフォルト)/ `overwrite`(先に `DEL`)。`ttl > 0` で `EXPIRE` 追加。

既知の制限:**stream は consumer group なし**、`XINFO` / `XGROUP` 等は個別処理が必要。

---

## Elasticsearch

### ツリー構造

```
Connection
└── Index (フラット、Database 層なし)
    └── Field (getMapping の properties から)
```

実装:

- `listIndices` は `client.cat.indices({ format: 'json' })`、`.` で始まるシステムインデックスをフィルタ(接続 `extra.showSystemIndices = true` でフィルタオフ可)。
- `listFields` は `client.indices.getMapping({ index })`、`mappings.properties` を取得、フィールド `detail.dataType = prop.type`(デフォルト `object`)。

### クエリパネル(`ElasticPane.vue`)

- 上部パンくず(index)+ 「更新」ボタン + 上部 `docs.count` バッジ(独立 `count` 呼び出しで取得)。
- 中部 textarea に Query DSL を記述、横に `op` 選択:`search` / `count` / `getMapping`。
- 下部「実行」、右側に「テーブル / 生 JSON」ビュー切替。

実行時:

```ts
await client.connections.executeCommand(conn.id, {
  op,                                  // 'search' | 'count' | 'getMapping'
  args: { index, body },               // body は textarea から解析された JSON
  context: { collection: index },      // 両経路を埋める、ドライバ needIndex() でフォールバック
  maxRows: 500,                        // search にのみ真に有効
})
```

`getMapping` は body 不要、`count` は body を `{ query: ... }` として透過。

### テーブルビュー vs 生 JSON

- `search` 結果:列 = `_id` + `hits.hits[*]._source` フィールド和集合、値は `cellOf(hit, col)` で取得(`_id` は `hit._id`、その他は `hit._source[col]`)。
- 上部 `total: N · took: M ms` は `data.hits.total`(`{ value: N }` または旧版 number)+ `executionTimeMs` から。
- `count` / `getMapping` には「行」概念がないため、テーブルビューは生 JSON にフォールバック。
- 任意の op で上部 toggle で raw JSON に切替可能。

### `search` の `maxRows` 挙動(truncated 検出)

ドライバのこの部分は特に注目に値する:

```ts
case 'search': {
  const params = { index, ...body }
  let probeTruncated = false
  if (typeof maxRows === 'number' && body.size == null) {
    params.size = maxRows + 1            // 1 件多く探索
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

ポイント:

- **ユーザーが DSL で明示的に `size` を指定した場合は触らない**(ユーザー意図を尊重)。
- 指定なしの場合のみ `maxRows + 1` で探索、ヒット > maxRows なら切り詰めて `truncated: true` を返す。
- 戻り構造は ES 元の `{ hits: { hits, total } }` を維持、`hits.hits` のみ短縮。

### ドライバがサポートする op(完全リスト)

`elasticsearch.ts` の switch で実際にリストされているもの:

| カテゴリ | op | 必須 args | 呼び出されるクライアントメソッド |
|---|---|---|---|
| 文書読 | `search` | `index?`, `body?` | `client.search({ index, ...body })` |
| 文書読 | `get` | `index?`, `id` | `client.get({ index, id })` |
| 文書読 | `count` | `index?`, `query?` | `client.count({ index, query })` |
| 文書書 | `index` | `index?`, `document`, `id?` | `client.index({ index, document, id? })`、`affected = 1` |
| 文書書 | `update` | `index?`, `id`, `doc?`, `body?` | `client.update({ index, id, doc, ...body })`、`affected = 1` |
| 文書書 | `delete` | `index?`, `id` | `client.delete({ index, id })`、`affected = 1` |
| 文書書 | `bulk` | `operations[]` | `client.bulk({ operations })`、`affected = items.length` |
| インデックス管理 | `indices.create` / `indices.delete` / `indices.getMapping` / `indices.refresh` | `args` を `client.indices.<sub>` に透過 | |
| cat | `cat.indices` / `cat.health` / `cat.nodes` | 透過 + デフォルト `format: 'json'` | |
| フォールバック | `raw` | `method`, `path`, `body?`, `querystring?` | `client.transport.request(...)`、任意 REST 透過 |

`needIndex()` は `context.collection` または `args.index` から対象インデックスをフォールバック取得、両方ない場合 `MISSING_INDEX` をスロー。

`unwrap(res)` は ES 8(デフォルトで body を直接返す)と旧版 v7 `{ body, statusCode, headers, warnings, meta }` 構造の両方に対応、UI はクライアントバージョンを気にする必要なし。

---

## 並列チャネル契約(概要)

ここまで読むと、3 つのドライバの差異が大きいことが分かりますが、フロントエンドにとっての契約は常に一致しています:

```ts
interface CommandRequest {
  op: string                   // ドライバ独自辞書
  args?: unknown               // Mongo/ES はオブジェクト、Redis は位置配列
  context?: {                  // 対象オブジェクト
    database?: string          // Mongo
    collection?: string        // Mongo / ES (= index)
    dbIndex?: number           // Redis
  }
  maxRows?: number             // ドライバが limit+1 切り詰めを実装
}

interface CommandResult {
  data: unknown
  executionTimeMs: number
  affected?: number            // 書き込み操作の「影響件数」
  truncated?: boolean          // maxRows によるトリガーの切り詰めフラグ
}
```

この形態は SQL チャネルとは独立:`QueryResult` は SQL 専用のまま。NoSQL ドライバの `execute()` は一律 `SQL_CHANNEL_UNSUPPORTED` をスロー、フロントエンドは dialect = mongo/redis/elasticsearch では呼び出しません。

---

## 既知の制限 / トレードオフ

| 項目 | 説明 |
|---|---|
| Mongo 24-hex 誤判定 | 極少数のたまたま 24 桁 16 進数の通常文字列がドライバで ObjectId 扱いされる。「updateOne で常に 0 ヒット」を直すための必要なコスト。 |
| Mongo 非 `_id` フィールドの ObjectId 参照 | ドライバはキー名 `_id` のみ自動変換、`userId / refId` 等の参照 ObjectId は UI で `{ $oid: 'hex' }` marker を使うか、`runCommand` で手動で EJSON 構築が必要。 |
| Redis MONITOR | ネイティブ MONITOR は接続全体をブロック、リクエスト-レスポンスチャネルと衝突。リアルタイムパネルは `INFO stats` ポーリングに退化、各コマンドを見たい場合は `redis-cli MONITOR` を使用。 |
| Redis コマンド解析にクォートなし | `RedisPane` 上部のコマンドエディタは空白でトークン分割、クォート / エスケープ未処理。空白を含む値は `NewKey` ダイアログまたは Lua スクリプトを使用。 |
| Redis ツリーサンプリング | タイプグループノードは最大 200 個の key サンプリング、スキャン予算 1 万。超過時はグローバル SCAN 検索(`RedisSearchDialog`)を使用。 |
| Redis タイプグループ count | DBSIZE > 100 000 の大 DB では各タイプの count を集計しない、左ツリー展開時の DB 全体 SCAN による遅延回避。 |
| Redis 大 key MEMORY USAGE | O(N) サンプリング、大 DB のスキャンは遅く CPU を占有、低負荷時または先に MATCH で範囲を絞ることを推奨。 |
| Redis インポートエクスポートの stream | consumer group なし、`XINFO / XGROUP` 等は個別移行が必要。 |
| Redis 新規 key で stream 非対応 | `XADD` のセマンティクスが重すぎ、`RedisPane` のコマンド入力欄 / Lua スクリプトから送る方がスムーズ。 |
| ES SQL | `_xpack/sql` は非 ANSI、現状 SQL チャネル接続なし、必要なら `op: 'sql'` エントリを開く。 |
| ES `size` 明示で `maxRows` を上書き | ユーザーが DSL に `size` を書いた場合は完全に尊重、追加の `+1` 探索なし、この時 `truncated` シグナルは出ない。 |
| ES truncated は search のみ有効 | `count` / `get` / `getMapping` には「コレクション」概念がなく、切り詰め非対象。 |
| すべての NoSQL ドライバ依存 | `mongodb` / `ioredis` / `@elastic/elasticsearch` はすべて **オプショナル peerDep**、遅延 import。デスクトップ版は `apps/desktop` に同梱、セルフホスト バックエンドは対応パッケージを `pnpm add` する必要、さもないと connect/test 段階で「ドライバ未インストール」エラー。 |
