---
title: ロードマップ
description: SkylerX の今後対応するデータベースと機能計画。
---

# ロードマップ

> 最終更新: 2026-05-31 · 方向性を示す計画であり、確約ではありません。実際のペースはフィードバックとリソースに依存します。
> 完全版: [GitHub の ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)

## 凡例

- ✅ 公開済 · 🟢 進行中 / 今四半期 · 🔵 来四半期 · ⚪ 候補 · 🟣 長期

## 1. データベース対応

### 既対応

MySQL · MariaDB · PostgreSQL · SQLite · H2 · Oracle · SQL Server · DM(达梦)· KingbaseES · OceanBase · TiDB · GBase · ClickHouse · Snowflake · Redshift · Apache Doris · StarRocks · DuckDB · TDengine · MongoDB · Redis · Elasticsearch

### 🟢 2026 Q3(7-9 月)

- **PolarDB-PG / -X**(クラウド)
- **GaussDB**(Huawei, PG 互換)
- **TimescaleDB**(時系列 / PG 拡張)
- **Cassandra / ScyllaDB**(CQL)
- **InfluxDB 3.x**(FlightSQL)

### 🔵 2026 Q4(10-12 月)

- **Trino / Presto**(連合クエリ)
- **Apache Hive**(HS2)
- **Neo4j**(グラフ, Cypher)
- **Couchbase**(N1QL)
- **AWS DynamoDB**(PartiQL)
- **pgvector / Milvus / Qdrant**(ベクトル)

### ⚪ 2027 H1 候補

Apache IoTDB · Nebula Graph · SequoiaDB · GreatSQL · Hologres · Lindorm · TDSQL-C · QuestDB · Druid · Pinot · Flink SQL Gateway · Materialize · RisingWave · Vertica · BigQuery · Athena

## 2. 機能

| カテゴリ | 主要マイルストーン |
|---|---|
| **エディタ** | Notebook モード · Visual Query Builder · Speech-to-SQL · 方言間ストアド翻訳 |
| **結果グリッド** | Form ビュー · Excel 風多値フィルタ · Master/Detail · FK ルックアップ |
| **スキーマ** | ER 図自動レイアウト · フォワードエンジニアリング · 移行 v2 |
| **DBA** | デッドインデックス検出 · 遅クエリ AI 書換 + インデックス提案 · レプリ遅延ダッシュボード |
| **AI** | Mock データ v2(FK 認識)· Health check v2 · ストリーミング補完 · スキーマ RAG |
| **コラボ** | E2E 暗号化接続同期 · チーム クエリライブラリ · Web 版 |
| **エクスポート** | チャート ビューア(ECharts)· BI 連携(Metabase / Superset / PowerBI / Tableau) |
| **プラットフォーム** | コード署名(macOS / Windows)· Sentry · Playwright E2E |

## 参加方法

- [Issues](https://github.com/duhbbx/SkylerX/issues) で 👍 投票
- 新規要望: [Feature request](https://github.com/duhbbx/SkylerX/issues/new/choose)
- 完全な ROADMAP: [ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)
