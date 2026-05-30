# 高度な機能

本章は SkylerX が**ヘビーユーザー(DBA / データエンジニア / バックエンド開発者)**向けに用意した高度な機能をまとめて紹介します。これらは右クリックメニュー、`⌘K` コマンドパレット、ツールバーの深い階層に隠れており、日常の SELECT ではほぼ使いませんが、以下のシーンで大いに時間を節約します:

- 実行プランがインデックスを使っているか、どのノードが最も遅いか見たい
- 履歴 SQL からどのインデックスを作るべきか逆推論したい
- あるテーブルのカラム分布 / NULL 率 / 型が大きすぎないか見たい
- 重複行を除去 / 履歴データにデフォルト値を補填 / ソフトデリートから復元したい
- DB 全体である値がどのテーブルに出現しているか検索したい
- ドラッグでクエリを可視化構築したい(SQL を書かずに)
- Doris/StarRocks のパーティション / ClickHouse の part / MySQL binlog / PG 拡張を管理したい
- Oracle DB を達夢 DM(中国産 DB)に全体移行したい

以下、「見る → 直す → 探す → 作る → 移行」の順で展開します。

## 1. EXPLAIN 可視化 — PlanPanel

SQL を書く人なら EXPLAIN を見たことがあるでしょうが、生テキストは直観的ではありません。SkylerX は QueryPane の隣に **Plan パネル**を取り付け、EXPLAIN 出力をツリー + サマリーとしてレンダリングします。

### トリガー方法

| エントリ | 動作 |
|---|---|
| QueryPane ツールバー `📊 Plan` | 現在の SQL を EXPLAIN(実際には実行しない) |
| `⌘⇧E` / Ctrl+Shift+E | 上と同じ |
| `📊 Plan` 横の `▶ Analyze` | EXPLAIN ANALYZE(**実際に実行**、DML 慎重に) |

底層は `plan.ts → planQuery(dialect, sql, { analyze })`:

| ダイアレクト | 生成される文 |
|---|---|
| PostgreSQL / KingbaseES | `EXPLAIN (FORMAT JSON) <sql>` / `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <sql>` |
| MySQL / MariaDB / OceanBase | `EXPLAIN FORMAT=TREE <sql>` / `EXPLAIN ANALYZE <sql>`(MySQL 8.0.18+) |
| その他のダイアレクト | フォールバックの表形式 EXPLAIN(plain pre レンダリング) |

### ノードツリーレンダリング

PG の JSON Plan は `parsePgPlan` で `PlanNode` ツリーに解析、その後 `flattenPlan` で `{node, depth}` リストに平坦化してレンダリング。各ノードに表示:

- **ラベル**:`Seq Scan` / `Index Scan` / `Hash Join` …
- **詳細**:`on users` / `using users_pk` / `inner join`
- **コストバー**:水平バー幅 = `cost / maxCost * 60px`、緑から赤グラデーション
- **数値**:`cost 1234.56 · est 1000 · act 1234 · 12.3ms`(act / ms は ANALYZE 時のみ)

### 遅いオペレータ色付け

PlanPanel は自動で「高コストの 1/3 ノード」を赤くマーキング:

```ts
function isSlow(node) {
  return node.cost >= maxCost.value * 0.33 && maxCost.value > 0
}
```

赤背景 + 赤ラベル、**目でどこを最適化すべきか即座に分かる**、コスト数値を 1 つずつ比較する必要なし。

### 推定 vs 実際のずれ

`estimateSkew(node)` は `max(est, act) / min(est, act)` を計算。≥ 10× は**オプティマイザ統計古い**(典型シグナル)とみなし、ノード左側に黄色サイドバー + ノード末尾に `⚠ 24×` バッジ。サマリーバーにも「ずれが最も深刻なノード」を単独で点出:

```ts
let skewWorst = null
for (const r of arr) {
  const sk = estimateSkew(r.node)
  if (sk == null) continue
  if (!skewWorst || sk > skewWorst.skew) skewWorst = { node: r.node, skew: sk }
}
```

このバッジを見たら通常 `ANALYZE table` か `pg_statistic refresh` の出番です。

### サマリーバー

パネル上部に表示:

| フィールド | 意味 |
|---|---|
| `Total Cost` | 最も重いノードの cost(ルートノード累積) |
| `Actual ms` | EXPLAIN ANALYZE 時の各ノード実際所要時間累積 |
| `Heaviest` | コスト最高のノード名 |
| `Skew` | 推定 vs 実際のずれが最深刻のノード + 倍率 |

---

## 2. インデックス推奨 — IndexRecommender

`⌘K → インデックス推奨` または NavTree DB ノード右クリック `🔧 インデックス推奨`。

### 入出力

| 入力 | 元 |
|---|---|
| 履歴 SQL パターン | `client.connections.history(connId, 1000)` 最新 1000 件 |
| 既存インデックス | MySQL `information_schema.STATISTICS` / PG `pg_index + pg_class` |

出力:`IndexHint[]`、各件にテーブル名、カラム名、総合スコア、推定理由、直接実行可能な `CREATE INDEX` DDL を含む。

### 推論アルゴリズム(`index-recommender.ts`)

SQL parser を導入せず(オーバーヘッド大かつダイアレクト差異多)、**正規表現ヒューリスティック**で WHERE / JOIN / ORDER BY / GROUP BY を抽出:

1. **履歴集約**:同一 SQL テキストは 1 行に統合、`count` + `totalMs` 累積
2. **フィルタ**:`SELECT` / `WITH` 系のみ保持、DML/DDL はスキップ
3. **エイリアス解析**:`parseTableAliases(sql)` が `FROM`/`JOIN` 後の `tbl [AS] alias` を Map に抽出
4. **4 種類の句をスキャン**、ヒットごとに基礎スコアを加算:

| 句 | 基礎スコア | 説明 |
|---|---|---|
| `WHERE col = ?` / `LIKE` / `IN` / `IS NULL` / `BETWEEN` | 5 | 強シグナル |
| `JOIN ON a.col = b.col` | 3 | 両側カラムに加算 |
| `ORDER BY col` | 2 | ソートにはソート済みインデックスが必要 |
| `GROUP BY col` | 2 | グループ化同様 |

5. **時間重み**:各 SQL `count × min(perMs/avgMs, MAX_TIME_MULTIPLIER=5)`、1〜2 件のスロー SQL でテーブル全体が埋もれるのを回避
6. **複数テーブル SQL** はエイリアス付き必須、裸カラムは認めない;**単一テーブル SQL** のみ裸カラム名を許容
7. **既存インデックスフィルタ**:`isCovered(table, cols, known)` で「既存インデックスのプレフィックスが推奨カラムを完全カバー」を判定、ヒットならスキップ
8. **複合提案**:各テーブルの上位 3 スコアカラムを 2 つずつペアリング、複合インデックス候補を生成

### DDL 生成

```ts
function buildDdl(table, columns, dialect) {
  const idxName = `idx_${sanitize(table)}_${cols.map(sanitize).join('_')}`.slice(0, 60)
  return `CREATE INDEX ${quoteIdent(idxName)} ON ${quoteIdent(table)}(${cols.map(quoteIdent).join(', ')});`
}
```

MySQL はバッククォート \``\`、PG はダブルクォート `"`。

### UI フロー

ダイアログを開くと自動で `run()`:スキャン → 候補列挙(`scoreEstimate` 降順)。各行:

- `[採用]` ボタン → `emit('runSql', h.ddl)` で DDL を QueryPane に投げる(ユーザーが確認後に実行)
- `[全コピー]` ですべての候補 DDL をクリップボードに一括コピー
- `[再スキャン]` でフロー再実行

MySQL ファミリー / PG ファミリーのみ対応、その他のダイアレクトは「現在未サポート」を表示。

---

## 3. データ探査 — DataInspector

テーブル右クリック `🔬 データ探査`。1 つのダイアログで 5 タブ、「データヘルス確認 + ワンクリックメンテナンス」の DBA トラブルシュートのコア動作をカバー。**設計上、SQL を並行実行しない**(本番への負荷を恐れる):ユーザーがタブをクリックして初めて該当タブのデータを取得。

### Tab 1:カラムサンプリング(A3)

カラムを 1 つ選び、1 つの SQL で全統計:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(col) AS non_null,
  COUNT(DISTINCT col) AS distinct_cnt,
  MIN(col) AS min_val,
  MAX(col) AS max_val
FROM <table>
```

さらに top-10:

```sql
SELECT col AS value, COUNT(*) AS cnt
FROM <table> GROUP BY col ORDER BY cnt DESC LIMIT 10
```

カード化された統計 + top-N テーブル表示。NULL 率高 / distinct 極小(ステータスコードかも)/ 極値異常が一目瞭然。

### Tab 2:全テーブルプロファイル(B6)

1 つの大 SELECT で全カラムの `COUNT(col)` + `COUNT(DISTINCT col)` を同時計算:

```sql
SELECT COUNT(*) AS total,
       COUNT(`a`) AS nn_a, COUNT(DISTINCT `a`) AS dc_a,
       COUNT(`b`) AS nn_b, COUNT(DISTINCT `b`) AS dc_b,
       ...
FROM <table>
```

出力表:`カラム名 | 型 | NULL% | DISTINCT/総数`。NULL% > 50 は黄色マーク、「この列は使われていない可能性」と提示。

### Tab 3:制約スキャン(B5)

テーブルの `IS_NULLABLE = 'NO'` カラムをリストアップ、各カラムに `SELECT COUNT(*) WHERE col IS NULL` を実行。ヒット > 0 は**制約違反**(初期に NOT NULL を付けず、後で付けたが汚いデータが残った場合が多い)とみなす。

### Tab 4:型最適化提案(B9)

カラム別タイプ戦略で縮小提案:

| 現在型 | チェック | 提案 |
|---|---|---|
| `VARCHAR(255)` | `MAX(CHAR_LENGTH(col))` 実際 max | `VARCHAR(max(32, ceil(maxlen*1.5)))`、宣言 > maxlen*4 かつ差 > 50 なら |
| `BIGINT` | `MAX(ABS(col))` | < 2³¹-1 なら → `INT` |
| `INT` | 同上 | < 32767 なら → `SMALLINT` |

各提案に理由を提示(`実際最大長 20、宣言 255、235 バイト浪費`)。

### Tab 5:テーブルメンテナンス(B10)

ダイアレクト別に 4 つのワンクリックボタン:

| ダイアレクト | ボタン |
|---|---|
| MySQL ファミリー | `ANALYZE TABLE` / `OPTIMIZE TABLE` / `CHECK TABLE` |
| PG ファミリー | `ANALYZE` / `VACUUM FULL` / `VACUUM` / `REINDEX TABLE` |

実行時に二重確認(VACUUM FULL はテーブルをロック)。

---

## 4. データ修整 — DataFixup

テーブル右クリック `🩹 データ修整`。3 タブ、「条件入力 → SQL 生成 → ユーザー審査 → 実行」の 4 ステップ骨格を共有。**直接 commit しない**、生成された SQL を QueryPane に pending として投げユーザーに確認させる。

### Tab 1:重複行検出(B3)

数列を**業務キー**(`email + tenant_id`)として選択、まず GROUP BY で重複グループを確認:

```sql
SELECT col1, col2, COUNT(*) AS cnt
FROM <table>
GROUP BY col1, col2 HAVING COUNT(*) > 1
ORDER BY cnt DESC LIMIT 100
```

重複ありを確認後、`クリーンアップ SQL 生成` で `ROW_NUMBER()` ウィンドウ削除文(PG 版)を取得、コメントに MySQL 自己結合版を代替案として記載:

```sql
-- 各グループの ROW_NUMBER() = 1 を残し、その他を削除
DELETE FROM <table>
WHERE (col1, col2, ctid) IN (
  SELECT col1, col2, ctid FROM (
    SELECT col1, col2, ctid,
           ROW_NUMBER() OVER (PARTITION BY col1, col2 ORDER BY ctid) AS rn
    FROM <table>
  ) sub WHERE sub.rn > 1
);
```

### Tab 2:NULL 補填(B4)

カラム + 戦略を選択:

| 戦略 | 生成される SET 式 |
|---|---|
| `literal` | `'<ユーザー入力値>'` |
| `avg` | `(SELECT AVG(col) FROM <table>)` |
| `min` / `max` | `(SELECT MIN/MAX(col) FROM <table>)` |
| `most_common` | `(SELECT col GROUP BY col ORDER BY COUNT(*) DESC LIMIT 1)` |

最終的に `UPDATE <table> SET col = <expr> WHERE col IS NULL;` を生成、コメントに「先に SELECT COUNT で影響件数を確認推奨」と一言追加。

### Tab 3:ソフトデリート復元(B8)

ヒューリスティックにカラム名をスキャンしてソフトデリートフィールド(`deleted_at` / `is_deleted` / `deleted`)を探す。カラム名がブール型かタイムスタンプかで復活文を生成:

| カラム名 | 生成 |
|---|---|
| `is_deleted` / `*_flag` | `UPDATE ... SET col = FALSE WHERE col = TRUE` |
| `deleted_at` / その他のタイムスタンプ | `UPDATE ... SET col = NULL WHERE col IS NOT NULL` |

オプションで「追加 WHERE」(`AND user_id = 42`)を入力して範囲限定、一度に全ソフトデリートを復活させないように。

---

## 5. テーブル横断値検索 — SearchValueDialog

`⌘K → テーブル横断検索` または結果セットセル右クリック `🔎 この値が他にどこにあるか探す`(後者は自動 prefill)。

### ワークフロー

1. **すべての「検索可能」文字列カラムを取得**(`information_schema.columns`):
   - MySQL:`varchar / char / text / tinytext / mediumtext / longtext / json`
   - PG:`character varying / character / text / json / jsonb`
2. **テーブル別グループ化**:各テーブルに `SELECT * FROM t WHERE col1 LIKE :v OR col2 LIKE :v ... LIMIT 50` を生成
3. **並行実行**(同時 max 6 件、接続プール満杯防止)
4. **プログレスバー** + ヒット一覧

### パフォーマンス境界

大 DB は数千カラムあるかも、検索前に `table_prefix` で範囲を絞る(`user_*`)。`matchMode` は `contains` / `exact` 選択可:

- `contains` → `LIKE '%v%'`(遅いが網羅)
- `exact` → `= 'v'`(速い、ID 精確検索向け)

`maxPerTable` は各テーブル最大 50 件のヒットに制限、ある大ワイドテーブルでメモリパンクを防止。

### 使用例

オンラインで「なぜユーザー `alice@x.com` がプッシュを受信したのか」調査:

1. ⌘K → テーブル横断検索
2. 値に `alice@x.com`、モード `exact`
3. 一度に全 DB をスキャン、`users(email)` + `subscription(email)` + `mail_logs(to_addr)` すべてに存在 → データフロー特定

---

## 6. 行変更履歴 — RowHistoryDialog

結果セットで行を選択して右クリック `⏱ バージョン履歴を見る`。

### ヒューリスティックなシャドウテーブル探索

ある行の PK(`{id: 42}`)を与え、自動で `information_schema.tables` をスキャンして候補シャドウテーブルを探す:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE '<base>_%'
   OR table_name = 'audit_<base>'
   OR table_name = '<base>_history'
```

ユーザーがドロップダウン(`<datalist>`)から選択するか手入力。

### 履歴取得

PK でフィルタ、`changed_at / updated_at / created_at / version / revision` 降順:

```sql
SELECT * FROM <shadowTable>
WHERE id = 42
ORDER BY changed_at, updated_at, created_at, version, revision DESC
LIMIT 200
```

出力テーブルの各行が 1 つのバージョン、列名はシャドウテーブルの元列、文字列フィールドは 80 文字に切り詰め。

---

## 7. 可視化クエリビルダー — VisualQueryDialog

`⌘K → 可視化クエリ` または DB ノード右クリック `🎨 可視化構築`。

**MVP はドラッグキャンバスを作らない** — より安定した「リスト + カード」レイアウトで、デモではなく実用を目指す。

### レイアウト

| エリア | 内容 |
|---|---|
| 左側 | 現在 DB の全テーブル + 検索欄 + チェックボックス |
| 中央 | チェック済みテーブルがカードに展開、各カラム前にチェック(チェックで SELECT に入る、未チェックは表示) |
| 上部 | WHERE / ORDER BY 入力欄 + `LIMIT` 数値入力 |
| 下部 | リアルタイム生成 SQL + `新しいクエリ tab で開く` ボタン |

### 自動 JOIN

2 テーブルチェック時に両側の「外部キー風カラム」を自動検出、`INNER JOIN` を生成:

```ts
// inferConventionalFks
const m = /^(.+?)_id$|^(.+?)Id$/.exec(col.name)
// user_id → users.id  /  category_id → categories.id
```

候補ターゲットテーブル:`<base>` そのまま + 簡易複数形(`user → users`、`category → categories`)。FK 経路が見つからなければ `CROSS JOIN` にダウングレード(効率注意の視覚提示)。

### SQL 生成

```sql
SELECT users.id AS users_id, users.name AS users_name,
       orders.id AS orders_id, orders.amount AS orders_amount
FROM users
  INNER JOIN orders ON users.id = orders.user_id
WHERE amount > 100
ORDER BY users.id DESC
LIMIT 200
```

カラム名に `<table>_<col>` エイリアス、複数テーブル同名カラムの衝突回避。

---

## 8. MPP パーティション管理 — MppPartitionDialog

Doris / StarRocks(MySQL プロトコル系)に適合。DB ノード右クリック `🗂 パーティション管理`。

### フィールド

`SHOW PARTITIONS FROM <db>.<tbl>` を呼び、表示:

| フィールド | 意味 |
|---|---|
| `PartitionId` / `PartitionName` | パーティションメタ情報 |
| `State` | NORMAL / 等 |
| `PartitionKey` / `Range` | パーティション列と範囲 |
| `DistributionKey` / `Buckets` | バケットキーと数 |
| `ReplicationNum` | レプリカ数 |
| `StorageMedium` | HDD / SSD |
| `CooldownTime` | クールダウン時刻(HDD 降格) |
| `DataSize` | パーティションデータ量(KB/MB/GB 自動フォーマット) |

### 操作

| ボタン | 動作 |
|---|---|
| `+ パーティション追加` | ダイアログで `ADD PARTITION ...` 句を入力、自動で `ALTER TABLE <db>.<tbl>` プレフィックス組み立て |
| 各行 `DROP` | 二重確認後 `ALTER TABLE <db>.<tbl> DROP PARTITION <name>` |
| `🔄 更新` | SHOW PARTITIONS を再実行 |

---

## 9. ダイアレクト専用の高度な機能

### 9.1 MysqlAdvancedDialog

MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks に適合。3 タブ:

| Tab | 使う SQL |
|---|---|
| **Binlog** | `SHOW MASTER STATUS` + `SHOW BINARY LOGS` + ファイル選択後 `SHOW BINLOG EVENTS IN '<file>' LIMIT N` |
| **マスタースレーブ状態** | 優先 `SHOW REPLICA STATUS`(8.0+)、失敗時 `SHOW SLAVE STATUS`(MariaDB / 旧版)にフォールバック |
| **変数 / ステータス** | `SHOW GLOBAL VARIABLES` / `SHOW GLOBAL STATUS`、フィルタ付き;Variables はさらに `SET GLOBAL k = v` で実行時パラメータ変更可能 |

### 9.2 PgAdvancedDialog

PostgreSQL / KingbaseES / openGauss / Greenplum / CockroachDB / Redshift に適合。3 タブ:

| Tab | データソース |
|---|---|
| **Extensions** | `pg_available_extensions`;ワンクリック `CREATE EXTENSION IF NOT EXISTS "<name>" WITH SCHEMA "<schema>"` / `DROP EXTENSION` |
| **Publications / Subscriptions** | `pg_publication` + `pg_publication_tables` + `pg_subscription`(論理レプリケーション管理) |
| **Slots** | `pg_replication_slots`(slot_name / plugin / slot_type / active / restart_lsn / confirmed_flush_lsn / wal_status);`DROP_REPLICATION_SLOT` 可能 |

### 9.3 ClickHouseAdvancedDialog

4 タブ、すべて `system.*` 読み取り、読み取り専用が主:

| Tab | データソース | 用途 |
|---|---|---|
| **パーティション** | `system.parts`(active フィルタ) | `rows / bytes_on_disk / data_compressed_bytes / marks / min_date / max_date / level` 確認;`DROP / DETACH / ATTACH PARTITION` サポート |
| **Mutation** | `system.mutations` | `is_done / command / parts_to_do / latest_failed_part / latest_fail_reason` 確認 |
| **レプリカ** | `system.replicas` | `is_leader / queue_size / inserts_in_queue / merges_in_queue / total_replicas / active_replicas / zookeeper_path` 確認 |
| **テーブル metadata** | `system.tables` | `engine / total_rows / total_bytes / partition_key / sorting_key / primary_key / sampling_key / storage_policy` 確認 |

各タブ上部に `database / table` フィルタ欄、大クラスター必携。

---

## 10. Oracle → DM 達夢(中国産 DB)マイグレーションウィザード

信創外注の高頻度シーン:顧客の Oracle DB を達夢にまるごと移行。`⌘K → Oracle → DM マイグレーション` でウィザードを開く。

### 5 ステップフロー

| ステップ | 動作 |
|---|---|
| 1. **接続選択** | 設定済み接続から `dialect == Oracle` / `dialect == DM` をフィルタ、左右各 1 つ選択 |
| 2. **オブジェクト選択** | ソース DB の `tables / views / sequences / procedures` 4 グループを取得、デフォルト全選択、グループ / 個別チェック可 |
| 3. **プレビュー** | 各オブジェクトに `DBMS_METADATA.GET_DDL` でソース DDL 取得 → `translateDdl()` で翻訳 → warnings 表示 + 編集許可 |
| 4. **実行** | オブジェクト別に `client.connections.execute(dstConnId, ddl)`、エラー収集して中断しない |
| 5. **レポート** | Markdown で成否 + warnings をまとめ、コピー / saveText 落地可能 |

### 翻訳ルール(`oracleToDm.ts`)

**型マッピング**(`TYPE_MAP`):

| Oracle | DM | 備考 |
|---|---|---|
| `VARCHAR2` | `VARCHAR` | — |
| `NVARCHAR2` | `NVARCHAR` | — |
| `NUMBER` | `NUMERIC` | DM も NUMBER を認識するが、NUMERIC がより標準 |
| `CLOB` / `NCLOB` / `BLOB` | 同名保持 | — |
| `DATE` | `DATE` | ⚠ Oracle は時分秒含む、DM は含まない |
| `TIMESTAMP` | `TIMESTAMP` | — |
| `RAW` / `LONG RAW` | `VARBINARY` | — |
| `LONG` | `CLOB` | Oracle で廃止済み |
| `BINARY_FLOAT` / `BINARY_DOUBLE` | `FLOAT` / `DOUBLE` | — |
| `ROWID` / `UROWID` | `VARCHAR(18)` / `VARCHAR(4000)` | DM 等価なし、ダウングレード |
| `XMLTYPE` | `XML` | XPath/XQuery 式は書き直し必要かも |

**型置換実装**:「長キー優先」ソートでマッチ(`LONG RAW` を `LONG` より前にして横取り回避)、裸 `NUMBER` 長さなしは補完しない、`NUMBER(p,s)` は数字をそのまま、ヒット後に対応 `TYPE_NOTES` 警告を追加。

**関数 / キーワードマッピング**(`FN_MAP`):

| Oracle | DM | 備考 |
|---|---|---|
| `SYSDATE` / `SYSTIMESTAMP` | `CURRENT_TIMESTAMP` | DM も SYSDATE を受け入れる、標準関数がより安定 |
| `NVL(a, b)` | `COALESCE(a, b)` | DM は NVL 互換、COALESCE がよりクロス DB |
| `NVL2(...)` | 保持 | 非対応なら `CASE WHEN expr IS NOT NULL THEN a ELSE b END` |
| `MINUS` | `EXCEPT` | DM は MINUS 互換、EXCEPT がより標準 |
| `DUAL` / `ROWNUM` | 同名保持 | DM サポート |

**複雑構文警告**(`HARD_WARNINGS`、SQL は触らず `[review]` 警告のみ):

| パターン | 警告内容 |
|---|---|
| `DECODE(...)` | 引き続き使用可だが、可読性のため `CASE WHEN` への変更を推奨 |
| `CONNECT BY` | ほとんど互換;`NOCYCLE` / `SYS_CONNECT_BY_PATH` 等の高度機能は逐文確認必要 |
| `MERGE INTO` | 複雑分岐(`DELETE WHERE` / 複数ソース `UPDATE` 含む)挙動が一致しない可能性 |
| `INSTEAD OF (INSERT/UPDATE/DELETE) TRIGGER` | DM トリガーセマンティクスに差異、トリガー本体は手動移行 |
| `SDO_GEOMETRY` / `MDSYS.*` | Oracle Spatial 等価なし、DMGeo またはサードパーティ必要 |
| `DBMS_*` | 一部のみ模擬(`DBMS_OUTPUT`/`DBMS_LOB`)、業務パッケージは書き直し必要 |
| `UTL_*`(`UTL_HTTP`/`UTL_FILE` 等) | 一般非対応、外部スクリプト代替必要 |
| `INTERVAL YEAR/DAY TO ...` | 一部バージョンは簡易形式のみ、バージョン確認必要 |
| `PIVOT(...)` / `UNPIVOT(...)` | DM 8.x から部分対応、旧バージョンは `CASE WHEN` 集約への書き換え必要 |
| `BULK COLLECT` / `FORALL` | PL/SQL バッチ操作、DMSQL 構文に差異 |

### 意図的にしないこと

- **PL/SQL ブロックセマンティクス翻訳しない** — ストアドプロシージャは CREATE シェルのみ移行、関数本体は手動
- **トリガー内容翻訳しない** — 同上
- **制約依存ソートしない** — 辞書順、失敗時はユーザー再実行
- **トランザクション原子性しない** — 各オブジェクト独立、失敗は赤マーク

### データマイグレーション(実験的)

Step 4 で「データマイグレーションを含む(各テーブル先頭 100 行サンプル)」をチェック:

```sql
-- ソース
SELECT * FROM "<table>"  -- 100 行制限

-- ターゲット
INSERT INTO "<table>" (col1, col2, ...) VALUES (v1, v2, ...)  -- 1 行ずつ
```

**骨格のみ** — 完全マイグレーションにはページング + 型変換 + バッチ挿入が必要、本ウィザードでは後続作業。本番環境の全量データマイグレーションは DTS / `expdp + impdp` 等の専門ツールを推奨。

### レポート

実行完了で Step 5 へ、Markdown レポート例:

```markdown
# Oracle → DM マイグレーションレポート

- ソース接続: `prod-oracle`
- ターゲット接続: `dm-test`
- 時刻: 2026-05-30 10:23:11
- 総オブジェクト数: 142、成功 138、失敗 4

## 成功オブジェクト
- [tables] ORDERS (124ms)
- [tables] USERS (89ms)
...

## 失敗オブジェクト
- [procedures] CALC_BONUS
  - エラー: ORA-00942 テーブルまたはビューが存在しません

## 翻訳警告(人手 review)
- (ORDERS) [type] DATE: Oracle DATE は時分秒含む、DM DATE は含まない;元列が時間成分依存なら TIMESTAMP へ変更
- (ORDERS_REPORT) [review] PIVOT/UNPIVOT:DM 8.x から部分対応、旧バージョンは CASE WHEN 集約への書き換え必要
```

`コピー` でクリップボードへ、または `保存` で `.md` ファイルにアーカイブ。

---

## 11. いつどれを使うか?

最後に「症状別の処方箋」表:

| やりたいこと | 使うツール |
|---|---|
| あるスロー SQL がどこで詰まっているか確認 | **PlanPanel** + ANALYZE |
| どのインデックスを作るべきか分からない | **IndexRecommender** |
| 新たに引き継いだテーブルのヘルス確認 | **DataInspector** 全テーブルプロファイル + 型最適化 |
| 汚いデータ / 重複行をクリーンアップ | **DataFixup** |
| ある値がどこに出現するか調査 | **SearchValueDialog** |
| 1 行の変更履歴を確認 | **RowHistoryDialog** |
| 非技術系同僚にクエリ構築を見せる | **VisualQueryDialog** |
| Doris パーティション管理 | **MppPartitionDialog** |
| MySQL binlog / マスタースレーブ遅延確認 | **MysqlAdvancedDialog** |
| PG 拡張インストール / 論理レプリ設定 | **PgAdvancedDialog** |
| CH part / Mutation 状態確認 | **ClickHouseAdvancedDialog** |
| Oracle DB を達夢へ移行 | **OracleToDmWizard** |

これらの機能を [AI アシスタント](./ai) と組み合わせれば威力倍増 — PlanPanel で遅いノードを見つけたら直接「AI に質問」、IndexRecommender の候補が分かりづらいなら AI に解説、DataInspector の型提案を AI にリスク評価してもらう、など。
