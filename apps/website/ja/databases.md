---
title: サポートするデータベース
description: SkylerX がサポートする 17 SQL + 3 NoSQL ダイアレクトの一覧。ドライバパッケージ名とプロトコルの説明付き
---

# サポートするデータベース

SkylerX は **統一されたドライバ抽象化層**(`@db-tool/core-driver`)を介して各ダイアレクトに接続します。SQL 系ダイアレクトは `execute(sql, params)` を、NoSQL は並列チャネルの `executeCommand(payload)` を使用します。

新しいダイアレクトの追加は次の 3 ステップのみです:

1. `DbDialect` enum にエントリを追加
2. `dialects/<name>.ts` で `DatabaseDriver` インターフェースを実装
3. `dialects/index.ts` に 1 行登録

<DatabaseGrid />

## プロトコル互換性マトリックス

「新しい」ダイアレクトの多くは既存プロトコル(MySQL wire / PG wire)に互換性があるため、**対応するドライバをそのまま流用**でき、ほぼゼロコストで接続できます:

### MySQL プロトコルファミリー(`mysql2` を使用)

- MySQL · MariaDB · OceanBase · TiDB · Doris · StarRocks

### PostgreSQL プロトコルファミリー(`pg` を使用)

- PostgreSQL · 人大金倉 KingbaseES(中国産 DB)· openGauss · Greenplum · CockroachDB · H2(PG-server モード)· Amazon Redshift

### 専用ドライバ

| ダイアレクト | ドライバパッケージ | 説明 |
|---|---|---|
| Oracle | `oracledb` | デフォルトで thin モード。純 JS で Instant Client 不要。SYSDBA / SYSOPER ロールに対応 |
| 達夢 DM(中国産 DB) | `dmdb` | 公式配布パッケージ。遅延ロード。信創環境の主力 |
| SQL Server | `mssql` | 純 JS。Windows / SQL 認証に対応 |
| SQLite | `better-sqlite3` | ローカルファイル。`.db` / `.sqlite` に対応 |
| DuckDB | `@duckdb/node-api` | ローカルファイル。OLAP 向け。BigInt は自動的に文字列化し精度ロスを防止 |
| ClickHouse | `@clickhouse/client` | HTTP プロトコル |
| Snowflake | `snowflake-sdk` | クラウド DWH。パスワード / 秘密鍵 / OAuth 認証に対応 |
| TDengine 涛思(中国産時系列 DB) | `@tdengine/websocket` | WebSocket プロトコル。時系列シナリオ |

### NoSQL 並列チャネル

| ダイアレクト | ドライバパッケージ | チャネル |
|---|---|---|
| MongoDB | `mongodb` | `executeCommand({ op, args, context })`、find/aggregate/insert/update/delete などの op に対応 |
| Redis | `ioredis` | `executeCommand({ op, args })`、SCAN サンプリング + 全件 TYPE 取得 |
| Elasticsearch | `@elastic/elasticsearch` | REST/HTTP、search/get/bulk/raw などの op に対応 |

## 中国国産 DB(信創)フルセット

SkylerX は **主要な中国国産データベースすべてをネイティブサポート**する数少ないオープンソースツールです:

| データベース | ベンダー | プロトコル | ステータス |
|---|---|---|---|
| **達夢 DM(中国産 DB)** | 達夢データベース | 独自 | ✅ 完全対応 |
| **人大金倉 KingbaseES(中国産 DB)** | 人大金倉 | PG 互換 | ✅ 完全対応 |
| **openGauss** | Huawei / 中国移動 | PG 互換 | ✅ 完全対応 |
| **OceanBase** | アント(Ant) | MySQL 互換(Oracle テナントもサポート) | ✅ 完全対応 |
| **TiDB** | PingCAP | MySQL 互換 | ✅ 完全対応 |
| **TDengine 涛思(中国産時系列 DB)** | 涛思(Taos Data) | WebSocket | ✅ 完全対応 |

付随機能:
- 🛡 **中国国家暗号 SM2/SM3/SM4** 暗号化・復号ツール
- 📋 **中国セキュリティ規格 GB17859(等保 2.0)コンプライアンスチェック**パネル(MySQL + PG 系)
- 🔄 **Oracle → 達夢 DM(中国産 DB)マイグレーションウィザード**(型 + 関数 + DDL を自動変換)

## 互換性に関する補足

| シナリオ | サポート度合い |
|---|---|
| 標準 SQL クエリ(SELECT / JOIN / WINDOW / CTE) | ✅ 全ダイアレクト |
| エディタ:シンタックスハイライト / 自動補完 / フォーマット | ✅ 全 SQL ダイアレクト |
| 可視化結果セット / 編集可能グリッド | ✅ 全 SQL ダイアレクト |
| EXPLAIN 可視化 | ✅ MySQL / PG / 主要ダイアレクト |
| Manual commit(手動トランザクションモード) | ✅ MySQL / PG / Oracle / DM / SQL Server / Snowflake / OceanBase / KingbaseES / Greenplum / openGauss / TiDB / CockroachDB |
| スロークエリログ解析 | ✅ MySQL 系 + PG 系 |
| レプリケーション遅延監視 | ✅ MySQL 系 + PG 系 + SQL Server AOAG |
| 構造比較 / データ比較 | ✅ 全 SQL ダイアレクト |
| バックアップ / 復元(SQL 形式、クロスプラットフォーム) | ✅ 全 SQL ダイアレクト |
| AI アシスタント | ✅ 全ダイアレクト(SQL のダイアレクト間翻訳に対応) |

## お探しのデータベースが見当たらない場合

- [Issue を起票して新しいダイアレクトをリクエスト →](https://github.com/duhbbx/SkylerX/issues/new)
- プロトコル互換ダイアレクト(MySQL / PG wire ベース)は **5 分で接続可能**
- 自社開発データベースについては法人協業にてご相談ください:`duhbbx@gmail.com`
