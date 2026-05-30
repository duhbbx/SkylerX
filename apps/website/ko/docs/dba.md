# DBA 와 모니터링

SkylerX 는 DBA 트러블슈팅에 자주 쓰이는 몇 가지 "실시간 뷰" 를 내장 패널로 만들었습니다: 프로세스 리스트 / 장기 트랜잭션 / 락 대기 / 복제 지연 / 슬로우 쿼리 Top N / 서버 지표 / 클러스터 토폴로지 / 권한.

모든 패널은 **대상 연결에 직접 SQL 을 실행**(중간 agent 없음), 추가 수집기도 없고, 데이터베이스 설정을 수정하지도 않습니다. 각 패널의 조회 SQL 과 방언 라우팅은 소스 코드 `packages/ui/src/components/*Dialog.vue` 에서 글자 단위로 검증 가능합니다.

## 진입점 일람

DBA 류 기능은 독립 메뉴가 없으며, 통합으로 **커맨드 팔레트** 를 통해 트리거: `⌘K` / `Ctrl+K` 로 열고, 패널명 검색. 구체적 연결과 관련된 것(예: "서버 활동", "슬로우 쿼리", "복제 지연", "OB 토폴로지")은 등록된 각 연결별로 명령을 생성하며, 어느 것을 선택하느냐에 따라 어느 DB 에 연결할지 결정됩니다.

| 패널 | 커맨드 팔레트 키워드 | 진입점 id |
|---|---|---|
| 서버 활동 | `서버 활동 / Server activity` | `act:activity:<connId>` |
| 복제 지연 | `복제 지연 / Replication lag` | `act:repl:<connId>` |
| 슬로우 쿼리 로그 분석 | `슬로우 쿼리 / Slow query` | `act:slowq:<connId>` |
| 작업 로그 | `작업 로그 / Operation log` | `act:oplog` |
| 서버 모니터링 | `서버 모니터링 / Server monitor` | `act:monitor` |
| OceanBase 클러스터 토폴로지 | `OceanBase` | `act:obtopo:<connId>` |
| 사용자 및 권한 | `사용자 및 권한 / Users & privileges` | `act:privileges` |

커맨드 팔레트 단축키는 `DEFAULT_KEY_BINDINGS.palette = 'CmdOrCtrl+K'` 로 정의되며, "설정 → 커스텀 단축키" 에서 변경 가능.

---

## 서버 활동

`ServerActivityDialog.vue` — 제목 `서버 활동 · {conn}`. 3개 탭 포함, 상단에 "새로고침" 버튼 + 자동 새로고침 드롭다운(2s / 5s / 10s / 끄기).

### 세 개의 패널

#### 프로세스 리스트(`tabProcesses`)

| 방언 패밀리 | 조회 SQL |
|---|---|
| MySQL | `information_schema.PROCESSLIST WHERE COMMAND <> 'Sleep' ORDER BY TIME DESC` |
| PostgreSQL | `pg_stat_activity WHERE state IS NOT NULL AND pid <> pg_backend_pid()` |
| SQL Server | `sys.dm_exec_sessions` JOIN `sys.dm_exec_requests` + `OUTER APPLY sys.dm_exec_sql_text(r.sql_handle)` |

필드는 SQL 레이어에서 컬럼명 정규화(`id / user / host / db / time / state / info`), 3개 방언 렌더링 헤더 일관.

#### 장기 트랜잭션(`tabLongTx`)

| 방언 패밀리 | 조회 SQL |
|---|---|
| MySQL | `information_schema.INNODB_TRX ORDER BY trx_started ASC`(`rows_locked / rows_modified` 반환) |
| PostgreSQL | `pg_stat_activity WHERE xact_start IS NOT NULL` |
| SQL Server | `sys.dm_tran_active_transactions` JOIN `sys.dm_tran_session_transactions` |

#### 락 대기(`tabLocks`)

| 방언 패밀리 | 조회 SQL |
|---|---|
| MySQL | `performance_schema.data_lock_waits` |
| PostgreSQL | `pg_locks` JOIN `pg_stat_activity` 의 "blocked / blocking" 자기 조인 |
| SQL Server | `sys.dm_tran_locks WHERE request_status = 'WAIT'` |

### KILL 작업

프로세스 리스트 / 장기 트랜잭션 두 탭의 각 행 우측에 `✗ KILL` 버튼이 있으며, 클릭 시 "세션 / 트랜잭션 종료" 확인 다이얼로그, 확인 후 방언별 실행:

| 방언 패밀리 | KILL 문 |
|---|---|
| MySQL | `KILL <id>` |
| PostgreSQL | `SELECT pg_terminate_backend(<pid>)` |
| SQL Server | `KILL <spid>` |

락 대기 탭은 KILL 제공 안 함(락 대기는 종종 blocker 가 차단하고 있으므로, 프로세스 리스트에서 blocker 를 kill 해야 함).

### 방언 적응 룰

진입점은 `familyOfConn()` 사용: 먼저 `dialectKind` 로 NoSQL 판정 → 직접 거부(`'NoSQL 방언은 이 패널에 적용 불가'`); 그렇지 않으면 `ddl.familyOf(dialect)` 사용:

- **MySQL 패밀리** 직접 매치 → MariaDB / TiDB / OceanBase / Doris / StarRocks
- **PG 패밀리** PG 분기 재사용 → CockroachDB / Greenplum / OpenGauss / KingbaseES / H2(`ddl.ts` 가 H2 도 pg 로 분류)
- **SQL Server** → mssql 분기
- 기타 방언은 `현재 방언은 이 패널을 지원하지 않습니다` 표시

---

## 복제 지연 모니터링

`ReplicationLagDialog.vue` — 제목 `마스터-슬레이브 복제 지연 · {conn}`.

상단에 **방언 badge + 역할 + 자동 새로고침 옵션(기본 5s, 끄기 / 2s / 5s / 10s 선택 가능)**. 역할은 4종, SQL 레이어에서 판정, UI 에서 색상으로 구분:

| 역할 | 출처 판정 | UI 색상 |
|---|---|---|
| 마스터 (`source`) | MySQL: `SHOW REPLICAS` / `SHOW SLAVE HOSTS` / `SHOW BINARY LOG STATUS` 중 하나라도 행 있음; PG: `pg_stat_replication` 에 행 있음; MSSQL: 로컬 replica `role_desc = 'PRIMARY'` | 녹색 |
| 슬레이브 (`replica`) | MySQL: `SHOW REPLICA STATUS` / `SHOW SLAVE STATUS` 에 행 있음; PG: `pg_is_in_recovery() = true`; MSSQL: 로컬 `role_desc = 'SECONDARY'` | 파란색 |
| 독립 (`standalone`) | 모든 탐지 비어 있음 | 회색 |
| 알 수 없음 (`unknown`) | 미지원 방언 | 회색 |

### 방언 라우팅 세부

#### MySQL 패밀리

4단계 폴백, 어느 단계든 행을 얻으면 정지:

1. `SHOW REPLICA STATUS`(MySQL 8.0.22+ 새 이름)
2. `SHOW SLAVE STATUS`(구 이름, 5.7 / 8.0 < 22 / MariaDB 호환)
3. 위가 모두 비어 있으면 → `SHOW REPLICAS` 시도하여 하류 슬레이브 나열
4. 다시 `SHOW BINARY LOG STATUS` / `SHOW MASTER STATUS` 로 폴백

반환 컬럼은 "핵심 컬럼 우선" 투영: `Channel_Name / Source_Host / Replica_IO_Running / Seconds_Behind_Source / Last_Error` 등 먼저 배치, 나머지는 뒤에 추가.

#### PostgreSQL 패밀리

```sql
-- 1) 먼저 standby 판정
SELECT pg_is_in_recovery() AS is_replica
-- 2a) 슬레이브 시점
SELECT
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int AS lag_seconds,
  pg_last_wal_receive_lsn()::text,
  pg_last_wal_replay_lsn()::text
-- 2b) 마스터 시점
SELECT pid, application_name, state, sync_state,
  EXTRACT(EPOCH FROM write_lag)  AS write_lag_seconds,
  EXTRACT(EPOCH FROM flush_lag)  AS flush_lag_seconds,
  EXTRACT(EPOCH FROM replay_lag) AS replay_lag_seconds,
  sent_lsn, write_lsn, flush_lsn, replay_lsn
FROM pg_stat_replication
```

#### SQL Server(AOAG)

`sys.dm_hadr_database_replica_states` JOIN `sys.availability_replicas` + `sys.dm_hadr_availability_replica_states`, 필드 포함: `synchronization_state_desc / synchronization_health_desc / log_send_queue_size / redo_queue_size / DATEDIFF(SECOND, last_commit_time, GETDATE()) AS lag_seconds`.

AOAG 구성 없으면 standalone.

### 컬러링 임계값

코드 상수:

```ts
const LAG_WARN   = 5    // 황색
const LAG_DANGER = 30   // 빨간색
```

"lag 초" 류 컬럼에만 색상, 후보 컬럼명: `lag_seconds / Seconds_Behind_Source / Seconds_Behind_Master / replay_lag_seconds / write_lag_seconds / flush_lag_seconds`.

### 폴트 톨러런스

`looksLikeNoReplication()` 가 `not configured / not a slave / not a replica / no such / access denied / permission denied / privilege / does not exist` 를 포함하는 오류를 "복제 미활성화" 회색 안내로 변환, 권한 부족 시 전체 페이지 빨간색 회피.

`Last_Error / Last_IO_Error / Last_SQL_Error` 중 하나라도 비어 있지 않으면 → 상단에 빨간색 배너로 단독 강조.

---

## 슬로우 쿼리 분석

`SlowQueryDialog.vue` + `slowQuery.ts` — 제목 `슬로우 쿼리 로그 분석`.

도구는 읽기 전용이며 설정 변경 안 함: **사용자 대신 어떤 변수도 SET 하지 않음**. 활성화 여부, 보존 기간, 샘플링 임계값은 모두 DBA 결정 사항, SkylerX 는 기존 digest 테이블만 읽음.

### 데이터 소스

| 방언 패밀리(`slowFamilyOf`) | 포함 방언 | 데이터 소스 |
|---|---|---|
| `mysql` | MySQL / MariaDB / TiDB / OceanBase / Doris / StarRocks | `performance_schema.events_statements_summary_by_digest` |
| `pg` | PostgreSQL / CockroachDB / Greenplum / OpenGauss / KingbaseES / Redshift | `pg_stat_statements` 익스텐션 |
| `other` | 기타 | `slowq.unsupported` 표시 |

> `slowFamilyOf()` 는 `ddl.familyOf()` 재사용 안 함 — 후자는 H2 를 pg 로 분류, Redshift 미수록, 본 모듈의 판정 경계와 다름.

### 쿼리 템플릿

#### MySQL — `events_statements_summary_by_digest`

```sql
SELECT
  DIGEST_TEXT AS sql_text,
  COUNT_STAR  AS exec_count,
  ROUND(AVG_TIMER_WAIT/1e9, 2) AS avg_ms,
  ROUND(SUM_TIMER_WAIT/1e9, 2) AS total_ms,
  ROUND(MAX_TIMER_WAIT/1e9, 2) AS max_ms,
  SUM_ROWS_EXAMINED AS rows_examined,
  SUM_ROWS_SENT     AS rows_sent,
  SUM_NO_INDEX_USED AS no_index_count,
  FIRST_SEEN, LAST_SEEN
FROM performance_schema.events_statements_summary_by_digest
WHERE (? IS NULL OR SCHEMA_NAME = ?)
ORDER BY <SUM_TIMER_WAIT | AVG_TIMER_WAIT | COUNT_STAR> DESC
LIMIT 50
```

`*_TIMER_WAIT` 단위는 피코초(10⁻¹² s), `/1e9` 로 밀리초 변환. `schema` 파라미터는 connection.database 로 자동 입력.

#### PostgreSQL — `pg_stat_statements`

```sql
SELECT
  query AS sql_text,
  calls AS exec_count,
  ROUND(mean_exec_time::numeric, 2)  AS avg_ms,
  ROUND(total_exec_time::numeric, 2) AS total_ms,
  ROUND(max_exec_time::numeric, 2)   AS max_ms,
  rows AS rows_sent,
  shared_blks_hit, shared_blks_read
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY <total_exec_time | mean_exec_time | calls> DESC NULLS LAST
LIMIT 50
```

### 정렬, Top N, 미활성화 안내

- 상단 "정렬" 드롭다운: 총 소요 시간 / 평균 소요 시간 / 호출 수 3택, 매 전환마다 **새 `ORDER BY` 로 재실행**, 프론트 정렬 아님
- 기본 LIMIT 50, 코드에서 `Math.max(1, Math.min(500, limit))` 상한 500
- 활성화 탐지: MySQL 은 `SHOW VARIABLES LIKE 'slow_query_log'`, PG 는 `SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'`
- 탐지 실패 → 리스트를 "미활성화" 안내로 교체, **붙여넣기 가능한 활성화 SQL 동반**(MySQL: `SET GLOBAL slow_query_log = ON; SET GLOBAL long_query_time = 1; …`; PG: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements; …`)

### 행 전개 후 작업

행 클릭하여 전개, 완전한 SQL 표시, 4개 버튼 제공:

| 버튼 | 동작 |
|---|---|
| 복사 | `navigator.clipboard.writeText(sql)` |
| 쿼리로 열기 | `openSql` emit → 부모 컨테이너가 새 쿼리 페이지 생성 |
| EXPLAIN 실행 | `EXPLAIN <sql>` 실행(끝 세미콜론 제거), 결과는 인라인 렌더링. **ANALYZE 켜지 않음**, 쓰기 작업 오 실행 회피 |
| AI 최적화 | `optimizeWithAi` emit → SQL 을 AI Toolbox 의 "SQL 최적화" 작업으로 푸시 |

---

## 작업 로그

`OperationLogDialog.vue` — 제목 `작업 로그`. **SkylerX 로컬 감사**, 데이터베이스 측 audit log 가 아님.

진입 시 모든 등록된 연결을 가져오고, 각각에서 최근 200건 `connections.history` 를 가져와, `executedAt` 내림차순으로 병합 표시. 각 행 포함: 성공 / 실패 표시, 실행 시간, 연결명, 소요 시간(ms), 단일 행으로 정리된 SQL 텍스트.

### 필터

| 필터 차원 | 옵션 |
|---|---|
| 상태 | 전체 / 성공 / 실패 |
| 연결 | 모든 연결 / 특정 단일 연결 |
| 키워드 | SQL 텍스트 case-insensitive `includes` 매치 |

### 내보내기

"CSV 내보내기" 는 현재 필터 결과로 내보내기, 파일명 `skylerx-operation-log.csv`, 컬럼: `time,connection,status,duration_ms,sql`.

임의의 행 클릭 → `openSql(connId, sql)` emit 으로 SQL 을 쿼리 페이지에 푸시(다이얼로그 닫기).

---

## 클러스터 토폴로지

### 범용 ClusterTopologyDialog(TiDB / OceanBase)

`ClusterTopologyDialog.vue` — 두 개의 탭: **노드** / **TiKV Stores | Region/Tablet**(방언별 이름 전환).

| 방언 | 노드 Tab | Regions Tab |
|---|---|---|
| TiDB | `information_schema.cluster_info`(tidb / tikv / pd / tiflash) | `information_schema.tikv_store_status`(`store_id, address, store_state_name, capacity, available, leader_count, region_count`) |
| OceanBase | `oceanbase.DBA_OB_SERVERS` | 먼저 `oceanbase.GV$OB_TABLET_TO_LS LIMIT 200`, 실패 시 `oceanbase.DBA_OB_UNITS` 로 폴백 |
| 기타 | `'이 방언은 클러스터 토폴로지 뷰를 지원하지 않습니다'` | 좌측과 동일 |

바이트 컬럼(`capacity / available / size$`)은 프론트에서 1024 진법으로 KB / MB / GB / TB 포매팅.

### OceanBase 전용 토폴로지

`OceanBaseTopologyDialog.vue` — 제목 `OceanBase 클러스터 토폴로지`, 연결 방언이 OceanBase 일 때만 진입점 가시.

상단 4개 카운트 카드(Zones / Observers / Tenants / Units) + 좌측 Zone → Observer 트리 + 우측 Tenant → Unit 리스트(클릭하여 펼침). 4개 뷰 **동시 쿼리**, 실패 시 배너 안내하지만 마지막 성공 데이터 보존.

| 뷰 | SQL |
|---|---|
| Zones | `SELECT zone, status, idc, region FROM oceanbase.DBA_OB_ZONES ORDER BY zone` |
| Observers | `SELECT svr_ip, svr_port, zone, status, with_rootserver, build_version, start_service_time FROM oceanbase.DBA_OB_SERVERS ORDER BY zone, svr_ip` |
| Tenants | `SELECT tenant_id, tenant_name, tenant_type, primary_zone, compatibility_mode, status, locked, locality FROM oceanbase.DBA_OB_TENANTS ORDER BY tenant_id` |
| Units | `SELECT unit_id, resource_pool_id, unit_group_id, tenant_id, zone, svr_ip, svr_port, status FROM oceanbase.DBA_OB_UNITS ORDER BY tenant_id, zone, svr_ip` |

상태 컬러링: `ACTIVE / NORMAL` 녹색, `INACTIVE / OFFLINE / DELETING` 빨간색, 기타 황색. tenant_type 은 이모지로 구분: 👑 SYS / ⚙ META / 🏢 USER. observer 주소 클릭으로 `svr_ip:svr_port` 원클릭 복사.

자동 새로고침은 끄기 / 5s / 10s / 30s 선택 가능(기본 끄기).

---

## 서버 모니터링

`ServerMonitorDialog.vue` — 제목 `서버 모니터링`.

드롭다운으로 등록된 연결 전환(지원되는 방언에만 사용 가능), 시작 후 **2초마다 setInterval 폴링**, 메모리에서 최대 60개 샘플의 sparkline 유지.

### 방언 지원

```ts
function fam(d) {
  if ([MySQL, MariaDB, OceanBase].includes(d)) return 'mysql'
  if ([PostgreSQL, KingbaseES].includes(d)) return 'pg'
  return 'other'
}
```

### MySQL 지표(`SHOW GLOBAL STATUS` + `SHOW VARIABLES LIKE 'max_connections'` 사용)

| 카드 | 출처 |
|---|---|
| 실행 시간 | `Uptime`(`Xd Yh Zm` 으로 포매팅) |
| QPS | (`Queries`/`Questions` 차이) ÷ 시간 차 |
| 연결 수 | `Threads_connected / max_connections` |
| 실행 중 | `Threads_running` |
| 슬로우 쿼리 | `Slow_queries` |
| 거부된 연결 | `Aborted_connects` |

### PostgreSQL 지표(한 건의 집계 SQL)

```sql
SELECT
  (SELECT count(*) FROM pg_stat_activity) AS conns,
  (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') AS active,
  (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock') AS waiting,
  (SELECT sum(xact_commit + xact_rollback) FROM pg_stat_database) AS xacts,
  (SELECT sum(blks_hit) FROM pg_stat_database) AS hit,
  (SELECT sum(blks_read) FROM pg_stat_database) AS rd,
  extract(epoch FROM (now() - pg_postmaster_start_time()))::bigint AS uptime
```

카드: 실행 시간 / TPS(xacts 차이)/ 연결 수 / 실행 중 / 락 대기 / Buffer 히트율 `hit / (hit + rd) * 100%`.

하단 sparkline 제목은 방언에 따라 `QPS` 또는 `TPS` 표시.

---

## 사용자 및 권한

`PrivilegesDialog.vue` + `privileges.ts` — 제목 `사용자 및 권한`.

좌측 컬럼은 사용자/역할 리스트 + 우측 컬럼 "기존 권한" / "GRANT 구성".

### 방언 지원

| 방언 패밀리 | 사용자 나열 SQL | 권한 확인 SQL |
|---|---|---|
| MySQL(MariaDB / OceanBase 포함) | `SELECT User, Host FROM mysql.user` | `SHOW GRANTS FOR 'usr'@'host'` |
| PostgreSQL(KingbaseES 포함) | `SELECT rolname FROM pg_roles WHERE rolcanlogin` | `information_schema.role_table_grants` |
| Oracle(DM 포함) | `SELECT username FROM all_users WHERE oracle_maintained = 'N'`(12c+) | `dba_sys_privs ∪ dba_role_privs ∪ dba_tab_privs` |
| SQL Server | `sys.database_principals WHERE type IN ('S','U','G')` | `sys.database_permissions` JOIN `sys.database_principals` |
| 기타 | `priv.unsupported` 표시 | 미지원 |

> Oracle 권한 조회는 `dba_*` 뷰 사용, 연결 사용자가 DBA 역할 없으면 ORA-00942 보고, UI 가 캡처하여 오류 정보를 "기존 권한" 위치에 표시.

### GRANT 구성기

권한 체크 + 타겟 입력 + 선택적 `WITH GRANT OPTION` → 실시간으로 미리보기 문 생성, 예:

```sql
GRANT SELECT, INSERT ON sales.orders TO 'app'@'%' WITH GRANT OPTION;
```

기본 체크 항목 `COMMON_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL PRIVILEGES']`.

권한 수여자는 방언별 포매팅:

| 방언 | grantee 형식 |
|---|---|
| MySQL | `'user'@'host'`(host 가 비어 있으면 `%` 입력) |
| SQL Server | `[user]`(`]` 는 `]]` 로 이스케이프) |
| Oracle | `"USER"`(전체 대문자, `"` 는 `""` 로 이스케이프) |
| 기타 | `"user"` |

### 직접 변경 안 함

**SkylerX 는 사용자 대신 GRANT / REVOKE 실행 안 함**. 두 개의 버튼:

- 복사 → 클립보드로
- 쿼리로 열기 → 쿼리 페이지로 푸시, 사용자가 수동 실행(SkylerX 의 SQL 실행 채널을 통과, 앞에 [프로덕션 보호](/ko/docs/connections#프로덕션-보호) 가 prod 표시 연결을 인터셉트)

`buildRevoke()` 도 `privileges.ts` 에서 export 되어 있지만, 현재 UI 에는 REVOKE 구성 폼 없음, 필요 시 GRANT 미리보기 문을 직접 수정해도 됨.

---

## 호환성 매트릭스

| 기능 | MySQL 패밀리 | PG 패밀리 | SQL Server | Oracle / DM | OceanBase | TiDB | NoSQL |
|---|---|---|---|---|---|---|---|
| 서버 활동: 프로세스 리스트 | `information_schema.PROCESSLIST` | `pg_stat_activity` | `dm_exec_sessions` | — | MySQL 분기 사용 | MySQL 분기 사용 | 적용 안 함 |
| 서버 활동: 장기 트랜잭션 | `INNODB_TRX` | `pg_stat_activity` | `dm_tran_active_transactions` | — | MySQL 분기 사용 | MySQL 분기 사용 | — |
| 서버 활동: 락 대기 | `data_lock_waits` | `pg_locks` | `dm_tran_locks` | — | MySQL 분기 사용 | MySQL 분기 사용 | — |
| KILL 작업 | `KILL <id>` | `pg_terminate_backend` | `KILL <spid>` | — | ✓ | ✓ | — |
| 복제 지연 | `SHOW REPLICA STATUS` 등 | `pg_stat_replication` / `pg_last_xact_replay_timestamp` | AOAG `dm_hadr_database_replica_states` | — | MySQL 분기 사용 | MySQL 분기 사용 | — |
| 슬로우 쿼리 | `events_statements_summary_by_digest` | `pg_stat_statements` | — | — | ✓ | ✓ | — |
| 서버 모니터링 | `SHOW GLOBAL STATUS` | `pg_stat_*` 집계 | — | — | MySQL 분기 사용(KingbaseES 만 pg 사용) | — | — |
| 클러스터 토폴로지 | — | — | — | — | `DBA_OB_*` | `cluster_info / tikv_store_status` | — |
| OB 토폴로지(전용) | — | — | — | — | ✓ | — | — |
| 사용자 및 권한 | `mysql.user` | `pg_roles` | `database_principals` | `all_users` + `dba_*` | MySQL 분기 사용 | MySQL 분기 사용 | — |
| 작업 로그(로컬) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

> **"X 분기 사용"** 은 해당 방언이 `ddl.familyOf()`(또는 `slowFamilyOf` / `fam()` 등)에 의해 X 패밀리로 분류되어, 동일한 SQL 을 직접 재사용하는 것을 의미, 모든 버전의 딕셔너리 뷰 컬럼명이 완전히 일치하는 것을 보장하지 않음. Doris / StarRocks 프로토콜은 MySQL 과 호환되며, 슬로우 쿼리 패널에서 FE 가 보통 `events_statements_summary_by_digest` 도 노출하는데, 일부 버전에서 노출 안 될 시 "미활성화" 친화적 안내로 폴백.

> **NoSQL(Redis / MongoDB / Elasticsearch)** 는 서버 활동 패널에서 `dialectKind(NoSql)` 에 의해 단락, SQL 발행 안 함, 대신 "⚙ 서버 → 클라이언트 / 슬로우 로그 사용" 안내 제공. Redis 의 실시간 모니터링은 전용 `RedisMonitorDialog` 에 있으며, 이 페이지의 범위가 아님.
