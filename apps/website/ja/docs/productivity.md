# 生産性ツール

SkylerX は「DBA / バックエンドの日常 30 秒 〜 30 分レベルの高頻度動作」をすべて**キーボード / コマンドパレット / 通知**の 3 本の主幹に繋ぎ、クリック数とウィンドウ切替を減らすことを目指しています。本ページは「最もよく使うエントリ」順に列挙し、各ツールにはコード事実とソースファイルが対応します。

## 1. 概要

| ツール | エントリ | 解決する問題 |
|---|---|---|
| コマンドパレット ⌘K | グローバル / `Settings → キーバインド` | すべてここから検索 → メニューナビゲーションをスキップ |
| グローバルオブジェクト検索 ⌘⇧O | グローバル | 複数 DB をまたぐファジー検索でテーブル / ビュー / カラム → ワンクリックでナビゲーションツリーに位置決め |
| SQL スニペットライブラリ | エディタ右側ドロワー / `★` ボタン | クエリをお気に入り再利用、`{{var}}` テンプレート対応 |
| クエリ履歴 | エディタ右側ドロワー | 時刻 / 所要時間ソート、スロークエリを赤マーク |
| お気に入り | ⌘K → 「お気に入り」/ ツールバー | テーブル / ビュー / クエリへの素早い再訪 |
| カスタムショートカット | `Settings → キーバインド` | 12 個のコマンドを自由にリバインド + 衝突検出 |
| Dashboard | ⌘K → 「Dashboard」 | 複数 SQL 複数カードの「今日のステータスボード」 |
| Webhook 通知 | `Settings → 通知` | DingTalk / Lark / Slack / 汎用、スロークエリ + エラーを push |
| 複数ウィンドウ ⌘⇧N | ファイル → 新ウィンドウ | 同じアプリ、2 つの独立セッション(ローカル接続ローカル / ローカル接続リモート比較) |

---

## 2. コマンドパレット ⌘K

コード位置:`packages/ui/src/components/CommandPalette.vue` + `packages/ui/src/Workspace.vue`(プロジェクトソース / ルーティング)

⌘K(mac)/ Ctrl+K(Win/Linux)を押す → 上部に浮かぶ検索枠 → キーワードを入力してフィルタ → ↑↓ 選択 → Enter 実行。Esc で閉じる。

### 検索メカニズム

```ts
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q
    ? props.items.filter((it) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(q))
    : props.items
})
```

- label + hint(接続 hint はダイアレクト名)をマッチ、純粋な部分文字列 includes、**ピンイン / 順序マッチ不要**(タイピング速度がファジーより重要)
- 最大 50 件表示(長いリストのカクつき防止)

### 内蔵コマンド一覧

下表は `Workspace.vue` の `paletteItems` 計算プロパティの全量(アクション + 各接続専用アクション + 全接続エントリ):

| グローバルアクション ID | ラベル | 等価パス |
|---|---|---|
| `act:new-conn` | 新規接続 | ツールバー + |
| `act:object-search` | グローバルオブジェクト検索 | ⌘⇧O |
| `act:schema-diff` | Schema 比較 | ツール → Schema diff |
| `act:data-diff` | データ比較 | ツール → Data diff |
| `act:privileges` | 権限管理 | 接続右クリック → 権限 |
| `act:settings` | 設定 | ⌘, |
| `act:export-conns` / `act:import-conns` | 接続設定インポート / エクスポート | ファイルメニュー |
| `act:refresh` | ナビゲーションツリー更新 | F5 |
| `act:favorites` | お気に入り | ツールバー ⭐ |
| `act:oplog` | 操作ログ | ツールバー |
| `act:monitor` | 監視パネル | ツールバー |
| `act:dashboard` | Dashboard | ツール → Dashboard |
| `act:ndjson-viewer` | NDJSON ビューア | ツールバー |
| `act:contracts` | データコントラクト | ツール → データコントラクト |
| `act:o2dm` | Oracle → DM マイグレーションウィザード | ツールバー |
| `act:mig-assess` | 移行評価(ソース DB プロファイリング + 等級 + AI 変換 + エクスポート) | Oracle/DM 接続を右クリック |
| `act:translate` | SQL 翻訳(ダイアレクト横断) | ツールバー |
| `act:notif` | 通知 webhook 設定 | `Settings → 通知` |
| `act:keybind` | カスタムショートカット | `Settings → キーバインド` |
| `act:drift` | Schema ドリフト検出 | ツールバー |
| `act:ai-chat` / `act:ai` / `act:ai-toolbox` | AI チャット / AI アシスタント / AI ツールボックス | ⌘⇧L |
| `act:about` / `act:shortcuts` | About / ショートカットリファレンス | ヘルプメニュー |
| `act:new-window` | 新ウィンドウ(デスクトップ版のみ) | ⌘⇧N |

### 接続別専用アクション

下記アクションは「登録済み接続ごと」に 1 行ずつ展開、ラベル末尾は `· 接続名 · ダイアレクト`:

| ID プレフィックス | 意味 |
|---|---|
| `act:activity:` | サーバーアクティビティ(processlist / pg_stat_activity) |
| `act:obtopo:` | OceanBase クラスタートポロジー(OB ダイアレクトのみ表示) |
| `act:snapshots:` / `act:backup:` | Schema スナップショット / バックアップ復元 |
| `act:health:` / `act:vqd:` | AI ヘルスチェック / 可視化クエリビルダー |
| `act:slowq:` / `act:idxrec:` / `act:repl:` | スロークエリ分析 / インデックス推奨 / マスタースレーブ遅延 |
| `act:compliance:` / `act:search-value:` | コンプライアンスチェック / テーブル横断全文検索 |
| `act:aicmt:` | AI コメント作成 |
| `conn:` プレフィックス | 接続を直接開く(グループ = 「接続」) |

> 5 接続を持つワークスペースでは、コマンドパレットで 80+ コマンドが検索可能、グループラベル + 部分文字列 includes でフィルタ、3〜4 文字入力すれば位置決め可能。

### 拡張方法

コードは `paletteItems` 計算プロパティに集中。新規コマンドは 2 ステップ:配列に `{ id, label, group }` を追加、`onPaletteSelect()` に `else if (item.id === ...)` ルーティングを追加。「接続別展開」は `act:compliance:` のやり方を参考:`.map(c => ({ id: \`act:xxx:${c.id}\`, ... }))`、ルーティングで `item.id.startsWith()` で id を分解。

---

## 3. グローバルオブジェクト検索 ⌘⇧O

コード位置:`packages/ui/src/components/ObjectSearchDialog.vue`

⌘⇧O(mac)/ Ctrl+Shift+O(Win/Linux)でダイアログ表示、指定接続内で**複数 DB / schema をまたぐテーブル、ビュー、カラムのファジー検索**。

### 検索 SQL

`information_schema` 経由、MySQL 系 / PG 系の 2 セット SQL:

| ダイアレクトファミリー | 除外する schema | エスケープモード |
|---|---|---|
| MySQL 系 | `mysql / information_schema / performance_schema / sys` | `LIKE '%term%'`、`%_\\` 3 文字エスケープ |
| PG 系 | `pg_catalog / information_schema` | `ILIKE '%term%'` |
| その他 | — | 非対応、手動検索に誘導 |

各種別(テーブル / ビュー / カラム)それぞれ先頭 100 件取得、入力 280ms デバウンス。

### 結果挙動

- **行クリック = reveal**:emit `reveal` イベント、Workspace が受け取り左側のナビゲーションツリーで対象オブジェクトに位置決め(対応 DB が未展開なら一気に展開)
- **ホバーで「プレビュー」ボタン表示**:emit `preview`、直接 `SELECT * FROM schema.table LIMIT 200` を開く(ダイアレクトの識別子クォート経由)
- **アイコン**:`▦` テーブル / `◫` ビュー / `·` カラム

### 並行安全性

各入力で `seq` シーケンスをインクリメント、「最新一回」の結果のみコミット、入力が速い時に旧レスポンスが新しいものを上書きするのを回避。

---

## 4. SQL スニペットライブラリ

コード位置:`packages/ui/src/snippets.ts` + `packages/ui/src/components/SnippetsPanel.vue`

### データ構造

```ts
interface Snippet {
  id: string        // `${timestamp}-${rand5}`
  name: string      // ユーザー命名、空欄なら SQL 先頭 40 文字
  sql: string
  tags?: string[]   // 分類タグ、UI で # フィルタ
  dialects?: DbDialect[]  // ダイアレクト限定、空 = 汎用
  createdAt: number
}
```

`localStorage.skylerx.snippets` に保存、Vue `reactive` + `watch deep` でリアルタイム落地。

### 追加 / 削除

- 任意の SQL エディタ右クリック → 「スニペットとして保存」またはツールバー `★`
- クエリ履歴の各行の `★` ボタン → 直接スニペットにお気に入り
- `Settings → エディタ → スニペット保存` はデフォルト ⌘S にバインド(変更可)

### プレースホルダテンプレート

スニペット内の `{{var}}` は挿入時に prompt でユーザー入力を求める:

```sql
SELECT * FROM {{table}} WHERE id = {{id}}
```

`applySnippetVars()` は出現順にプレースホルダを抽出、1 つずつダイアログ表示、いずれかでキャンセル → 全体放棄、未完成 SQL を挿入しない。

### ダイアレクト別フィルタ

`snippetsForDialect(dialect)` はパネル内で現在のエディタが接続しているダイアレクトに応じて自動フィルタ:

- `dialects = []` または未設定 → 任意ダイアレクトで見える(「汎用」)
- `dialects = [MySQL, MariaDB]` → MySQL / MariaDB 接続でのみ出現

PG 接続で MySQL 専用構文を見るのを避けます。

### パネルインタラクション

| 操作 | 効果 |
|---|---|
| 上部検索枠 | 部分文字列フィルタ name + SQL + tags |
| タグバー `#xxx` クリック | タグでフィルタ、再クリックでキャンセル |
| スニペット行ダブルクリック | プレースホルダ適用後にエディタに挿入 |
| `×` | スニペット削除(確認なし) |

---

## 5. クエリ履歴

コード位置:`packages/ui/src/components/HistoryPanel.vue`

実行成功 / 失敗ごとにローカル SQLite にレコードを書き込み、フィールド:`sql / executedAt / durationMs / success / pinned / tags / note`。

### ソート + フィルタ

| コントロール | 説明 |
|---|---|
| 検索枠 | sql + tags + note を部分文字列スキャン |
| ソートドロップダウン | `時刻降順`(デフォルト)/ `所要時間降順` |
| `≥ N ms` | スロークエリフィルタ、閾値超の行**全体を赤染**(デフォルト 500ms) |
| `📌` | ピン留めのみ表示 |
| `クリア` | テーブル全体ワンクリッククリア |

ピン留めは常に最上位(`pinned: 1` で強制)、その他はユーザー選択のソート順。

### 行操作

| ボタン | 動作 |
|---|---|
| `📌` | ピン留め切替 |
| `🏷` | tags 変更(カンマ区切り、例 `daily,prod,join`) |
| `📝` | note 変更(自由テキストメモ) |
| `★` | SQL スニペットとして保存(emit `saveSnippet`) |
| 行ダブルクリック | SQL を現在のエディタにロード |

すべてのメタデータ変更は `client.connections.historyMeta(id, patch)` で SQLite に落とす、localStorage は経由しない。

### スロークエリ連動通知

`Settings → 通知 → グローバルトリガー → スロークエリ閾値 (ms)`(`settings.slowQueryNotifyMs`)。0 以外に設定すると、この閾値を超えるすべての実行が `notify('slow-query', ...)` → 対応 webhook チャネルをトリガー。

---

## 6. お気に入り

コード位置:`packages/ui/src/favorites.ts`

お気に入りは 3 種類の `kind` が可能:

| kind | 意味 | クリック挙動 |
|---|---|---|
| `table` | データテーブル | ナビゲーションツリーで reveal + 先頭 200 行プレビュー |
| `view` | ビュー | 上に同じ |
| `query` | カスタム SQL | 現在 / 新 tab で草稿として開く |

### 主キールール

- オブジェクト類:`${connId}|${sqlName}`、同接続内同オブジェクトを 1 回のみお気に入り、再クリックでキャンセル
- クエリ類:`q|${connId}|${createdAt}|${rand4}`、同 SQL の複数回お気に入り許容(シーン:同一クエリの異なる時刻の「スナップショット」)

### グループタグ

`setFavoriteTag(id, tag)` で 1 件のお気に入りにタグを付ける、パネルがタグで折りたたみ表示。1 件のお気に入りは最初のタグのみ取得、シンプルだが十分。

### 永続化

`localStorage.skylerx.favorites`、reactive + watch deep。

### クエリ履歴からワンクリックお気に入り

`addQueryFavorite({ connId, connName, dialect, name, sql, tags })` は「クエリを走らせて、これは残す価値がある」の高速経路。HistoryPanel の `★` ボタンは snippet 経由、ツールバーの「現在クエリをお気に入り」はこの関数経由。

---

## 7. カスタムショートカット(K1)

コード位置:`packages/ui/src/keybindings.ts` + `packages/ui/src/components/KeyBindingsDialog.vue`

エントリ:`Settings → キーバインド` / コマンドパレット → 「カスタムショートカット」。

### 12 個のバインド可能コマンド

| ID | デフォルト chord | 用途 |
|---|---|---|
| `run-sql` | `CmdOrCtrl+Enter` | SQL 実行 |
| `palette` | `CmdOrCtrl+K` | コマンドパレット |
| `object-search` | `CmdOrCtrl+Shift+O` | グローバルオブジェクト検索 |
| `ai-chat` | `CmdOrCtrl+Shift+L` | AI チャットパネル切替 |
| `new-conn` | `CmdOrCtrl+N` | 新規接続 |
| `new-query` | `CmdOrCtrl+T` | 新規クエリ |
| `close-tab` | `CmdOrCtrl+W` | タブを閉じる |
| `find` | `CmdOrCtrl+F` | エディタ検索 |
| `replace` | `CmdOrCtrl+H` | エディタ置換 |
| `format-sql` | `CmdOrCtrl+Shift+F` | SQL フォーマット |
| `save-snippet` | `CmdOrCtrl+S` | 現在 SQL をスニペットとして保存 |
| `settings` | `CmdOrCtrl+,` | 設定 |

### `CmdOrCtrl` のレンダリング規約

| プラットフォーム | リテラル `CmdOrCtrl+Shift+K` の表示 |
|---|---|
| macOS | `⌘⇧K`(システムメニュースタイル、連続記号、`+` なし) |
| Windows / Linux | `Ctrl+Shift+K` |

保存は一律 `CmdOrCtrl+...` の OS 非依存文字列、レンダリングはプラットフォームマッピング;`formatChord()` で実装。

### 録画フロー

1. コマンド行の「録画」をクリック → 行が録画状態に入り、不可視 `input`(`position: absolute; left: -9999px`)をレンダリングしてキーボードフォーカス取得
2. `keydown` を監視、`chordFromEvent(e)` が現在の組み合わせを解析:
   - 修飾キー順序は固定 `CmdOrCtrl → Shift → Alt`(文字列等価 ↔ chord リテラル等価を保証)
   - 単一文字は強制大文字、空白は `Space`、その他 `Enter` / `,` / `ArrowUp` はそのまま
   - 裸修飾キー(Shift のみ押し主キー未押下)は空文字列を返す
3. Enter で保存 / Esc でキャンセル / 空 draft で Backspace は「このコマンドを無効化」(空文字列で落地)

### 衝突検出

`conflicts` 計算プロパティが録画状態の `draftChord` を含めてマージ済みバインドをスキャン、2 つのコマンドが同 chord にバインドされていれば、行末に赤字で `"XX コマンドと衝突"` と表示、ユーザーがその場で確認。

### 保存 + 「デフォルトに戻す」

「デフォルトと異なる」項目のみ `settings.keyBindings`(`Record<string, string>`)に落とす。

- デフォルトに戻す → 自動で上書きから削除、ストレージをシンプルに保つ
- 「すべてデフォルトに戻す」 → `settings.keyBindings` をクリア、二重確認付き
- 「あるコマンドを無効化」 = 空文字列を書き込み、**key を保持**するが値が `''`

---

## 8. Dashboard — 複数 SQL 複数カード

コード位置:`packages/ui/src/components/DashboardDialog.vue`

エントリ:ツールメニュー → Dashboard / ⌘K → 「Dashboard」。

### カード構造

```ts
interface Card {
  id: string
  title: string
  connId: string
  sql: string
  lastRunAt?: number
  lastResult?: QueryResult | null
  lastError?: string | null
}
```

- `localStorage.skylerx.dashboard.cards` に永続化、ただし**`lastResult` は保存しない**(大きい可能性)、再オープン時にクリア
- 各行にタイトル + 接続名 + SQL プレビュー(200 文字切り詰め)+ 直近 5 行結果(60 文字切り詰め)表示

### 操作

| ボタン | 動作 |
|---|---|
| `+ カード追加` | 小フォーム表示:タイトル + 接続 + SQL(textarea 4 行) |
| `↻ 全更新` | `Promise.all(cards.map(runCard))` で並行実行 |
| カードヘッダ `↻` | 単一カード更新 |
| カードヘッダ `✎` | 編集フォームへ |
| カードヘッダ `×` | 削除(確認付き) |

### 意図的にしないこと(トレードオフ)

- **タイマー更新しない**:バックグラウンドで死んでしまうリスク、必要時に手動で ↻ 押下で十分
- **チャートを作らない**:「→ ChartDialog にジャンプ」のクリック動線がより明確な「見たい時に見る」経路
- **共有 / コラボなし**:v0.5 までは導入せず、クラウドサービス依存回避

---

## 9. Webhook 通知

コード位置:`packages/ui/src/notifications.ts` + `packages/ui/src/components/NotificationSettingsDialog.vue`

エントリ:`Settings → 通知` / ⌘K → 「通知 webhook」。

### 4 種類のチャネル

| Channel | URL 形態 | 署名 |
|---|---|---|
| `dingtalk` | DingTalk ロボット webhook | HMAC-SHA256(`ts\n${secret}`、key=`secret`)、クエリ `?timestamp=&sign=urlencoded(...)` に連結 |
| `feishu` | Lark ロボット webhook | HMAC-SHA256(空 data、key=`ts\n${secret}`)、sign を body フィールドに |
| `slack` | Slack incoming webhook | 署名なし(URL が証明) |
| `webhook` | 汎用 POST JSON | 署名なし、受信側で自前解析 |

署名アルゴリズムは `globalThis.crypto.subtle` の HMAC-SHA256、**サードパーティ依存なし**。

### 3 種類のトリガーイベント

| Event | トリガータイミング |
|---|---|
| `query-error` | SQL 実行失敗 |
| `slow-query` | 実行時間 ≥ `settings.slowQueryNotifyMs`(0 = オフ) |
| `manual` | ユーザーが「テスト送信」/ ツールバーの「通知」をクリック |

各設定が独立してこの 3 イベントを購読可能(`subscribe: NotifEvent[]`)。

### 設定項目

```ts
interface NotifConfig {
  id: string
  name: string
  channel: 'dingtalk' | 'feishu' | 'slack' | 'webhook'
  webhookUrl: string
  secret?: string           // DingTalk/Lark 署名鍵(任意)
  enabled: boolean
  subscribe: NotifEvent[]
}
```

`localStorage.skylerx.notifications` に保存、`settings` から独立(通知量大、変動頻繁、settings と同期するとノイズになる)。

### テスト送信

`Settings → 通知` で設定を選択 → 「テスト送信」。発効条件:

- `enabled === true`
- `webhookUrl` 非空
- `subscribe.includes('manual')`(テストは `notify('manual', ...)` 経由のため)

いずれか満たさない場合 toast 提示、実際には送らない。

### 派遣はメインフローをブロックしない

`notify(event, payload)` は fire-and-forget:

```ts
await Promise.all(targets.map(async (c) => {
  try { await dispatchOne(c, payload) }
  catch (e) { console.warn(`[notify] ${c.channel}/${c.name} failed:`, e) }
}))
```

単一の webhook 失敗はすべて飲み込み、コンソールに warn のみ。**通知は補助チャネル、メインフローを引きずれない**。

### デスクトップ版プロキシ fetch

デスクトップ Electron は優先で `globalThis.api.ai.fetch` IPC プロキシを経由、ブラウザ CORS を回避;Web 版はネイティブ `fetch` にフォールバック。

---

## 10. アプリケーションメニュー構造

コード位置:`apps/desktop/src/main/menu.ts`

7 つのトップレベルメニュー(DataGrip / Navicat レイアウト参照):

| メニュー | 主な項目 |
|---|---|
| **SkylerX**(mac のみ) | About / 設定 ⌘, / 更新確認 / サービス / 隠す / 終了 |
| **ファイル** | 新規接続 ⌘N / 新規クエリ ⌘T / SQL ファイル開く ⌘O / 接続設定インポート · エクスポート / バックアップ · 復元 / タブを閉じる ⌘W |
| **編集** | システム role(取消 / やり直し / 切取 / コピー / 貼付 / 全選択)+ 検索 ⌘F / 置換 ⌘H / SQL フォーマット ⌘⇧F |
| **表示** | コマンドパレット ⌘K / オブジェクト検索 ⌘⇧O / AI チャット切替 ⌘⇧L / お気に入り / 操作ログ / ズーム / フルスクリーン / 開発者ツール |
| **ツール** | サーバーアクティビティ / バックアップ復元 / データ転送 / Schema diff / Data diff / Schema スナップショット / Dashboard / テーブル横断全文検索 / データコントラクト / AI ツールボックス / AI アシスタント |
| **ウィンドウ** | 新ウィンドウ ⌘⇧N / 最小化 / リロード / (mac)全ウィンドウを前面 |
| **ヘルプ** | About / ショートカットリファレンス / GitHub リポジトリ / 問題報告 / 更新確認 |

### 実装詳細

カスタムメニュー項目は**メインプロセスで業務ロジックを直接実行せず**(レンダラ層 Vue 状態を取得できない)、統一で `webContents.send('menu:command', '<key>')` でレンダラ層に通知。レンダラ層は `Workspace.vue` で `window.api.menu.onCommand(key => ...)` を購読、key で対応 paletteItem の `onPaletteSelect` にルーティング。

---

## 11. Settings 全体像

コード位置:`packages/ui/src/components/SettingsDialog.vue`

`Settings` ダイアログ左側に 5 つの分類タブ、右側に動的にフォームをレンダリング。

| 分類 | 主な項目 |
|---|---|
| **一般** ⚙ | 言語(中 / 英)、テーマ(深 / 浅)、UI 拡大(70% - 200%)、コミットモードデフォルト(auto / manual)、NavTree を使用頻度でソート、**データマスキングスイッチ + ルール編集** |
| **エディタ** ⌨ | フォントサイズ、インデント、自動折り返し、自動補完スイッチ、キーワード大文字小文字(upper / lower / preserve) |
| **データグリッド** ▦ | デフォルトページサイズ(50 / 100 / 200 / 500 / 1000)、NULL 表示文言 |
| **本番ウォーターマーク** ⚠ | 文言、透明度(0.04 - 0.5)、角度(-90° - 90°)、フォントサイズ、色;リアルタイムプレビュー付き |
| **AI アシスタント** ✨ | Provider 切替(Anthropic / OpenAI / DeepSeek / Codex / Grok)、API Key / Model / Base URL、メモリとプロファイル(A 自由テキスト / B 構造化事実 / C ベクトルメモリ) |

> **テーマ関連項目**:`Settings → 一般 → テーマ` でダーク / ライト切替、全パネルに影響。ダークがデフォルト(`appearance: 'dark'` は VitePress / Electron レンダリング CSS 変数に記述)。

### 「AI メモリ」3 層

| 層 | フィールド | 意味 |
|---|---|---|
| A | `aiCustomInstructions` | 自由テキストプロファイル、各対話で system prompt に連結 |
| B | `aiFacts[]` + `aiAutoExtractFacts` | 構造化事実リスト、手動 / 自動抽出可 |
| C | `aiVectorMemory` + embedding 3 点セット + `aiVectorTopK` | ベクトルメモリ、セッション横断のセマンティック呼び出し |

下部の `デフォルトに戻す` で settings 全体リセット、二重確認付き。

---

## 12. 複数ウィンドウ ⌘⇧N

コード位置:`apps/desktop/src/main/index.ts` の `spawnExtraWindow()` + IPC `window:newSession`

⌘⇧N(mac)/ Ctrl+Shift+N(Win/Linux)で完全に新しい BrowserWindow(1100 × 750)、同じ renderer URL を再利用、メインウィンドウとは**完全独立のセッション**。

### 典型用途

| シナリオ | やり方 |
|---|---|
| ローカル比較リモート | メインウィンドウでローカル dev に接続、新ウィンドウで prod replica に接続、並べて見る |
| マルチテナント切替 | 1 ウィンドウでテナント A、1 ウィンドウでテナント B |
| 大クエリ + 隣で書きながら確認 | メインウィンドウでスロー SQL 実行、新ウィンドウで次のセグメントを書く |

各ウィンドウは独立した SQL タブ / 現在選択中の接続 · DB · schema / エディタカーソル位置を持つ。履歴 / お気に入り / スニペットは**共有**(localStorage 同源 + SQLite 単一ファイル)。

「ウィンドウ間同期」はしない(2 ウィンドウの同接続の実行は相互に見えない、それぞれが自分の historyPanel に書き込む);「ウィンドウマネージャ」もしない、ウィンドウ数に上限なし、OS の Mission Control / Exposé を使用。

---

## 13. 生産性ショートカット早見表

デフォルトバインドは以下、すべて `Settings → キーバインド` でリバインド可能(`new-window` はメニュー項目、`COMMANDS` 表外)。

| 操作 | macOS | Windows / Linux | コマンド ID |
|---|---|---|---|
| コマンドパレット | ⌘K | Ctrl+K | `palette` |
| グローバルオブジェクト検索 | ⌘⇧O | Ctrl+Shift+O | `object-search` |
| SQL 実行 | ⌘+Enter | Ctrl+Enter | `run-sql` |
| AI チャット切替 | ⌘⇧L | Ctrl+Shift+L | `ai-chat` |
| 新規接続 / 新規クエリ / タブを閉じる | ⌘N / ⌘T / ⌘W | Ctrl+N / T / W | `new-conn` / `new-query` / `close-tab` |
| 検索 / 置換 / SQL フォーマット | ⌘F / ⌘H / ⌘⇧F | Ctrl+F / H / Shift+F | `find` / `replace` / `format-sql` |
| スニペットとして保存 / 設定 | ⌘S / ⌘, | Ctrl+S / Ctrl+, | `save-snippet` / `settings` |
| 新ウィンドウ | ⌘⇧N | Ctrl+Shift+N | (メニュー項目) |
