# インストールとアップグレード

## macOS

`.dmg` をダウンロード → ダブルクリックでマウント → SkylerX を Applications にドラッグ → ディスクをイジェクト。

初回起動時に「開発元を確認できません」と表示されることがあります:
1. SkylerX を右クリック → 開く → ダイアログで「開く」を選択
2. または `システム設定 → プライバシーとセキュリティ → このまま開く`

### Apple Silicon vs Intel

ダウンロードページは自動的に arm64 版を推奨します。Rosetta がインストールされていれば x64 版も動作しますが、arm64 ネイティブの方が高速でメモリ使用量も少なくなります。

## Windows

`.exe` インストーラーをダウンロード → ダブルクリックで実行 → Next を押し続ける。

**SmartScreen の警告**:「詳細情報 → 実行」をクリック。

### x64 vs arm64

x64 はすべての Windows マシンで動作します。arm64 は Surface Pro X / Qualcomm Snapdragon ノートパソコン向けで、x64 エミュレーションによる電力消費を回避できます。

## Linux

### AppImage(インストール不要、一時利用向け)

```bash
chmod +x SkylerX-0.5.0-x64.AppImage
./SkylerX-0.5.0-x64.AppImage
```

### .deb(Debian / Ubuntu / 統信 UOS / 優麒麟 / Deepin)

```bash
sudo dpkg -i SkylerX-0.5.0-amd64.deb
# 依存関係の問題が発生したら:
sudo apt-get install -f
```

### .rpm(Fedora / openEuler / 銀河麒麟 Kylin / 紅旗 Linux / 中標麒麟 NeoKylin)

```bash
sudo rpm -ivh SkylerX-0.5.0-x86_64.rpm
# または dnf を使用
sudo dnf install ./SkylerX-0.5.0-x86_64.rpm
```

### .pacman(Arch Linux / Manjaro)

```bash
sudo pacman -U SkylerX-0.5.0-x86_64.pacman
```

### .tar.gz(その他のディストリビューション)

```bash
tar -xzf SkylerX-0.5.0-x64.tar.gz
cd SkylerX-0.5.0
./skylerx
# オプション:デスクトップショートカットを作成
```

## 自動更新

SkylerX は `electron-updater` を内蔵しており、起動時に自動的に新バージョンをチェックします:

1. バックグラウンドでサイレントダウンロード
2. ダウンロード完了後に「アプリを再起動して更新を完了」と通知
3. ユーザーがクリックすると新バージョンが適用される

**自動更新を無効化**:`Settings → 更新 → 「自動更新の確認」をオフ` または環境変数 `SKYLERX_DISABLE_AUTOUPDATE=1` を付けて起動。

## データ保存先

SkylerX のローカル設定ストア(SQLite)は OS 標準のユーザーデータディレクトリに保存されます:

| プラットフォーム | パス |
|---|---|
| macOS | `~/Library/Application Support/@db-tool/desktop/db-tool.db` |
| Windows | `%APPDATA%\@db-tool\desktop\db-tool.db` |
| Linux | `~/.config/@db-tool/desktop/db-tool.db` |

このファイルには以下が保存されます:
- 接続設定(パスワードは OS キーチェーンで暗号化)
- SQL クエリ履歴
- SQL スニペットライブラリ
- お気に入り
- AI メモリ
- ユーザー設定

**バックアップの推奨**:`@db-tool/desktop` ディレクトリ全体を定期的に OneDrive / iCloud / NAS にコピーしてください。

## アンインストール

### macOS
SkylerX をゴミ箱にドラッグ → 必要に応じて `~/Library/Application Support/@db-tool/` をクリーンアップ

### Windows
コントロールパネル → プログラムと機能 → SkylerX → アンインストール → 必要に応じて `%APPDATA%\@db-tool\` をクリーンアップ

### Linux
```bash
sudo apt remove skylerx        # .deb でインストールした場合
sudo rpm -e skylerx            # .rpm でインストールした場合
rm -f ~/.config/@db-tool       # 設定(オプション)
```

## アップグレード

アプリ内の自動更新 → 再起動するだけで完了します。新バージョンのインストーラーを手動でダウンロードして上書きインストールも可能です。**設定ストアは失われません**、バージョン間で互換性があります。

## 中国国産 DB(信創)環境

以下の中国国産 OS に対応しています:

- **銀河麒麟 Kylin / 中標麒麟 NeoKylin**:`.rpm` 推奨
- **統信 UOS**:`.deb` 推奨
- **Ubuntu Kylin 優麒麟**:`.deb` 推奨
- **openEuler**:`.rpm` 推奨
- **Deepin**:`.deb` 推奨

**龍芯 LoongArch / 飛騰 Phytium**:公式ビルドは未提供です。必要に応じて[法人協業](mailto:duhbbx@gmail.com)にてご相談いただければカスタムビルドが可能です。
