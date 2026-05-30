---
layout: home
title: SkylerX — オープンソースのデータベース管理ツール
titleTemplate: クロスプラットフォーム · マルチダイアレクト · AI 搭載

hero:
  name: SkylerX
  text: AI 搭載の<br/>クロスプラットフォーム DB 管理ツール
  tagline: 17 SQL + 3 NoSQL ダイアレクト · 中国国産 DB(信創)フルセット · Electron + Vue 3 · Apache 2.0
  image:
    src: /hero-screenshot.png
    alt: SkylerX クエリワークスペース
  actions:
    - theme: brand
      text: 今すぐダウンロード
      link: /ja/download
    - theme: alt
      text: ドキュメントを見る
      link: /ja/docs/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/duhbbx/SkylerX

features:
  - icon: 🧠
    title: 複数の AI アシスタント
    details: Anthropic / OpenAI / DeepSeek / Codex / Grok を自由に切り替え。7 種類の専用 AI Toolbox + インライン補完 + ヘルスチェック
  - icon: 🔌
    title: 20+ ダイアレクト
    details: 主要 SQL + 中国国産 DB 信創(達夢 DM / 人大金倉 KingbaseES / openGauss / OceanBase / TiDB)+ NoSQL(MongoDB / Redis / ES)
  - icon: 🛡
    title: 本番保護
    details: prod マーキング + 危険 SQL の二重確認 + SQL Linter ルールエンジン + データマスキング + 中国国家暗号 SM2/3/4
  - icon: 📊
    title: 可視化された結果セット
    details: 仮想スクロール + 編集可能 + JSON/BLOB 自動認識 + 数値列スパークライン + 条件付き色付け
  - icon: 🔍
    title: EXPLAIN 可視化
    details: 推定行数 vs 実行行数、遅いオペレータをハイライト、オプションで ANALYZE による実測も可能
  - icon: 🛠
    title: DBA ツールボックス
    details: サーバーアクティビティ / KILL / スロークエリログ解析 / レプリケーション遅延監視 / インデックス推奨 / スキーマドリフト検出
---

<HeroExtra />

## なぜ SkylerX を選ぶのか

- **Navicat は有料かつクローズドソース**で、ライセンス更新やアクティベーションの手間がかかります
- **DataGrip はサブスクリプションが高額**で、個人開発者にやさしくありません
- **DBeaver は重く UI が古く**、AI 機能も限定的です
- **中国国産 DB**(達夢 DM / 人大金倉 KingbaseES / openGauss)は主流ツールでのサポートが十分ではありません
- **AI で SQL を書き、EXPLAIN を読み解き、DB のヘルスチェックを行える**ツールが欲しい

そこで SkylerX はゼロから書き直しました。**オープンソース、無料、クロスプラットフォーム、信創対応済み**です。

## 主な機能

<FeatureGrid />

## サポートするデータベース

17 の SQL + 3 の NoSQL ダイアレクトをカバーし、**中国国産 DB と信創環境**のフルセットに対応します:

<DatabaseGrid />

[完全なデータベースマトリックスを見る →](/ja/databases)

## 使い始め方

```bash
# 1. GitHub Releases から対応するプラットフォームのインストーラーをダウンロード
#    macOS .dmg / Windows .exe / Linux .AppImage / .deb / .rpm
open https://github.com/duhbbx/SkylerX/releases/latest

# 2. SkylerX をインストールして起動

# 3. 新規接続 → ダイアレクト選択 → host/port/user/password 入力 → テスト → 保存

# 4. 接続をダブルクリック → ナビゲーションツリーを参照 → テーブル名をダブルクリックしてデータグリッドを開く → クエリを開始
```

詳細なチュートリアルは [クイックスタート →](/ja/docs/getting-started) をご覧ください。

## 会社情報 / 法人協業

**Wuhan Skyler Network Technology Co., Ltd.**(武漢斯凱勒網絡科技有限公司)— SkylerX の開発・保守元であり、受託開発およびプロジェクト協業も承っております:

- 🗄 **データベースコンサルティング** — 選定 / 設計 / チューニング / マイグレーション(Oracle / SQL Server → MySQL / PG / 中国国産 DB)
- 🏢 **Navicat / DataGrip 代替の社内導入** — 企業向けプライベート版のカスタマイズ
- 🛡 **信創 / 中国国産化環境への導入** — 麒麟(Kylin) / 統信 UOS / 龍芯(LoongArch) / 飛騰(Phytium) など
- 🤖 **AI 統合** — LLM ゲートウェイ / RAG / Agent ワークフロー / プライベート推論
- 📊 **データ基盤** — ETL / DWH(ClickHouse / Snowflake / DuckDB)
- 🛠 **DevOps & SRE** — CI/CD / 可観測性 / マルチクラウド・ハイブリッド

お問い合わせ:`duhbbx@gmail.com` · WeChat `tuhoooo`
