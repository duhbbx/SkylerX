# クイックスタート

ダウンロードから最初のクエリ成功まで 5 分で到達します。

## 1. ダウンロードとインストール

[ダウンロードページ](/ja/download) で対応プラットフォームのインストーラーを選びます:

- **macOS**:`.dmg` ファイル。Applications フォルダにドラッグするだけ
- **Windows**:`.exe` インストーラー。Next を押し続けます
- **Linux**:`.AppImage`(インストール不要、`chmod +x` で直接実行可能)、または `.deb` / `.rpm`(`sudo dpkg -i` / `sudo rpm -ivh`)

初回起動時に、ローカル設定ストア(SQLite、OS 標準のユーザーデータディレクトリ配下)が自動的に初期化されます。

## 2. 最初の接続を作成

アプリ起動 → 左上の「新規接続」(⌘N / Ctrl+N)→ ダイアレクトを選択。

### MySQL / PostgreSQL などの主要ダイアレクト

| 項目 | 例 |
|---|---|
| 接続名 | ローカル開発 DB |
| ダイアレクト | MySQL |
| ホスト | 127.0.0.1 |
| ポート | 3306(MySQL デフォルト) |
| ユーザー | root |
| パスワード | (任意のパスワード) |
| データベース | (任意。空欄にすると接続後に自分で選択) |
| 環境マーカー | dev / test / prod |

「接続テスト」→ 成功したら「保存」をクリック。

### Oracle / OceanBase Oracle テナント

Oracle は Service Name を指定する必要があります(デフォルト `XEPDB1`、コンテナ `gvenzl/oracle-free` は `FREEPDB1`):

| 項目 | 例 |
|---|---|
| ダイアレクト | Oracle |
| ホスト | 127.0.0.1 |
| ポート | 1521 |
| ユーザー | system |
| パスワード | oracle |
| データベース / Service | FREEPDB1 |
| 詳細 → privilege | (空欄 = 通常)または SYSDBA / SYSOPER など |

### 中国国産 DB(信創)

- **達夢 DM(中国産 DB)**:ポート 5236、`dmdb` npm パッケージのインストールが必要(`pnpm -F @db-tool/desktop add dmdb`)
- **人大金倉 KingbaseES(中国産 DB)**:ポート 54321(デフォルト)、PG 互換で追加ドライバ不要
- **openGauss**:PG 互換で追加ドライバ不要
- **OceanBase**:ポート 2881、mysql2 経由。Oracle テナントもこのダイアレクトを使用

各項目の詳細は [接続管理 →](/ja/docs/connections) を参照。

## 3. ナビゲーションツリーを参照

接続リストで **接続をダブルクリック** → 左側のナビゲーションツリーが自動展開されます:

```
📦 ローカル開発 DB (MySQL)
  └── 📁 mydb
       ├── 📁 テーブル (12)
       │    ├── users
       │    ├── orders
       │    └── ...
       ├── 📁 ビュー (3)
       ├── 📁 関数 (1)
       └── 📁 ストアドプロシージャ (0)
```

**テーブル名をダブルクリック** → デフォルトでデータグリッドを開きます(先頭 200 行を SELECT、[Settings → デフォルトページサイズ] で変更可能)。

## 4. SQL を書いて実行

- ツールバーの「新規クエリ」または ⌘T / Ctrl+T で新しい SQL タブを開く
- Monaco エディタがテーブル名 / カラム名 / キーワードを自動補完
- ⌘+Enter / Ctrl+Enter で実行(選択範囲がある場合は選択範囲のみ実行)
- 結果は下部のグリッドに表示

### よく使うショートカット

| 操作 | macOS | Windows / Linux |
|---|---|---|
| コマンドパレット | ⌘K | Ctrl+K |
| グローバルオブジェクト検索 | ⌘⇧O | Ctrl+Shift+O |
| SQL 実行 | ⌘+Enter | Ctrl+Enter |
| SQL フォーマット | ⌘⇧F | Ctrl+Shift+F |
| AI チャットパネルの切替 | ⌘⇧L | Ctrl+Shift+L |
| 新規ウィンドウ(2 つ目のセッション) | ⌘⇧N | Ctrl+Shift+N |

すべてのショートカットは `Settings → キーバインド` でカスタマイズ可能です。

## 5. AI アシスタントの設定(オプション)

`Settings → AI Provider` → サポートされている provider を追加:

- Anthropic(Claude シリーズ)
- OpenAI(GPT-4 / o1 シリーズ)
- DeepSeek
- Codex
- Grok / xAI

API Key を入力すれば以下が利用可能になります:
- 右側のチャットパネル(⌘⇧L で切替)
- エディタ内のインライン補完(Copilot 風)
- 任意のエラーダイアログで「✨ AI に質問」をクリックして自動的に原因特定・修正
- 7 種類の専用 Toolbox(マイグレーション作成 / チューニング / EXPLAIN 解読 / テストデータ生成 / 自然言語→SQL / コメント生成 / テーブル用途の解説)

## 6. さらに使いこなす

- [SQL エディタを深掘り](/ja/docs/query) — 自動補完 / スニペットライブラリ / EXPLAIN
- [結果セットグリッド](/ja/docs/grid) — 編集可能モード / フィルタ / 色付け / エクスポート
- [AI アシスタント](/ja/docs/ai) — provider 設定 / メモリシステム / Toolbox 詳細
- [トラブルシューティングと互換性](/ja/docs/troubleshooting) — ORA-xxx / SQLSTATE などの一般的なエラーを自動特定

## 困ったとき

- アプリ内のエラーダイアログで「**✨ AI に質問**」をクリック — SQL + エラー情報 + 接続メタデータを自動で AI に投げます
- それでも解決しない場合:[GitHub Issues](https://github.com/duhbbx/SkylerX/issues)
