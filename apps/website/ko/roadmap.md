---
title: 로드맵
description: SkylerX 가 추가할 데이터베이스와 기능 계획.
---

# 로드맵

> 최종 업데이트: 2026-05-31 · 방향성 계획이며 약속은 아닙니다. 실제 진행 속도는 피드백과 리소스에 따라 달라집니다.
> 전체 버전: [GitHub ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)

## 범례

- ✅ 출시됨 · 🟢 진행 중 / 이번 분기 · 🔵 다음 분기 · ⚪ 후보 · 🟣 장기

## 1. 데이터베이스 지원

### 이미 지원

MySQL · MariaDB · PostgreSQL · SQLite · H2 · Oracle · SQL Server · DM(达梦)· KingbaseES · OceanBase · TiDB · GBase · ClickHouse · Snowflake · Redshift · Apache Doris · StarRocks · DuckDB · TDengine · MongoDB · Redis · Elasticsearch

### 🟢 2026 Q3 (7-9 월)

- **PolarDB-PG / -X** (클라우드)
- **GaussDB** (화웨이, PG 호환)
- **TimescaleDB** (시계열 / PG 확장)
- **Cassandra / ScyllaDB** (CQL)
- **InfluxDB 3.x** (FlightSQL)

### 🔵 2026 Q4 (10-12 월)

- **Trino / Presto** (페더레이션 쿼리)
- **Apache Hive** (HS2)
- **Neo4j** (그래프, Cypher)
- **Couchbase** (N1QL)
- **AWS DynamoDB** (PartiQL)
- **pgvector / Milvus / Qdrant** (벡터)

### ⚪ 2027 H1 후보

Apache IoTDB · Nebula Graph · SequoiaDB · GreatSQL · Hologres · Lindorm · TDSQL-C · QuestDB · Druid · Pinot · Flink SQL Gateway · Materialize · RisingWave · Vertica · BigQuery · Athena

## 2. 기능

| 카테고리 | 주요 마일스톤 |
|---|---|
| **에디터** | Notebook 모드 · Visual Query Builder · Speech-to-SQL · 방언 간 SP 번역 |
| **결과 그리드** | Form 뷰 · Excel 식 다중값 필터 · Master/Detail · FK 룩업 |
| **스키마** | ER 다이어그램 자동 레이아웃 · 정방향 엔지니어링 · 마이그레이션 v2 |
| **DBA** | 죽은 인덱스 감지 · 슬로우 쿼리 AI 재작성 + 인덱스 제안 · 복제 지연 대시보드 |
| **AI** | Mock 데이터 v2 (FK 인식) · Health check v2 · 스트리밍 자동완성 · 스키마 RAG |
| **협업** | E2E 암호화 연결 동기화 · 팀 쿼리 라이브러리 · Web 버전 |
| **내보내기** | 차트 뷰어 (ECharts) · BI 연동 (Metabase / Superset / PowerBI / Tableau) |
| **플랫폼** | 코드 서명 (macOS / Windows) · Sentry · Playwright E2E |

## 참여하기

- [Issues](https://github.com/duhbbx/SkylerX/issues) 에서 👍 투표
- 신규 요청: [Feature request](https://github.com/duhbbx/SkylerX/issues/new/choose)
- 전체 로드맵: [ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)
