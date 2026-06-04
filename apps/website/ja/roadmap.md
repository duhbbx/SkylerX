---
title: ロードマップ
description: SkylerX の今後対応するデータベースと機能計画。四半期ごとに更新します。
---

# ロードマップ

> 最終更新: 2026-06-04
> 方向性を示す計画であり、確約ではありません。実際のペースはフィードバックとリソースに依存します。
> 完全版: [GitHub の ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)

何かを前に進めたいですか？

- 👍 対応する [issue](https://github.com/duhbbx/SkylerX/issues) に投票する
- 新規リクエストを起票する: [New Feature Issue](https://github.com/duhbbx/SkylerX/issues/new/choose)
- アーキテクチャを議論する: [Discussions](https://github.com/duhbbx/SkylerX/discussions)

## 凡例

- ✅ 公開済
- 🟢 進行中 / 今四半期
- 🔵 来四半期
- ⚪ 候補 — 優先度はフィードバックで変動
- 🟣 長期 / アーキテクチャ変更が必要

---

## 1. データベース対応

### 1.1 対応済み（2026-05 時点）

| カテゴリ | ドライバ |
|---|---|
| **リレーショナル（OSS）** | MySQL · MariaDB · PostgreSQL · SQLite · H2 |
| **リレーショナル（商用）** | Oracle · SQL Server |
| **中国系 / 信創** | DM（达梦）· KingbaseES（人大金仓）· OceanBase · TiDB · GBase |
| **分析系（MPP/OLAP）** | ClickHouse · Snowflake · Amazon Redshift · Apache Doris · StarRocks · DuckDB |
| **時系列** | TDengine |
| **NoSQL** | MongoDB · Redis · Elasticsearch |

### 1.2 導入計画

#### 🟢 2026 Q3（7-9 月）

| データベース | タイプ | 備考 |
|---|---|---|
| **PolarDB-PG / -X** | クラウドネイティブ | 既存ドライバを再利用 |
| **GaussDB（Huawei）** | 信創 | PG 互換モード |
| **TimescaleDB** | 時系列（PG 拡張） | Hypertable / continuous aggregates |
| **Cassandra / ScyllaDB** | ワイドカラム NoSQL | SQL チャネル上の CQL |
| **InfluxDB 3.x** | 時系列 | FlightSQL |

#### 🔵 2026 Q4（10-12 月）

| データベース | タイプ | 備考 |
|---|---|---|
| **Trino / Presto** | 連合 SQL | HTTP API、カタログツリーがサブソースをマッピング |
| **Apache Hive（HS2）** | ビッグデータ SQL | Kerberos / LDAP 経由の JDBC |
| **Neo4j** | グラフ | Bolt + Cypher、新規チャネル |
| **Couchbase** | マルチモデル NoSQL | N1QL |
| **AWS DynamoDB** | KV / ドキュメント | PartiQL、NoSQL チャネル |
| **pgvector / Milvus / Qdrant** | ベクトル | 専用ベクトルフィールドビューア |

#### ⚪ 2027 H1 候補

Apache IoTDB · Nebula Graph · SequoiaDB · GreatSQL · Hologres（Aliyun PG）· Lindorm（Aliyun HBase）· TDSQL-C（Tencent）· QuestDB · Apache Druid · Apache Pinot · Flink SQL Gateway · Materialize · RisingWave · Vertica · BigQuery · Athena

#### 🟣 長期（需要次第）

Apache HBase · Impala · DynamoDB Streams · Cassandra CDC · LMDB / RocksDB ビューア · Weaviate / Chroma · ArangoDB（マルチモデル）

---

## 2. 機能ロードマップ

### 2.1 エディタ & クエリ UX

| ステータス | 機能 |
|---|---|
| ✅ | SQL Linter + AI インライン補完 |
| ✅ | タグ + ピン留め付きクエリ履歴 |
| ✅ | **Notebook モード** — マルチセル SQL / Markdown、ローカル永続化、Jupyter 風 |
| 🟢 | **Visual Query Builder** — ドラッグで結合、自動 JOIN、GUI 集約 |
| 🔵 | **Speech-to-SQL** — Whisper オフライン → AI 翻訳 |
| 🔵 | **方言間ストアド翻訳** — Oracle PL/SQL ↔ PG PL/pgSQL ↔ DM |
| ✅ | **Linter カスタムルールエディタ** — ユーザー定義の禁止パターン / スタイルルール（正規表現マッチ + 重大度レベル） |
| ⚪ | スニペットライブラリ + デバイス間同期 |

### 2.2 結果グリッド UX

| ステータス | 機能 |
|---|---|
| ✅ | インライン編集 + DML コミット、エラー時の「AI に聞く」、セルビューア |
| ✅ | **クエリ結果 diff** — 2 つの結果セットを行 / セル単位で比較し、追加 / 削除 / 変更をマーク |
| ✅ | **エクスポート時マスキング** — マスキング有効時、コピー / エクスポート（CSV/JSON/SQL/…）もルールに従い列全体をマスクし、グリッドと一致 — 「表示はマスク、エクスポートは平文」を解消 |
| 🟢 | **Form ビュー** — 幅広テーブル向けの縦型単一行エディタ |
| 🟢 | **Excel 風多値フィルタ** |
| 🔵 | **Master/Detail 連動** — 行を選択すると関連テーブルを自動読み込み |
| 🔵 | FK 列の編集時に **FK ルックアップドロップダウン** |
| ⚪ | ライブ JOIN 列展開 · ピボット · JSON 列ツリービューア |

### 2.3 スキーマ & モデリング

| ステータス | 機能 |
|---|---|
| ✅ | DDL 生成 · スキーマ diff · Mock データ v1 |
| ✅ | Oracle → DM 移行ウィザード |
| ✅ | **移行アセスメント** — ソースプロファイリング（17 のオブジェクトカテゴリ + リスク指標）+ A/B/C/D グレーディング + AI PL/SQL 変換 + Word/PDF/Excel エクスポート、ハブ&スポーク IR 設計 |
| ✅ | **ER 図自動レイアウト** — 稼働中スキーマからのリバースエンジニアリング、外部キー自動リンク（子 → 親）、列数によるノードサイズ、PK テーブル強調、テーブル + 隣接にフォーカス、PNG / SVG エクスポート |
| 🔵 | **フォワードエンジニアリング** — ER 図を編集 → 移行を生成 |
| ✅ | **クロス DB 移行 v2** — ハブ&スポーク IR：MySQL/Oracle/DM/SQL Server をパース → PG/Oracle/DM/MySQL を生成、型 / インデックス / ビュー / FK を完全対応、データ移行（チャンク化パラメータ化 + 増分 + 検証） |
| ✅ | **データリネージグラフ** — SQL をパース → テーブル単位のリネージ（列単位はロードマップ上） |
| ⚪ | dbt 連携 · 列単位リネージ |

### 2.4 DBA / 運用

| ステータス | 機能 |
|---|---|
| ✅ | EXPLAIN ビジュアライザ · 遅クエリのスパークライン · Health check v1 |
| ✅ | **長時間実行クエリのキラー** — 方言横断のプロセス / セッション一覧（MySQL `information_schema.PROCESSLIST` / PG `pg_stat_activity` / MSSQL `sys.dm_exec_requests` / Oracle `v$session`）、本番接続では行ごとに `KILL` のタイプ確認付き KILL |
| 🟢 | **デッドインデックス検出** + サイズ統計 |
| 🟢 | **遅クエリ → 自動書換 + インデックス提案** |
| 🔵 | レプリケーション遅延ダッシュボード |
| ✅ | **ストレージ増加トレンド予測** — DB / テーブルサイズをスナップショットし、7/30/90 日の容量曲線をフィット + 上限警告 |
| ⚪ | コネクションプールチューニング · 署名付き監査ログ · バックアップスケジューラ |

### 2.5 AI

| ステータス | 機能 |
|---|---|
| ✅ | AI チャット · エラー時の Ask-AI · Mock データ v1 · Health check v1 |
| 🟢 | **Mock データ v2** — テーブル横断の FK 認識 + 意味的フィールド（名前、住所、電話番号） |
| 🟢 | **Health check v2** — アンチパターンライブラリを 50+ チェックに拡張 |
| 🔵 | **ストリーミング補完（Cursor 風）** — 入力に追従するサジェスト |
| ✅ | **スキーマ + ドキュメント RAG** — スキーマ（テーブル / ビュー / 関数）+ ドキュメントをチャンク化 → ベクトル（OpenAI 互換 /v1/embeddings）+ BM25 ハイブリッド検索（RRF 融合）+ 関連度下限、関連テーブルのみを AI コンテキストに注入、埋め込みが無い場合は字句フォールバックへ穏当に縮退 |
| ⚪ | AI 提案によるマスキングルール · SQL → ER 図 |

### 2.6 コラボレーション / マルチデバイス

| ステータス | 機能 |
|---|---|
| ✅ | マルチウィンドウ · 7 言語 i18n |
| 🔵 | **E2E 暗号化接続同期** — デバイス間、保存時暗号化 |
| 🔵 | **チームクエリライブラリ** — 読み取り専用 / コメント / フォーク |
| ⚪ | Web 版 · モバイル読み取り専用ビューア |
| 🟣 | リアルタイムペアクエリ（Yjs プロトコル） |

### 2.7 連携 & エクスポート

| ステータス | 機能 |
|---|---|
| ✅ | CSV / Excel / JSON / SQL / Parquet / Markdown へエクスポート |
| ✅ | **チャートビューア（ECharts）** — 結果グリッドからワンクリック：折れ線 / 棒 / 円 / 散布、Y は数値列・X は非数値列を自動検出、ズーム + 複数系列に対応、メインスレッドで最大 5000 行をレンダリング |
| 🔵 | **チャートプリセット / ダッシュボード** — 「このクエリ → このチャート」を保存して再利用 |
| 🔵 | **BI エクスポート** — Metabase / Superset / PowerBI / Tableau のデータソース |
| ⚪ | REST / GraphQL モックエンドポイント |

### 2.8 プラグイン / 拡張性

| ステータス | 機能 |
|---|---|
| 🔵 | **サードパーティドライバプラグイン API** |
| ⚪ | エクスポート形式プラグイン / テーマプラグイン |

### 2.9 ナビゲーションツリー / ワークスペースナビ

NavTree は日常作業の 95% の入口です — 直近で着地した磨き込みの波：

| ステータス | 機能 |
|---|---|
| ✅ | **複数選択 + 一括操作** — Ctrl/⌘+クリック / Shift+範囲、DROP / TRUNCATE / グループへ移動 / SELECT テンプレートのコピー / DDL エクスポート / 並列接続テスト、バッチ SQL は対応箇所ではネイティブマルチターゲット（PG `DROP TABLE a, b, c`）、それ以外（Oracle/DM/SQLite）はフェイルファストの逐次実行。Refs #25 |
| ✅ | **ドラッグで幅変更** — 200-600px、ダブルクリックでリセット、設定に永続化。Refs #17 |
| ✅ | **接続ごとの表示 DB / スキーマフィルタ** — 接続名の横に DataGrip 風の N/M チップ、v2 では DB ごとのスキーマフィルタに対応（1 つの DB に 50 スキーマがある PG シナリオ）。Refs #24 |
| ✅ | **ローカルツリー検索（Ctrl/⌘+F）** — 読み込み済みノードのライブフィルタ、一致を含むブランチを強制展開 |
| ✅ | **全カタログオブジェクトインデックス + ツリー横断検索** — 接続ごとのフラットカタログキャッシュ（約 5MB / 10 万オブジェクト / 10ms スキャン）、初回検索時にバックグラウンドで静かに構築、一致はツリーの上に表示、テーブル / ビュー / 関数 / プロシージャ / シーケンス / トリガ / インデックスをカバー、種別ピルによるフィルタリング |
| ✅ | **Redis キーのクリックリンク** — ナビ内の Redis キーをシングルクリックすると対応する RedisPane タブにフォーカスしてキーを選択、新規タブは生成しない。Refs #19 |
| ✅ | **方言横断のオブジェクト型網羅** — Oracle/DM（DM の型に対する `CLASS` object_type 修正を含む）、Vastbase/openGauss + PG ファミリ全体（マテリアライズドビュー / プロシージャ / 型、openGauss はパッケージ / シノニムも）、SQL Server（関数 / プロシージャ / トリガ / シーケンス / 型 / シノニム） |
| ✅ | **システム DB / スキーマをワンクリック除外** — 表示 DB / スキーマ設定で system DB / スキーマ（mysql / pg_catalog / SYS / SYSAUDITOR …）を一括オフ、ユーザーオブジェクトは不変、単層方言（MySQL 等）は無意味なスキーマドロップダウンを非表示 |
| ✅ | **接続情報のコピー** — 接続を右クリック → 「接続情報をコピー」サブメニュー：JDBC URL / JSON / 複数行 / 単一行（;） — パスワードは含めない |
| ✅ | **グループへ移動（コンボボックス）** — 一括でグループへ移動：ドロップダウンから既存グループを選択 or 新規名を入力（トリム、無ければ作成）、空 = グループから外す |
| 🟢 | **Cmd+Shift+P グローバルオブジェクトファインダー** — 接続横断のあいまいモーダル、ツリー内検索を補完 |
| 🔵 | **インデックスを IndexedDB に永続化** — ミリ秒単位のコールドスタート結果（陳腐化マーカー付き） |
| 🔵 | **全種別の revealObject** — 現在はツリー内のテーブル / ビューをリビール、関数 / プロシージャ / シーケンスへ拡張 |
| ⚪ | **選択接続を横断する一括操作** — 例：`prod` タグの全接続に対する夜間レポート |

---

## 3. プラットフォーム / エンジニアリング

| ステータス | 項目 |
|---|---|
| ✅ | マルチアーキテクチャビルドマトリクス（macOS arm/x64 · Windows · Linux） |
| ✅ | Aliyun OSS ミラー + 自動更新チャネル切替 |
| 🟢 | **コード署名** — Apple Developer + Windows（SignPath OSS 経由） |
| 🟢 | **クラッシュレポート** — ソースマップ付きセルフホスト Sentry |
| 🔵 | Playwright E2E + CI マトリクス |
| 🔵 | Codecov 連携 |
| ⚪ | AppImage / Snap / Flatpak / MS Store / MAS / Homebrew tap |

---

## 4. ドキュメント / コミュニティ

| ステータス | 項目 |
|---|---|
| ✅ | 7 言語サイト + SEO + セルフホスト Umami |
| ✅ | DBA / スキーマ / NoSQL / セキュリティ / AI / 生産性のドキュメント |
| 🟢 | **動画チュートリアル**（Bilibili + YouTube、コア機能ごとに 3 分未満） |
| 🔵 | ケーススタディ / 公開 changelog サイト |

---

## マイルストーン

| 時期 | ハイライト |
|---|---|
| 2026-06 | スキーマ RAG（ベクトル + BM25 ハイブリッド）· ER 図 + PNG/SVG エクスポート · クエリ結果 diff · エクスポート時マスキング · ナビの方言横断オブジェクト型網羅 · 方言横断リーダーの実機検証（DM/Oracle/MySQL/Vastbase） |
| 2026-05 | AI 設定 → 暗号化 SQLite · 7 言語 SEO · セルフホスト Umami |
| 2026-04 | ClickHouse / Snowflake / Doris / StarRocks / Redshift / H2 ドライバの波 |
| 2026-03 | NoSQL チャネル（MongoDB / Redis / Elasticsearch）· SQL Linter · AI インライン |
| 2026-02 | EXPLAIN ビジュアライザ · 遅クエリのスパークライン · Oracle → DM ウィザード |
| 2026-01 | 初の公開リリース（MySQL / PG / Oracle / SQL Server / DM / KingbaseES） |

---

## 貢献したいですか？

- セットアップ、テスト、PR ルールは [CONTRIBUTING.md](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md) を参照
- 新規ドライバ：`packages/core-driver/src/drivers/*` のいずれかをテンプレートとしてコピー
- ロードマップ自体は [ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md) にあります — PR 歓迎
