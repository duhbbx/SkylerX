---
title: 테스트 및 품질
description: SkylerX 의 2 계층 품질 모델 — 자동 유닛 테스트 + 각 DB / 각 기능을 커버하는 수동 체크리스트.
---

# 테스트 및 품질

**두 계층. 하나는 매 커밋에 자동 실행, 하나는 릴리스 전 수동. 둘 다 오픈소스, GitHub 에서 확인 가능.**

## 요약

| 계층 | 도구 | 실행 시점 | 위치 |
|---|---|---|---|
| **유닛 테스트** | Vitest | 모든 push / PR 에서 GitHub Actions CI | `packages/**/src/**/*.test.ts` — 15+ 파일 (SQL 생성, EXPLAIN 파싱, schema diff, 암호화, Oracle→DM 타입 매핑) |
| **수동 체크리스트** | Markdown 체크박스 + 증거 (스크린샷 / SQL 로그) | PR 자가 테스트 + 릴리스 전 스모크, 템플릿이 GitHub PR / issue 에 자동 채워짐 | [`docs/qa/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa) — 30+ 체크리스트, ~6000 줄 |

## 계층 1 — 유닛 테스트

모든 커밋이 CI 를 트리거:

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`

빨간 PR 은 `main` 에 머지 불가.

**커버**: 순수 로직 — 방언별 DDL 생성, EXPLAIN 파싱, schema diff, Oracle→DM 번역, 설정 암호화, i18n 커버리지, SQL Linter 규칙.

**커버하지 않음**: Vue 컴포넌트 렌더링, 실제 DB 상호작용, 크로스 OS 단축키, 자동 업데이트 흐름 — 계층 2 담당.

참조: [`packages/ui/src/*.test.ts`](https://github.com/duhbbx/SkylerX/tree/main/packages/ui/src) · [GitHub Actions](https://github.com/duhbbx/SkylerX/actions/workflows/ci.yml)

## 계층 2 — 수동 체크리스트

모두 Markdown, **증거 필수** — ✅ 는 스크린샷 / SQL 로그 / 녹화가 함께 있어야 함. 흐름:

- **PR 생성** → GitHub 가 `Manual test` + `Reviewer verification` 섹션 자동 채움. 작성자는 자가 테스트하면서 체크 + 증거 첨부. 리뷰어는 브랜치 pull 후 ≥2 항목 무작위 재테스트 후 Approve
- **릴리스 전** → [🚦 Release Smoke issue](https://github.com/duhbbx/SkylerX/issues/new/choose) 생성. 템플릿이 전체 스모크 체크리스트 자동 채움. 전부 녹색 또는 실패는 bug issue 링크 후 tag

### 구조

- [`RELEASE_SMOKE.md`](https://github.com/duhbbx/SkylerX/blob/main/docs/qa/RELEASE_SMOKE.md) — 15 분 릴리스 전 스모크
- [`driver-matrix.md`](https://github.com/duhbbx/SkylerX/blob/main/docs/qa/driver-matrix.md) — 22 방언 매트릭스
- [`features/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/features) — 기능별 13 파일
- [`databases/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases) — 방언별 심층 16 파일

### 방언별 파일이 커버하는 것

Connection · Database/schema · Tables · Indexes · Views · Constraints · Functions / Stored procs · Triggers · Sequences · **Users · Roles · Grants** · DML/Query · Transactions · 방언별 quirks · Cross-platform · Known limitations.

## 흔적을 남기는 템플릿

- [`PULL_REQUEST_TEMPLATE.md`](https://github.com/duhbbx/SkylerX/blob/main/.github/PULL_REQUEST_TEMPLATE.md) — Manual test + Reviewer verification + Evidence
- [`50_release_smoke.yml`](https://github.com/duhbbx/SkylerX/blob/main/.github/ISSUE_TEMPLATE/50_release_smoke.yml) — 릴리스별 스모크 issue
- [`CODEOWNERS`](https://github.com/duhbbx/SkylerX/blob/main/.github/CODEOWNERS) — 핵심 경로는 owner 자동 지정

## 숨기지 않는 한계

- **UI 자동 테스트 아직 없음** (Playwright 는 [ROADMAP](/ko/roadmap) Q4)
- **수동 테스트는 자율에 의존** — Evidence + reviewer 부서명으로 "체크만 하기" 비용 상승
- **실제 DB 커버리지는 테스터 환경 의존** — 체크리스트가 docker-compose 제안하지만 실행은 테스터 결정

## 참여하기

- 버그 신고: [Bug Report 템플릿](https://github.com/duhbbx/SkylerX/issues/new/choose)
- PR 제출: 표준 템플릿 따르기; Manual test 섹션 필수
- 유닛 테스트 추가: [`CONTRIBUTING.md`](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md) 참조
- 수동 체크리스트 추가: [`docs/qa/databases/README.md`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases) 참조

---

> **릴리스 품질?** [Release Smoke issues](https://github.com/duhbbx/SkylerX/issues?q=label%3A%22type%3A+smoke%22) · **CI 상태?** [GitHub Actions](https://github.com/duhbbx/SkylerX/actions) · **로드맵?** [ROADMAP](/ko/roadmap)
