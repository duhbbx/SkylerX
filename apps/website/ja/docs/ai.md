# AI アシスタント

SkylerX は AI を**複数の独立したチャネル**としてプロダクトの異なる場所に注入しています。1 つのチャットボックスで何もかも済ますわけではありません:

- **右側チャットパネル**(`⌘⇧L`):マルチターン対話 + DB 構造の注入 + SQL のワンクリック挿入 / 実行
- **インライン補完**:エディタ内のグレーのゴーストテキスト(Copilot 風)
- **エラー診断「AI に質問」**:任意のエラーダイアログ / 結果エリアにボタン
- **AI Toolbox**:7 種類の常用プロンプトの統一エントリ
- **領域特化ダイアログ**:ヘルスチェック / インサイト / テーブル設計 / リバース / コメント / 翻訳 / テストデータ

下層では `provider 抽象化 + 3 層メモリ + マルチチャネル IPC` を共有しています。本章では全機能をコードの事実に基づいて説明し、主観的な誇張は排します。

## 1. 概要 — マルチ provider + 並列チャネル

| モジュール | ファイル | 役割 |
|---|---|---|
| `askAi()` / `askAiChat()` | `ai.ts` | provider の振り分け(Anthropic vs OpenAI 互換)、HTTP リクエスト(メインプロセス IPC 経由可)、中断可能 |
| `pXxx()` prompts | `ai-prompts.ts` | 9 種類の領域別プロンプトテンプレート、純粋な文字列組み立て |
| インライン補完 | `aiInline.ts` | Monaco InlineCompletionsProvider、600ms スロットル + AbortController |
| 3 層メモリ | `memory.ts` | A プロファイル / B 事実 / C ベクトルメモリ、統一の `buildMemorySection()` を system prompt に注入 |
| チャットパネル | `AiChatPanel.vue` | 右側サイドバー、schema 注入 + chat-bus 受信 |
| 領域ダイアログ | `Ai*Dialog.vue` | ヘルスチェック / インサイト / テーブル設計 / リバース / コメント / テストデータ |
| ダイアレクト間翻訳 | `SqlTranslateDialog.vue` | 通常 SQL + ストアドプロシージャの 2 モード |

すべてのチャネルは下層で `askAi*` → IPC fetch → 同じ provider 設定を経由します。provider を切り替えると **すべてのチャネルが即座に切り替わります**。

## 2. Provider 設定

`Settings → AI Provider` は 5 種類の provider をサポート:

| Provider | プロトコル | エンドポイント |
|---|---|---|
| **Anthropic** | Anthropic Messages | `${baseUrl}/v1/messages`、`x-api-key` 認証 |
| **OpenAI** | OpenAI Chat | `${baseUrl}/v1/chat/completions`、`Authorization: Bearer` 認証 |
| **DeepSeek** | OpenAI 互換 | 上に同じ |
| **Codex** | OpenAI 互換 | 上に同じ |
| **Grok / xAI** | OpenAI 互換 | 上に同じ |

実際のコード(`ai.ts → askAi`):

```ts
const provider = settings.aiProvider
const cfg = settings.aiProviders[provider]
if (!cfg?.apiKey?.trim()) throw new Error('NO_API_KEY')
if (provider === 'anthropic') return callAnthropic(o, cfg.apiKey.trim(), base, model)
return callOpenAiCompat(o, cfg.apiKey.trim(), base, model)
```

### カスタムエンドポイント

各 provider は独立した `baseUrl` を持ち、フィールドを変更するだけです:

| シナリオ | 設定 |
|---|---|
| 自前の Anthropic プロキシ | provider=Anthropic、`baseUrl=https://your-proxy.example.com` |
| プライベート OpenAI 互換(vLLM / Ollama / one-api) | provider=OpenAI、`baseUrl` と `model` を変更 |
| DeepSeek 直接接続 | `https://api.deepseek.com`、`model=deepseek-chat` |
| Grok 直接接続 | `https://api.x.ai`、`model=grok-3-mini` |

### API Key の暗号化保存

Key は接続パスワードと同様にシステムキーチェーン(macOS Keychain / Windows Credential / GNOME libsecret)経由で保存され、`settings.aiProviders[*].apiKey` はディスク上では暗号化形式です。

### IPC を経由する? ブラウザから直接送信する?

デスクトップ版の preload は `window.api.ai.fetch`(メインプロセスがプロキシ、ブラウザの CORS を回避、真のキャンセル可能)を公開します。Web 版はネイティブ `fetch` にフォールバック。`ai.ts → aiBridge()` が自動選択:

```ts
function aiBridge() {
  return globalThis.api?.ai ?? null
}
```

IPC パスはレンダラ層の `AbortSignal` をメインプロセスの `ai:cancel` にもチェーンし、**進行中のリクエストを本当にキャンセルできます**(レスポンスを破棄するだけではない):

```ts
const reqId = `r${Date.now()}-${random}`
init.signal?.addEventListener('abort', () => bridge.cancel?.(reqId))
```

## 3. 右側チャットパネル — AiChatPanel

`⌘⇧L` / `Ctrl+Shift+L` で表示を切替。パネル左端をドラッグして幅を調整可能(`280-800px`)、幅は `skylerx.aiChat.width` に永続化されます。

### コンテキストバー(上部)

| コントロール | 役割 |
|---|---|
| **接続選択** | 現在の対話がどの接続を指すか(ダイアレクト + schema のソースを決定) |
| **DB / schema 選択** | MySQL は `SCHEMATA`、PG は `pg_namespace`。システム DB は自動でフィルタ |
| **DB 構造を添付** チェックボックス | チェックすると `information_schema.COLUMNS` を取得し `tbl(col1 type, col2 type, ...)` に整形して system prompt に注入(6000 文字制限) |
| **新規対話** / **クリア** | 現在の履歴をクリアし新しい対話を開始 |

### Schema 注入の実装

MySQL は `information_schema.COLUMNS`、PG は `information_schema.columns`。テーブル別にグループ化し `tbl(col1 type, col2 type, ...)` を 1 行 1 テーブルとして整形、6000 文字を超えると切り詰め + `-- (truncated)` を追加。**テーブル名 + カラム名 + 型のみ送信、データは送信しません**。

### マルチターン対話

メッセージは `localStorage` の key `skylerx.aiChat.messages` に保存、最大 50 件。各 `send()`:

```ts
const memorySection = await buildMemorySection(text)  // A/B/C 3 層メモリ
const reply = await askAiChat({
  messages: messages.value,           // 全履歴
  dialect: connOf(connId.value)?.dialect,
  schema: useSchema.value ? schemaText.value : undefined,
  memorySection,
  signal: controller.signal,
})
```

返信受信後はバックグラウンドで:
- `autoExtractFacts({ user, assistant })` — LLM に長期記憶すべき事実 1〜3 件を抽出させ B 層に保存
- `rememberVector(\`Q: ${user}\nA: ${assistant}\`)` — ベクトル化して C 層に保存

### 思考中タイマー + 停滞ヒント

`elapsedTimer` は毎秒 +1 され、`12s` のように表示。20s 超で自動的に赤色の `maybeStuck` ヒントを追加。`[停止]` ボタンは `controller.abort()` を呼び(IPC パスでは真の中断)。

### SQL コードブロックの特殊レンダリング

返信は `splitParts` で ` ``` ` を境にスライス、SQL セグメントは Monaco `editor.colorize` で非同期ハイライト(コンテンツハッシュをキーに `sqlHtml` にキャッシュ)、非 SQL セグメントは `renderMarkdown` で GFM レンダリング。

各 SQL セグメントの下に 3 つのボタン:

| ボタン | 動作 |
|---|---|
| `コピー` | `navigator.clipboard.writeText` |
| `下書きに挿入` | `emit('insertSql', sql, connId)` → Workspace が QueryPane に注入 |
| `▶ 実行` | 二重確認 → `emit('runSql', ...)` → Workspace が実行 |

### SQL 実行バッジ

「実行」クリック後に SQL ブロックにバッジが付きます(永続化 `skylerx.aiChat.runMarks`、最大 200 件):

| ステータス | 表示 |
|---|---|
| `pending` | ⌛ グレー背景 + 「10:23 派遣済み」 |
| `ok` | ✓ 緑背景 + 「10:23 成功」 |
| `error` | ✗ 赤背景 + 「10:23 失敗」、hover でエラー本文を確認 |

実行完了後 QueryPane が `onChatSqlExecuted` イベントバスで通知、チャットパネルが購読してバッジを更新。

### Provider 切替器

下部のドロップダウンは **apiKey が設定された provider のみリスト**(空 key を選んで `NO_API_KEY` を防ぐ)、隣の `⚙` ボタンは `openSettings` を emit し AI 設定 section に遷移。

## 4. インライン補完 — aiInline.ts

Monaco InlineCompletionsProvider、Copilot 風のゴーストテキスト。SQL エディタに登録:

```ts
monaco.languages.registerInlineCompletionsProvider('sql', provider)
```

### スロットル戦略

| パラメータ | 値 | 役割 |
|---|---|---|
| `DEBOUNCE_MS` | 600ms | ユーザーが 600ms 停止してから LLM を呼び出す |
| `MAX_PREFIX` | 2000 文字 | カーソル前のテキストを取得、長すぎる場合は末尾を切り詰め |
| 最小トリガー長 | 3 文字 | `prefix.trim().length < 3` なら空を返す |

新しいトリガーごとに **即座に前のものを abort**:

```ts
function clearPending() {
  if (!pending) return
  clearTimeout(pending.timer)
  pending.abort.abort()  // 前のリクエストを真にキャンセル
  pending = null
}
```

クォータを浪費せず、古い補完が突然出現することもありません。

### Prompt + system プロンプト

```ts
const text = await askAiChat({
  messages: [{ role: 'user', content: buildPrompt(prefix, ctx) }],
  dialect: ctx.dialect,
  extraSystem: 'あなたは SQL インライン補完エンジンです。カーソル位置の後続 SQL テキスト断片のみを出力し、'
             + '最大 1 行、コードブロックや説明、既存上文の繰り返しを含めないこと。'
             + '上下文が補完に不十分な場合は空文字列を出力。',
  signal: abort.signal,
})
```

`buildPrompt` の内容:`ダイアレクト: <d>\n\nSchema:\n<hint>\n\nSQL 上文(カーソルは末尾):\n<prefix>`。

### 後処理クリーンアップ(`sanitizeCompletion`)

- ` ```sql ... ``` ` フェンスを除去(LLM がたまにコードブロックで囲む)
- モデルが prefix を繰り返した場合、prefix 末尾 80 文字で始まる → 切除
- 複数行返信は最初の 1 行のみ取得

### 受け入れ / キャンセル

| キー | 動作 |
|---|---|
| `Tab` | 補完を受け入れる |
| `Esc` / `Backspace` / 入力継続 | キャンセル(Monaco 組み込み) |

### マスタースイッチ

`settings.enableCompletion`(SQL 自動補完と共通スイッチ)を再利用、補完をオフにすると LLM を呼ばなくなります。失敗は一律サイレント(インライン補完はチャットほどミッションクリティカルではなく、失敗してもユーザーを煩わせない)。

## 5. エラー診断「AI に質問」ボタン

実行エラー時 **任意のアラートダイアログ / 結果エリアのエラーバー**に `✨ AI に質問` ボタンがあります。クリックすると `AiChatPanel.askAboutError()` を発火:

```ts
async function askAboutError(p: { connId, connName?, sql, error }) {
  controller?.abort()             // 1) 現在の対話を中断
  for (let i=0; i<30 && running.value; i++) await sleep(50)  // finally の完了を待つ
  connId.value = p.connId         // 2) エラーが発生した接続に切替
  useSchema.value = true          // 3) schema コンテキストを強制有効化
  saveToStorage()
  const msg = `${t('aichat.askAiPrompt')}\n\n**接続**: ${p.connName}\n\n**SQL**\n\`\`\`sql\n${p.sql}\n\`\`\`\n\n**Error**\n\`\`\`\n${p.error}\n\`\`\``
  input.value = msg
  if (switching) await sleep(200) // 4) schema の非同期ロードを待つ
  if (!schemaText.value) await loadSchema()
  await send()
}
```

### メッセージ形式

送信されるユーザーメッセージはこのような形:

```markdown
この SQL のエラーを確認し、考えられる原因と修正案を提示してください。

**接続**: prod-mysql

**SQL**
```sql
INSERT INTO orders(user_id, amount) VALUES (42, 99.9)
```

**Error**
```
ERROR 1452 (23000): Cannot add or update a child row:
a foreign key constraint fails (`shop`.`orders`, CONSTRAINT `fk_user` ...)
```

自動注入された schema コンテキスト(`users(id int, ...)` と `orders(...)` の両方)があれば、AI は通常「`user_id=42` が `users.id` に存在しない」と秒速で特定できます。

### chat-bus イベントバス

このメカニズムはチャットパネルだけが使うわけではなく、`MockDataDialog` の実行失敗も同じバス経由で `askAi` ボタンを表示します:

```ts
toast.error(`実行失敗: ${errMsg}`, {
  askAi: { sql: stmt, error: errMsg, connId, connName, dialect },
})
```

`ChatErrorAskEvent` は統一形式で、任意の場所でエラーを投げると「AI に質問」ボタンを付けることができ、毎回個別実装する必要がありません。

## 6. AI Toolbox(7 種類の専用プロンプト)

`🛠 AI Toolbox` または `⌘K → AI ツールボックス`。1 つのダイアログで 7 種類のタスクを扱い、選択後「AI に依頼」をクリック → ダイアログを閉じ + prompt を右側チャットパネルに送信。

| Toolbox | プロンプトテンプレート | 入力 | 出力形式 |
|---|---|---|---|
| **マイグレーション作成** | `pMigration` | 対象テーブル + 要件記述 | 独立した 3 セグメントの `\`\`\`sql`:正方向 ALTER / 逆方向ロールバック / データマイグレーション |
| **SQL 最適化** | `pOptimizeSql` | 元 SQL + オプション EXPLAIN | 判定 → 書き換え提案(SQL ブロック)→ インデックス提案(SQL ブロック)→ 期待される効果 |
| **EXPLAIN 解読** | `pExplainAnalysis` | SQL + EXPLAIN テキスト | 平易な日本語でノードごとに解説 + 「結論 + 最も手をつけるべき箇所」 |
| **テストデータ生成** | `pTestData` | テーブル + 行数 + 業務背景 | 単一 `\`\`\`sql` セグメント、行ごとに INSERT、FK 認識あり |
| **NL → SQL** | `pNl2Sql` | 自然言語での記述 | 単一 `\`\`\`sql` セグメント、曖昧さがあれば最も一般的な解釈で進めつつ曖昧点を指摘 |
| **ドキュメント作成(カラムの意味)** | `pDataDictDoc` | テーブル + カラム CSV | Markdown 3 列リスト:カラム / 型 / 業務上の意味 |
| **テーブル用途の解説** | `pExplainTable` | テーブル + カラム + FK ヒント | 200 文字以下の段落 + 3 個の bullet(誰が挿入 / 誰が読む / 削除戦略) |

### Toolbox フォーム項目

| タスク | テーブル要 | SQL 要 | EXPLAIN 要 | 追加 |
|---|---|---|---|---|
| migration | ✓ | | | 要件テキスト |
| optimize | | ✓ | (任意) | |
| explain-analysis | | ✓ | ✓ | |
| test-data | ✓ | | | 行数 + 業務背景 |
| nl2sql | | | | 要件テキスト |
| doc | ✓ | | | カラム CSV を自動取得 |
| explain-table | ✓ | | | カラム CSV を自動取得 |

送信時に `pXxx(...)` で prompt を組み立て → `emit('submit', { prompt, connId, connName, withSchema: true })` → Workspace が `AiChatPanel.askPredefined(...)` に転送、`askAboutError` と同じパターンです。

### 設計ポイント

- ユーザーの原始要求(「カラム追加 / リネーム / 最適化」)を prompt にそのまま残し、翻訳でセマンティクスが失われるのを防ぐ
- コンテキスト(SQL / テーブル名 / EXPLAIN テキスト)を Markdown コードブロックとして挿入し、AI が認識しやすくする
- 期待される出力フォーマットを明確に記述(「ALTER + 逆 ALTER + データマイグレーションを提示」)し、往復を減らす
- 出力フォーマットを強く制約(独立 3 セグメント `\`\`\`sql` + H3 タイトル)= フロントエンドがタイトルで安定して分割解析できる

## 7. AI Health Check — データベースヘルスチェック

ツールバー `❤️ Health Check`。開くと 4 ステップで自動実行:

1. **メタデータ収集** — 3 本並行 SQL:
   - MySQL:`COLUMNS / STATISTICS / KEY_COLUMN_USAGE`(`REFERENCED_TABLE_NAME IS NOT NULL` でフィルタ)
   - PG:`information_schema.columns + pg_index + pg_class` + FK サブクエリ
2. **シリアライズ** — テーブル別にコンパクトテキストに整形(columns / indexes / FKs)
3. **AI に送信** — `pHealthCheck` で prompt を組み立て、`askAiChat` を呼び出す
4. **レンダリング** — Markdown を H2 で分割し 6 枚のカテゴリカードに

### 6 種類のアンチパターン + AI の実際のチェック指示(`pHealthCheck`)

| 節 | タイトル | AI が実際に行うこと |
|---|---|---|
| 1 | 高頻度クエリ列にインデックスがない | ヒューリスティックに `status / created_at / user_id / type / is_* / *_at` を高頻度フィルタ・ソート列と推定、対応インデックスがないものを指摘 |
| 2 | 名前は FK っぽいが FK 制約がない | `xxx_id` / `xxxId` だが所属テーブルに任意の親テーブルへの FOREIGN KEY がない → リストアップ + 親テーブル推定 |
| 3 | カラム命名スタイルの混在 | 同一テーブル / DB 内で snake_case + camelCase が混在 → どちらに統一すべきか指摘 |
| 4 | 型を大きく選びすぎ | 短い文字列に `VARCHAR(255)` / 小さい整数に `BIGINT` / 時間を `VARCHAR` で保存 |
| 5 | 重要業務テーブル / 列にコメントがない | `user / order / payment / account` などのコアテーブルに COMMENT がない、コメントすべき重要列を選定 |
| 6 | ソフトデリート列にインデックスがない | `deleted_at / is_deleted` が任意のインデックスに入っていない → `CREATE INDEX` を提案 |
| まとめ | — | コスパ順に 3〜5 件の優先対応項目 |

**出力強制制約**:6 個の `## 1.` 〜 `## 6.` H2 タイトルで分節(フロントエンドが H2 でカード分割しやすい)、問題なしの節もタイトルを残して「明らかな問題は見つかりませんでした」と記載。

### メタデータ収集

MySQL は `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE`、PG は `information_schema.columns + pg_index/pg_class + table_constraints` の FK サブクエリ、3 本の SQL を並行実行(各約 5000 行制限)。prompt の総メタデータは ~12K 文字で上限切り詰め、トークン爆発防止。MySQL ファミリー / PG ファミリーのみサポート。

## 8. AI Insights — スロー SQL + エラー原因究明

2 タブのダイアログ、SQL / エラーを直接貼り付けて実行できます(先に DB に接続する必要なし):

### Tab 1:スロー SQL 最適化

入力:SQL(必須)+ EXPLAIN(任意)+ テーブル統計 / 行数(任意)。AI 出力は 4 セグメント:疑わしい遅い箇所(全テーブルスキャン / インデックスなし / カーテシアン積 / 暗黙変換 / 統計古い)→ 推奨インデックス(`CREATE INDEX`)→ 書き換え提案(カバーインデックス / サブクエリ → JOIN / 等価書き換え)→ 改善効果の見積もり。

`extraSystem`: `You are a database performance expert. Be specific and reference actual cost trade-offs.`

### Tab 2:エラー原因究明

入力:エラー情報(必須)+ コンテキスト(任意:実行 SQL / 時刻 / ユーザー)。AI 出力:エラーの意味(平易な日本語翻訳)→ 最も可能性が高い 3 原因(確率順)→ トラブルシュート手順 → 修正案。

`extraSystem`: `You are an SRE/DBA. Be practical, prioritize quick mitigation.`

「AI に質問ボタン」との違い:Insights は**手動の deep dive**(エラーを与えてじっくり分析)、ボタンは**現在の SQL + エラー + 現在の接続 schema を一括関連付け**してチャットパネルでマルチターン継続。

## 9. AI Schema Architect — テーブル設計

対話式のテーブル設計アシスタント。業務要件を伝える → AI が複数テーブル + FK + インデックスの完全な DDL を生成、追加質問で設計を改良可能。

### システムプロンプト(コンポーネントにハードコード)

```text
You are a senior database architect. The user describes a business domain (in any language).
Your job:
1. Design multiple related tables (with primary keys, foreign keys, indexes,
   sensible types for the <dialect> dialect).
2. Output a single ```sql code block containing the COMPLETE CREATE TABLE statements
   (including foreign keys and indexes) so the user can copy-paste-run.
3. Explain key design decisions briefly in 2-4 bullet points.
4. When the user asks to revise, output the FULL updated SQL again (not just a diff)
   — they will execute the whole block.

Stay concise. Prefer normalized design unless user asks for denormalized.
```

### 流れ

1. ユーザーが業務記述を入力(`"EC 注文システム作成:ユーザー、商品、注文、注文項目、クーポン対応"`)
2. `askAiChat({ messages, dialect, extraSystem })` で Markdown を取得
3. `extractAllSql(reply)` ですべての `\`\`\`sql` ブロックを `sqlBlocks` として抽出
4. ユーザーが追問 → 全履歴を再送 → AI が**完全な新版** SQL を出力(system prompt の強制制約:diff ではなく全量)

### ワンクリック実行

下部の `▶ 最新版を実行` ボタン:最後のアシスタント返信内のすべての `sqlBlocks` を結合 + `splitStatements` で分割 + 順次 `client.connections.execute`。二重確認で `CREATE` 文数 + 対象 DB を表示。

## 10. AI Schema Reverse — リバース推論

CSV / TSV / JSON サンプルデータ → AI が schema を推論 → `CREATE TABLE` + オプション `INSERT` を生成。

### 入力

| 項目 | 説明 |
|---|---|
| 形式 | CSV / TSV / JSON から選択 |
| テーブル名 | デフォルト `inferred_table`、変更可 |
| サンプルデータ | 数行で十分、ヘッダー / フィールド名付きが最も正確 |
| INSERT も生成 | チェックボックス、ONなら prompt に「5. サンプルデータをすべて挿入する INSERT 文を生成」を追加 |

### Prompt 構造

```text
以下の CSV サンプルデータを基に、schema をリバース推論し mysql ダイアレクトの CREATE TABLE SQL を生成してください...

要件:
1. 各列**最も適切な**型を推論(長さ、純数値か、日付か、enum か等を考慮)
2. **主キー**(自動増分 vs 業務キー)、**NOT NULL 必須**の列を推論
3. **インデックス候補**を 1〜2 個推奨(経験ベース:FK 風の列、頻繁にフィルタする列)
4. テーブル名: `inferred_table`

サンプルデータ:
```
id,name,email,created_at
1,alice,a@x.com,2026-01-01
...
```

以下の構造で厳密に出力してください:

### 推論説明
(カラム名 → 型 → 理由、2〜3 文)

### CREATE TABLE
```sql
CREATE TABLE ...
```

### インデックス提案
- ...
```

### 編集後実行

返された SQL は右側の編集可能ボックス(`sqlEdit`)に抽出され、ユーザーが編集後 `▶ 実行` をクリック → 二重確認 → `splitStatements` で分割 → 順次実行。

## 11. AI Comment Writer — テーブル / 列にコメントを書く

テーブル右クリック `💬 AI でコメント生成` またはツールバーのエントリ。流れ:

1. **カラム取得** — MySQL は `information_schema.COLUMNS`(name / type / nullable / default / comment)、PG は `pg_catalog.col_description` で既存コメントを追加取得
2. **シリアライズ** — `columnsCsv` に整形:`- col type [NOT NULL] [DEFAULT ...]`
3. **AI に送信** — `pComment(ctx, columnsCsv)`、**1 つの `\`\`\`json` コードブロックのみ**出力を要求
4. **解析** — JSON を抽出、`[{ col, comment }]` を取得
5. **比較表** — 既存コメント vs AI 提案、行ごとのチェックボックスで採用可否を決定
6. **適用** — ALTER 生成:
   - MySQL:`ALTER TABLE ... MODIFY <col> <type> [NOT NULL] [DEFAULT ...] COMMENT '...'`(元の type / nullable / default を持参する必要、さもないと失われる)
   - PG:`COMMENT ON COLUMN <table>.<col> IS '...'`

### Prompt 強制制約(`pComment`)

prompt は以下を強制:**1 つの `\`\`\`json` コードブロックのみ、前後に説明テキストなし**、配列の各項目は `{ "col": "カラム名", "comment": "業務上の意味を一文で" }`、`col` はフィールド名を**そのまま**コピー(大文字小文字を区別、翻訳しない)、`comment` は 30 文字以下、情報不足なら `?(人手補足推奨)` と記載、**すべてのフィールドを列挙**(`id / created_at` のような基本フィールドも含む)。

出力強制制約 = `parseSuggestion()` は安定した正規表現で ` ```json ... ``` ` を抽出、失敗時は全体を裸 JSON として再試行。`col` がそのまま書き戻されるため、現状との比較 + ALTER の組み立てがずれません。

### テーブルレベルコメント

カラムレベルに加えて、テーブル自体にも 1 文書けます:MySQL は `ALTER TABLE ... COMMENT='...'`、PG は `COMMENT ON TABLE ... IS '...'`。

## 12. AI SQL 翻訳 — SqlTranslateDialog

`🌐 Translate` から起動。4 つのダイアレクトに固定:`mysql / postgresql / sqlserver / oracle`。

### 2 つのモード

| モード | Prompt |
|---|---|
| **SQL**(通常クエリ / DDL) | `pTranslate(from, to, sql)` |
| **ストアドプロシージャ / 関数** | `pTranslateProcedure(from, to, code)` — 追加でパラメータモード / BEGIN-END / DECLARE / 例外処理 / カーソル / DELIMITER をカバー |

`extraSystem` も切替わります:

- SQL: `You are a senior SQL polyglot. Translate SQL across dialects precisely; flag every non-portable construct honestly.`
- Procedure: `You are a senior SP/PL/SQL polyglot. Translate stored procedures faithfully; preserve control flow and explicit error handling.`

### 出力強制制約(`pTranslate`)

厳密に 3 セクション:

1. **翻訳後 SQL** — 単一の `\`\`\`sql` コードブロック、1 つだけ、説明なし
2. **`### 警告`** — bullet で**移植不可**な点を列挙(`MySQL ON DUPLICATE KEY UPDATE` → `PG ON CONFLICT DO UPDATE` はセマンティクスは概ね対応するが挙動の細部が異なる、`DATETIME vs TIMESTAMP`、`NVARCHAR vs NVARCHAR2`、ページネーション / 自動増分 / 文字列結合 / クォートスタイル、暗黙変換、NULL ソート挙動の差異);なければ「明らかな移植不可構文なし」と記載
3. **`### 提案`** — bullet でターゲットダイアレクトの**より慣用的**な書き方(CTE / `LIMIT OFFSET` / `COALESCE` で `IFNULL` を置換);なければ「直訳で十分慣用的」と記載

H3 タイトルで分割 → フロントエンドがタイトルで分割してレンダリング。

### 2 カラムレンダリング

| 左カラム | 右カラム |
|---|---|
| `extractSql(answer)` で翻訳後 SQL を抽出 → Monaco `colorize` でハイライト + `ワンクリックコピー` | 最初の `\`\`\`sql` ブロックを除いた残りの Markdown(警告 + 提案)→ `renderMarkdown` |

### 細かい最適化

- `swapDialects()`:from/to をワンクリックで入れ替え、翻訳後の逆方向確認に便利
- **同一ダイアレクトショートサーキット**:`from === to` なら「翻訳不要」の疑似返信を直接構築、リクエストを浪費しない
- 翻訳中に `controller?.abort()` でキャンセル可能

## 13. AI Mock Data — FK 認識テストデータ

テーブル右クリック `🧪 テストデータ生成`。このダイアログのメインは**ルールエンジン**(`mockgen.ts` がカラム名 + SQL 型から `SemanticKind` を推論)、AI は 2 つのポイントでのみ介入:

### 13.1 `aiInfer()` — AI に全カラムのセマンティック型を一括推論させる

ボタン `✨ AI 推論`。prompt は全英語(モデルは英語 JSON 指示への反応がより安定)、制約:

- 固定ホワイトリスト `SEMANTIC_KINDS` から選ぶ(`auto / integer / decimal / money / name_cn / phone_cn / id_card_cn / address_cn / email / enum / lorem_cn / ...`)、その他は無効
- 中国語コンテキスト列(`name/姓名 / 手机/phone / 身份证 / 地址`)は `_cn` バリアントを優先
- **禁止** `auto`(無意味なランダムテキスト生成)、具体型を選ぶこと
- `money/price/amount/cost` → `money`;`decimal/float` → `decimal`
- `[PK]` マーク付きの整数主キー → `integer`(ジェネレータが自動増分);`status/state/role` → `enum`;`description/content/remark/note` → `lorem_cn`
- **JSON object のみ**出力、形式 `{"user_id":"integer","name":"name_cn","mobile":"phone_cn"}`

返却後 `/\{[\s\S]*\}/` で最初の JSON セグメントを抽出(前後の余分なテキストを許容)、各項目を kind がホワイトリスト内か + 列が baseColumns 内かで検証してから適用。

### 13.2 実行失敗時に「AI に質問」を表示

INSERT 失敗(NOT NULL 値欠落 / FK 不在 / 型不一致)→ toast に `askAi` ボタンを表示 → chat-bus 経由で stmt + エラー + 接続情報をチャットパネルに送信。

実際の INSERT 生成は `buildMockInserts(dialect, tableRef, columns, count)` が担当(チャンク分割、各チャンク 100 行)、AI は生成そのものには関与せず — **セマンティック推論** + **エラー診断**のみ。

## 14. 3 層メモリ — memory.ts

`Settings → AI → メモリ` で設定。各対話で自動的に system prompt 前置位置に注入(モデルは前置コンテキストへの反応がより敏感):

| 層 | 名前 | 形態 | 用途 | トリガー |
|---|---|---|---|---|
| **A** | `aiCustomInstructions` | フリーテキスト | 長期アイデンティティ / 嗜好 | 各対話で全量注入 |
| **B** | `aiFacts` | `{id, text, createdAt}[]` | 構造化事実 | 各対話で全量注入;`aiAutoExtractFacts` 有効時に各ターン自動で 1〜3 件抽出して保存 |
| **C** | `aiVectorMemories` | `{id, text, vec, createdAt}[]` | 大量ノート | 各回コサイン類似度で top-K 取得(デフォルト `aiVectorTopK`)、スコア > 0.3 のみ使用 |

### `buildMemorySection(query)` の組み立て順序

A → B → C の順で Markdown セクションを組み立て:

- A: `## User profile & preferences` + フリーテキスト
- B: `## Known facts` + bullet リスト
- C: `## Relevant past notes` + bullet リスト(query + 設定済み embedding key が必要、`recallRelevant(query)` で top-K + 閾値 > 0.3)

### Embedding 設定

C 層は embedding エンドポイントが必要です。`Settings → AI → メモリ` で個別設定:

| 項目 | デフォルト |
|---|---|
| `aiEmbeddingBaseUrl` | (空、ユーザー入力必要) |
| `aiEmbeddingApiKey` | (空) |
| `aiEmbeddingModel` | `text-embedding-3-small` |

実際のリクエストは OpenAI 互換 `${base}/v1/embeddings` 経由、DeepSeek / Grok も互換。Embedding 系の短時間リクエストはタイムアウト 15s で、チャット主流を引きずらない設計。

### LRU 切り詰め

C 層の容量上限は 1000 件、超過時は最古を切り捨て:

```ts
if (settings.aiVectorMemories.length > 1000) {
  settings.aiVectorMemories.splice(1000, settings.aiVectorMemories.length - 1000)
}
```

### 自動事実抽出(B 層)

`aiAutoExtractFacts` 有効時、各 chat 終了後に `autoExtractFacts({ user, assistant })` を実行、LLM に 1 ターンの user/assistant 対話から ≤ 3 件の**長期記憶に値する**事実(`"uses MySQL 8"` / `"works on 'orders' schema"` / `"prefers snake_case"`)を抽出させ、ephemeral コンテンツはスキップ、返信 `none` はスキップ、それ以外は bullets を解析して保存、失敗は一律サイレント(memory はメイン対話をブロックしない)。`extraSystem`: `You are a memory curator. Output bullet list of durable facts only.`

## 15. プライバシー & セキュリティ

| デフォルト挙動 | 説明 |
|---|---|
| API Key 暗号化保存 | システムキーチェーン(macOS / Windows / Linux libsecret) |
| API Key は本機から外に出ない | デスクトップ版は IPC でベンダーエンドポイントに直接接続、Web 版はブラウザから直接送信(baseUrl を変えて自前プロキシ可) |
| デフォルト **データ送信しない** | チャットパネルの「DB 構造を添付」はデフォルト OFF、ON にしても **`tbl(col1 type, col2 type, ...)` サマリーのみ送信**、行データは送らない |
| Schema 6KB 上限 | 超過すると自動的に `-- (truncated)` で切り詰め、トークン爆発防止 |
| `request log` 監査可能 | `Settings → AI → リクエストログ`(デスクトップ IPC パスで完全記録) |
| 内蔵エラー「AI に質問」は送信内容を明示 | SQL 全文 + エラーコード + 接続メタデータ + schema ヒント |

## 16. コスト管理

| 観点 | 設定方法 |
|---|---|
| provider 切替 | チャットパネル下部のドロップダウン / `⌘K → AI provider 切替` |
| model 変更 | `Settings → AI Provider → <provider> → model`(安いモデルをインライン補完 + Health Check、高いモデルをテーブル設計 / 翻訳に) |
| インライン補完オフ | `Settings → 補完` マスタースイッチ — `enableCompletion` を再利用(高トークン消費シーンで必要に応じてオフ) |
| ベクトルメモリオフ | `Settings → AI → メモリ → ベクトルメモリ` をオフに — 各対話で embedding を呼ぶため、オフで embedding トークンを節約 |
| 自動事実抽出オフ | `aiAutoExtractFacts` オフ — 無効なら各ターンで追加の抽出リクエストを送らない |
| 長コンテキスト vs 短 | 「DB 構造を添付」を必要に応じて選択、DB に無関係な質問(`この SQL の文法を解説`)では不要 |

---

## 17. 行動対照早見表

| やりたいこと | 使うチャネル |
|---|---|
| マルチターン対話で問いながら直す | **AiChatPanel** |
| エディタ内でリアルタイム補完 | **インライン補完**(`aiInline.ts`) |
| エラーが出てすぐ診断したい | **エラー「AI に質問」ボタン**(chat-bus) |
| あるテーブルにマイグレーション作成 / SQL 最適化 / EXPLAIN 解読 | **AiToolboxDialog** |
| DB 全体でアンチパターンスキャン | **AiHealthCheckDialog** |
| あるスロー SQL / エラー情報を deep dive | **AiInsightsDialog** |
| 業務記述から複数テーブルを設計 | **AiSchemaArchitectDialog** |
| サンプルデータから schema を逆推論 | **AiSchemaReverseDialog** |
| 全カラムに日本語コメントを書いて DB に反映 | **AiCommentDialog** |
| ダイアレクト間で SQL / ストアドプロシージャを翻訳 | **SqlTranslateDialog** |
| テーブルにテストデータを投入(セマンティック型 + FK 安全) | **MockDataDialog** |
| AI に長期記憶を与える | **memory.ts → A/B/C 3 層** |

[高度な機能](./advanced) と組み合わせれば威力倍増 — EXPLAIN が読めなければ直接 AI に質問、インデックス推奨が判断つかないなら AI に解説、Oracle → DM マイグレーションの翻訳警告を AI でリスク評価。
