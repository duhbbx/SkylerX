# トラブルシューティングと互換性

## 接続失敗のよくある問題

### `ECONNREFUSED` — 接続拒否

- データベースプロセスが起動していない / ポートのバインドが間違っている
- 確認:`nc -zv <host> <port>` または `telnet`
- Docker コンテナ:`docker ps` で Up かどうかとポートマッピングを確認

### `ETIMEDOUT` — タイムアウト

- ファイアウォール / セキュリティグループ / VPN によるブロック
- SSH トンネルの場合:踏み台サーバーに到達できない

### `Authentication failed` — 認証失敗

- ユーザー名 / パスワードが間違っている
- MySQL `caching_sha2_password` の互換性問題 — mysql2 をアップグレードするか `mysql_native_password` に変更
- PG の `pg_hba.conf` が該当の接続元を許可していない

### Oracle `ORA-12541: TNS:no listener`

- Oracle コンテナの起動が完了していない、または LISTENER が登録されていない
- 1〜2 分待ってから再試行
- service name が正しいか確認(デフォルト XEPDB1、`gvenzl/oracle-free` は FREEPDB1)

### Oracle `ORA-00900: invalid SQL statement near 'v'`(OceanBase 接続時)

- これは **OceanBase Oracle テナント** 特有の現象 — `VERSION()` 関数が Oracle モードに存在しない
- SkylerX v0.5+ では修正済み(`SELECT 1 FROM DUAL` を使った疎通確認に変更)
- 旧バージョン:最新版にアップグレードしてください

### Oracle `ORA-01950: insufficient quota on tablespace USERS`

新規作成された Oracle ユーザーに quota がないため、挿入 / テーブル作成が失敗します。**対処**:

```sql
-- SYSDBA で接続して実行
ALTER USER "your_username" QUOTA UNLIMITED ON USERS;
-- またはより包括的に
GRANT UNLIMITED TABLESPACE TO "your_username";
```

> ⚠️ Oracle はデフォルトで unquoted な識別子を大文字に変換します。ユーザー名がダブルクォートで囲まれた小文字名(`"test"`)の場合、後続の ALTER もダブルクォート + 元の大文字小文字で記述する必要があります。

### MongoDB ObjectId の編集ができない

- 編集グリッドで `_id` フィールドを変更すると失敗 — IPC でシリアライズされると ObjectId が文字列になり、ドライバが自動 wrap しない
- SkylerX v0.5+ では修正済み:ドライバ層で 24-hex 文字列の `_id` を自動検出し ObjectId に wrap
- 旧バージョン:本物の ObjectId 主キーを持つコレクションは、一時的に mongosh で編集してください

## エラーコード早見表

### MySQL / MariaDB / TiDB / Doris / StarRocks

| errno | 意味 | よくある原因 |
|---|---|---|
| 1045 | Access denied | ユーザー名 / パスワードが間違っている |
| 1049 | Unknown database | データベースが存在しない |
| 1054 | Unknown column | カラム名のミス |
| 1062 | Duplicate entry | ユニークインデックスの衝突 |
| 1064 | SQL syntax error | 構文エラー |
| 1146 | Table doesn't exist | テーブルが存在しない / DB を間違えた |
| 1213 | Deadlock | デッドロック、リトライ |
| 1264 | Out of range value | 列の型が値を収容できない |
| 2002 | Can't connect via socket | ホスト / ポートが間違っている |
| 2003 | Can't connect to MySQL server | 接続拒否 |
| 2013 | Lost connection during query | サーバー側クラッシュ / タイムアウト |

### PostgreSQL / 互換ダイアレクト(KingbaseES / openGauss / CockroachDB / Greenplum / Redshift / H2)

SQLSTATE 5 桁:

| code | 意味 |
|---|---|
| 23505 | unique violation |
| 23502 | not null violation |
| 23503 | foreign key violation |
| 42P01 | undefined table |
| 42703 | undefined column |
| 42601 | syntax error |
| 28000 | invalid authorization |
| 08001 | unable to connect |
| 40001 | serialization failure(リトライ) |
| 53300 | too many connections |

### Oracle / OceanBase Oracle テナント / DM 達夢(中国産 DB)

ORA-xxxxx シリーズ:

| code | 意味 |
|---|---|
| 00900 | invalid SQL statement |
| 00904 | invalid identifier |
| 00911 | invalid character |
| 00942 | table or view does not exist |
| 01017 | invalid username/password |
| 01950 | no privileges on tablespace |
| 12541 | TNS no listener |
| 12514 | service not found |
| 28000 | account locked |

## 動作が遅い

### 大きな結果セットで重い

- デフォルトページサイズが大きすぎる?200〜500 行に下げれば仮想スクロールが自動的に有効化されます
- 列が多すぎる?不要な列を非表示にしてください(列ヘッダ右クリック → 非表示)

### ネットワーク遅延が大きい

- リモート接続が遅い:SSH トンネルで圧縮 / 踏み台サーバーを近くに配置
- AI が遅い:より近いリージョンの provider に切り替え(deepseek.com は中国国内で高速)

### SkylerX の起動が遅い

- `Settings → 起動` をチェック → 「自動更新の確認」をオフ
- macOS:`xattr -d com.apple.quarantine /Applications/SkylerX.app` で隔離属性を解除

## データセキュリティ / プライバシー

- パスワード暗号化 — OS キーチェーンを使用(macOS Keychain / Windows DPAPI / Linux Secret Service)
- AI はデフォルトで **データを送信しません**、schema hint のみ送信
- すべての接続 / SQL 履歴 / スニペット / 設定はローカル SQLite に保存
- 統計 / テレメトリは一切アップロードしません

## アップグレードのよくある問題

### 自動更新失敗

- ネットワーク問題:[Releases](https://github.com/duhbbx/SkylerX/releases) から手動で新バージョンをダウンロード
- 権限問題:macOS でアプリに書き込み権限がない場合、管理者として再インストール

### アップグレード後に接続 / 設定が失われた

**通常は発生しません**。ローカル SQLite はバージョン間で互換性があります。発生した場合は、**旧バージョンのデータディレクトリを削除する前に**、[Issue を起票](https://github.com/duhbbx/SkylerX/issues)してください。通常はパスマイグレーションの問題です。

## バグレポートの提出

上記すべてで解決しない場合:

1. アプリの任意のエラーダイアログで「**✨ AI に質問**」をクリックし、AI で原因特定できるか試す
2. それでも解決しない場合 → [GitHub Issues](https://github.com/duhbbx/SkylerX/issues/new)
3. Issue に以下を添付してください:
   - SkylerX バージョン(`Help → About`)
   - OS + バージョン
   - データベース種別 + バージョン
   - 再現手順
   - 完全なエラー情報

## 法人協業 / プライベート導入

- 信創環境の深度適合(龍芯 LoongArch / 飛騰 Phytium / 鯤鵬 Kunpeng)
- 中国国家暗号コンプライアンス / 中国セキュリティ規格 GB17859(等保 2.0)導入
- データベース移行コンサルティング(Oracle → 達夢 DM(中国産 DB)/ KingbaseES)
- 社内カスタマイズ版

連絡先:`duhbbx@gmail.com` · WeChat `tuhoooo`
