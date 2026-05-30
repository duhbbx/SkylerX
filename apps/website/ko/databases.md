---
title: 지원하는 데이터베이스
description: SkylerX 가 지원하는 17개 SQL + 3개 NoSQL 방언 목록, 드라이버 패키지명과 프로토콜 설명 포함
---

# 지원하는 데이터베이스

SkylerX 는 **통합 드라이버 추상화 레이어**(`@db-tool/core-driver`)를 통해 각 방언에 접속합니다. SQL 방언은 `execute(sql, params)` 를, NoSQL 은 `executeCommand(payload)` 병렬 채널을 사용합니다.

새 방언 추가는 다음만 하면 됩니다.

1. `DbDialect` enum 에 한 항목 추가
2. `dialects/<name>.ts` 에서 `DatabaseDriver` 인터페이스 구현
3. `dialects/index.ts` 에 한 줄 등록

<DatabaseGrid />

## 프로토콜 호환성 매트릭스

많은 "새" 방언이 기존 프로토콜(MySQL wire / PG wire)과 호환되며, 이들은 **해당 드라이버를 그대로 재사용**할 수 있어 거의 비용 없이 접속됩니다.

### MySQL 프로토콜 패밀리(`mysql2` 사용)

- MySQL · MariaDB · OceanBase · TiDB · Doris · StarRocks

### PostgreSQL 프로토콜 패밀리(`pg` 사용)

- PostgreSQL · 人大金仓 KingbaseES · openGauss · Greenplum · CockroachDB · H2(PG-server 모드) · Amazon Redshift

### 독립 드라이버

| 방언 | 드라이버 패키지 | 설명 |
|---|---|---|
| Oracle | `oracledb` | 기본 thin 모드, 순수 JS 로 Instant Client 불필요, SYSDBA / SYSOPER 역할 지원 |
| 达梦 DM | `dmdb` | 공식 배포 패키지, 지연 로드, 신촹 주력 |
| SQL Server | `mssql` | 순수 JS, Windows / SQL Auth 지원 |
| SQLite | `better-sqlite3` | 로컬 파일, `.db` / `.sqlite` 지원 |
| DuckDB | `@duckdb/node-api` | 로컬 파일, OLAP 친화적, BigInt 자동 문자열화로 정밀도 손실 방지 |
| ClickHouse | `@clickhouse/client` | HTTP 프로토콜 |
| Snowflake | `snowflake-sdk` | 클라우드 DW, 비밀번호 / 개인 키 / OAuth 인증 지원 |
| TDengine 涛思 | `@tdengine/websocket` | WebSocket 프로토콜, 시계열 시나리오 |

### NoSQL 병렬 채널

| 방언 | 드라이버 패키지 | 채널 |
|---|---|---|
| MongoDB | `mongodb` | `executeCommand({ op, args, context })`, find/aggregate/insert/update/delete 등 op 지원 |
| Redis | `ioredis` | `executeCommand({ op, args })`, SCAN 샘플링 + 전체 TYPE 가져오기 |
| Elasticsearch | `@elastic/elasticsearch` | REST/HTTP, search/get/bulk/raw 등 op 지원 |

## 중국 국산 신촹 풀 라인업

SkylerX 는 **모든 주요 중국 국산 데이터베이스를 네이티브로 지원**하는 몇 안 되는 오픈 소스 도구 중 하나입니다.

| 데이터베이스 | 벤더 | 프로토콜 | 상태 |
|---|---|---|---|
| **达梦 DM** | 达梦 데이터베이스 | 자체 | ✅ 완전 |
| **人大金仓 KingbaseES** | 人大金仓 | PG 호환 | ✅ 완전 |
| **openGauss** | 화웨이 / 차이나 모바일 | PG 호환 | ✅ 완전 |
| **OceanBase** | 蚂蚁 (앤트) | MySQL 호환(Oracle 테넌트도 지원) | ✅ 완전 |
| **TiDB** | PingCAP | MySQL 호환 | ✅ 완전 |
| **TDengine** | 涛思 | WebSocket | ✅ 완전 |

부가 기능:
- 🛡 **중국 국가 암호 SM2/SM3/SM4** 암복호화 도구
- 📋 **중국 보안 등급 보호 2.0 (GB17859) 컴플라이언스 체크** 패널(MySQL + PG 계열)
- 🔄 **Oracle → 达梦 DM 마이그레이션 마법사**(타입 + 함수 + DDL 자동 변환)

## 호환성 안내

| 시나리오 | 지원도 |
|---|---|
| 주요 SQL 표준 쿼리(SELECT / JOIN / WINDOW / CTE) | ✅ 모든 방언 |
| 에디터: 구문 강조 / 자동 완성 / 포매팅 | ✅ 모든 SQL 방언 |
| 시각화 결과 셋 / 편집 가능 그리드 | ✅ 모든 SQL 방언 |
| EXPLAIN 시각화 | ✅ MySQL / PG / 주요 방언 |
| Manual commit 수동 트랜잭션 모드 | ✅ MySQL / PG / Oracle / DM / SQL Server / Snowflake / OceanBase / KingbaseES / Greenplum / openGauss / TiDB / CockroachDB |
| 슬로우 쿼리 로그 분석 | ✅ MySQL 계열 + PG 계열 |
| 복제 지연 모니터링 | ✅ MySQL 계열 + PG 계열 + SQL Server AOAG |
| 구조 비교 / 데이터 비교 | ✅ 모든 SQL 방언 |
| 백업 / 복원(SQL 형식, 크로스 플랫폼) | ✅ 모든 SQL 방언 |
| AI 어시스턴트 | ✅ 모든 방언(SQL 번역으로 방언 간 상호 변환) |

## 원하는 데이터베이스가 없나요?

- [Issue 등록으로 새 방언 신청 →](https://github.com/duhbbx/SkylerX/issues/new)
- 프로토콜 호환 방언(MySQL / PG wire 기반)은 **5분 만에 접속 가능**
- 엔터프라이즈 자체 개발 데이터베이스는 비즈니스 협력으로 문의: `duhbbx@gmail.com`
