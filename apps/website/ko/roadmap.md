---
title: 로드맵
description: SkylerX 가 곧 추가할 데이터베이스와 기능 계획, 매 분기 갱신됩니다.
---

# 로드맵

> 최종 업데이트: 2026-06-04
> 방향성 계획이며 약속은 아닙니다. 실제 진행 속도는 피드백과 리소스에 따라 달라집니다.
> 전체 원본: [GitHub 의 ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)

무언가를 앞당기고 싶으신가요?

- 👍 해당하는 [issue](https://github.com/duhbbx/SkylerX/issues) 에 투표하세요
- 새 요청을 제출하세요: [New Feature Issue](https://github.com/duhbbx/SkylerX/issues/new/choose)
- 아키텍처를 논의하세요: [Discussions](https://github.com/duhbbx/SkylerX/discussions)

## 범례

- ✅ 출시됨
- 🟢 진행 중 / 이번 분기
- 🔵 다음 분기
- ⚪ 후보 — 우선순위는 피드백에 따라 바뀝니다
- 🟣 장기 / 아키텍처 변경 필요

---

## 1. 데이터베이스 지원

### 1.1 이미 지원됨 (2026-05 기준)

| 분류 | 드라이버 |
|---|---|
| **관계형 (오픈소스)** | MySQL · MariaDB · PostgreSQL · SQLite · H2 |
| **관계형 (상용)** | Oracle · SQL Server |
| **중국산 / 信创** | DM (达梦) · KingbaseES (人大金仓) · OceanBase · TiDB · GBase |
| **분석형 (MPP/OLAP)** | ClickHouse · Snowflake · Amazon Redshift · Apache Doris · StarRocks · DuckDB |
| **시계열** | TDengine |
| **NoSQL** | MongoDB · Redis · Elasticsearch |

### 1.2 온보딩 계획

#### 🟢 2026 Q3 (7-9 월)

| 데이터베이스 | 유형 | 비고 |
|---|---|---|
| **PolarDB-PG / -X** | 클라우드 네이티브 | 기존 드라이버 재사용 |
| **GaussDB (화웨이)** | 信创 | PG 호환 모드 |
| **TimescaleDB** | 시계열 (PG 확장) | Hypertable / continuous aggregates |
| **Cassandra / ScyllaDB** | 와이드 컬럼 NoSQL | SQL 채널 상의 CQL |
| **InfluxDB 3.x** | 시계열 | FlightSQL |

#### 🔵 2026 Q4 (10-12 월)

| 데이터베이스 | 유형 | 비고 |
|---|---|---|
| **Trino / Presto** | 페더레이션 SQL | HTTP API, 카탈로그 트리가 서브소스를 매핑 |
| **Apache Hive (HS2)** | 빅데이터 SQL | Kerberos / LDAP 상의 JDBC |
| **Neo4j** | 그래프 | Bolt + Cypher, 신규 채널 |
| **Couchbase** | 멀티모델 NoSQL | N1QL |
| **AWS DynamoDB** | KV / 문서 | PartiQL, NoSQL 채널 |
| **pgvector / Milvus / Qdrant** | 벡터 | 전용 벡터 필드 뷰어 |

#### ⚪ 2027 H1 후보

Apache IoTDB · Nebula Graph · SequoiaDB · GreatSQL · Hologres (Aliyun PG) · Lindorm (Aliyun HBase) · TDSQL-C (Tencent) · QuestDB · Apache Druid · Apache Pinot · Flink SQL Gateway · Materialize · RisingWave · Vertica · BigQuery · Athena

#### 🟣 장기 (수요에 따라)

Apache HBase · Impala · DynamoDB Streams · Cassandra CDC · LMDB / RocksDB 뷰어 · Weaviate / Chroma · ArangoDB (멀티모델)

---

## 2. 기능 로드맵

### 2.1 에디터 & 쿼리 UX

| 상태 | 기능 |
|---|---|
| ✅ | SQL Linter + AI 인라인 자동완성 |
| ✅ | 태그 + 고정 기능을 갖춘 쿼리 히스토리 |
| ✅ | **Notebook 모드** — 멀티 셀 SQL / Markdown, 로컬 영속화, Jupyter 유사 |
| 🟢 | **Visual Query Builder** — 드래그 조인, 자동 JOIN, GUI 집계 |
| 🔵 | **Speech-to-SQL** — Whisper 오프라인 → AI 변환 |
| 🔵 | **방언 간 SP 번역기** — Oracle PL/SQL ↔ PG PL/pgSQL ↔ DM |
| ✅ | **Linter 사용자 규칙 에디터** — 사용자 정의 금지 패턴 / 스타일 규칙 (정규식 매칭 + 심각도 레벨) |
| ⚪ | 스니펫 라이브러리 + 기기 간 동기화 |

### 2.2 결과 그리드 UX

| 상태 | 기능 |
|---|---|
| ✅ | 인라인 편집 + DML 커밋, 오류 시 "Ask AI", 셀 뷰어 |
| ✅ | **쿼리 결과 diff** — 두 결과 집합을 행 / 셀 단위로 비교, 추가 / 삭제 / 변경 표시 |
| ✅ | **내보내기 시 마스킹** — 마스킹이 켜져 있으면 복사 / 내보내기 (CSV/JSON/SQL/…) 가 규칙에 따라 컬럼 전체를 마스킹하여 그리드와 일치 — 더 이상 "화면은 마스킹, 내보내기는 평문" 문제 없음 |
| 🟢 | **Form 뷰** — 넓은 테이블용 세로형 단일 행 에디터 |
| 🟢 | **Excel 식 다중값 필터** |
| 🔵 | **Master/Detail 연동** — 한 행을 선택하면 관련 테이블을 자동 로드 |
| 🔵 | FK 컬럼 편집 시 **FK 룩업 드롭다운** |
| ⚪ | 라이브 JOIN 컬럼 확장 · 피벗 · JSON 컬럼 트리 뷰어 |

### 2.3 스키마 & 모델링

| 상태 | 기능 |
|---|---|
| ✅ | DDL 생성 · 스키마 diff · Mock 데이터 v1 |
| ✅ | Oracle → DM 마이그레이션 마법사 |
| ✅ | **마이그레이션 평가** — 소스 프로파일링 (17 개 오브젝트 분류 + 위험 지표) + A/B/C/D 등급 + AI PL/SQL 변환 + Word/PDF/Excel 내보내기, hub-and-spoke IR 설계 |
| ✅ | **ER 다이어그램 자동 레이아웃** — 라이브 스키마에서 역공학, FK 자동 연결 (자식 → 부모), 컬럼 수에 따른 노드 크기, PK 테이블 강조, 테이블 + 이웃 포커스, PNG / SVG 내보내기 |
| 🔵 | **정방향 엔지니어링** — ER 다이어그램 편집 → 마이그레이션 생성 |
| ✅ | **크로스 DB 마이그레이션 v2** — hub-and-spoke IR: MySQL/Oracle/DM/SQL Server 파싱 → 전체 타입 / 인덱스 / 뷰 / FK 와 함께 PG/Oracle/DM/MySQL 생성, 데이터 마이그레이션 (청크 파라미터화 + 증분 + 검증) |
| ✅ | **데이터 리니지 그래프** — SQL 파싱 → 테이블 수준 리니지 (컬럼 수준은 로드맵 예정) |
| ⚪ | dbt 연동 · 컬럼 수준 리니지 |

### 2.4 DBA / 운영

| 상태 | 기능 |
|---|---|
| ✅ | EXPLAIN 시각화 · 슬로우 쿼리 스파크라인 · Health check v1 |
| ✅ | **장기 실행 쿼리 킬러** — 방언 간 프로세스/세션 목록 (MySQL `information_schema.PROCESSLIST` / PG `pg_stat_activity` / MSSQL `sys.dm_exec_requests` / Oracle `v$session`), 운영 연결에서는 `KILL` 을 직접 입력하는 확인 절차와 함께 행별 KILL |
| 🟢 | **죽은 인덱스 감지** + 크기 통계 |
| 🟢 | **슬로우 쿼리 → 자동 재작성 + 인덱스 제안** |
| 🔵 | 복제 지연 대시보드 |
| ✅ | **스토리지 증가 추세 예측** — db/테이블 크기 스냅샷, 7/30/90 일 용량 곡선 적합 + 한도 경고 |
| ⚪ | 커넥션 풀 튜닝 · 서명된 감사 로그 · 백업 스케줄러 |

### 2.5 AI

| 상태 | 기능 |
|---|---|
| ✅ | AI 채팅 · 오류 시 Ask-AI · Mock 데이터 v1 · Health check v1 |
| 🟢 | **Mock 데이터 v2** — 테이블 간 FK 인식 + 시맨틱 필드 (이름, 주소, 전화번호) |
| 🟢 | **Health check v2** — 안티패턴 라이브러리를 50+ 개 검사로 확장 |
| 🔵 | **스트리밍 자동완성 (Cursor 스타일)** — 입력하는 즉시 제안 |
| ✅ | **스키마 + 문서 RAG** — 스키마 (테이블 / 뷰 / 함수) + 문서를 청크화 → 벡터 (OpenAI 호환 /v1/embeddings) + BM25 하이브리드 검색 (RRF 융합) + 관련도 하한, 관련 테이블만 AI 컨텍스트에 주입, 임베딩이 없으면 어휘 기반으로 우아하게 폴백 |
| ⚪ | AI 추천 마스킹 규칙 · SQL → ER 다이어그램 |

### 2.6 협업 / 멀티 디바이스

| 상태 | 기능 |
|---|---|
| ✅ | 멀티 윈도우 · 7 개 언어 i18n |
| 🔵 | **E2E 암호화 연결 동기화** — 기기 간, 저장 시 암호화 |
| 🔵 | **팀 쿼리 라이브러리** — 읽기 전용 / 코멘트 / fork |
| ⚪ | Web 버전 · 모바일 읽기 전용 뷰어 |
| 🟣 | 실시간 페어 쿼리 (Yjs 프로토콜) |

### 2.7 연동 & 내보내기

| 상태 | 기능 |
|---|---|
| ✅ | CSV / Excel / JSON / SQL / Parquet / Markdown 내보내기 |
| ✅ | **차트 뷰어 (ECharts)** — 결과 그리드에서 원클릭: 선 / 막대 / 원형 / 산점도, Y 는 숫자 컬럼, X 는 비숫자 컬럼 자동 감지, 줌 + 다중 시리즈 지원, 메인 스레드 렌더링 최대 5000 행 |
| 🔵 | **차트 프리셋 / 대시보드** — "이 쿼리 → 이 차트" 를 저장해 재사용 |
| 🔵 | **BI 내보내기** — Metabase / Superset / PowerBI / Tableau 데이터 소스 |
| ⚪ | REST / GraphQL mock 엔드포인트 |

### 2.8 플러그인 / 확장성

| 상태 | 기능 |
|---|---|
| 🔵 | **서드파티 드라이버 플러그인 API** |
| ⚪ | 내보내기 포맷 플러그인 / 테마 플러그인 |

### 2.9 내비게이션 트리 / 워크스페이스 내비게이션

NavTree 는 일상 작업의 95% 가 시작되는 진입점입니다 — 방금 도착한 정리 작업의 물결:

| 상태 | 기능 |
|---|---|
| ✅ | **다중 선택 + 일괄 작업** — Ctrl/⌘+클릭 / Shift+범위, DROP / TRUNCATE / 그룹으로 이동 / SELECT 템플릿 복사 / DDL 내보내기 / 병렬 연결 테스트, 일괄 SQL 은 지원되는 경우 네이티브 멀티 타깃을 사용하고 (PG `DROP TABLE a, b, c`) 그 외에는 실패 시 즉시 중단하는 순차 처리 (Oracle/DM/SQLite). Refs #25 |
| ✅ | **드래그로 너비 조정** — 200-600px, 더블 클릭으로 초기화, 설정에 영속화. Refs #17 |
| ✅ | **연결별 표시 DB/스키마 필터** — 연결 이름 옆 DataGrip 스타일 N/M 칩, v2 는 데이터베이스별 스키마 필터 지원 (한 DB 에 50 개 스키마가 있는 PG 시나리오). Refs #24 |
| ✅ | **로컬 트리 검색 (Ctrl/⌘+F)** — 로드된 노드를 실시간 필터링, 매치가 있는 브랜치를 강제 확장 |
| ✅ | **전체 카탈로그 오브젝트 인덱스 + 트리 간 검색** — 연결별 플랫 카탈로그 캐시 (~5MB / 10 만 오브젝트 / 10ms 스캔), 첫 검색 시 백그라운드에서 조용히 빌드, 매치가 트리 위에 표시, 테이블 / 뷰 / 함수 / 프로시저 / 시퀀스 / 트리거 / 인덱스 커버, kind-pill 필터링 |
| ✅ | **Redis 키 클릭 연동** — 내비에서 Redis 키를 단일 클릭하면 매칭되는 RedisPane 탭에 포커스하고 키를 선택, 새 탭을 띄우지 않음. Refs #19 |
| ✅ | **방언 전반의 오브젝트 타입 완전성** — Oracle/DM (DM 의 타입에 대한 `CLASS` object_type 수정 포함), Vastbase/openGauss + PG 패밀리 전체 (구체화 뷰 / 프로시저 / 타입, openGauss 는 패키지 / 시노님도), SQL Server (함수 / 프로시저 / 트리거 / 시퀀스 / 타입 / 시노님) |
| ✅ | **시스템 DB/스키마 원클릭 제외** — 표시 DB/스키마 설정에서 시스템 DB/스키마 (mysql / pg_catalog / SYS / SYSAUDITOR …) 를 한 번에 체크 해제, 사용자 오브젝트는 그대로 유지, 단일 레벨 방언 (MySQL 등) 은 더 이상 무의미한 스키마 드롭다운을 표시하지 않음 |
| ✅ | **연결 정보 복사** — 연결 우클릭 → "연결 정보 복사" 서브메뉴: JDBC URL / JSON / 멀티 라인 / 싱글 라인 (;) — 비밀번호는 절대 포함하지 않음 |
| ✅ | **그룹으로 이동 (콤보박스)** — 일괄 그룹 이동: 드롭다운에서 기존 그룹 선택 또는 새 이름 입력 (트림 후 없으면 생성), 비우면 그룹에서 제거 |
| 🟢 | **Cmd+Shift+P 전역 오브젝트 파인더** — 연결 간 퍼지 모달, 트리 내 검색을 보완 |
| 🔵 | **인덱스를 IndexedDB 에 영속화** — 콜드 스타트 결과를 밀리초 단위로 (staleness 마커 포함) |
| 🔵 | **모든 종류에 대한 revealObject** — 현재는 트리에서 테이블/뷰를 표시, 함수 / 프로시저 / 시퀀스로 확장 |
| ⚪ | **선택한 연결 전반의 일괄 작업** — 예: 모든 `prod` 태그 연결에 대한 야간 리포트 |

---

## 3. 플랫폼 / 엔지니어링

| 상태 | 항목 |
|---|---|
| ✅ | 멀티 아키텍처 빌드 매트릭스 (macOS arm/x64 · Windows · Linux) |
| ✅ | Aliyun OSS 미러 + 자동 업데이트 채널 스위처 |
| 🟢 | **코드 서명** — Apple Developer + Windows (SignPath OSS 경유) |
| 🟢 | **크래시 리포팅** — 소스 맵을 갖춘 셀프 호스팅 Sentry |
| 🔵 | Playwright E2E + CI 매트릭스 |
| 🔵 | Codecov 연동 |
| ⚪ | AppImage / Snap / Flatpak / MS Store / MAS / Homebrew tap |

---

## 4. 문서 / 커뮤니티

| 상태 | 항목 |
|---|---|
| ✅ | 7 개 언어 사이트 + SEO + 셀프 호스팅 Umami |
| ✅ | DBA / Schema / NoSQL / Security / AI / Productivity 문서 |
| 🟢 | **비디오 튜토리얼** (Bilibili + YouTube, 핵심 기능당 3 분 미만) |
| 🔵 | 사례 연구 / 공개 changelog 사이트 |

---

## 마일스톤

| 날짜 | 하이라이트 |
|---|---|
| 2026-06 | 스키마 RAG (벡터 + BM25 하이브리드) · ER 다이어그램 + PNG/SVG 내보내기 · 쿼리 결과 diff · 내보내기 시 마스킹 · 방언 전반의 내비 오브젝트 타입 완전성 · 크로스 방언 리더 라이브 검증 (DM/Oracle/MySQL/Vastbase) |
| 2026-05 | AI 설정 → 암호화 SQLite · 7 개 언어 SEO · 셀프 호스팅 Umami |
| 2026-04 | ClickHouse / Snowflake / Doris / StarRocks / Redshift / H2 드라이버 물결 |
| 2026-03 | NoSQL 채널 (MongoDB / Redis / Elasticsearch) · SQL Linter · AI 인라인 |
| 2026-02 | EXPLAIN 시각화 · 슬로우 쿼리 스파크라인 · Oracle → DM 마법사 |
| 2026-01 | 첫 공개 릴리스 (MySQL / PG / Oracle / SQL Server / DM / KingbaseES) |

---

## 기여하고 싶으신가요?

- 설정, 테스트, PR 규칙은 [CONTRIBUTING.md](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md) 를 참고하세요
- 신규 드라이버: `packages/core-driver/src/drivers/*` 중 아무거나 템플릿으로 복사하세요
- 로드맵 자체는 [ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md) 에 있습니다 — PR 환영합니다
