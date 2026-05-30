# DBA と監視

SkylerX は DBA のトラブルシュートでよく使う「リアルタイムビュー」を内蔵パネルとして用意:プロセス一覧 / 長トランザクション / ロック待ち / レプリケーション遅延 / スロークエリ Top N / サーバー指標 / クラスタートポロジー / 権限。

すべてのパネルは**対象接続に直接 SQL を実行**(中間 agent 経由なし)、追加のコレクターもなければ、DB 設定の変更もしません。各パネルの取得 SQL とダイアレクトルーティングはソース `packages/ui/src/components/*Dialog.vue` で逐字検証可能です。

## エントリ一覧

DBA 系機能には独立メニューがなく、統一で**コマンドパレット**から起動:`⌘K` / `Ctrl+K` で開いてパネル名を検索。特定接続を扱うもの(「サーバーアクティビティ」「スロークエリ」「レプリケーション遅延」「OB トポロジー」)は登録済みの接続ごとに 1 つのコマンドを生成、どれを選ぶかで接続先を決定。

| パネル | コマンドパレットキーワード | エントリ id |
|---|---|---|
| サーバーアクティビティ | `サーバーアクティビティ / Server activity` | `act:activity:<connId>` |
| レプリケーション遅延 | `レプリケーション遅延 / Replication lag` | `act:repl:<connId>` |
| スロークエリログ分析 | `スロークエリ / Slow query` | `act:slowq:<connId>` |
| 操作ログ | `操作ログ / Operation log` | `act:oplog` |
| サーバー監視 | `サーバー監視 / Server monitor` | `act:monitor` |
| OceanBase クラスタートポロジー | `OceanBase` | `act:obtopo:<connId>` |
| ユーザーと権限 | `ユーザーと権限 / Users & privileges` | `act:privileges` |

コマンドパレットを開くショートカットは `DEFAULT_KEY_BINDINGS.palette = 'CmdOrCtrl+K'` で定義、「設定 → カスタムショートカット」で変更可能。

---

## サーバーアクティビティ

`ServerActivityDialog.vue` — タイトル `サーバーアクティビティ · {conn}`。3 タブを含み、上部に「更新」ボタン + 自動更新ドロップダウン(2s / 5s / 10s / オフ)。

### 3 つのパネル

#### プロセス一覧(`tabProcesses`)

| ダイアレクトファミリー | 取得 SQL |
|---|---|
| MySQL | `information_schema.PROCESSLIST WHERE COMMAND <> 'Sleep' ORDER BY TIME DESC` |
| PostgreSQL | `pg_stat_activity WHERE state IS NOT NULL AND pid <> pg_backend_pid()` |
| SQL Server | `sys.dm_exec_sessions` JOIN `sys.dm_exec_requests` + `OUTER APPLY sys.dm_exec_sql_text(r.sql_handle)` |

フィールドは SQL 層で列名を正規化(`id / user / host / db / time / state / info`)、3 ダイアレクトの表頭が一致。

#### 長トランザクション(`tabLongTx`)

| ダイアレクトファミリー | 取得 SQL |
|---|---|
| MySQL | `information_schema.INNODB_TRX ORDER BY trx_started ASC`(`rows_locked / rows_modified` を返す) |
| PostgreSQL | `pg_stat_activity WHERE xact_start IS NOT NULL` |
| SQL Server | `sys.dm_tran_active_transactions` JOIN `sys.dm_tran_session_transactions` |

#### ロック待ち(`tabLocks`)

| ダイアレクトファミリー | 取得 SQL |
|---|---|
| MySQL | `performance_schema.data_lock_waits` |
| PostgreSQL | `pg_locks` JOIN `pg_stat_activity` の「blocked / blocking」自己結合 |
| SQL Server | `sys.dm_tran_locks WHERE request_status = 'WAIT'` |

### KILL 操作

プロセス一覧 / 長トランザクションの 2 タブには各行の右側に `✗ KILL` ボタン、クリックすると「セッション / トランザクション終了」確認ダイアログ、確認後にダイアレクト別に実行:

| ダイアレクトファミリー | KILL 文 |
|---|---|
| MySQL | `KILL <id>` |
| PostgreSQL | `SELECT pg_terminate_backend(<pid>)` |
| SQL Server | `KILL <spid>` |

ロック待ちタブは KILL を提供しない(ロック待ちは通常 blocker がブロックしているため、プロセス一覧で blocker を kill する必要)。

### ダイアレクト適合ルール

エントリは `familyOfConn()` を経由:まず `dialectKind` で NoSQL 判定 → 直接拒否(`'NoSQL ダイアレクトは本パネル非対応'`)、それ以外は `ddl.familyOf(dialect)` を使用:

- **MySQL ファミリー** に直接ヒット → MariaDB / TiDB / OceanBase / Doris / StarRocks
- **PG ファミリー** PG 分岐を再利用 → CockroachDB / Greenplum / OpenGauss / KingbaseES / H2(`ddl.ts` は H2 も pg に分類)
- **SQL Server** → mssql 分岐
- その他のダイアレクトは `当該ダイアレクトはこのパネルをサポートしません` を表示

---

## レプリケーション遅延監視

`ReplicationLagDialog.vue` — タイトル `マスタースレーブレプリケーション遅延 · {conn}`。

上部に**ダイアレクトバッジ + ロール + 自動更新オプション(デフォルト 5s、オフ / 2s / 5s / 10s 選択可)**。ロールは 4 種、SQL 層で判定、UI 上は色で区別:

| ロール | 判定元 | UI 色 |
|---|---|---|
| マスター(`source`) | MySQL: `SHOW REPLICAS` / `SHOW SLAVE HOSTS` / `SHOW BINARY LOG STATUS` のいずれかに行あり;PG: `pg_stat_replication` に行あり;MSSQL: ローカル replica `role_desc = 'PRIMARY'` | 緑 |
| スレーブ(`replica`) | MySQL: `SHOW REPLICA STATUS` / `SHOW SLAVE STATUS` に行あり;PG: `pg_is_in_recovery() = true`;MSSQL: ローカル `role_desc = 'SECONDARY'` | 青 |
| スタンドアロン(`standalone`) | すべての探索が空 | 灰 |
| 不明(`unknown`) | 未サポートのダイアレクト | 灰 |

### ダイアレクトルーティング詳細

#### MySQL ファミリー

4 段階フォールバック、いずれかの段階で行を取得したら停止:

1. `SHOW REPLICA STATUS`(MySQL 8.0.22+ の新名)
2. `SHOW SLAVE STATUS`(旧名、5.7 / 8.0 < 22 / MariaDB 互換)
3. 上が空 → `SHOW REPLICAS` で下流スレーブを列挙してみる
4. さらに `SHOW BINARY LOG STATUS` / `SHOW MASTER STATUS` にフォールバック

戻り列は「キー列前置」投影:`Channel_Name / Source_Host / Replica_IO_Running / Seconds_Behind_Source / Last_Error` 等を先に、その他は後ろに追加。

#### PostgreSQL ファミリー

```sql
-- 1) まず standby を判定
SELECT pg_is_in_recovery() AS is_replica
-- 2a) スレーブ視点
SELECT
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int AS lag_seconds,
  pg_last_wal_receive_lsn()::text,
  pg_last_wal_replay_lsn()::text
-- 2b) マスター視点
SELECT pid, application_name, state, sync_state,
  EXTRACT(EPOCH FROM write_lag)  AS write_lag_seconds,
  EXTRACT(EPOCH FROM flush_lag)  AS flush_lag_seconds,
  EXTRACT(EPOCH FROM replay_lag) AS replay_lag_seconds,
  sent_lsn, write_lsn, flush_lsn, replay_lsn
FROM pg_stat_replication
```

#### SQL Server(AOAG)

`sys.dm_hadr_database_replica_states` JOIN `sys.availability_replicas` + `sys.dm_hadr_availability_replica_states`、フィールドは `synchronization_state_desc / synchronization_health_desc / log_send_queue_size / redo_queue_size / DATEDIFF(SECOND, last_commit_time, GETDATE()) AS lag_seconds` 等。

AOAG 設定がなければ standalone。

### 色付け閾値

コード定数:

```ts
const LAG_WARN   = 5    // 黄
const LAG_DANGER = 30   // 赤
```

「lag 秒」系列のみ色付け、候補列名:`lag_seconds / Seconds_Behind_Source / Seconds_Behind_Master / replay_lag_seconds / write_lag_seconds / flush_lag_seconds`。

### フォールトトレラント

`looksLikeNoReplication()` は `not configured / not a slave / not a replica / no such / access denied / permission denied / privilege / does not exist` を含むエラーを「レプリケーション未有効」のグレー提示に変換、権限不足時のページ全体赤化を回避。

`Last_Error / Last_IO_Error / Last_SQL_Error` のいずれかが非空 → 上部に赤バナーで単独ハイライト。

---

## スロークエリ分析

`SlowQueryDialog.vue` + `slowQuery.ts` — タイトル `スロークエリログ分析`。

ツールは読み取り専用、設定変更しません:**変数を SET することはしません**。有効化 / 保持期間 / サンプリング閾値はすべて DBA 判断、SkylerX は既存の digest テーブルを読むだけです。

### データソース

| ダイアレクトファミリー(`slowFamilyOf`) | 含むダイアレクト | データソース |
|---|---|---|
| `mysql` | MySQL / MariaDB / TiDB / OceanBase / Doris / StarRocks | `performance_schema.events_statements_summary_by_digest` |
| `pg` | PostgreSQL / CockroachDB / Greenplum / OpenGauss / KingbaseES / Redshift | `pg_stat_statements` 拡張 |
| `other` | その他 | `slowq.unsupported` 表示 |

> `slowFamilyOf()` は `ddl.familyOf()` を再利用しない —— 後者は H2 を pg に分類、Redshift 未収録、本モジュールの判定境界とは異なる。

### クエリテンプレート

#### MySQL — `events_statements_summary_by_digest`

```sql
SELECT
  DIGEST_TEXT AS sql_text,
  COUNT_STAR  AS exec_count,
  ROUND(AVG_TIMER_WAIT/1e9, 2) AS avg_ms,
  ROUND(SUM_TIMER_WAIT/1e9, 2) AS total_ms,
  ROUND(MAX_TIMER_WAIT/1e9, 2) AS max_ms,
  SUM_ROWS_EXAMINED AS rows_examined,
  SUM_ROWS_SENT     AS rows_sent,
  SUM_NO_INDEX_USED AS no_index_count,
  FIRST_SEEN, LAST_SEEN
FROM performance_schema.events_statements_summary_by_digest
WHERE (? IS NULL OR SCHEMA_NAME = ?)
ORDER BY <SUM_TIMER_WAIT | AVG_TIMER_WAIT | COUNT_STAR> DESC
LIMIT 50
```

`*_TIMER_WAIT` 単位はピコ秒(10⁻¹² s)、`/1e9` でミリ秒に換算。`schema` パラメータは connection.database で自動入力。

#### PostgreSQL — `pg_stat_statements`

```sql
SELECT
  query AS sql_text,
  calls AS exec_count,
  ROUND(mean_exec_time::numeric, 2)  AS avg_ms,
  ROUND(total_exec_time::numeric, 2) AS total_ms,
  ROUND(max_exec_time::numeric, 2)   AS max_ms,
  rows AS rows_sent,
  shared_blks_hit, shared_blks_read
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY <total_exec_time | mean_exec_time | calls> DESC NULLS LAST
LIMIT 50
```

### 並び替え、Top N、未有効提示

- 上部「並び替え」ドロップダウン:総所要時間 / 平均所要時間 / 呼び出し回数の 3 選 1、切替えるたびに**新しい `ORDER BY` で再実行**(フロント側ソートではない)
- デフォルト LIMIT 50、コード内 `Math.max(1, Math.min(500, limit))` で上限 500
- 有効化探索:MySQL は `SHOW VARIABLES LIKE 'slow_query_log'`、PG は `SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'`
- 探索失敗 → リストを「未有効」提示に置換、**貼り付け可能な有効化 SQL 付き**(MySQL:`SET GLOBAL slow_query_log = ON; SET GLOBAL long_query_time = 1; …`;PG:`CREATE EXTENSION IF NOT EXISTS pg_stat_statements; …`)

### 行展開後の操作

行をクリックして展開すると完全 SQL を表示、4 つのボタンを提供:

| ボタン | 動作 |
|---|---|
| コピー | `navigator.clipboard.writeText(sql)` |
| クエリで開く | emit `openSql` → 親コンテナが新クエリページ作成 |
| EXPLAIN 実行 | `EXPLAIN <sql>` を実行(末尾分号削除)、結果をインラインでレンダリング。**ANALYZE は使わない**、書き込み操作の誤実行回避 |
| AI 最適化 | emit `optimizeWithAi` → SQL を AI ツールボックスの「SQL 最適化」タスクに送信 |

---

## 操作ログ

`OperationLogDialog.vue` — タイトル `操作ログ`。**SkylerX ローカル監査**、DB 側 audit log ではありません。

開く時に登録済み全接続を取得、各接続から最新 200 件の `connections.history` を取得、`executedAt` 降順でマージ表示。各行は:成功 / 失敗 マーク、実行時刻、接続名、所要時間(ms)、単一行化された SQL テキスト。

### フィルタ

| フィルタ次元 | オプション |
|---|---|
| ステータス | 全部 / 成功 / 失敗 |
| 接続 | 全接続 / 指定単一接続 |
| キーワード | SQL テキスト case-insensitive `includes` マッチ |

### エクスポート

「CSV エクスポート」は現在のフィルタ結果をエクスポート、ファイル名 `skylerx-operation-log.csv`、列:`time,connection,status,duration_ms,sql`。

任意の行をクリック → emit `openSql(connId, sql)` でこの SQL をクエリページに送信(ダイアログを閉じる)。

---

## クラスタートポロジー

### 汎用 ClusterTopologyDialog(TiDB / OceanBase)

`ClusterTopologyDialog.vue` —— 2 タブ:**ノード** / **TiKV Stores | Region/Tablet**(ダイアレクトで名前切替)。

| ダイアレクト | ノードタブ | Regions タブ |
|---|---|---|
| TiDB | `information_schema.cluster_info`(tidb / tikv / pd / tiflash) | `information_schema.tikv_store_status`(`store_id, address, store_state_name, capacity, available, leader_count, region_count`) |
| OceanBase | `oceanbase.DBA_OB_SERVERS` | まず `oceanbase.GV$OB_TABLET_TO_LS LIMIT 200`、失敗時は `oceanbase.DBA_OB_UNITS` にフォールバック |
| その他 | `'当該ダイアレクトはクラスタートポロジービューをサポートしません'` | 左に同じ |

バイト列(`capacity / available / size$`)はフロント側で 1024 進数で KB / MB / GB / TB にフォーマット。

### OceanBase 専用トポロジー

`OceanBaseTopologyDialog.vue` —— タイトル `OceanBase クラスタートポロジー`、接続ダイアレクトが OceanBase の時のみエントリが見えます。

上部 4 枚の集計カード(Zones / Observers / Tenants / Units) + 左側 Zone → Observer ツリー + 右側 Tenant → Unit リスト(展開可)。4 つのビューを**並行クエリ**、失敗時はバナー提示だが前回成功データを保持。

| ビュー | SQL |
|---|---|
| Zones | `SELECT zone, status, idc, region FROM oceanbase.DBA_OB_ZONES ORDER BY zone` |
| Observers | `SELECT svr_ip, svr_port, zone, status, with_rootserver, build_version, start_service_time FROM oceanbase.DBA_OB_SERVERS ORDER BY zone, svr_ip` |
| Tenants | `SELECT tenant_id, tenant_name, tenant_type, primary_zone, compatibility_mode, status, locked, locality FROM oceanbase.DBA_OB_TENANTS ORDER BY tenant_id` |
| Units | `SELECT unit_id, resource_pool_id, unit_group_id, tenant_id, zone, svr_ip, svr_port, status FROM oceanbase.DBA_OB_UNITS ORDER BY tenant_id, zone, svr_ip` |

状態色付け:`ACTIVE / NORMAL` 緑、`INACTIVE / OFFLINE / DELETING` 赤、その他黄。tenant_type は絵文字で区別:👑 SYS / ⚙ META / 🏢 USER。observer アドレスをクリックでワンクリック `svr_ip:svr_port` コピー。

自動更新は オフ / 5s / 10s / 30s(デフォルトオフ)を選択可。

---

## サーバー監視

`ServerMonitorDialog.vue` — タイトル `サーバー監視`。

ドロップダウンで登録済み接続を切替(サポートされているダイアレクトのみ利用可)、起動後 **2 秒に 1 回 setInterval ポーリング**、メモリ内に最大 60 サンプリングポイントの sparkline を保持。

### ダイアレクトサポート

```ts
function fam(d) {
  if ([MySQL, MariaDB, OceanBase].includes(d)) return 'mysql'
  if ([PostgreSQL, KingbaseES].includes(d)) return 'pg'
  return 'other'
}
```

### MySQL 指標(`SHOW GLOBAL STATUS` + `SHOW VARIABLES LIKE 'max_connections'` 経由)

| カード | 元 |
|---|---|
| 稼働時間 | `Uptime`(`Xd Yh Zm` にフォーマット) |
| QPS | (`Queries`/`Questions` 差分) ÷ 時間差 |
| 接続数 | `Threads_connected / max_connections` |
| 実行中 | `Threads_running` |
| スロークエリ | `Slow_queries` |
| 拒否接続 | `Aborted_connects` |

### PostgreSQL 指標(1 つの集約 SQL)

```sql
SELECT
  (SELECT count(*) FROM pg_stat_activity) AS conns,
  (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') AS active,
  (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock') AS waiting,
  (SELECT sum(xact_commit + xact_rollback) FROM pg_stat_database) AS xacts,
  (SELECT sum(blks_hit) FROM pg_stat_database) AS hit,
  (SELECT sum(blks_read) FROM pg_stat_database) AS rd,
  extract(epoch FROM (now() - pg_postmaster_start_time()))::bigint AS uptime
```

カード:稼働時間 / TPS(xacts 差分)/ 接続数 / 実行中 / ロック待ち / Buffer ヒット率 `hit / (hit + rd) * 100%`。

下部の sparkline タイトルはダイアレクトに応じて `QPS` または `TPS` 表示。

---

## ユーザーと権限

`PrivilegesDialog.vue` + `privileges.ts` — タイトル `ユーザーと権限`。

左列にユーザー/ロール一覧 + 右列に「既存付与」/「GRANT 構築」。

### ダイアレクトサポート

| ダイアレクトファミリー | ユーザー列挙 SQL | 付与確認 SQL |
|---|---|---|
| MySQL(MariaDB / OceanBase 含む) | `SELECT User, Host FROM mysql.user` | `SHOW GRANTS FOR 'usr'@'host'` |
| PostgreSQL(KingbaseES 含む) | `SELECT rolname FROM pg_roles WHERE rolcanlogin` | `information_schema.role_table_grants` |
| Oracle(DM 含む) | `SELECT username FROM all_users WHERE oracle_maintained = 'N'`(12c+) | `dba_sys_privs ∪ dba_role_privs ∪ dba_tab_privs` |
| SQL Server | `sys.database_principals WHERE type IN ('S','U','G')` | `sys.database_permissions` JOIN `sys.database_principals` |
| その他 | `priv.unsupported` 表示 | 非対応 |

> Oracle で付与確認に `dba_*` ビューを使うため、接続ユーザーに DBA ロールがないと ORA-00942、UI はエラーをキャッチして「既存付与」位置にエラー情報を表示。

### GRANT 構築

権限選択 + ターゲット入力 + オプション `WITH GRANT OPTION` → リアルタイムでプレビュー文を生成、例:

```sql
GRANT SELECT, INSERT ON sales.orders TO 'app'@'%' WITH GRANT OPTION;
```

プリセットチェック項目 `COMMON_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL PRIVILEGES']`。

被付与者はダイアレクト別にフォーマット:

| ダイアレクト | grantee 形式 |
|---|---|
| MySQL | `'user'@'host'`(host 空時は `%`) |
| SQL Server | `[user]`(`]` を `]]` にエスケープ) |
| Oracle | `"USER"`(全大文字、`"` を `""` にエスケープ) |
| その他 | `"user"` |

### 直接変更しない

**SkylerX は GRANT / REVOKE を代行実行しません**。2 つのボタン:

- コピー → クリップボードへ
- クエリで開く → クエリページに送信、ユーザーが手動実行(SkylerX の SQL 実行チャネル経由、前段に[本番保護](/ja/docs/connections#本番保護)が prod マーク接続を阻止)

`buildRevoke()` も `privileges.ts` 内でエクスポートされていますが、現在の UI に REVOKE 構築フォームはなく、必要なら GRANT プレビュー文を直接編集してもよい。

---

## 互換性マトリックス

| 機能 | MySQL ファミリー | PG ファミリー | SQL Server | Oracle / DM | OceanBase | TiDB | NoSQL |
|---|---|---|---|---|---|---|---|
| サーバーアクティビティ:プロセス一覧 | `information_schema.PROCESSLIST` | `pg_stat_activity` | `dm_exec_sessions` | — | MySQL 分岐 | MySQL 分岐 | 非適用 |
| サーバーアクティビティ:長トランザクション | `INNODB_TRX` | `pg_stat_activity` | `dm_tran_active_transactions` | — | MySQL 分岐 | MySQL 分岐 | — |
| サーバーアクティビティ:ロック待ち | `data_lock_waits` | `pg_locks` | `dm_tran_locks` | — | MySQL 分岐 | MySQL 分岐 | — |
| KILL 操作 | `KILL <id>` | `pg_terminate_backend` | `KILL <spid>` | — | ✓ | ✓ | — |
| レプリケーション遅延 | `SHOW REPLICA STATUS` 等 | `pg_stat_replication` / `pg_last_xact_replay_timestamp` | AOAG `dm_hadr_database_replica_states` | — | MySQL 分岐 | MySQL 分岐 | — |
| スロークエリ | `events_statements_summary_by_digest` | `pg_stat_statements` | — | — | ✓ | ✓ | — |
| サーバー監視 | `SHOW GLOBAL STATUS` | `pg_stat_*` 集約 | — | — | MySQL 分岐(KingbaseES のみ pg 分岐) | — | — |
| クラスタートポロジー | — | — | — | — | `DBA_OB_*` | `cluster_info / tikv_store_status` | — |
| OB トポロジー(専用) | — | — | — | — | ✓ | — | — |
| ユーザーと権限 | `mysql.user` | `pg_roles` | `database_principals` | `all_users` + `dba_*` | MySQL 分岐 | MySQL 分岐 | — |
| 操作ログ(ローカル) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

> **「X 分岐」** は、当該ダイアレクトが `ddl.familyOf()`(または `slowFamilyOf` / `fam()` 等)で X ファミリーに分類され、同じ SQL を再利用することを意味します。すべてのバージョンの辞書ビュー列名が完全一致するとは限りません。Doris / StarRocks は MySQL プロトコル互換、スロークエリパネルで FE が通常 `events_statements_summary_by_digest` を公開しますが、個別バージョンで未公開時は「未有効」のフレンドリーな提示にフォールバック。

> **NoSQL(Redis / MongoDB / Elasticsearch)** はサーバーアクティビティパネルで `dialectKind(NoSql)` によりショートサーキット、SQL を送らず、「⚙ サーバー → クライアント / スローログを使用」の提示を表示。Redis のリアルタイム監視は専用 `RedisMonitorDialog` にあり、本ページの範囲外。
