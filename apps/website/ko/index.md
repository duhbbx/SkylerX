---
layout: home
title: SkylerX — 오픈 소스 데이터베이스 관리 도구
titleTemplate: 크로스 플랫폼 · 멀티 방언 · AI 탑재

hero:
  name: SkylerX
  text: AI를 탑재한<br/>크로스 플랫폼 데이터베이스 관리 도구
  tagline: 17개 SQL + 3개 NoSQL 방언 · 중국 국산 DB(신촹) 풀 라인업 · Electron + Vue 3 · Apache 2.0
  image:
    src: /hero-screenshot.png
    alt: SkylerX 쿼리 워크스페이스
  actions:
    - theme: brand
      text: 지금 다운로드
      link: /ko/download
    - theme: alt
      text: 문서 보기
      link: /ko/docs/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/duhbbx/SkylerX

features:
  - icon: 🧠
    title: 다양한 AI 어시스턴트
    details: Anthropic / OpenAI / DeepSeek / Codex / Grok 자유롭게 전환 가능, 7개 전문 AI Toolbox + 인라인 자동 완성 + 헬스 체크
  - icon: 🔌
    title: 20개 이상의 방언
    details: 주요 SQL + 중국 국산 DB 신촹(达梦/金仓/openGauss/OceanBase/TiDB) + NoSQL(MongoDB/Redis/ES)
  - icon: 🛡
    title: 프로덕션 보호
    details: prod 표시 + 위험한 SQL 재확인 + SQL Linter 룰 엔진 + 데이터 마스킹 + 중국 국가 암호 SM2/3/4
  - icon: 📊
    title: 시각화 결과 셋
    details: 가상 스크롤 + 편집 가능 + JSON/BLOB 인식 + 숫자 컬럼 sparkline + 조건부 컬러링
  - icon: 🔍
    title: EXPLAIN 시각화
    details: 예상 행 수 vs 실제 행 수, 느린 연산자 하이라이트, 선택적 ANALYZE 실제 실행 측정
  - icon: 🛠
    title: DBA 도구 상자
    details: 서버 활동 / KILL / 슬로우 쿼리 로그 분석 / 복제 지연 모니터링 / 인덱스 추천 / Schema 드리프트 감지
---

<HeroExtra />

## 왜 SkylerX를 선택하나

- **Navicat은 유료이며 오픈 소스가 아님**, 중국 내에서는 갱신 / 활성화의 번거로움이 있음
- **DataGrip은 구독료가 비쌈**, 개인 개발자에게 친화적이지 않음
- **DBeaver는 무겁고 UI가 낡았으며**, AI 기능이 부족함
- **중국 국산 데이터베이스**(达梦 / KingbaseES / openGauss)는 주요 도구에서의 지원이 그다지 친화적이지 않음
- **AI로 SQL 작성 / EXPLAIN 해석 / 데이터베이스 헬스 체크**가 제대로 가능한 도구를 원함

그래서 SkylerX는 처음부터 다시 만들었습니다, **오픈 소스, 무료, 크로스 플랫폼, 신촹 대응**.

## 주요 기능

<FeatureGrid />

## 지원 데이터베이스

17개 SQL + 3개 NoSQL 방언을 망라하며, **중국 국산 데이터베이스 및 신촹 환경**의 풀 라인업입니다.

<DatabaseGrid />

[전체 데이터베이스 매트릭스 보기 →](/ko/databases)

## 사용 시작

```bash
# 1. GitHub Releases 에서 해당 플랫폼용 설치 패키지 다운로드
#    macOS .dmg / Windows .exe / Linux .AppImage / .deb / .rpm
open https://github.com/duhbbx/SkylerX/releases/latest

# 2. SkylerX 설치 및 실행

# 3. 새 연결 → 방언 선택 → host/port/user/password 입력 → 테스트 → 저장

# 4. 연결 더블 클릭 → 네비게이션 트리 탐색 → 테이블명 더블 클릭으로 데이터 그리드 열기 → 쿼리 시작
```

전체 튜토리얼은 [빠른 시작 →](/ko/docs/getting-started)

## 회사 소개 / 비즈니스 협력

**Wuhan Skyler Network Technology Co., Ltd.** — SkylerX의 개발 및 유지 관리 주체이며, 외주 개발 및 프로젝트 협력도 함께 받습니다.

- 🗄 **데이터베이스 컨설팅** — 선정 / 설계 / 튜닝 / 마이그레이션(Oracle / SQL Server → MySQL / PG / 중국 국산 DB)
- 🏢 **Navicat / DataGrip 대체 배포** — 엔터프라이즈 내부 프라이빗 버전 커스터마이징
- 🛡 **신촹 / 국산화 환경 배포** — 麒麟 / 统信 UOS / 龙芯 / 飞腾 등
- 🤖 **AI 통합** — LLM 게이트웨이 / RAG / Agent 워크플로우 / 프라이빗 추론
- 📊 **데이터 플랫폼** — ETL / 데이터 웨어하우스(ClickHouse / Snowflake / DuckDB)
- 🛠 **DevOps & SRE** — CI/CD / 옵저버빌리티 / 멀티 클라우드 하이브리드

연락처: `duhbbx@gmail.com` · WeChat `tuhoooo`
