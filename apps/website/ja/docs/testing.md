---
title: テストと品質保証
description: SkylerX の 2 層品質モデル — 自動ユニットテスト + 各 DB / 各機能をカバーする手動チェックリスト。
---

# テストと品質保証

**2 層構成。1 層は全コミットで自動実行、1 層はリリース前の手動。両方ともオープンソースで GitHub に公開。**

## TL;DR

| レイヤ | ツール | 実行タイミング | 場所 |
|---|---|---|---|
| **ユニットテスト** | Vitest | 全 push / PR で GitHub Actions CI が実行 | `packages/**/src/**/*.test.ts` — 15+ ファイル(SQL 生成、EXPLAIN 解析、schema diff、暗号化、Oracle→DM 型マッピング) |
| **手動チェックリスト** | Markdown チェックボックス + エビデンス(スクリーンショット / SQL ログ) | PR 自己テスト + リリース前スモーク、テンプレが GitHub PR / issue に自動展開 | [`docs/qa/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa) — 30+ チェックリスト、約 6000 行 |

## Layer 1 — ユニットテスト

コミットごとに CI が実行:

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`

赤い PR は `main` へマージ不可。

**カバー範囲**: 純粋ロジック — 各方言 DDL 生成、EXPLAIN 解析、schema diff、Oracle→DM 翻訳、設定暗号化、i18n 完全性、SQL Linter ルール。

**範囲外**: Vue コンポーネント描画、実 DB 連携、クロス OS ショートカット、自動更新フロー — これらは Layer 2 で。

参照: [`packages/ui/src/*.test.ts`](https://github.com/duhbbx/SkylerX/tree/main/packages/ui/src) · [GitHub Actions](https://github.com/duhbbx/SkylerX/actions/workflows/ci.yml)

## Layer 2 — 手動チェックリスト

全て Markdown、**エビデンス必須** — チェック ✅ にはスクリーンショット / SQL ログ / 録画が必要。フロー:

- **PR 作成** → GitHub が `Manual test` + `Reviewer verification` セクションを自動展開。作者は自己テストしながらチェック + エビデンス貼付。レビュアは branch を pull して ≥2 項目をランダム再テストしてから Approve
- **リリース前** → [🚦 Release Smoke issue](https://github.com/duhbbx/SkylerX/issues/new/choose) を作成。テンプレが完全な smoke チェックリストを自動展開。全 ✅ または失敗を bug issue にリンクしてから tag

### 構成

- [`RELEASE_SMOKE.md`](https://github.com/duhbbx/SkylerX/blob/main/docs/qa/RELEASE_SMOKE.md) — 15 分のリリース前 smoke
- [`driver-matrix.md`](https://github.com/duhbbx/SkylerX/blob/main/docs/qa/driver-matrix.md) — 22 方言マトリクス
- [`features/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/features) — 機能別 13 ファイル
- [`databases/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases) — 方言別深堀 16 ファイル

### 方言別ファイルの構造

Connection · Database/schema · Tables · Indexes · Views · Constraints · Functions / Stored procs · Triggers · Sequences · **Users · Roles · Grants** · DML/Query · Transactions · Dialect-specific quirks · Cross-platform · Known limitations。

## 痕跡を残すテンプレート

- [`PULL_REQUEST_TEMPLATE.md`](https://github.com/duhbbx/SkylerX/blob/main/.github/PULL_REQUEST_TEMPLATE.md) — Manual test + Reviewer verification + Evidence
- [`50_release_smoke.yml`](https://github.com/duhbbx/SkylerX/blob/main/.github/ISSUE_TEMPLATE/50_release_smoke.yml) — リリースごとの smoke issue
- [`CODEOWNERS`](https://github.com/duhbbx/SkylerX/blob/main/.github/CODEOWNERS) — クリティカルパスは自動で owner にアサイン

## 隠さない限界

- **UI 自動テストはまだなし**(Playwright は [ROADMAP](/ja/roadmap) Q4)
- **手動テストは規律に依存** — Evidence + reviewer 副署で「適当にチェック」のコストを上げる
- **実 DB カバレッジはテスタの環境次第** — チェックリストは docker-compose を提案するがテスタが実行するかは別

## 参加するには

- バグ報告: [Bug Report テンプレート](https://github.com/duhbbx/SkylerX/issues/new/choose)
- PR 提出: 標準テンプレに従う; Manual test セクション必須
- ユニットテスト追加: [`CONTRIBUTING.md`](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md) 参照
- 手動チェックリスト追加: [`docs/qa/databases/README.md`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases) 参照

---

> **リリースの品質?** [Release Smoke issues](https://github.com/duhbbx/SkylerX/issues?q=label%3A%22type%3A+smoke%22) · **CI 状態?** [GitHub Actions](https://github.com/duhbbx/SkylerX/actions) · **ロードマップ?** [ROADMAP](/ja/roadmap)
