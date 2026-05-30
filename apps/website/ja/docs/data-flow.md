# データフロー:インポート / エクスポート / バックアップ / マイグレーション

SkylerX は「データが DB に入る / 出る」すべての経路を 1 組のダイアログに集約し、統一でカスタム `SaveFileDialog`(クロスプラットフォームで一貫、システムネイティブは呼ばない)とレンダラ側解析(CSV/JSON/Excel をすべてメモリ内で処理)を経由します。本章は「出口 → 入口 → バックアップ / 復元 → DB 間マイグレーション → データディクショナリ → データ比較」の順で整理します。

## 1. 概要:このセクションがカバーするもの

| シナリオ | エントリ | メインダイアログ / 関数 | 関連フォーマット |
|---|---|---|---|
| 1 行 / 数行を手軽にコピー | 結果グリッド右クリック → 「コピー形式」 | `ResultGrid.vue::copyRows` | CSV / TSV / JSON / Markdown / SQL VALUES |
| 1 テーブル / Schema 全体をダウンロード | NavTree 右クリック「SQL エクスポート」→ `ExportOptionsDialog` | `Workspace.vue::doTableExport` / `doSchemaExport` | SQL(CREATE + INSERT) |
| Workspace 全体を移行 | コマンドパレット `act:export-conns` / `WorkspaceExportDialog` | `WorkspaceExportDialog.vue` | `.skylerxws` JSON |
| CSV/JSON/Excel をテーブルに流し込む | NavTree 右クリック「データインポート」→ `ImportDialog` | `ImportDialog.vue` + `io.ts` | CSV / TXT / JSON / NDJSON / XLSX |
| Excel/Lark 表のクリップボードから直接貼り付け | メインエリアで ⌘V(または `PasteImportDialog`) | `PasteImportDialog.vue` | TSV / CSV |
| .ndjson ファイルを直接見る | コマンドパレット `act:ndjson-viewer` | `NdjsonViewerDialog.vue` | `.ndjson` / `.jsonl` |
| DB 全体バックアップ / 復元 | コマンドパレット `act:backup:<id>`(接続ごとに 1 つ) | `BackupRestoreDialog.vue` | `.sql` / `.ndjson` |
| 接続をまたいでテーブルをコピー | NavTree 右クリック「データ転送」 | `DataTransferDialog.vue` | 行単位 SELECT → バッチ INSERT |
| データディクショナリ生成 | NavTree 右クリック schema/db → 「データディクショナリ」 | `Workspace.vue::genDataDict` + `dump.ts` | Markdown / HTML |
| 2 テーブルのデータ差分比較 | コマンドパレット `act:data-diff` | `DataDiffDialog.vue` + `data-diff.ts` | 行レベル diff → 同期 SQL |

ファイル IO の機能は一律 `client.files`(メインプロセスが `openText / saveText / listDir / commonDirs / mkdir` を実装)を経由します。Web 版では `listDir` が利用不可、ブラウザのダウンロード / アップロードにフォールバック(テキスト形式のみ対応)。

## 2. エクスポート

### 2.1 結果セットの多フォーマットコピー

`ResultGrid.vue` でセル / 選択範囲を右クリックすると「コピー形式」サブメニューが表示されます:

| 項目 | 実装 | 用途 |
|---|---|---|
| CSV | `io.ts::toCSV` | Excel / Numbers に直接貼り付けて表を作成 |
| TSV | `io.ts::toTSV` | Excel / Notion / Lark 表(区切り文字 `\t`) |
| JSON | `io.ts::toJSON` | プログラムで `JSON.parse`、`Date` は自動 `toISOString()` |
| Markdown | `io.ts::toMarkdown` | ドキュメント / PR 説明への表貼り付け(`|` と改行をエスケープ) |
| SQL VALUES | `io.ts::toSqlValuesList` | `(1, 'a'), (2, 'b')` のような形、`INSERT...VALUES` / `VALUES (...) AS t` / `ON CONFLICT ... EXCLUDED` に貼り付け |
| SQL INSERT | `io.ts::toInsertSql` | 直接実行可能な `INSERT INTO tbl (...) VALUES (...)` 行ごとに 1 文 |

**型復元の詳細**(`io.ts` 実装):

- `null/undefined` → 空(CSV)/`NULL`(SQL)を出力
- `Date` → `toISOString()`
- `number` → 直接出力、`Infinity/NaN` は SQL で `NULL` にダウングレード
- `boolean` → SQL では `TRUE/FALSE`(SQLite はさらに `1/0` に翻訳)
- `object/array` → `JSON.stringify`、SQL ではシングルクォートで包む
- シングルクォート `'` は一律ダブルにエスケープ(`a'b` → `'a''b'`)、注入を防止

CSV セルは `"` / `,` / 改行を含む場合のみクォートを追加、TSV は `\t` / 改行 / `"` を含む場合のみ追加 — 無条件にクォートしないため、Excel に貼った時にセルがすっきりします。

### 2.2 ExportOptionsDialog — テーブル / Schema 全体エクスポート

NavTree でテーブルまたは schema(DB)を右クリック → 「SQL エクスポート」、最初に極シンプルな選択肢ダイアログ `ExportOptionsDialog` が表示されます:

- **構造のみ** → `withData = false`、`CREATE TABLE` のみ出力
- **構造 + データ** → `withData = true`、`SELECT * FROM ref` でデータ取得、`INSERT` リストを追加

`pick` を受けて `Workspace.vue` が `doTableExport` / `doSchemaExport` を実行:

1. `client.connections.metadata(... group: 'columns')` でカラム取得
2. `dump.ts::buildCreateFromColumns` がカラムメタデータから **CREATE TABLE を再構築**(v1 では主キーを含み、インデックスと外部キーは含まない — ダイアレクト横断のインデックス構文差異が大きいため、まず安定優先)
3. `withData` が true の場合、`SELECT * FROM ref`(ページングなし、大テーブルはバックアップ / マイグレーションを使用してください)
4. `buildTableDump` で組み立て:

   ```sql
   -- テーブル構造
   CREATE TABLE `users` (...);

   -- データ(N 行)
   INSERT INTO `users` (...) VALUES (...);
   ```

5. ファイル名はデフォルトで `<オブジェクト名>.sql`、拡張子は `.sql` 固定、`client.files.saveText` でカスタム `SaveFileDialog` でパスを選択

schema 全体エクスポートはすべての base table を反復、先頭に `-- ws.dumpHeader { label, n }` でメタ情報をマーキング。

### 2.3 Workspace 全量エクスポート(`.skylerxws`)

`WorkspaceExportDialog.vue` は「PC 乗り換え / 同僚と共有」の 2 シナリオを統合。ファイル構造:

```ts
interface WorkspaceFile {
  version: 1
  exportedAt: number
  source: string                  // 'SkylerX'
  connections?: ConnectionConfig[]
  snippets?: typeof snippets
}
```

エクスポートオプション(すべて個別チェック可):

| オプション | デフォルト | 説明 |
|---|---|---|
| 接続設定を含む | ✓ | `client.connections.list()` を使用、デフォルト**マスク**(パスワードなし) |
| ⚠ パスワードを含む | ✗ | チェックすると **1 件ずつ** `client.connections.get(id)` で平文取得。ファイルはマシン間で解読可能 — マシン間でシステム keychain に依存しなくなる代わり、ファイル自体が裸の平文、慎重に使用 |
| SQL Snippets を含む | ✓ | JSON 全体をコピー、ID 変更なし |

デフォルトファイル名 `skylerx-workspace-YYYY-MM-DD.skylerxws`、filter は `.skylerxws` と `.json` の両方を受け入れる。

インポート時に「接続 + Snippets」をカウント → 二重確認 → 衝突戦略でマージ:

- **skip**:同名スキップ(デフォルト)
- **overwrite**:同 `name` で dup.id を使い `update`、全フィールド上書き(ファイル内にあればパスワードも含む)
- **rename**:`name` 末尾に `(インポート)` 追加で新規作成

### 2.4 暗号化エクスポート `.sql.enc`(AES-256-GCM + PBKDF2)

`export-encrypt.ts` は純粋な関数 API を提供、UI 層はシナリオ別に呼ぶ(典型シナリオ:機密データを含む SQL dump を外部協業先に送るためのエクスポート)。アルゴリズム選定:

| 項目 | 値 | トレードオフ |
|---|---|---|
| ファイルヘッダーマジック | `SKYLERX-ENC-v1` | アルゴリズムアップグレード時のバージョン識別 |
| KDF | PBKDF2-HMAC-SHA-256 | ブラウザ/Node ともネイティブサポート、依存なし |
| 反復回数 | `DEFAULT_ITER = 200_000` | OWASP 2023 推奨 ≥ 600k、ここでは旧マシン体験との折衷、後で引き上げ可 |
| 暗号化 | AES-GCM | 128-bit 認証タグ内蔵、パスワード違い / 改ざんは `WRONG_PASSWORD` をスロー |
| 鍵長 | 256 bit | `deriveKey` が直接 AES-GCM 256 を生成 |
| Salt | 16 バイトランダム | 毎回再生成、再利用しない |
| IV | 16 バイトランダム | 毎回再生成、再利用しない |
| シリアライズ | 単一行 JSON | ストリーミング読み書きが容易、`.sql.enc` はテキストエディタで目視可能 |

ディスクフォーマット(単一行 JSON):

```json
{ "magic": "SKYLERX-ENC-v1", "salt": "<b64>", "iv": "<b64>", "iter": 200000, "data": "<b64-cipher+tag>" }
```

実装詳細:

- `globalThis.crypto.subtle` を使用、**サードパーティ依存なし**;旧 Node に subtle がない場合は直接エラーで実行時アップグレードを要求
- `Uint8Array` はすべて底層で `new ArrayBuffer(n)` でフォールバック、TS 5.7 + lib.dom が `BufferSource` を `ArrayBuffer` バックエンドに絞った後の型エラーを回避
- base64 エンコードは 32 KB チャンクに分割、`String.fromCharCode(...bytes)` で大ファイル時のスタックオーバーフローを回避
- 復号時に GCM 検証失敗を統一で `WRONG_PASSWORD` に翻訳、元の `OperationError` を**リークしない**、攻撃者へのサイドチャネルを回避

## 3. インポート

### 3.1 ImportDialog — CSV / JSON / NDJSON / Excel 全形式 3 ステップウィザード

NavTree でテーブル右クリック → 「データインポート」、`ImportDialog.vue` は固定 3 ステップウィザード(`step: 'pick' | 'map' | 'run'`):

#### Step 1 ファイル選択

- メインボタン「ファイル選択」→ `client.files.openText`、filter は `csv / txt / json`(JSON は `\.json$/i` か先頭文字 `[`/`{` の嗅ぎ取りで自動判別、`parseJSON` 経由)
- サブボタン「Excel…」→ レンダラ側の `<input type=file>` 経由、`ArrayBuffer` 読み込み後**動的ロード** `xlsx`(SheetJS)。最初の sheet のみ読み、`raw: false`(Excel 表示値を使用、日付が数値にならない)、`defval: ''`。Excel 経路はテキストチャネルを経由しない(バイナリ経由)ため、大サイズでも IPC で詰まらない
- 解析後、先頭 5 行をプレビュー、「先頭行ヘッダー」チェックボックスで手動切替可能

`io.ts::parseCSV` は手書きの状態機械:BOM 除去、`""` エスケープ、CRLF / LF、クォート内のカンマ・改行に対応。最後に単セルが空フィールド 1 つだけの「空行」をフィルタアウト。

`io.ts::parseJSON` は 3 形態に対応:

- **オブジェクト配列**:キー和集合がヘッダー(出現順)
- **配列の配列**:最初の行がヘッダー
- **単一オブジェクト**:1 行として処理

#### Step 2 フィールドマッピング + 型推論

`autoMap()` は「小文字後の正確一致」でソース / ターゲット列を自動マッピング。各列にドロップダウンで手動選択、「スキップ」= `-1`。

型推論 `inferType(srcIdx)` は **その列の先頭 50 個の非空値**をサンプリング、順次検査:

| 推論 | 正規表現 |
|---|---|
| `number` | `/^-?\d+(\.\d+)?$/` |
| `date` | `/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?Z?$/i` |
| `boolean` | `/^(true|false|t|f|y|n)$/i` |
| `string` | フォールバック |

空文字列が存在すれば `nullable` をマーク、UI 上で `·∅` のアイコン。**注意**:型推論はヒントのみ、実行時は文字列として挿入、本当の cast は DB エンジンが列定義に従って実施 — これによりダイアレクト差異を許容(MySQL `'2024-01-01'` を自動で DATE 扱い、SQLite は TEXT)。

#### Step 3 オプション + 実行

| オプション | デフォルト | 動作 |
|---|---|---|
| TRUNCATE してからインポート | ✗ | `INSERT` の前に `TRUNCATE TABLE <ref>` を挿入、チェック時は慎重、**ロールバック不可**(MySQL/PG の TRUNCATE は両方 DDL) |
| バッチ行数 | 200(min 1、max 2000) | `INSERT INTO t (...) VALUES (...), (...), ...` 1 ステートメントの行数を制御、長過ぎてドライバが切り詰めるのを回避 |

実行は `client.connections.executeBatch` 経由、ソース行の空文字列(`''`)は一律 `NULL` 扱い(`io.ts::buildInsertStatements` 内 `s == null || s === '' ? 'NULL' : ...`)、そのため **インポート時は「真の空文字列」と「値なし」を区別できない**。厳密区分が必要なら SQL エディタで手書きしてください。

### 3.2 PasteImportDialog — クリップボード直挿入

`PasteImportDialog.vue` は ImportDialog の軽量版:開いたら `navigator.clipboard.readText()`、ファイル選択不要。

| 入力 | 解析経路 |
|---|---|
| `\t` 含む | TSV(Excel / Lark 表のデフォルトコピー形式)で `\t` 分割 |
| `\t` なし | 手書き CSV 簡易解析(`""` エスケープ対応、ただし**複雑なネスト引用符は未処理** — 複雑な場合は ImportDialog へ) |

ターゲットテーブルの列は `information_schema.columns` からリアルタイム取得(MySQL / MariaDB / OB / TiDB / Doris / StarRocks は `table_schema + table_name`、PG / その他は `table_name + table_catalog`)。正規化後(`toLowerCase + _-空白を除去`)に自動マッチ、残りは手動選択、未選択 = スキップ。

実行バッチサイズは固定 `BATCH = 500`、各バッチ 1 つの `INSERT INTO ... VALUES (...), (...)` で連結;`sqlLiteral` は簡易処理:空文字列 → `NULL`、純数値はそのまま、その他はシングルクォート(`'` を倍にエスケープ)。**Redis / ドキュメント DB 等の非 SQL ダイアレクトは事前にフィルタ**(`dialectKind === DbKind.Sql` の接続のみリスト)。

適用シナリオ:Lark / Excel から数十〜数千行をコピーしてテーブルに直接貼り付け。それ以上の量は ImportDialog(`executeBatch` 経由)または DataTransferDialog(ページング経由)を使用してください。

## 4. NDJSON ブラウザ(`NdjsonViewerDialog`)

コマンドパレット `act:ndjson-viewer` → `.ndjson` / `.jsonl` ファイル選択 → テーブルとして閲覧、**DB 接続不要**。

解析ルール(`parse()`):

- 行ごとに分割、空行 / 解析失敗の行 → `skipped` カウントに計上(ブロックしない)
- dbgate Archives スタイルの `{ __table, data }` ラッパーを識別 → 行は `__table` テーブルに所属、データは `data`
- エラーマーク `{ __error: "..." }` を識別 → スキップカウント `skipped++`
- その他は通常の JSON 行扱い、`table = ''`

UI 特性:

- **テーブル横断 tab**:上部で出現済みの `__table` を tab として列挙、クリックでそのテーブルのみ表示
- **列和集合**:すべての表示行の `Object.keys` 和集合をヘッダーとして取得(各行のフィールドは揃わなくても可、欠落は `null` 表示)
- **行詳細**:行をダブルクリックで右側 / 下部に完全 JSON を展開
- **全文コピー / 別名保存**:ファイル全体をクリップボードにコピー、または `saveText` で別名保存(デフォルトで元ファイル名を継承)
- **読み取り専用 v1**:編集未対応、DB へのリインポート未対応、後続作業中

## 5. バックアップ / 復元(`BackupRestoreDialog`)

コマンドパレット `act:backup:<connId>` → `BackupRestoreDialog`。**MVP は純粋 SQL ルート**:外部 `mysqldump` / `pg_dump` を呼ばない(クロスプラットフォームパス検出が面倒、ユーザーマシンに必ずあるとは限らない);後続で DDL 完全(trigger / view / FK 順序)が必要なら IPC で `child_process.spawn` を上げる。

#### バックアップフォーマット

| フォーマット | 実装 | 特徴 |
|---|---|---|
| **SQL** | NavTree 右クリック「SQL エクスポート」に誘導(`doSchemaExport` を再利用) | 伝統経路、直接 `mysql/psql` クライアントが食える |
| **NDJSON** | 内蔵 `doBackupNdjson()` | dbgate Archives スタイル、接続間のインポート/エクスポートに便利 |

NDJSON バックアップフロー:

1. `metadata({ group: 'tables', path: [database] })` ですべての base table を取得
2. テーブルごとに `SELECT * FROM <sqlName>`、各行に `{"__table":"t","data":{...}}\n` を 1 件書き込み
3. 単一テーブル失敗で**中断しない**、`{"__table":"t","__error":"..."}` に切り替えて書き込む(復元時に確認可能)
4. `saveText` で `skylerx-<接続名>-<タイムスタンプ>.ndjson` に落とす、filter は `.ndjson / .jsonl` 両方受け入れ
5. 全行程でプログレスバー(`done / total · phase`)+ 「⏹ 停止」ボタン(`stopRequested` を各テーブル前にチェック)

既知の制限:`BLOB / Buffer` は `JSON.stringify` で `{ type: 'Buffer', data: [...] }` になり、**復元時にバイナリに戻らない**;厳密シナリオは SQL 経路を使用してください。

#### 復元フロー

| 経路 | フロー |
|---|---|
| SQL | `client.files.openText` → `splitStatements(content)` で `;` 分割 → 二重確認 → 順次 `execute`、**単一失敗で中断しない**、エラーは `restoreProgress.errors[]` に書き込み(各 200 文字に切り詰め) |
| NDJSON | `__table` 別にバケット → **各バケット 1 回の大 `INSERT`**、内部で `chunkSize = 100` 切り分け(`max_allowed_packet` を回避)→ 同様にエラー収集 |

UI 上にリアルタイムプログレスバー + エラーリスト(長過ぎる場合切り詰め + 折り返し)+ 完了後の `restoreOk / restoreWithErrors / restoreStopped` 3 状態 toast。

## 6. 接続間のデータマイグレーション(`DataTransferDialog`)

NavTree でテーブル右クリック → 「データ転送」。「バックアップ / 復元」より範囲が狭い:**単一テーブル対単一テーブル**、ソース側を選んだら開始、開発 → ステージング間のデータ転送に適合。

| 項目 | デフォルト | 説明 |
|---|---|---|
| ターゲット接続 | 現在の接続 | ドロップダウンに全接続、`(現在)` サフィックス付き |
| ターゲット database | ソース ctx | ダイアレクト別意味が異なる、PG は catalog、MySQL は DB |
| ターゲット schema | ソース ctx | PG/KB は必須(デフォルト `public`)、MySQL は空欄 |
| ターゲットテーブル名 | ソーステーブル名 | 存在しないと挿入失敗、自動でテーブル作成しない |
| バッチ行数 | 500 | ソース側 `SELECT ... LIMIT ? OFFSET ?` ページングサイズを制御 |
| 先にターゲットを TRUNCATE | ✗ | 実際に走るのは `DELETE FROM <ref>`(`TRUNCATE` ではない、トランザクションでロールバック可) |

実行ループ:

```ts
for (let page = 0; page < 100000; page++) {
  const res = await execute(srcId, `SELECT * FROM ${srcRef}`, [],
    { ..., limit: size, offset: page * size })
  if (!res.rows.length) break
  await executeBatch(tgtId, rowInserts(tgt.dialect, dstRef, cols, res.rows), dstOpts)
  if (res.rows.length < size) break    // 早期停止
}
```

- 最大ページ数 10w は無限ループのフォールバック
- カラム名はソーステーブルの `metadata` から取得、つまり **ターゲットテーブルに同名カラムが必要**(順序不問、`rowInserts` は明示的にカラムリスト)
- 型変換は JS → SQL literal(`io.ts::sqlLiteral`)+ ターゲット DB エンジンの暗黙 cast に委ねる。複雑型(Postgres `jsonb`、MySQL `BIT(1)`)はロスする可能性があり、移行後にサンプリングで spot-check してください。

## 7. データディクショナリエクスポート(Markdown / HTML)

NavTree で schema(または DB)右クリック → 「データディクショナリ → Markdown / HTML」。`Workspace.vue::genDataDict` が `dump.ts::buildDataDictMarkdown / buildDataDictHtml` を呼ぶ。

各テーブルを 1 セクション、フィールドテーブルの列は固定:

| フィールド | 型 | NULL 可 | 主キー | デフォルト | コメント |
|---|---|---|---|---|---|
| `id` | `bigint unsigned` | N | 🔑 | | ユーザー主キー |
| `email` | `varchar(255)` | Y | | `NULL` | メールアドレス |

データソース:`metadata({ group: 'columns' })` が返す `MetadataNode.detail.{dataType, nullable, primaryKey, defaultValue, comment}`。

#### Markdown と HTML の差異

| 観点 | Markdown | HTML |
|---|---|---|
| エスケープ | `|` → `\|`、改行 → 空白 | `&<>` 実体 |
| 目次 | なし(IDE アウトライン使用) | 3 段組 TOC、アンカーリンク `#t-<urlencoded>` |
| レイアウト | 純 Markdown | インライン `<style>`、固定 sans-serif、テーブル枠線、奇偶行ゼブラ、`@media print` でセクション跨ぎ防止 |
| 適用 | ドキュメント / Wiki / GitLab に埋め込み | ブラウザで直接 PDF 印刷 |

ファイル名 `<schema-or-db>-data-dict.md|html`。**完全オフライン**生成 — データディクショナリはコンプライアンス監査シーンで最も一般的な要求、オフライン環境で実行可能。

## 8. データ比較(`DataDiffDialog`)

コマンドパレット `act:data-diff`。**2 接続 × 2 テーブル → 行レベル diff → 同期 SQL**。

コアアルゴリズムは `data-diff.ts::diffRows`(純関数、単体テスト可):

```ts
diff = {
  inserts: Row[],            // ソースあり / ターゲットなし
  updates: RowUpdate[],      // 主キー同じ、非キー列に差異あり
  deletes: Row[]             // ターゲットあり / ソースなし
}
```

マッチングキー(`keyCols`):

- デフォルトでソーステーブルの `information_schema.table_constraints + key_column_usage` から**主キー**を取得(MySQL / PG 共通 SQL)
- ユーザーは `keyColsInput`(カンマ区切り)を手動入力 / 上書きで上書き可能

値比較 `same(a, b)` は**文字列正規化**:`null/undefined` は空と等価、その他は `String(a) === String(b)` — ドライバ差異を許容(`MySQL2` は `BigInt` を返し、`pg` は `Number`、SQLite は `string`)。

サポートマトリックス:**MySQL ファミリー(MySQL / MariaDB / OB)+ PostgreSQL ファミリー(PG / KingbaseES) のみ**;その他のダイアレクト(SQLite / Oracle / SQL Server / Redis 等)は UI に「MyPg のみ短いサポート」警告、ボタングレーアウト。

実行結果:

| 指標 | 意味 |
|---|---|
| `inserts` | ターゲットをソースに揃える |
| `updates` | ターゲットをソースと一致させる(実際に異なる列のみ SET) |
| `deletes` | ターゲットの余分な行、**末尾出力にコメント付き**「ターゲットのみ存在、確認後に実行」、誤削除回避 |

最後に `generateDataSync` で読みやすい SQL に組み立て、「コピー」または「クエリページで開く」、ターゲット接続で実行 — dry-run / 人手レビューの窓口を提供。

`LIMIT`(デフォルト 2000)でメモリ爆発防止、主キー差分が多い場合は先に範囲を絞ってください。

## 9. セキュリティ(要約)

詳細は [セキュリティモデル](./troubleshooting.md) を参照。本章関連の要点:

- **Workspace エクスポートはデフォルトでパスワードなし**;チェックして初めて裸の平文 JSON、UI 上に赤い「⚠」で明示警告
- **`.sql.enc` 暗号化エクスポート**は AES-256-GCM、パスワード違いとファイル改ざんで同じエラー、サイドチャネル漏洩なし
- NDJSON バックアップは**マスクしない**;真のマスクは生成時に PII Scanner を回すか、SQL エディタで `SELECT replace(...)` を手書き
- インポート/エクスポートの一時データは**メモリ内のみ**、中間ファイルを書かず、ダイアログを閉じると即解放

## 10. 互換性マトリックス

| 機能 | MySQL ファミリー | PG ファミリー | SQLite | Oracle | SQL Server | DM / KingbaseES | Redis | MongoDB |
|---|---|---|---|---|---|---|---|---|
| CSV/TSV/JSON/MD としてコピー | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| SQL VALUES/INSERT としてコピー | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| テーブル/Schema SQL エクスポート | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| `.skylerxws` 全量エクスポート | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `.sql.enc` 暗号化エクスポート | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ImportDialog(CSV/JSON/Excel) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | RedisImportExport 使用 | NDJSON 経路使用 |
| クリップボードインポート | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| NDJSON ブラウザ | DB 非依存 | DB 非依存 | — | — | — | — | — | — |
| バックアップ/復元 SQL 経路 | ✓ | ✓ | ✓ | 部分 | ✓ | ✓ | — | — |
| バックアップ/復元 NDJSON 経路 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| 接続間データマイグレーション | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| データディクショナリ(MD/HTML) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| 行レベルデータ比較 + 同期 SQL | ✓ | ✓ | ✗ | ✗ | ✗ | ✓(KB) | — | — |

「✗」は現状明示的にグレーアウト;「—」はそのダイアレクトに無意味(KV / ドキュメント DB は専用 `RedisImportExportDialog` を使用)。

## トリガー方法早見表

| 操作 | ツールバー | 右クリックメニュー | ⌘K コマンドパレット | ショートカット |
|---|---|---|---|---|
| 結果を CSV / TSV / ... としてコピー | — | 結果グリッド → コピー形式 → ... | — | — |
| テーブル SQL エクスポート | — | NavTree テーブルノード → SQL エクスポート | — | — |
| Schema SQL エクスポート | — | NavTree schema ノード → SQL エクスポート | — | — |
| Workspace エクスポート | 上部歯車 → エクスポート | — | `Workspace エクスポート`(`act:export-conns`) | — |
| Workspace インポート | 上部歯車 → インポート | — | `Workspace インポート`(`act:import-conns`) | — |
| データインポート(CSV/JSON/Excel) | — | NavTree テーブルノード → データインポート | — | — |
| クリップボードインポート | — | — | `PasteImport`(上部メニュートリガー) | — |
| NDJSON ファイル閲覧 | — | — | `NDJSON ブラウザ`(`act:ndjson-viewer`) | — |
| バックアップ / 復元 | — | — | `バックアップ/復元 · <接続>`(`act:backup:<id>`) | — |
| データ転送 | — | NavTree テーブルノード → データ転送 | — | — |
| データディクショナリ | — | NavTree schema/DB → データディクショナリ → MD / HTML | — | — |
| データ比較 | — | — | `データ比較`(`act:data-diff`) | — |

ヒント:すべての「別名保存」操作は底層で同じカスタム `SaveFileDialog`(`packages/ui/src/components/SaveFileDialog.vue`)を経由 — macOS / Windows / Linux で完全一致、**システムネイティブダイアログを呼ばない**;お気に入り、最近のディレクトリ、↑↓ で項目選択、Enter で保存、⌘L でアドレスバーフォーカスをサポート。
