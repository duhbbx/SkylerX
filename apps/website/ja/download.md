---
title: SkylerX をダウンロード
description: 全プラットフォーム対応インストーラー(macOS / Windows / Linux)、x64 + arm64 のマルチアーキテクチャ対応
---

# SkylerX をダウンロード

<DownloadButton />

::: tip ダウンロード元の自動選択
中国本土 / 香港・マカオからのアクセスでは、自動的に **アリババクラウド OSS ミラー**(上海ノード)の直リンクを利用し、GitHub より高速です。海外ユーザーは **GitHub Releases** を経由します。下のマトリックス上部からいつでも手動で切り替えでき、選択は記憶されます。
:::

<DownloadMatrix />

## システム要件

| プラットフォーム | 最低バージョン | 推奨 |
|---|---|---|
| **macOS** | 10.13(High Sierra) | 12+(Monterey 以上)|
| **Windows** | 10 | 11 |
| **Linux** | glibc 2.28+(Ubuntu 20.04 / Debian 11 / CentOS 8 など同時期) | Ubuntu 22.04+ |

**アーキテクチャ**:x64(Intel / AMD)と arm64(Apple Silicon / ARM サーバー / Surface Pro X)のデュアルアーキテクチャ対応。

## 中国国産 DB(信創)環境

以下の中国国産 OS に対応しています(`.deb` / `.rpm` / `.AppImage` を使用):

| OS | 推奨フォーマット |
|---|---|
| **銀河麒麟 Kylin** / **中標麒麟 NeoKylin** | `.rpm` |
| **統信 UOS** | `.deb` |
| **Ubuntu Kylin** / **優麒麟** | `.deb` |
| **openEuler** | `.rpm` |
| **Deepin** | `.deb` |
| **紅旗 Linux(Red Flag Linux)** | `.rpm` |
| **龍芯 LoongArch** | 公式ビルドは未提供。企業向けにご相談いただければ独自ビルド可能 |

## アップグレード

SkylerX は **自動更新を内蔵**しています(electron-updater ベース)。アプリ起動時に新バージョンを自動検出し、ダウンロード・インストールを案内します。

無効化したい場合は、`Settings → 更新` で「自動更新の確認」をオフにしてください。

::: warning Windows ユーザー — v0.5.0-rc1 / rc2 から rc3+ へのアップグレードは一度だけ手動操作が必要です
旧バージョン(rc1/rc2)の updater は `publisherName` を厳格に検証しますが、v0.5.0-rc3 以降は一時的に署名検証を外しています(SignPath Foundation の審査待ちのため)。そのため自動更新が `not signed by the application owner` を報告します。

**一度だけの手動操作**:下表の対応プラットフォームの rc3+ setup.exe または portable.exe をダウンロードし、上書きインストールしてください(設定は失われません)。それ以降は自動更新が正常に戻ります。

SignPath Foundation の審査が通り次第、EV 署名 + 厳格検証が復元され、それ以降は手動操作は不要となります。
:::

## 過去のバージョン

[GitHub Releases で全バージョンを見る →](https://github.com/duhbbx/SkylerX/releases)

## コード署名 / Code Signing

Windows インストーラーは **[SignPath Foundation](https://signpath.org/)** によるデジタル署名が施されています。SignPath Foundation はオープンソースプロジェクトに無償でコード署名を提供する非営利団体です。

> Code signing for this project is provided by the [SignPath Foundation](https://signpath.org/), free of charge.

これにより:
- Windows ユーザーが SmartScreen の "unknown publisher" 警告を見ることはありません
- インストーラーの真正性は標準的な証明書チェーン検証で確認できます
- `electron-updater` は更新のたびに publisher 名を厳格にマッチングします

Foundation は条件を満たすオープンソースプロジェクトに EV(Extended Validation)コードサイニング証明書を発行しています。SkylerX はオープンソースコミュニティへのご支援に深く感謝します。

## インストーラーの検証

各 Release には `SHA256SUMS.txt` が付属しており、ダウンロード後に検証できます:

```bash
# macOS / Linux
shasum -a 256 SkylerX-0.5.0-arm64.dmg
# または Releases ページの SHA256SUMS.txt の値と比較

# Windows PowerShell
Get-FileHash SkylerX-0.5.0-x64-setup.exe -Algorithm SHA256
```

## トラブルが発生したら

- **中国国内で GitHub が遅い**:本ページではデフォルトでアリババクラウド OSS ミラーに自動切替されます(上部スイッチ)。あるいは `https://github.akams.cn/` などの加速ミラーで GitHub URL の接頭辞を置き換えてください
- **OSS ミラーも遅い / ダウンロードが中断する**:上部の「🌐 GitHub」をクリックしてオリジンへ戻すか、直接 <https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/latest/> にアクセスし、ダウンロードツール(IDM / Aria2 など)でレジューム可能なダウンロードを行ってください
- **インストール失敗**:[トラブルシューティングドキュメント →](/ja/docs/troubleshooting) を参照
- **macOS で「開発元を確認できません」と表示される**:アプリを右クリック → 開く → 「開く」を確認。または `システム設定 → プライバシーとセキュリティ` で「このまま開く」をクリック

## ライセンス

[Apache License 2.0](https://github.com/duhbbx/SkylerX/blob/main/LICENSE) — デスクトップ版は完全オープンソース、商用利用も無料です。
