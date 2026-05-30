# 構造管理

データベースは「データを入れる」面だけではなく、テーブルを描き、変更し、突き合わせ、移行することの方が多いものです。SkylerX は構造関連の機能を DB / テーブル / Schema 向けのツール群にまとめ、読み取り専用の閲覧から 2 DB 間の整合まで一気通貫で提供します。

本ページは軽い順に紹介します:**閲覧 → 設計 → 編集 → リレーション図 → スナップショット → DB 間比較 → ドリフト → DB / Schema 作成 → AI 補助**。

## 概要

| ツール | トリガー | 目的 | SQL 生成 | 直接 DB に反映 |
|---|---|---|---|---|
| テーブル構造(TableStructure) | 左ツリー:テーブルノード → デフォルトでダブルクリック | カラム / インデックス / キー / DDL を読み取り専用で確認 | — | 否 |
| テーブル設計器(TableDesigner) | ツリー右クリック → テーブル作成 / 設計 | 可視化建表 + diff-aware ALTER | ✓(プレビュー) | ✓(確認後) |
| DDL エディタ(DdlEditor) | ツリー右クリック → ビュー、関数、プロシージャ、トリガーを作成 / 編集 | オブジェクト DDL を直接書く / 修正 | ✓(エディタ) | ✓ |
| ER 図(ErdView) | ツリー右クリック schema → ER 図 | DB 全体可視化 + ドラッグでテーブル作成 / FK 追加 | ✓(.sql エクスポート) | ✓(DB に適用) |
| 構造スナップショット(SchemaSnapshots) | コマンドパレット `act:snapshots:{connId}` | 現在の全テーブル DDL を localStorage に保存、後日比較 | — | 否 |
| 構造比較(SchemaDiff) | コマンドパレット `act:schema-diff` | 2 接続 schema の横断比較 + 整合マイグレーションスクリプト生成 | ✓(クエリとしてワンクリックで開く) | 否 |
| 構造ドリフト(SchemaDrift) | コマンドパレット `act:drift` | 同ダイアレクト 2 接続の深度ドリフト検出(カラム / インデックス / FK) | ✓(整合スクリプト) | ✓(確認後) |
| 新規データベース(NewDatabase) | ツリー右クリック接続ノード → 新規データベース | ダイアレクトに応じた `CREATE DATABASE` 生成 | ✓(プレビュー編集可) | ✓ |
| 新規 Schema(NewSchema) | ツリー右クリック DB ノード → 新規 Schema | PG / SQL Server / Oracle など | ✓ | ✓ |
| AI テーブル設計(SchemaArchitect) | コマンドパレット → AI テーブル設計アシスタント | 業務記述 → 複数テーブル DDL | ✓ | ✓ |
| AI 逆推論(SchemaReverse) | コマンドパレット → AI リバース推論 | サンプルデータ → CREATE TABLE | ✓ | ✓ |

以下、項目ごとに展開します。

## 1. テーブル構造閲覧(TableStructure)

最もシンプルな「このテーブルがどう見えるか確認」、ツリーでテーブルノードをクリックすると読み取り専用 tab が開きます。ソースは `packages/ui/src/components/TableStructure.vue`。

UI は 4 タブ、タブの末尾に件数を表示:

- **カラム** — カラム名 / 型 / NULL 可否 / 主キー / デフォルト値 / コメント
- **インデックス** — インデックス名リスト(名前のみ、詳細列は設計器で確認)
- **キー** — 主キー / 外部キー / ユニークキー名
- **DDL** — テーブルの `CREATE TABLE` 全文

DDL タブの取得戦略はダイアレクトによって異なります:

```ts
if (isMysql) {
  // MySQL 系は SHOW CREATE TABLE が最も権威ある
  const r = await client.connections.execute(connId, `SHOW CREATE TABLE ${ref}`)
  // row['Create Table'] を取得
}
// 非 MySQL: buildCreateFromColumns(...) でカラム情報から簡易 DDL を再構築
```

つまり **MySQL / MariaDB / OceanBase** で見える DDL は DB からの原文出力、PostgreSQL / Oracle / SQL Server などはカラム情報から組み立てた近似版で、実用には十分ですが GENERATED / EXTENDS のような複雑構文は含まれません。

右上の更新ボタン `⟳` で再取得(`Promise.all([meta('columns'), meta('indexes'), meta('keys')])`)、テーブル変更後の確認に便利です。

## 2. 可視化テーブル設計器(TableDesigner)

`packages/ui/src/components/TableDesigner.vue`、**880 行**、構造管理の主力。2 つの mode:

- `mode: 'create'` — テーブル新規作成(空白から)
- `mode: 'alter'` — テーブル変更(既存カラム構造 + インデックス + 外部キーから読み込み)

### 上部バー

| ボタン | 動作 |
|---|---|
| 新規作成 / リセット | `resetTable()` で空テーブル状態にリセット |
| 保存 | 作成モード → `CREATE TABLE`;変更モード → `ALTER TABLE` diff シーケンス |
| 名前を付けて保存 | `prompt` で新テーブル名 → 現在のカラム構造で `CREATE TABLE`(「構造をコピー」相当) |
| ➕ フィールド / フィールド挿入 / フィールド削除 / 主キー / ⬆⬇ | columns 配列を直接 splice |
| テーブル名入力欄 | alter モードでは読み取り専用(リネームは RENAME 経由、本設計器の範囲外) |

### 内部タブ(ダイアレクト別表示)

`INNER` 配列が 10 個の固定タブを定義:`fields / indexes / fk / unique / check / trigger / options / storage / comment / sql`。各タブは reactive な子フォームで、変更は即座に SQL プレビューに反映されます。

**フィールドテーブル**(インライン編集):

| 列 | 編集方法 |
|---|---|
| フィールド名 | 通常 input |
| 型 | input + datalist(`type-list`)、ダイアレクト別の候補(`typeOptions(dialect)`) |
| 長さ / 精度 | 数値 input |
| NULL / PK | チェックボックス |
| デフォルト値 / コメント | input |

選択行の下に「フィールド属性」エリアがあり、MySQL 系のみ `UNSIGNED / ZEROFILL / AUTO_INCREMENT / ON UPDATE CURRENT_TIMESTAMP / CHARSET / COLLATION` を表示、全ダイアレクトで `GENERATED` 式を表示。

**インデックス**の種類ドロップダウンはダイアレクト別:MySQL 系 `BTREE / HASH / FULLTEXT / SPATIAL`、PG 系 `btree / hash / gin / gist`。PG はさらに `WHERE`(部分インデックス)と `CONC`(`CREATE INDEX CONCURRENTLY`、テーブル変更時にロックしない)の 2 列を追加。

**外部キー**も同様にダイアレクト別:`ON DELETE / ON UPDATE` の候補は `CASCADE / SET NULL / RESTRICT / NO ACTION` 固定、PG は `MATCH FULL/PARTIAL/SIMPLE` と `DEFERRABLE` を追加。

**オプション**タブ:

- MySQL 系:Engine / Charset / Collation / Row Format(`DYNAMIC / COMPRESSED / COMPACT / REDUNDANT`)/ Auto-increment 開始値
- PG 系:`TABLESPACE / FILLFACTOR / INHERITS`
- その他:空欄ヒント

### diff-aware ALTER(alter モードのコア)

alter モード突入時に `loadExisting()` が `client.connections.metadata` でカラム情報を `ColumnDef[]` にマッピング、さらに `loadIndexes()` / `loadForeignKeys()` で `information_schema` から既存のインデックス・外部キーを取得、**一式を `original.value / originalIndexes.value / originalForeignKeys.value` のスナップショットとして保存**し diff の基線にします。

その後 `alterStmts` は `computed(() => buildAlterTable(dialect, tableRef, original.value, spec, { indexes: originalIndexes.value, foreignKeys: originalForeignKeys.value }))`。

`buildAlterTable` は元 vs 現在のフィールドレベル diff:

- カラム名変更(かつ `originalName` 存在)→ `ALTER TABLE ... RENAME COLUMN / CHANGE COLUMN`
- 行削除 → `DROP COLUMN`
- 新規行 → `ADD COLUMN`
- 型 / NULL / デフォルト / コメント変更 → `MODIFY COLUMN`(MySQL)または `ALTER COLUMN`(PG/MSSQL)
- インデックス / FK を `originalIndexes.value` と比較 → 増減

SQL プレビュータブ(`inner === 'sql'`)は生成された ALTER リストを表示、何も変更がない場合は `designer.noChanges` プレースホルダ。**保存**で各 ALTER を個別に `client.connections.execute`、いずれか失敗するとそこで停止しフォーカスを SQL タブに切り替え、成功済みのものはロールバックしません(変更シーン一般に許容、失敗情報はエラーバーに表示)。

### dirty チェック + 作成後 alter への切替

dirty チェックは `JSON.stringify({ tableName, spec })` と基線の比較で、tab を閉じる時に親コンポーネントが `isDirty()` を呼び「未保存」プロンプトを出すか決定。保存成功 / リセット後は基線が同期、新規 tab を開いた直後に誤判定で dirty 扱いされることはありません。

新規保存成功後、コンポーネントは自身で `runtimeMode` を `alter` に切替え、CREATE したばかりのカラムを `originalName` 付きでマーク、以降の保存は ALTER diff を経由。効果:保存を押すとテーブルが作られ、tab は閉じず・遷移せず、フィールド追加・型変更を続けられる — 「作りながら考える」ワークフロー向けの最適化です。

## 3. DDL エディタ(ビュー / 関数 / プロシージャ / トリガー)

`packages/ui/src/components/DdlEditor.vue`。設計器以外の schema オブジェクトは SQL テキストで直接書く、本コンポーネントはダイアレクト識別付きの Monaco ラッパー。

- **mode: 'create'** — `objectTemplate(dialect, kind, ctx)` で最小骨格を与える(例:`CREATE VIEW v AS SELECT 1;`)
- **mode: 'edit'** — `objectDdlQuery(dialect, kind, ref, node)` で既存定義を取得

`objectDdlQuery` は 3 種類の mode のいずれかを返す:

| mode | 適用 | 取得方法 |
|---|---|---|
| `showCreate` | MySQL 系 | `SHOW CREATE VIEW / PROCEDURE / FUNCTION / TRIGGER`、row 内の `^create` で始まるフィールドから取得 |
| `viewdef` | PG ビュー | `pg_get_viewdef(...)`、本コンポーネントが `prefix` を組み立て(`CREATE OR REPLACE VIEW ... AS\n`) |
| `funcdef` / `oracle-ddl` | PG 関数 / Oracle DBMS_METADATA | `row.ddl` を直接読む |

ツールバー:

- **保存 / 実行**(mode により文言が変わる)— 全文を 1 ステートメントとして実行(関数 / プロシージャ本体に分号があり、分号で分割できない)
- **フォーマット** — `sql-formatter` がダイアレクト別:`mysql` 系 → mysql、`pg` 系 → postgresql、`sqlserver` → transactsql、`oracle/dm` → plsql。解析失敗時は原文維持で入力を妨げない
- **キャンセル** — 直接 tab を閉じる

エラーバーはバックエンドの生エラーを表示、トリガー / ストアドプロシージャは一般に分号 / DELIMITER の書き方の問題です。

## 4. ER 図(ErdView)

`packages/ui/src/components/ErdView.vue`、SVG 手書きキャンバス。開き方:ツリーの DB / Schema ノードを右クリック → ER 図、`kind: 'erd'` の tab が新規に開きます。

### 表示モード(デフォルト)

- 全テーブルを取得(`loadErd`、内部で `information_schema` / `pg_constraint` などを使用)→ 自動グリッドレイアウト
- マウスホイール = ズーム、空白部をドラッグ = パン
- テーブル枠を個別に任意位置にドラッグ可(負の座標も可、canvas は切り詰めない)
- 上部:`－ / + / 1:1 / ⟳ / 編集` のズームと更新

### 編集モード(「編集」クリックで開く)

3 種類の修正を同時に行い、提出時に一括実行できます:

1. **テーブル新規作成** — `addTable()` で枠を表示、カラム追加・型変更・主キー指定が可能
2. **外部キー新規作成** — 任意カラム右側のポートを押下 → 別テーブルのカラムにドラッグして離す → `newFks.push(...)`、視覚的には紫色の点線
3. **ALTER でカラム追加**(D1)— 既存テーブルの「+ ALTER カラム追加...」ボタン → 2 つの prompt(カラム名 / 型)→ `alterAddCols[tableName]` に入る、枠内では紫色ハイライトで `+` プレフィックス表示

### 成果物

`generateDdl()` は `client.files.saveText` を呼び、`.sql` ファイルを生成:

```sql
CREATE TABLE "t1" (
  "id" int,
  ...
);

ALTER TABLE "orders" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "users" ADD COLUMN "phone" varchar(64);
```

`applyChanges()` は `buildDdl(true)`(新規追加部分のみ)を `;\n` で分割、`executeBatch` で現在の接続に一括投下、成功後 `load()` で再取得 → 表示モードに戻る。失敗時は alert を表示、ユーザーの構造は変更されない。

## 5. 構造スナップショット(SchemaSnapshotsDialog)

`packages/ui/src/components/SchemaSnapshotsDialog.vue`。コマンドパレット `act:snapshots:{connId}` でトリガー。

位置付け:**同一接続の異なる時点**の DDL 比較。後述の SchemaDiff(2 接続)、SchemaDrift(深度ドリフト)とは重複しません。

### スナップショット取得

「📸 スナップショット取得」をクリック → 最初の database/schema 配下の全テーブル DDL を取得。MySQL は `SHOW CREATE TABLE`、PG は簡易 DDL(カラム + 型 + NULL + DEFAULT)を組み立て。終了後 prompt でコメント記入(「リリース前 / 注文システム改修後 / ...」)、`localStorage['skylerx.schema-snapshots']` に保存、各接続あたり最大 `MAX_PER_CONN = 20` 件、超過時は LRU で最古を淘汰。

### 比較

リストから 2 件をチェック(2 件を超えると最古が自動で押し出される)→ 「⟷ 比較」。アルゴリズムは単純:

- A のみ → `added`(緑)
- B のみ → `removed`(赤)
- 両方にあるが内容が異なる → `changed`(黄)
- 完全一致 → `same`(デフォルト非表示)

diff 行をクリック → 右側に 2 カラム DDL、目視比較可能。

> 制限:最初の database/schema のみ確認、複数 DB の場合は個別にスナップショット取得が必要。`localStorage` への保存は、SQLite マイグレーションをこの「ログ型」データで汚したくないため。5MB クォータで通常数十テーブル × 20 スナップショットには十分。

## 6. 構造比較(SchemaDiffDialog)— 2 接続比較 + 整合 SQL

`packages/ui/src/components/SchemaDiffDialog.vue`。コマンドパレット `act:schema-diff` でトリガー。

### トリガー条件

- ソース接続 + ソース schema、ターゲット接続 + ターゲット schema を選択
- **同ファミリー**(MySQL ↔ MySQL / PG ↔ PG)であること、ファミリー横断では SQL 構文が合わず、UI に「MySQL ↔ MySQL / PG ↔ PG のみサポート」と表示

接続切替後 `onPickSrc / onPickTgt` がデフォルト schema を自動入力:PG → `public`、MySQL → 接続設定の `database`。

### 取得 + 比較

両側で並行に 1 本の `information_schema.COLUMNS` クエリ(`TABLE_NAME / COLUMN_NAME / 型 / NULL 可否 / 主キー / デフォルト値`)を実行、`TableSnapshot[]` を取得 → `diffSchemas` が 3 種を出力:`added / changed / removed`。各 changed 行はさらに列レベル `columnChanges`(`add / drop / modify`)を持つ。

### 成果物

`generateMigration` がターゲットダイアレクトに合わせて整合 SQL を出力、先頭にサマリー(新規 N 件、変更 N 件、削除 N 件)。下に 2 つのボタン:

- **コピー** — クリップボードに書き込み
- **ターゲット接続のクエリで開く** — `emit('openSql', tgtId, migration)`、Workspace が新しい query tab を開き SQL を流し込み、確認してから Run。このステップで **自動で DB に反映されないことを保証**。

## 7. 構造ドリフト検出(SchemaDriftDialog)

`packages/ui/src/components/SchemaDriftDialog.vue`、**925 行**、SchemaDiff より一段深い。コマンドパレット `act:drift`。

違い:SchemaDiff はカラムのみ確認、DriftDialog は**インデックス**と**外部キー**も確認、生成された整合スクリプトは **SkylerX 内から直接実行可能**。

### TableProfile

各テーブルを `TableProfile` に正規化:`columns: Map<name, {type, nullable, default, pk}>` + `indexes: Map<name, {unique, columns[]}>` + `fks: Map<name, "(c1,c2) → other(c1,c2)">`、加えて目視比較用の元 DDL も保持。

取得元はダイアレクト別:MySQL は `SHOW CREATE TABLE` + `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE`、PG は `information_schema.columns` + `pg_indexes`(`indexdef` テキストから正規表現で unique とカラム名を抽出)+ `information_schema.constraint_column_usage`。

### レポート

3 カラム:**ソースのみ / ターゲットのみ / 内容差**。3 つ目のカラムは各テーブルを展開して列変化(`+ name / − name / ~ name`)、インデックス変化(`+ idx_x`)、FK 変化(`~ fk_x`)を表示。行をクリックで下の 2 カラム DDL diff を展開可能。

### 整合スクリプト(重要な成果物)

各行に「+ 整合」ボタン、そのテーブルの修復 SQL を下のスクリプトプレビュー枠に**追加**:

| 状態 | 生成される文 |
|---|---|
| ソースのみ | ソース DDL をそのままコピー(`CREATE TABLE`) |
| ターゲットのみ | `-- DROP TABLE \`x\`; -- コメントアウト、人手でアンコメント必要` |
| 列 add | `ALTER TABLE \`t\` ADD COLUMN \`c\` {srcType};` |
| 列 drop | コメントアウト `-- ALTER TABLE ... DROP COLUMN ...`(誤削除防止) |
| 列 modify | MySQL:`MODIFY COLUMN`;PG:`ALTER COLUMN ... TYPE` |
| インデックス / FK 差分 | `-- INDEX +xx` / `-- FK -xx` でコメントヒントのみ、**自動生成しない**(インデックス再構築構文が複雑、人手対応) |

実行フロー:`▶ スクリプト実行` で高リスク確認 → `;\s*\n` で分割、`--` コメント行はスキップ → `executeBatch`。

> 設計上のトレードオフ:テーブル削除 / 列削除はデフォルトでコメントアウト、列追加 / 型変更は即実行可能。「破壊的なものはコメント、補修的なものは実行可」、運用シーンで事故りにくい。

## 8. 新規データベース(NewDatabaseDialog)

`packages/ui/src/components/NewDatabaseDialog.vue`。ツリー右クリック接続ノード → 新規データベース。

ダイアログ:**名前(必須)** + 折りたたみの「詳細オプション」(文字セット / 照合順序 / コメント)+ **SQL プレビュー(編集可)**。最終的に実行されるのはプレビュー枠のテキスト、フォームではない — プレビュー後に手動で `IF NOT EXISTS` 等を追加できる。

### ダイアレクトマトリックス

| ダイアレクト | サポート | 備考 |
|---|---|---|
| MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks | ✓ | `CREATE DATABASE \`n\` [DEFAULT CHARACTER SET ...] [DEFAULT COLLATE ...]`(COMMENT なし) |
| PostgreSQL / KingbaseES / openGauss / Greenplum / CockroachDB / Redshift | ✓ | `CREATE DATABASE "n" [ENCODING '...']` + 独立 `COMMENT ON DATABASE` |
| SQL Server | ✓ | `CREATE DATABASE [n]`(文字セットなし) |
| ClickHouse | ✓ | `CREATE DATABASE \`n\` COMMENT '...'` |
| Snowflake | ✓ | `CREATE DATABASE "n" COMMENT = '...'` |
| TDengine 涛思(中国産時系列 DB) | ✓ | `CREATE DATABASE n`(クォートなし) |
| **Oracle / DM 達夢(中国産 DB)** | ✗ | データベース = インスタンスレベル、DBCA が必要。「通常は schema(ユーザー)を新規作成すべき」と提示 |
| SQLite / DuckDB | ✗ | ファイル型、データベース = ファイル、新規接続でファイルパス選択して「作成」 |
| H2 | ✗ | 起動パラメータで決定、リアルタイム SQL 作成不可 |
| MongoDB / Redis / Elasticsearch | ✗ | collection / index / db0-15 等のメカニズム経由、CREATE DATABASE を使わない |

未サポートのダイアレクトは UI 上に赤い注意書きが表示され、提出不可。

### 文字セットオプション

ダイアレクト別推奨:

- MySQL 系:`utf8mb4 / utf8 / latin1 / gbk`、collation `utf8mb4_general_ci / unicode_ci / 0900_ai_ci / bin`
- PG 系:`UTF8 / SQL_ASCII / LATIN1 / GBK`

提出時に `;\s*\n` でステートメント分割、順次 `execute`。

## 9. 新規 Schema(NewSchemaDialog、Oracle 特殊処理)

`packages/ui/src/components/NewSchemaDialog.vue`。ツリー右クリック DB ノード → 新規 Schema。

### ダイアレクトマトリックス

| supportInfo | ダイアレクト | 構文 |
|---|---|---|
| `pg` | PostgreSQL / KingbaseES / openGauss / Greenplum / CockroachDB / Redshift | `CREATE SCHEMA "n" [AUTHORIZATION "owner"]` + オプション `COMMENT ON SCHEMA` |
| `sqlserver` | SQL Server | `CREATE SCHEMA [n] [AUTHORIZATION owner]` |
| `snowflake` | Snowflake | `CREATE SCHEMA "n" [COMMENT = '...']` |
| `oracle` | Oracle / DM 達夢(中国産 DB) | **Schema = User**、CREATE USER + GRANT 経由(下記参照) |
| `null` | MySQL / SQLite / ClickHouse / TDengine 涛思 / NoSQL | Schema 概念なし、「このダイアレクトに Schema 概念なし」と表示 |

### Oracle / DM の特殊処理

Oracle では "schema" は "user" の同義語、本ダイアログは開発シーン向けの合理的デフォルトを用意:

```sql
CREATE USER :name IDENTIFIED BY :password
  DEFAULT TABLESPACE USERS
  TEMPORARY TABLESPACE TEMP
  QUOTA UNLIMITED ON USERS;

GRANT CONNECT, RESOURCE, UNLIMITED TABLESPACE,
      CREATE VIEW, CREATE SYNONYM, CREATE SEQUENCE,
      CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE,
      CREATE MATERIALIZED VIEW, CREATE DATABASE LINK
   TO :name;
```

(プレースホルダ `:name` / `:password` は実際入力されるユーザー名 / パスワードを表す。)

このように書いた理由、コードコメントが率直に説明しています:

- `QUOTA UNLIMITED ON USERS` — 付けないと新ユーザーがデータ挿入の瞬間に `ORA-01950: insufficient quota on tablespace USERS`
- Oracle 12c+ では `RESOURCE` に `CREATE VIEW / SEQUENCE` 等が含まれず、開発常用権限を明示的に補う必要がある
- `SELECT ANY TABLE / DBA / SYSDBA` は付与しない — 「自分の schema だけ触れる」を維持
- ユーザー名 / パスワードはデフォルトで**クォートなし**:合法な unquoted 識別子は Oracle が自動的に大文字化(「ダブルクォート小文字 → 後続 ALTER USER で見つからない」を回避)。小文字や特殊文字を保持したい場合は自分で SQL プレビューにダブルクォートを追加

パスワードフィールドが空の場合はプレースホルダ `CHANGE_ME_123` を入れ、変更を促します。

### 提出

`execute` 時に `database` コンテキスト付き(PG 系の schema は DB に属するため、先に USE してから CREATE)。失敗時の toast エラー情報にも `askAi` リンクが付き、SQL + エラーをまとめて AI に投げて解説(Oracle のテーブルスペース不在 / 権限不足によくある)。

## 10. AI 補助:Schema Architect + Schema Reverse

2 つの対話式ツール、生成された SQL を最後にユーザーが審査してから実行。

### Schema Architect(業務記述 → 複数テーブル DDL)

`packages/ui/src/components/AiSchemaArchitectDialog.vue`。対話式、マルチターンで反復可能。

System Prompt の要旨:

> You are a senior database architect. The user describes a business domain.
> 1. Design **multiple related tables** with PK, FK, indexes for the **`{dialect}`** dialect.
> 2. Output a single ```sql code block containing the COMPLETE CREATE TABLE statements.
> 3. Explain key design decisions in 2-4 bullets.
> 4. When user asks to revise, output the FULL updated SQL again (not a diff).

ワークフロー:

1. 業務記述(「EC 注文システム作成:ユーザー、商品、注文、注文項目、クーポン対応」)
2. AI が Markdown を返す:設計説明 + 完全な SQL コードブロック
3. 対話で追問(「status フィールド追加」/「order_items をパーティションテーブルに」)、AI が**まるごと**新版 SQL を出力
4. 上部のボタン `▶ 最新版を実行` — `latestSql` を取得(最新アシスタント返信内の SQL ブロック)、`;\s*(?:\n|$)` で分割 → 順次 `execute`

`latestSql` は常に最新ターンを取得 — 5 回反復したら 5 回目の版を実行、初期版で汚染されません。

### Schema Reverse(サンプルデータ → CREATE TABLE)

`packages/ui/src/components/AiSchemaReverseDialog.vue`。シングルターン非対話式、「CSV があるので対応テーブルを作って」向け。

入力:**形式**(CSV / TSV / JSON)+ **テーブル名** + **サンプルデータ**(数行で十分、ヘッダー付きが最も正確)+ オプション「INSERT も生成」。

Prompt は 4 セクション出力を強制:**推論説明**(カラム名 → 型 → 理由)、**CREATE TABLE**(`sql` コードブロック)、**INSERT(データ)**(オプション、`sql` コードブロック)、**インデックス提案**(bullet list)。

AI 応答後、自動で `extractSql(text)` で最初の SQL コードブロックを抽出、下部編集枠に流し込み、修正後 `▶ 実行` をクリック可。

> インデックス推奨について:Schema Reverse の AI は「提案」のみ(経験ベース)、自動でインデックスを作成しない。実際の履歴 SQL + 既存インデックスベースの推奨 → [高度な機能 → インデックス推奨](./advanced.md) を参照。

## 互換性マトリックス

下表は各ツールがどのダイアレクトをサポートするかをまとめます。`▣` = 完全サポート、`◐` = 部分サポート、`-` = 適用外 / スキップ。

| ツール | MySQL 系 | PG 系 | SQL Server | Oracle / DM | SQLite | ClickHouse | NoSQL |
|---|---|---|---|---|---|---|---|
| TableStructure | ▣(`SHOW CREATE TABLE` 原文) | ◐(カラム再構築) | ◐(カラム再構築) | ◐(カラム再構築) | ◐ | ◐ | - |
| TableDesigner — CREATE | ▣ | ▣ | ▣ | ▣ | ◐(型 / オプション少なめ) | ◐ | - |
| TableDesigner — ALTER diff | ▣ | ▣ | ◐ | ◐ | ◐ | ◐ | - |
| DdlEditor | ▣(SHOW CREATE) | ▣(`pg_get_viewdef` / `funcdef`) | ◐ | ▣(DBMS_METADATA) | ◐ | ◐ | - |
| ErdView | ▣ | ▣ | ◐ | ◐ | ◐ | - | - |
| SchemaSnapshots | ▣ | ◐(簡易 DDL) | - | - | - | - | - |
| SchemaDiff | ▣ | ▣ | - | - | - | - | - |
| SchemaDrift | ▣ | ▣ | - | - | - | - | - |
| NewDatabase | ▣ | ▣ | ▣ | -(NewSchema へ) | -(ファイル型) | ▣ | -(専用コマンド) |
| NewSchema | -(概念なし) | ▣ | ▣ | ▣(=User) | - | - | - |
| AI Architect / Reverse | ▣ | ▣ | ▣ | ▣ | ▣ | ▣ | ◐ |

「MySQL 系」には MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks を含む。「PG 系」には PostgreSQL / KingbaseES / openGauss / Greenplum / CockroachDB / Redshift / H2(PG 互換) を含む。

## 一般的なワークフロー

**ゼロから業務 DB を構築**:
1. ツリー右クリック接続 → 新規データベース → SQL プレビュー確認 → 実行
2. コマンドパレット → AI テーブル設計アシスタント → 業務記述 → 完全 DDL を取得 → 新 DB で実行
3. ツリー右クリック schema → ER 図 → 関係確認 / 微調整
4. フィールド変更:ツリー右クリックテーブル → 設計(alter モード)→ 変更保存(ALTER diff 経由)

**DB 間の整合**:
1. コマンドパレット `act:schema-diff` → dev / prod の 2 接続を選択 → マイグレーション SQL 取得 → 「ターゲット接続のクエリで開く」 → 確認 → Run
2. prod が手動で変更された疑い:`act:drift` → baseline / prod を選択 → 3 カラムレポートを確認 → 修正対象テーブルで「+ 整合」 → スクリプトプレビュー審査 → 実行

**履歴レビュー**:
1. リリース前 `act:snapshots:{connId}` → スナップショット取得 → メモ「v2.0 リリース前」
2. 3 ヶ月後:スナップショットダイアログを開く → 「v2.0 リリース前」と現時点の新スナップショットをチェック → 比較 → 結局どのテーブルが変わったか確認

ここまでで構造層の機能は揃いました。実行時のクエリプラン、スローログ、インデックス推奨は [高度な機能](./advanced.md) を、ダイアレクト間マイグレーションツールは [データベースサポート](./databases.md) を参照してください。
