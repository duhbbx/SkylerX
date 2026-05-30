# セキュリティとコンプライアンス

SkylerX は dev / test / prod の 3 種類の環境を同時に対象とし、**接続認証情報から結果セットレンダリング、SQL コミットからバッチエクスポートまで**の End-to-End セキュリティモデルを内蔵しています。本ページでは、コードに実際に実装されている各防御線を明確に説明します:何をするか、何をしないか、運用とコンプライアンス監査にどんな証跡を提供できるか。

## 1. 概要

SkylerX のセキュリティモデルは「データフロー方向」で 5 セグメントに分かれ、各セグメントに専用コードのフォールバックがあります:

| 段階 | モジュール / ファイル | 主な責務 |
|---|---|---|
| 認証情報落地 | `apps/desktop/src/main/db/connectionStore.ts` | パスワード / SSH 秘密鍵を OS キーチェーン(Electron `safeStorage`)で暗号化して保存 |
| 環境識別 | `packages/ui/src/connEnv.ts` | dev / test / prod の 3 色マーク + 読み取り専用接続 + 読み込み文ホワイトリスト |
| 文阻止 | `packages/ui/src/sqlLint.ts` | 7 個のヒューリスティックルール(WHERE なしの UPDATE/DELETE、prod 上の DROP/TRUNCATE 等) |
| データ表示 | `packages/ui/src/masking.ts` + `DataMaskingViewDialog` | カラム名パターンマッチ → レンダリング時マスキング + DB に反映するマスキングビュー |
| ガバナンス / 監査 | `compliance.ts` / `PiiScannerDialog` / `DataContractDialog` / `export-encrypt.ts` | 中国セキュリティ規格 GB17859(等保 2.0)コンプライアンスチェック、PII スキャン、データコントラクト、暗号化エクスポート |

以下、コードの事実に基づいてセグメントごとに説明します。

## 2. 接続パスワード暗号化(OS キーチェーン)

コード位置:`apps/desktop/src/main/db/connectionStore.ts`

新規 / 編集接続時、パスワードは平文で SQLite に落とさず、Electron の `safeStorage`(macOS = Keychain、Windows = DPAPI、Linux = libsecret / kwallet)経由:

```ts
function encryptPassword(plain?: string): string | null {
  if (!plain) return null
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(plain).toString('base64')}`
  }
  return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
}
```

保存フィールドには一律プレフィックス、後続のバージョン識別に便利:

| プレフィックス | 意味 | 出現タイミング |
|---|---|---|
| `enc:` | OS キーチェーン暗号文 | 正常経路、macOS / Windows / ほとんどの Linux |
| `plain:` | base64 フォールバック(**dev 専用**) | `safeStorage.isEncryptionAvailable()` が `false` を返す時、裸 Linux コンテナや libsecret / kwallet 欠如によくある |
| その他 | 旧版でプレフィックスなしの互換フィールド | 過去データ |

> **重要:** `plain:` を見たら、SkylerX は引き続き動作しますが、**平文と同等**です。Linux で `gnome-keyring` または `kwallet` をインストール後、ユーザーに接続を再編集(任意の変更後保存で再暗号化トリガー)させることを推奨します。

### SSH トンネル鍵

SSH 設定には `password` / `privateKey` / `passphrase` の 3 項目、全体が同じ暗号化チェーンを経由。**リスト表示時(`listConnections`)に秘密鍵フィールドを能動的に除去**、メモリ内の冗長な保持を回避:

```ts
function decryptSsh(stored, withSecrets) {
  const ssh = JSON.parse(decryptPassword(stored)) as SshConfig
  return withSecrets
    ? ssh
    : { ...ssh, password: undefined, privateKey: undefined, passphrase: undefined }
}
```

実際に接続開始 / 編集フォームに戻す時(`getConnection`)のみ、完全な秘密鍵を持って戻ります。

## 3. 環境マーク dev / test / prod + 本番保護

コード位置:`packages/ui/src/connEnv.ts`

接続設定の `extra.env` フィールドに 3 状態 enum を保存:

| 値 | UI ラベル | 色(`ENV_META.color`) | デフォルト厳格度 |
|---|---|---|---|
| `dev` | 開発 | `#4caf50` 緑 | 標準 |
| `test` | テスト | `#e0a020` オレンジ | 標準 |
| `prod` | 本番 | `#e04050` 赤 | **追加 SQL ルール + 実行前二重確認** |

### 接続全体の読み取り専用(`extra.readOnly`)

読み取り専用接続は `connReadOnly()` でマーク。SkylerX は 2 ヶ所で独立して守る:

1. **接続全体レベル**:`isReadOnlyStatement(sql)` は先頭キーワードホワイトリスト(`select` / `with` / `show` / `explain` / `desc(ribe)` / `pragma`)で書き込み文を阻止、ホワイトリスト外は一律サーバーに送らない。
2. **コミットモード**:読み取り専用接続は `auto` commit を強制(手動トランザクションは読み取り専用接続に無意味);`initialCommitMode()` を参照。

### 本番ウォーターマーク

`Settings → 本番ウォーターマーク` で文言 / 角度 / 透明度 / 色をカスタマイズ可、prod 接続のすべてのビュー(SQL エディタ、結果セット、エクスポートプレビュー)に SVG ウォーターマークを重ね、スクリーンショット拡散を防止。

## 4. SQL Linter — 7 個の内蔵ルール

コード位置:`packages/ui/src/sqlLint.ts`

ヒューリスティック純文字列スキャン、完全 parser はせず、「明らかに危険な」パターンのみヒット。結果は 3 段階:

| Severity | UI フィードバック | 引き続き実行? |
|---|---|---|
| `error` | モーダル二重確認 | ユーザー確認後に実行 |
| `warn` | toast 提示 | **実行する**(提示のみ) |
| `info` | 呼び出し側決定(エディタサイドバーにアイコン可) | 実行する |

完全ルール表:

| ルール ID | Severity | トリガー条件 | 提示 |
|---|---|---|---|
| `no-where-update` | error | `UPDATE` 開始 + `WHERE` なし | UPDATE に WHERE 句がなく、全テーブル更新になります |
| `no-where-delete` | error | `DELETE FROM` + `WHERE` なし | DELETE に WHERE 句がなく、全テーブルがクリアされます |
| `prod-drop` | error | 接続 env=prod + `DROP TABLE/DATABASE/SCHEMA/INDEX/VIEW` | 本番環境で DROP XXX を実行 |
| `prod-truncate` | warn | 接続 env=prod + `TRUNCATE` | 本番環境で TRUNCATE を実行 |
| `cross-join` | warn | `SELECT` + `FROM a, b`(カンマ JOIN)または `JOIN` の `ON/USING` なし | 複数テーブルクエリで結合条件未指定(カーテシアン積疑い) |
| `select-star` | info | `SELECT *` | SELECT * は明示的なカラム列挙を推奨 |
| `forgotten-limit` | info | `SELECT` の `LIMIT` / `FETCH FIRST` / `TOP n` / `COUNT()` なし | SELECT に LIMIT がなく、大量データ取得の可能性 |

### ルールの「廉価」制約

コメント除去は最も素朴な 2 つの正規表現(`/\/\*[\s\S]*?\*\//g` と `/--[^\n]*/g`)で `-- WHERE 1=1` のような偽 WHERE が linter を騙さないことを保証。すべてのルールは O(n) 文字列スキャンで、実行ホットパスで走らせてもユーザーを遅くしません。

### 多文集約

`lintStatements(stmts, ctx)` は同一 id の finding を severity 最高で 1 回保持、「SQL ファイル全選択実行」シーン向け。

## 5. データコントラクト(notNull / range / regex)

コード位置:`packages/ui/src/components/DataContractDialog.vue`

データコントラクトは「業務フィールドに出現すべきでない値」を事前埋め込み。1 件のコントラクトは 4 部から成る:

| フィールド | 型 | 説明 |
|---|---|---|
| `name` | string | ユーザーが付けたコントラクト名 |
| `table` | string | 適用 `schema.table` |
| `notNull` | `string[]` | これらの列は NULL 不可 |
| `range` | `Record<string, [min, max]>` | 数値範囲、`null` は無制限 |
| `regex` | `Record<string, string>` | 列値がヒットすべき正規表現 |
| `enabled` | boolean | 有効スイッチ |

保存先 `localStorage.skylerx.dataContracts`、JSON 配列。

### 典型用途

```json
{
  "name": "ユーザーテーブル完全性",
  "table": "public.users",
  "notNull": ["phone", "email"],
  "range": { "age": [0, 150] },
  "regex": { "email": "^[^@]+@[^@]+$", "phone": "^1\\d{10}$" },
  "enabled": true
}
```

### インポート / エクスポート

- **📋 エクスポート** をクリック → JSON をクリップボードにコピー、チーム共有ドキュメント / git リポジトリに貼り付け可
- **📥 インポート** をクリック → JSON を貼り付けて現在のリストを上書き

DBA がコントラクトを書いた後、チーム / プロジェクト別に開発者に配布、ローカル SkylerX に取り込まれて自動有効化されます。

## 6. 機密フィールドスキャン(PII Scanner)

コード位置:`packages/ui/src/components/PiiScannerDialog.vue`

2 段ヒューリスティック:**カラム名マッチ → サンプリング検証**。

### カラム名マッチ段階

`DEFAULT_MASK_RULES`(次節参照)の `columnPattern` 正規表現を使用。例えばカラム名 `user_phone` は `(phone|mobile|tel|手机|电话)` にヒット、`phone` に分類。

### サンプリング検証段階(オプション)

ヒット列の先頭 N 行(デフォルト 50、10-1000 で変更可)を取得、正規表現で二次確認:

| kind | サンプリング検証正規表現 |
|---|---|
| `phone` | `/^\+?[\d\s\-()]{7,20}$/` |
| `email` | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `idCard` | `/^\d{15}$\|^\d{17}[\dxX]$/` |
| `bankCard` | `/^\d{12,19}$/` |
| `name` / `address` / `default` | なし、カラム名のみ |

ヒット率 < 30% は「カラム名の偶然、実際は PII でない」と判定、レポートから除外。

### レポートと次のステップ

レポートは「ヒット数降順」でテーブル別にグループ化、**📋 CSV エクスポート** 可(列:schema/table/column/data_type/rule/kind/sample)。CSV はそのままコンプライアンス監査に提出可能、または DB 右クリック → 「マスキングビュー生成」でこれらの列を選んでマスキングビューを作成。

## 7. データマスキングビュー(DataMaskingViewDialog)

コード位置:`packages/ui/src/masking.ts` + `packages/ui/src/components/DataMaskingViewDialog.vue`

### 7.1 内蔵マスキングルール

`DEFAULT_MASK_RULES` がルールのベースライン、ユーザーは `Settings → データマスキング` で削除 / 変更 / カスタムルール追加可。

| ルール名 | columnPattern | kind | デフォルト有効 | アルゴリズム |
|---|---|---|---|---|
| 電話番号 | `(phone\|mobile\|tel\|手机\|电话)` | phone | ✅ | 前 3 + `****` + 後 4 |
| メール | `(email\|mail\|邮箱)` | email | ✅ | 頭文字 + `***@domain` |
| 身分証 | `(id_?card\|身份证\|idno)` | idCard | ✅ | 前 6 + `*…` + 後 4 |
| 銀行カード | `(bank_?card\|card_?no\|账号\|账户)` | bankCard | ✅ | 前 4 ` **** **** ` 後 4 |
| 氏名 | `(real_?name\|user_?name\|full_?name\|姓名)` | name | ❌ | 頭文字 + `*`(残り非表示) |
| 住所 | `(address\|addr\|地址)` | address | ❌ | 前 6 文字 + `***` |
| パスワード / Token | `(password\|passwd\|secret\|pwd\|token\|api_?key\|密码)` | default | ✅ | 前 2 + `****` + 後 2 |

### 7.2 レンダリング時マスキング vs DB 反映マスキングビュー

SkylerX は 2 種類の独立したマスキング経路を提供:

- **レンダリング時マスキング**:`Settings → データマスキング → 有効化`。フロントエンドがカラム名 → ルール → アルゴリズムで即時マスキング、**DB は変更しない**、エクスポート時にエクスポートダイアログで「原文 / マスキング」を選択可能。
- **DB 反映マスキングビュー**(`DataMaskingViewDialog`):`CREATE OR REPLACE VIEW ... AS SELECT mask_expr(c) ...` SQL を生成して DB に落とす、**アプリ側はビューを経由、生テーブルを直接読まない**。6 つの戦略が利用可能:

| 戦略 | 生成される SQL 式(MySQL 例) |
|---|---|
| `raw` 原文 | `` `c` AS `c` `` |
| `md5` | `` md5(CAST(`c` AS char(4000))) AS `c` `` |
| `partial` 前 N 後 M | `` CONCAT(LEFT(`c`,N), '***', RIGHT(`c`,M)) AS `c` `` |
| `fixed` 置換 | `'***' AS \`c\`` |
| `truncate` 切り詰め | `` LEFT(`c`, max) AS `c` `` |
| `null` | `` NULL AS `c` `` |

ダイアログ起動時にカラム名で `recommendStrategy(colName)` を呼び推奨を提示、ユーザーが列別に上書き可能。生成された SQL は手動編集後に実行可能(▶ ビュー作成をクリック)。

## 8. 中国セキュリティ規格 GB17859(等保 2.0)コンプライアンスチェック

コード位置:`packages/ui/src/compliance.ts` + `packages/ui/src/components/ComplianceDialog.vue`

「DB 接続から直接検証可能」な項目に絞り、ファイアウォール / ディスク暗号化等の OS 層は含めない。結果は 4 状態:

| Severity | 意味 |
|---|---|
| `pass` ✅ | コンプライアンス遵守 |
| `warn` ⚠️ | 非遵守だがリスク制御可(例:監査未有効、SSL オフ) |
| `fail` ❌ | 重大違反(例:root リモート開放、空パスワードユーザー) |
| `unknown` — | 判定不可(権限不足、商用版のみの特性) |

### MySQL 系(MySQL / MariaDB / OceanBase / TiDB)— 7 条

| ID | 大カテゴリ | タイトル | 探索方法 |
|---|---|---|---|
| `mysql.auth.password-policy` | 認証 | 強パスワードポリシー強制 | `SHOW VARIABLES LIKE 'validate_password%'`、policy ≥ MEDIUM かつ length ≥ 8 |
| `mysql.audit.enabled` | セキュリティ監査 | 監査ログ有効 | `audit_log_*`(企業版)または `server_audit_*`(MariaDB) |
| `mysql.auth.root-remote` | アクセス制御 | root はリモートログイン不可 | `SELECT user, host FROM mysql.user WHERE user='root'` |
| `mysql.auth.anonymous` | アクセス制御 | 匿名ユーザー不在 | `mysql.user WHERE user=''` |
| `mysql.transport.ssl` | データ完全性 | SSL 通信強制 | `require_secure_transport=ON` |
| `mysql.audit.slowlog` | セキュリティ監査 | スロークエリログ有効 | `slow_query_log=ON` |
| `mysql.integrity.binlog` | データ完全性 | binlog 有効 | `log_bin=ON`(ポイントインタイムリカバリ / マスタースレーブの前提) |

### PostgreSQL 系(PG / KingbaseES / openGauss / Greenplum / CockroachDB)— 6 条

| ID | 大カテゴリ | タイトル | 探索方法 |
|---|---|---|---|
| `pg.auth.password-encryption` | 認証 | パスワード暗号化に SCRAM-SHA-256 使用 | `SHOW password_encryption` |
| `pg.audit.pgaudit` | セキュリティ監査 | pgaudit 監査拡張がインストール済み | `pg_extension WHERE extname='pgaudit'` |
| `pg.transport.ssl` | データ完全性 | SSL 有効 | `SHOW ssl` |
| `pg.access.superuser-count` | アクセス制御 | スーパーユーザー数制御(≤ 2) | `SELECT rolname FROM pg_roles WHERE rolsuper` |
| `pg.audit.log-statement` | セキュリティ監査 | log_statement 設定済み | `SHOW log_statement` ≠ none |
| `pg.auth.empty-password` | 認証 | 空パスワードのログイン可能ユーザー不在 | `pg_authid WHERE rolpassword IS NULL AND rolcanlogin` |

### Markdown レポートエクスポート

**Markdown エクスポート** をクリックすると `renderReport()` を呼び、大カテゴリ別にグループ化、「サマリー: ✅ N · ⚠️ N · ❌ N · — N」統計行 + 各ルールの説明 / 結論 / `evidence` 生証跡を追加。ファイル名は自動で接続名 + タイムスタンプ:`compliance-<safeName>-<YYYY-MM-DDTHH-MM-SS>.md`。

### 並行実行

「チェック開始」をクリックすると `Promise.all` ですべてのルールを並行実行、失敗は他の項目に影響しない(`try/catch` で `unknown` にフォールバック)、ドライバ層が自前でキューイング / 接続を再利用。

### その他のダイアレクト

非 MySQL / PG 系はプレースホルダ項目に入る:

```
当該ダイアレクトのコンプライアンスチェック未提供 — 手動確認をお願いします
```

後続で Oracle / SQL Server / SQLite / 達夢 DM のルールを補完予定。

## 9. 中国国家暗号 SM2 / SM3 / SM4(計画中)

コンプライアンスルールセットには既に「`password_encryption=md5` は中国国家暗号 / 中国セキュリティ規格 GB17859(等保 2.0)では弱アルゴリズムとみなす」を警告判定として追加(`pg.auth.password-encryption` の説明参照)。SM2 / SM3 / SM4 の補助 API(データを DB 落地前にアプリ層で中国国家暗号で署名 / 暗号化するため)は現状 **未リリース**、v0.6 で独立した `cryptoCn.ts` ツールモジュールとして提供予定:

- SM2 楕円曲線署名 / 暗号化(sm-crypto ベース)
- SM3 メッセージダイジェスト
- SM4 対称ブロック暗号(CBC / ECB)

インターフェース署名が安定したら本ページの「中国国家暗号補助 API」セクションに追記します。

## 10. 暗号化エクスポート .skbk

コード位置:`packages/ui/src/export-encrypt.ts`

任意のテキスト(通常は SQL dump または接続設定)をパスワードで単一行 JSON ファイルに暗号化、拡張子 `.sql.enc` / `.skbk`。

### アルゴリズムスタック

| 段階 | アルゴリズム | パラメータ |
|---|---|---|
| 鍵派生 | PBKDF2-HMAC-SHA-256 | iter = `DEFAULT_ITER` = **200 000**(調整可、ヘッダー記録) |
| 暗号化 | AES-GCM 256 | salt 16 バイト + iv 16 バイト、毎回再生成 |
| 完全性 | AES-GCM 内蔵 128-bit auth tag | パスワード違い / ファイル改ざん → 復号時に直接 `WRONG_PASSWORD` スロー |
| ファイルヘッダー | `magic: 'SKYLERX-ENC-v1'` | アルゴリズム / パラメータアップグレード時のバージョン識別用 |

> **PBKDF2 iter を 200 000 にしたトレードオフ**:OWASP 2023 推奨は SHA-256 ≥ 600 000、ただしデスクトップ端は旧マシンを考慮(Atom CPU で 600k は 1+ 秒詰まる)、折衷。エクスポート内容が極めて機密な場合、`encryptText` 呼び出し時に手動で iter フィールドを上げられます。

### シリアライズフォーマット

```json
{
  "magic": "SKYLERX-ENC-v1",
  "salt": "<base64 16B>",
  "iv":   "<base64 16B>",
  "iter": 200000,
  "data": "<base64 ciphertext + tag>"
}
```

フィールド順序固定で git diff に便利、単一行 JSON でストリーミング読み書きに便利。

### エラーコード

| エラー | スロー時機 | UI フィードバック |
|---|---|---|
| `INVALID_BLOB` | 解析時にフィールド欠如 / 型不一致 / `magic` 不一致 | 「ファイル形式が壊れています」と提示 |
| `WRONG_PASSWORD` | AES-GCM auth tag 検証失敗(パスワード違い / ファイル改ざん) | 「パスワードが違います」と提示(両方区別せず、元エラー漏洩回避) |

### Web Crypto 依存

実装は統一で `globalThis.crypto.subtle` を経由、サードパーティ依存なし。デスクトップ Electron レンダラ層 + 現代ブラウザは直接サポート、Node 18+ も動作可(テスト用)。極めて古い環境は `Web Crypto API unavailable: upgrade to Node 18+ or a modern browser` をスロー。

## 11. AI プライバシー境界

AI アシスタント(Anthropic / OpenAI / DeepSeek / Codex / Grok)は SkylerX のコア拡張ですが、サードパーティ API に送る内容は**コンテキストの必須範囲に限定**:

| 種類 | 送信? | 備考 |
|---|---|---|
| 現在の SQL テキスト | ✅ | ユーザーが能動的にトリガーした対話 / 補完の前提 |
| 現在の schema hint(DB / テーブル / カラム名) | ✅ | メタデータのみ、**行データは一切送らない** |
| エラー情報本文 + エラーコード | ✅ | 「AI に質問」診断用、`AI` ドキュメント第 4 節参照 |
| 接続メタデータ(ダイアレクト / 接続名 / DB 名) | ✅ | AI が正しいダイアレクトを選ぶため |
| **結果セット行データ** | ❌ | ユーザーが AI インライン補完を有効化しても、schema hint のみ送り、SELECT 戻り行は送らない |
| **接続パスワード / SSH 秘密鍵** | ❌ | OS キーチェーン内の暗号文はヒント化のために読み出されない |
| **ローカル接続設定全体** | ❌ | 現在選択中の接続の dialect / database のみ取得 |

AI を完全隔離したい場合:

1. `Settings → AI Provider → API Key をクリア` → インライン補完 / チャット / AI に質問のエントリすべてを無効化
2. またはローカルエンドポイント(Ollama / vLLM / プライベートデプロイ)を使い、`endpoint` フィールドを `http://localhost:...` に向ける

> **AI 通知 webhook も同じ原則**:通知本文にはデフォルトで「タイトル + サマリー + トリガー時刻」のみ、SQL 行データは含まれない。具体は `Settings → 通知` のテンプレートで変更可能。

## 12. セキュリティ関連ショートカット早見表

| 操作 | エントリ |
|---|---|
| 中国セキュリティ規格 GB17859(等保 2.0)コンプライアンスチェック | ⌘K → 「中国セキュリティ規格 GB17859(等保 2.0)コンプライアンスチェック · 接続名」/ 接続右クリック → コンプライアンスチェック |
| PII スキャン | DB 右クリック → PII スキャナー |
| マスキングビュー生成 | DB / テーブル右クリック → マスキングビュー生成 |
| データコントラクト | ⌘K → 「データコントラクト」/ ツール → データコントラクト |
| 暗号化エクスポート | 結果セット / SQL エディタ → エクスポート → `.skbk` 選択 |
| 全接続のセキュリティポリシー | `Settings → データマスキング` / `Settings → 本番ウォーターマーク` |
| カスタムショートカット(誤タップ防止) | `Settings → キーバインド` |

## 13. 既知の制限

コード事実層面で DBA に知ってもらう必要のある境界:

- **SQL Linter はヒューリスティック**:完全 SQL parser でないため、文字列スキャンが極少数のケースで漏判(例:ネスト `/* ... */` コメント + 文字列リテラルに `where` キーワードが出現)。高リスク操作には prod 二重確認(接続名入力)の併用を推奨。
- **コンプライアンスチェックは対応する読み取り権限が必要**:`mysql.user` テーブルには SELECT 権限、`pg_authid` にはスーパーユーザーが必要、権限不足の項目は `unknown` に落ち、`fail` にならない、**unknown を pass と見なさない**でください。
- **マスキングレンダリングは UI 層のみ**:DB 内は依然として原文。「アプリが原文を読む」を完全に防ぐには、DB 反映マスキングビュー + DB アカウント権限の絞り込みを併用。
- **暗号化エクスポートファイル自体は「ブルートフォース辞書攻撃」を防がない**:200k ラウンドの PBKDF2 が与えるのは ~10^7 量級のコスト、弱パスワードは依然オフラインで破られる可能性あり。ファイルに強パスワードを付けるか、チーム内で KMS / 公開鍵配布を経由してください。
- **環境マークはソフト制約**:`extra.env = 'prod'` はユーザーが接続保存時に自分で記入、ユーザーが手滑りで `dev` を選ぶと、prod 専用のルールがトリガーされません。チームレベルで「接続設定エクスポート → 同僚インポート」でこのフィールドを標準化することを推奨。
