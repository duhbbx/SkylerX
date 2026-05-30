# 接続管理

## 新規接続

⌘N / Ctrl+N または左上の「新規接続」ボタンでフォームが開きます。

### 基本項目(全ダイアレクト共通)

| 項目 | 説明 |
|---|---|
| 接続名 | 表示用、任意 |
| ダイアレクト | データベース種別(MySQL / PG / Oracle / ...) |
| ホスト | ホスト名または IP |
| ポート | ダイアレクトに応じてデフォルト値が自動入力(MySQL 3306 / PG 5432 / Oracle 1521 ...) |
| ユーザー | ユーザー名 |
| パスワード | 空欄保存可、初回接続時に再度尋ねられます |
| データベース | デフォルトで接続する DB / schema、空欄可 |
| グループ | 接続ツリーのルート階層のフォルダ。複数環境を整理しやすくする |
| 環境マーカー | dev / test / prod — prod は[本番保護](#本番保護)を発動 |

### ダイアレクト固有項目

#### Oracle / OceanBase Oracle テナント

| 項目 | 説明 |
|---|---|
| Service Name | デフォルト XEPDB1、コンテナ `gvenzl/oracle-free` は FREEPDB1 |
| privilege | SYSDBA / SYSOPER / SYSASM / SYSBACKUP / SYSDG / SYSKM / SYSRAC、通常接続は空欄 |

> **SYSDBA ログイン**時の Oracle は通常 CDB ルート(`FREEPDB1` ではなく `FREE`)に接続します。

#### Snowflake

| 項目 | 説明 |
|---|---|
| Account | `xy12345.us-east-1` のような Snowflake 識別子 |
| Warehouse | コンピュートウェアハウス |
| Role | デフォルトロール |
| Schema | デフォルト schema |
| Authenticator | デフォルト password、または `snowflake_jwt` 秘密鍵 |
| Private Key Path | 秘密鍵 PEM ファイル(JWT モード時に表示) |
| Private Key Passphrase | 秘密鍵パスフレーズ(ある場合) |

#### MongoDB

オプションで **URI 直接入力モード**:`mongodb://user:pass@host:27017/db?replicaSet=rs0`。入力すると host/port/user/password は無視されます。

#### SQLite / DuckDB

host/port/user は不要で、**データベースファイルのパス**のみが必要です:
- 隣に「参照…」ボタンがあり、システムファイル選択ダイアログを呼び出せます
- 存在しないファイル名も選択可能(新規 DB を自動作成)
- 空欄 → メモリモード `:memory:`(アプリ終了時に消える)

#### ClickHouse

| 項目 | 説明 |
|---|---|
| URL | 完全な URL(`https://user:pass@host:8443/...`)。入力すると host/port は無視 |
| Show System Databases | デフォルトでは `system` / `information_schema` DB を非表示 |

#### Redis

host/port/password/dbIndex のみ必要です。SkylerX は 16 個の論理 DB(db0..db15)を自動展開します。

#### H2

**PG-server モードのみ対応**。H2 の起動時に `-pg` パラメータが必要:

```bash
java -cp h2-2.x.x.jar org.h2.tools.Server \
  -pg -pgPort 5435 -ifNotExists -baseDir ./data
```

接続時:Host=localhost、Port=5435、User=`sa`、Password=空。

## SSH トンネル

データベースが踏み台サーバーの後ろにある場合は、**SSH タブ** に切り替えて SSH トンネルを有効化します:

- SSH ホスト / ポート / ユーザー
- 認証:**パスワード** または **秘密鍵**(`~/.ssh/id_rsa` など)から選択
- 秘密鍵パスフレーズ(暗号化されている場合)

SkylerX は自動的に SSH トンネルを確立し、それを経由してデータベースに接続します。

## SSL / TLS

**SSL タブ** に切り替えて SSL を有効化:

- サーバー証明書を検証するかどうか
- CA / 証明書 / 鍵(PEM テキストを貼り付けるかファイルを選択)

## Manual Commit 手動コミットモード

`Settings → グローバルデフォルトコミットモード` または **接続ごと → 詳細 → コミットモード**:

- `auto`(デフォルト):各 SQL を即座にコミット
- `manual`:ユーザーが明示的に「コミット / ロールバック」を押す必要があり、SkylerX はトランザクションを維持するため長時間接続を保持

データ修復 / 重要なマイグレーションのシナリオに適しており、**本番接続では manual を強く推奨**します。

## 接続テスト

フォーム下部の「接続テスト」ボタンでリアルタイムフィードバック:
- ✅ 成功 + サーバーバージョンと往復遅延を表示
- ❌ 失敗 + エラーコード + 自動分類(「接続拒否」/「DNS」/「タイムアウト」/「認証」/「SSL」など)+ トラブルシューティング手順

テスト失敗時のダイアログで **「✨ AI に質問」** をクリック → エラー + 接続メタデータを自動で AI アシスタントに投げます。

## 本番保護(`env=prod`)

prod としてマークされた接続には以下の追加保護が適用されます:

- ツリールートに赤色のバッジで `[prod]` を表示
- `DROP TABLE / DATABASE / INDEX` / `TRUNCATE` / WHERE なしの `UPDATE/DELETE` 実行時、**続行するには接続名の入力を強制**
- AI は prod 上でより保守的に応答(デフォルトで SELECT のみのスタイル)

環境マーカーの判定は **純粋にローカル設定**で、データベース自体には影響しません。

## パスワードの暗号化保存

パスワードは OS キーチェーンで暗号化されます:

- **macOS**:Keychain Access
- **Windows**:DPAPI(現在のユーザーログインセッションベース)
- **Linux**:Secret Service(GNOME Keyring / KWallet)

万が一キーチェーンが利用できない場合は base64 エンコードにフォールバックします(`plain:` プレフィックスで明示的にマーク、**安全ではない警告**を表示)。**本番環境ではキーチェーンの可用性を確保することを強く推奨**します。

## グループ管理

各接続をオプションで **グループ** に所属させることができ、ルートツリーはグループごとに折りたたまれます:

```
📁 開発環境
   ├── ローカル MySQL
   └── ローカル PostgreSQL
📁 テスト環境
   └── テスト OceanBase
📁 本番環境  ⚠
   └── prod-mysql [prod]
```

新規接続時に「グループ」項目に名前を入力するだけ(Enter で確定)。

## 複数ウィンドウ(複数接続を並行クエリ)

⌘⇧N / Ctrl+Shift+N で新しい SPA ウィンドウを開く → 同じ設定ストアをロードし、2 つのウィンドウがそれぞれ独立して接続し、相互に干渉しません。

「左に prod、右に staging を並べて比較する」ようなシナリオに適しています。

## 接続の削除

接続を右クリック → 削除 → 二重確認 → SQLite から削除 + Keychain も同期クリア。

データベース自体は **影響を受けません**、SkylerX 側の接続設定が消えるだけです。
