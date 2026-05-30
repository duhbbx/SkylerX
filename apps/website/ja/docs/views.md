# 結果セットの代替ビュー

SQL を実行して結果セットを取得すると、デフォルトで表示されるのはグリッドです([結果セットグリッド](./grid.md) を参照)。しかし、グリッドが常に最良の見せ方とは限りません — 100 行の `(month, revenue)` を見て傾向を掴むには、表より折れ線グラフの方が遥かに直観的です。SkylerX は結果ツールバーに**代替ビュー**を用意し、データを再実行せず、メモリ内で現在の結果セットを別形態に切り替えて表示します。

本ページで明確にすること:**いつビューを切り替えるか、各ビューの計算方法、要求するデータ形状、成果物の保存形式**。

## グリッドより代替ビューが直観的な場面

| データ形状 | 推奨ビュー | 典型シナリオ |
|---|---|---|
| カテゴリ列 + 数値列 | 棒グラフ / 円グラフ / 環形 | 都市別売上、endpoint 別エラー |
| 時刻列 + 数値列(連続) | 折れ線 / 面積 | DAU トレンド、CPU 使用率 |
| 数値列 × 2(関連性) | 散布図 | ユーザーアクティブ vs リテンション |
| カテゴリ / 数値列 × 3 | ピボットテーブル | チャネル × 月 = 収益 |
| `(lat, lng)` 2 列 | 地理散布図 | 店舗分布、ユーザーマップ |
| 時刻列 + label 列 | タイムライン | デプロイイベント、注文ライフサイクル |
| `(id, parent_id, ...)` | 自己参照 FK ツリー | コメントスレッド、組織部門 |
| 同一行の複数履歴 | 行変更履歴 | audit テーブル追跡 |

下部バーのトリガー(`packages/ui/src/components/ResultGrid.vue:1202-1215`):

```vue
<button :disabled="!result?.rows.length" @click="chartOpen = true">📊 チャート</button>
<div class="menu-box">
  <button @click="showViewMenu = !showViewMenu">📐 ビュー</button>
  <!-- ポップアップメニュー -->
  <button @click="altView = 'pivot'">⊞ ピボット</button>
  <button @click="altView = 'tree'">🌳 ツリー</button>
  <button @click="altView = 'geo'">🗺 地理</button>
  <button @click="altView = 'timeline'">⏱ タイムライン</button>
</div>
```

これらのビューはすべて modal で開き、閉じるとグリッドに戻ります — グリッドの「拡大鏡」であって、グリッドを置き換えるものではありません。

## 1. チャートビュー(棒 / 折れ線 / 円 + 4 種類の拡張)

`packages/ui/src/components/ChartDialog.vue`、**630 行**、トリガーボタン:**📊 チャート**。

### 設計選択

コードコメントが率直に説明しています:

> ECharts を使わず、SVG を手書き(棒 / 折れ線 + 円グラフをそれぞれ約 100 行ずつ)、理由:
> - デスクトップアプリのサイズに敏感、チャートは結果グリッドの「小道具」であってメインステージではない
> - 3 種類のチャートが臨時のデータ確認シナリオの 90% をカバー、より華美なら ECharts への切替も後で間に合う
> - SVG レンダリングは PNG エクスポートが容易(toDataURL via `<canvas>`)

7 種類のチャートはすべて純粋な手書き SVG:

| チャート | 適用 | 上限 | 備考 |
|---|---|---|---|
| 📊 棒グラフ(bar) | カテゴリ数値比較 | 先頭 50 行 | Y 軸自動 round 上限 |
| 📈 折れ線(line) | 傾向 / 時系列 | 先頭 200 行 | `M / L` パス |
| 🥧 円グラフ(pie) | 構成比 | 先頭 50 行 | 自動パーセント表示 |
| ⛰ 面積(area) | 傾向 + 量級 | 先頭 200 行 | 折れ線を baseline まで閉じる |
| ·· 散布図(scatter) | 離散点群 | 先頭 200 行 | 円ドット |
| ⭕ 環形(donut) | 構成比の変種 | 先頭 50 行 | 外環 `r * 1.0`、内孔 `r * 0.55` |
| 📡 レーダー(radar) | 多次元比較 | 先頭 50 行、最低 3 点 | 1 行 1 軸 |

### 列選択

上部 3 つのセレクタ:**Label**(任意列、`.toString()`)、**Value**(数値列を自動嗅ぎ取り、非数値列はカラム名後ろに `(?)`)、**種別**。`isNumericColumn` は先頭 20 行で `Number.isFinite(Number(v))` を嗅ぎ取り、デフォルト Y 列 = 最初の数値列。result 切替時に `watch` で選択をリセット。

データ規則:`Number(v)` が NaN の行はスキップ、行数が上限超なら先頭 N 行のみ取得(棒 / 円 50、折れ線 / 面積 / 散布図 200、レーダー 50)。

### Y 軸

刻みを「綺麗に」見せるため、上限は `Math.ceil(m / 10^floor(log10(m))) * 10^floor(log10(m))` で丸める。刻み数字は `B / M / k`(1e9 / 1e6 / 1e4 超)でフォーマット。

### 成果物:PNG エクスポート

ツールバー右側 `⬇ PNG エクスポート` → `XMLSerializer` で SVG をシリアライズ → `<canvas>` 2× HiDPI 描画(ダーク背景 `#1d1e22`)→ `canvas.toBlob('image/png')` → カスタム `SaveFileDialog`。ファイル名 `chart-{kind}-{ts}.png`、解像度 1440×720、Lark / Slack に直接貼るのに適しています。

## 2. ピボットテーブル(PivotDialog)

`packages/ui/src/components/PivotDialog.vue`、162 行。トリガー:**📐 ビュー → ⊞ ピボット**。

位置付け:**メモリ内で**現在の結果セットに対して pivot を実行、SQL を再実行しない。アルゴリズムは複雑ではない — 行を `(rowFields...)` でグループ化 → グループ内を `colField` でバケット化 → バケット内で `agg`。

### 3 軸 + 集約関数 1 つ

| コントロール | 動作 |
|---|---|
| **行**(chips 複数選択) | これらの列でグループ化、key は `'\|'` で連結 |
| **列**(ドロップダウン) | この列のすべての distinct 値を表頭の列に展開(辞書順) |
| **値** + 集約 | 各 (row, col) セル内でこの列を集約 |
| 集約ドロップダウン | `COUNT / SUM / AVG / MIN / MAX` |

### アルゴリズム

2 層ネスト `Map<rowKey, Map<colKey, number[]>>`:`result.rows` を 1 回スキャン、`rowKey` は `rowFields` 各列文字列を `|` で連結、`colKey` は `colField` の文字列値、`Number(row[valueField])` を配列に入れる。`NULL` は一律リテラル `'NULL'`(同一グループ集約)。COUNT は `length`、その他は数値集約。

### 制限

コードコメントの直言:

> 未対応:複数 value field、順序付き列名(pivot 列は辞書順)、フィルタ。次バージョンで補完可能。

つまり — 「月で 1〜12 順に並べたい、10、11、12、1、2... ではなく」は現状不可、SQL で先にゼロパディング文字列(`'01' / '02' / ...`)にする必要があります。

### 成果物

一時的なテーブルビューにすぎず、直接エクスポート不可。データを永続化したい場合の推奨:

- ピボットを閉じてグリッドに戻る → 右クリックでコピー → CSV / Markdown を選択して Excel / Notion に貼り付け
- ピボットロジックを SQL で書き直し:MySQL の `GROUP BY x WITH ROLLUP` / PG の `crosstab()`

## 3. 地理散布図(GeoMapDialog)

`packages/ui/src/components/GeoMapDialog.vue`、138 行。トリガー:**📐 ビュー → 🗺 地理**。

leaflet を使わず、ベースマップも描かず、SVG で `(lng, lat)` の散布点を直描。コードコメントの説明:

> 投影:等距等距投影(Mercator は視覚変形小、ローカルデータは経緯度直描で十分、複雑な座標系は不要)。
> 未対応:ベースマップ(tiles 不使用)、クラスタリング(点が多すぎるとぼやけるがドラッグ zoom で解決)。

### 自動列認識

```ts
latCol = cols.find(c => /^(lat|latitude|y)$/i.test(c)) ?? cols[0]
lngCol = cols.find(c => /^(lng|lon|long|longitude|x)$/i.test(c)) ?? cols[1]
labelCol = cols.find(c => /^(name|title|label|id)$/i.test(c)) ?? ''
```

数値妥当性のハードフィルタ(ゴミデータ防止):

```ts
if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
```

### 自動視野フレーム

世界地図全体ではなく、bounds は「全点を包む + 5% マージン」で計算:

```ts
const dx = Math.max(0.001, (maxX - minX) * 0.05)
return { minX: minX - dx, maxX: maxX + dx, ... }
```

4 隅の経緯度数値が SVG 境界に表示、マウス hover で `lat=... lng=...` 表示。

### 成果物

ビジュアル閲覧のみ、PNG エクスポートなし(次バージョンで追加可能)。永続化された可視化が欲しい場合、SQL 出力にカテゴリ列を追加し、チャートビュー(散布図)でスクリーンショットも可。

### データ形状要件

| 列名互換 | 例 |
|---|---|
| `lat`, `latitude`, `y` | `latitude FLOAT` |
| `lng`, `lon`, `long`, `longitude`, `x` | `lng DECIMAL(9,6)` |
| `name`, `title`, `label`, `id`(label、任意) | `store_name VARCHAR` |

標準名でなくても OK — ドロップダウンから手動選択可、値が数値で範囲内であれば。

## 4. タイムライン(TimelineDialog)

`packages/ui/src/components/TimelineDialog.vue`、171 行。トリガー:**📐 ビュー → ⏱ タイムライン**。

### 自動列認識

```ts
timeCol = cols.find(c => /at$|_time$|date|time|created|updated/i.test(c)) ?? cols[0]
labelCol = cols.find(c => /^(name|title|label|id|user|action)$/i.test(c)) ?? ''
colorCol = ''   // オプション:この列でカテゴリ色付け
```

`created_at / updated_at / event_time / order_date / login_time` 等にフォールバックヒット。

### 時刻値解析(`toMs`)

4 形式すべて対応:

```ts
function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000   // ms または s ヒューリスティック
  const ms = Date.parse(String(v))  // ISO / "YYYY-MM-DD HH:MM:SS"
  return Number.isNaN(ms) ? null : ms
}
```

> 1e12(2001 年)以下の数値は Unix 秒として ×1000、それ以上は ms とみなす。一般業務時間には十分、極少数の 1969 年以前のタイムスタンプは誤判定 — 該当データがあれば先に SQL の `to_char(...)` で文字列に変換。

### レンダリング

水平タイムライン、イベント点は上下に互い違いで重複防止(`i % 2 === 0 ? -16 : +16`)、X 軸 5 セグメント等距離刻みで日付表示。

**color** 列指定時、distinct 値に順次 8 色パレット(`#7c6cff / #4caf50 / #e0a020 / #e04050 / #3aa1ff / #b48cff / #67c23a / #ff9966`)、下部に legend 凡例。点上にマウス hover、下部情報バーに `時刻 · label` 表示。

### データ形状要件

最低 1 つの時刻列(任意の Date / ISO / Unix 秒 or ミリ秒)。Label / Color は両方オプション。

## 5. 自己参照 FK ツリー(TreeViewDialog)

`packages/ui/src/components/TreeViewDialog.vue`、130 行。トリガー:**📐 ビュー → 🌳 ツリー**。

**自己参照外部キー**または階層データに適合:コメントスレッド(`comments.parent_id → comments.id`)、組織部門(`departments.parent_dept_id → id`)、地理行政区(`regions.parent_id`)。

### 3 つの軸

| セレクタ | 推論ルール |
|---|---|
| **id** | `/^id$/i` を優先マッチ、なければ最初の列 |
| **parent** | `/parent[_-]?id\|pid/i` マッチ、デフォルト空 |
| **label** | `/^(name\|title\|label)$/i` マッチ、なければ id にフォールバック |

### アルゴリズム

2 パススキャン:第 1 パスで id をインデックス化(`byId: Map<id, node>`)、第 2 パスで子を親にぶら下げ、親 id がインデックスにない(NULL 含む)場合はルート。`parent === self` はルート扱い(`WHERE id=1 AND parent_id=1` のような偽レコードを防止)。

### サイクル検出

`walk(n, depth)` の DFS で `Set<string>` を使い訪問済み記録、再度同 id に遭遇したら `n.cycle = true` でストップ。該当ノード横に黄色 `⚠`、マウス hover で「サイクル」と提示。データが運用ミスで改変された後(親子関係が循環してしまった)によく見られます。

### レンダリング

flatten 後、`depth * 18px` のインデント、各ノードは `▸ <label> #<id>` で表示。マウス hover label で `title="{json}"` の完全な行データ表示(目視確認に便利)。

### データ形状要件

最低 id + parent の 2 列必要、1 つの `SELECT id, parent_id, name FROM comments WHERE post_id = 1234` でツリー全体を 1 回で取得、ビューは自動で階層をレンダリング。

## 6. 行変更履歴(RowHistoryDialog)

`packages/ui/src/components/RowHistoryDialog.vue`、123 行。

位置付け:**単一行のバージョン追跡** — あるテーブルのある行の主キーを与え、`audit / *_history / *_log` シャドウテーブルでのすべてのバージョンを検索。

### シャドウテーブル自動発見

開く時に自動で `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '{base}_%' OR table_name = 'audit_{base}' OR table_name = '{base}_history'` を実行、候補を `<datalist>` ドロップダウンに表示、ユーザーが選択または手入力。

### 履歴取得

シャドウテーブル確定後、PK 条件で `SELECT * FROM {shadow} WHERE {pk}=... ORDER BY changed_at, updated_at, created_at, version, revision DESC LIMIT 200`。ORDER BY は 5 つの候補列名を一気に列挙、DB は存在するものを使う(MySQL は寛容 / PG は厳格、よくある audit テーブルは少なくとも 1 つを持つ)。結果はコンパクトな mini テーブルで表示、各セルは 80 文字に切り詰め。

### データ形状要件

業務テーブル + 1 つの `*_history` / `*_audit` / `*_log` シャドウテーブル(主キー + 業務列複製 + `changed_at / version` フィールド)が必要。一般的な audit trigger 実装はこの規約を満たします。

> 実装メモ:このダイアログはリポジトリ内に既に書かれている(`Workspace.vue` に `rowHistOpen` 状態と modal マウントあり)、現状は結果グリッド右クリックから直接開くエントリはない — 後続の右クリックメニュー組み込み用に予約された機能。

## 7. データリネージ(LineageDialog)— ヒューリスティック版

`packages/ui/src/components/LineageDialog.vue`、98 行。

コードコメントが冒頭で明言:

> 列リネージ(ヒューリスティック版):まだ真の SQL parser がないため、最も簡易なヒューリスティック使用 — 履歴 SQL テキストに「`{table}.{column}`」または裸 `{column}`(前提として SQL で `{table}` を FROM しているもの)を含むものを関連とみなす。
> 精度には限界がある:漏れ(エイリアス / サブクエリ)、誤検出(同名列)。ユーザーに明確に「heuristic」版と告知、SQL parser 上線後に真のリネージ分析に置換予定。

### アルゴリズム

本接続の最近 500 件履歴 SQL を取得、1 件ずつ `\b{table}\b` + `\b{column}\b` の 2 つの word-boundary 正規表現でテキストマッチ。ヒット後に先頭を見る:`INSERT / UPDATE` → sinks に入る(書き込み)、`SELECT / WITH` → sources に入る(読み込み)。

### レンダリング

2 カラム:

- **← Sinks** — データをこの列に**書き込む**SQL(INSERT / UPDATE)
- **→ Sources** — データをこの列から**読み出す**SQL(SELECT / WITH)

各行に実行時刻 + 先頭 120 文字の SQL サマリーを表示。上部の黄色バナーで「これはヒューリスティック結果、監査根拠にしないこと」とユーザーに告知。

### データ形状要件

**クエリ履歴**(`client.connections.history`)に依存。関連クエリを SkylerX で実行したことがない場合、リネージウィンドウは「No hits」を表示。

> 実装メモ:RowHistoryDialog と同様、`Workspace.vue` でマウント済み、外部 trigger(`lineageOpen.value = {...}`)が必要、現状専用 UI エントリなし、予約 API として。

## サポートマトリックス

| ビュー | 自動列認識 | データ規模上限 | 静的エクスポート | SQL 再実行 | 適合 |
|---|---|---|---|---|---|
| チャート(7 種) | 数値列嗅ぎ取り | 50 / 200 行 | PNG(2× HiDPI) | 否 | 量級 / 傾向 / 構成比を一目で把握 |
| ピボットテーブル | 1/2/3 列目 | ブラウザメモリ依存 | CSV としてコピー | 否 | 2 軸交差集約 |
| 地理散布図 | `lat / lng / x / y` エイリアス | 上限なし | 否 | 否 | 経緯度直描 |
| タイムライン | `at$ / time / date / created` サフィックス | 上限なし | 否 | 否 | イベントフロー + カテゴリ色付け |
| ツリー | `id / parent_id / name` | 上限なし | 否 | 否 | 自己参照 FK 階層 |
| 行履歴 | テーブル名 `*_history / *_audit` ヒューリスティック | 200 行(SQL LIMIT) | 否 | ✓(audit テーブル取得) | 単一行バージョン追跡 |
| データリネージ | — | 履歴 500 件 | 否 | 否 | 列の読み書き関係(ヒューリスティック) |

## トリガー方法一覧

| ビュー | エントリ | 備考 |
|---|---|---|
| チャート | 結果ツールバー `📊 チャート` | 棒グラフをデフォルトで直接開く |
| ピボット / ツリー / 地理 / タイムライン | 結果ツールバー `📐 ビュー → ポップアップメニュー` | 同 modal で `altView` 状態を共有 |
| 行履歴 | `rowHistOpen.value = { conn, table, pk }` でトリガー | 現状予約、右クリックメニュー組み込み待ち |
| データリネージ | `lineageOpen.value = { conn, table, column }` でトリガー | 現状予約、右クリックメニュー組み込み待ち |

すべての modal を閉じると元のグリッドに戻り、ページネーション / 並び替え状態は失われません — グリッドの上に「拡大鏡」を被せるだけで、結果セット自体を置き換えるものではありません。

## ビュー選択の意思決定ツリー

**量級 / ランキング / 傾向 / 構成比**を見たい?→ チャート
- 量級 vs 時刻 → 折れ線 / 面積
- カテゴリランキング → 棒グラフ
- 構成比 → 円 / 環形
- 多次元 → レーダー

**2 軸交差**(例「チャネル × 月」)を見たい?→ ピボット

データに **`(lat, lng)`** あり → 地理散布図

データに **時刻列** あり:
- 時系列値連続(毎日の DAU)→ 折れ線
- 離散イベント(デプロイ、リリース、アラート)→ タイムライン

データが **自己参照 FK** → ツリー

**特定行の履歴変化**を見たい → 行履歴

**この列を誰が読み / 書きしているか**探したい → データリネージ(ヒューリスティック、慎重に使用)

これで結果セット層面のすべての代替ビューをカバーしました。データ形状が上記のいずれにも該当しない場合、90% は SQL を書き換えればいずれかのビューに収まります — どうしてもダメな場合はグリッドに戻り、コピー機能で Excel / Numbers / Notion に貼り付けて続き処理してください。

SQL 自体の実行状況(スローログ、Explain、インデックス推奨)は [高度な機能](./advanced.md) を、データのエクスポート / インポートは [データマイグレーション](./databases.md) を参照してください。
