# 고급 기능

이 문서는 SkylerX 가 **헤비 유저(DBA / 데이터 엔지니어 / 백엔드 개발자)** 를 위해 준비한 고급 기능을 모아 소개합니다. 이 기능들은 우클릭 메뉴, `⌘K` 커맨드 팔레트, 또는 툴바 하위에 숨겨져 있어 일상적인 SELECT 작업에서는 사용할 일이 없지만, 아래 시나리오를 만나면 매우 시간을 절약해 줍니다.

- 실행 계획이 인덱스를 타는지, 어느 노드가 가장 느린지 보고 싶다
- 과거 SQL 을 기반으로 어떤 인덱스를 만들어야 할지 역추론하고 싶다
- 한 테이블의 컬럼 분포 / NULL 비율 / 타입이 너무 크게 선택되었는지 보고 싶다
- 중복 행 제거 / 과거 데이터에 기본값 보충 / 소프트 삭제에서 복구하고 싶다
- 전체 DB 에서 한 값이 어느 테이블에 출현하는지 검색하고 싶다
- SQL 을 직접 작성하지 않고 비주얼 드래그로 쿼리를 만들고 싶다
- Doris/StarRocks 의 파티션 / ClickHouse 의 part / MySQL binlog / PG 익스텐션을 관리하고 싶다
- Oracle DB 전체를 达梦(DM) 으로 마이그레이션하고 싶다

아래는 "보기 → 수정 → 검색 → 생성 → 마이그레이션" 순서로 전개합니다.

## 1. EXPLAIN 시각화 — PlanPanel

SQL 을 쓰는 사람은 누구나 EXPLAIN 을 보지만, 텍스트만으로는 직관적이지 않습니다. SkylerX 는 QueryPane 옆에 **Plan 패널**을 두어 EXPLAIN 출력을 트리 + 요약으로 렌더링합니다.

### 트리거 방법

| 진입점 | 동작 |
|---|---|
| QueryPane 툴바 `📊 Plan` | 현재 SQL 의 EXPLAIN(실제 실행 안 함) |
| `⌘⇧E` / Ctrl+Shift+E | 위와 동일 |
| `📊 Plan` 옆의 `▶ Analyze` | EXPLAIN ANALYZE(**실제 실행**, DML 주의) |

저변은 `plan.ts → planQuery(dialect, sql, { analyze })` 사용:

| 방언 | 생성된 문장 |
|---|---|
| PostgreSQL / Kingbase | `EXPLAIN (FORMAT JSON) <sql>` / `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <sql>` |
| MySQL / MariaDB / OceanBase | `EXPLAIN FORMAT=TREE <sql>` / `EXPLAIN ANALYZE <sql>`(MySQL 8.0.18+) |
| 기타 방언 | 폴백 표 EXPLAIN(plain pre 렌더링) |

### 노드 트리 렌더링

PG 의 JSON Plan 은 `parsePgPlan` 으로 `PlanNode` 트리로 파싱한 후, `flattenPlan` 으로 `{node, depth}` 리스트로 압평하여 렌더링. 각 노드 표시:

- **라벨**: `Seq Scan` / `Index Scan` / `Hash Join` …
- **세부**: `on users` / `using users_pk` / `inner join`
- **비용 바**: 수평 바 너비 = `cost / maxCost * 60px`, 녹색에서 빨간색 그라데이션
- **숫자**: `cost 1234.56 · est 1000 · act 1234 · 12.3ms`(act / ms 는 ANALYZE 일 때만)

### 느린 연산자 컬러링

PlanPanel 은 "비싼 1/3 노드" 를 자동으로 빨간색 표시:

```ts
function isSlow(node) {
  return node.cost >= maxCost.value * 0.33 && maxCost.value > 0
}
```

빨간 배경 + 빨간 라벨, **눈으로 바로 어디를 최적화해야 할지 식별**, 비용 숫자를 하나씩 비교할 필요 없음.

### 예상 vs 실제 편차

`estimateSkew(node)` 는 `max(est, act) / min(est, act)` 계산. ≥ 10× 면 **옵티마이저 통계 오래됨**(전형적 신호)으로 간주, 노드 좌측에 노란 사이드 바 + 노드 끝에 `⚠ 24×` 배지 추가. 요약 바에서도 "편차가 가장 심한 노드"를 별도로 지적:

```ts
let skewWorst = null
for (const r of arr) {
  const sk = estimateSkew(r.node)
  if (sk == null) continue
  if (!skewWorst || sk > skewWorst.skew) skewWorst = { node: r.node, skew: sk }
}
```

이 배지를 보면 일반적으로 `ANALYZE table` 또는 `pg_statistic refresh` 를 해야 합니다.

### 요약 바

패널 상단에 표시:

| 필드 | 의미 |
|---|---|
| `Total Cost` | 최중 노드의 cost(루트 노드 누적) |
| `Actual ms` | EXPLAIN ANALYZE 시 각 노드 실제 소요 시간 누적 |
| `Heaviest` | 비용 최고 노드 이름 |
| `Skew` | 예상 vs 실제 편차 가장 심한 노드 + 배수 |

---

## 2. 인덱스 추천 — IndexRecommender

`⌘K → 인덱스 추천` 또는 NavTree DB 노드 우클릭 `🔧 인덱스 추천`.

### 입력과 출력

| 입력 | 출처 |
|---|---|
| 과거 SQL 패턴 | `client.connections.history(connId, 1000)` 최근 1000건 |
| 기존 인덱스 | MySQL `information_schema.STATISTICS` / PG `pg_index + pg_class` |

출력: `IndexHint[]`, 각 항목은 테이블명, 컬럼명, 종합 점수, 추론 이유, 바로 실행 가능한 `CREATE INDEX` DDL.

### 추론 알고리즘(`index-recommender.ts`)

SQL parser 를 도입하지 않고(비용이 크고 방언 차이 많음), **정규식 휴리스틱**으로 WHERE / JOIN / ORDER BY / GROUP BY 추출:

1. **이력 집계**: 같은 SQL 텍스트를 한 행으로 병합, `count` + `totalMs` 누적
2. **필터**: `SELECT` / `WITH` 류 문만 보관, DML/DDL 스킵
3. **별칭 파싱**: `parseTableAliases(sql)` 가 `FROM`/`JOIN` 뒤에서 `tbl [AS] alias` 추출하여 Map 으로
4. **4종 절 스캔**, 각 매치에 기본 점수 가중:

| 절 | 기본 점수 | 설명 |
|---|---|---|
| `WHERE col = ?` / `LIKE` / `IN` / `IS NULL` / `BETWEEN` | 5 | 강 신호 |
| `JOIN ON a.col = b.col` | 3 | 양쪽 컬럼 모두 점수 추가 |
| `ORDER BY col` | 2 | 정렬에 정렬된 인덱스 필요 |
| `GROUP BY col` | 2 | 그룹화도 동일 |

5. **시간 가중**: 각 SQL `count × min(perMs/avgMs, MAX_TIME_MULTIPLIER=5)`, 한두 건의 슬로우 SQL 이 테이블을 압도하는 것 방지
6. **다중 테이블 SQL** 은 별칭이 있어야 노출 컬럼 인식; **단일 테이블 SQL** 만 노출 컬럼명 허용
7. **기존 인덱스 필터**: `isCovered(table, cols, known)` 가 "기존 인덱스 접두사가 제안 컬럼을 완전히 포함" 으로 판단, 매치 시 스킵
8. **복합 제안**: 각 테이블 상위 3개 고점수 컬럼을 쌍쌍 페어링하여, 2열 복합 인덱스 제안 생성

### DDL 생성

```ts
function buildDdl(table, columns, dialect) {
  const idxName = `idx_${sanitize(table)}_${cols.map(sanitize).join('_')}`.slice(0, 60)
  return `CREATE INDEX ${quoteIdent(idxName)} ON ${quoteIdent(table)}(${cols.map(quoteIdent).join(', ')});`
}
```

MySQL 은 백틱 \``\`, PG 는 큰따옴표 `"` 사용.

### UI 흐름

팝업이 열리면 자동으로 `run()`: 스캔 → 후보 나열(`scoreEstimate` 내림차순). 각 행:

- `[채택]` 버튼 → `emit('runSql', h.ddl)` 로 DDL 을 QueryPane 으로 던짐(사용자가 검토 후 실행)
- `[전체 복사]` 모든 후보 DDL 을 클립보드로 한 번에 복사
- `[재스캔]` 흐름 재실행

MySQL 패밀리 / PG 패밀리만 지원, 기타 방언은 "현재 지원 안 됨" 표시.

---

## 3. 데이터 탐사 — DataInspector

테이블 우클릭 `🔬 데이터 탐사`. 하나의 다이얼로그에 5개 탭, "데이터 헬스 + 원클릭 유지보수" DBA 트러블슈팅 핵심 액션 커버. **설계상 SQL 을 동시 실행하지 않습니다**(프로덕션 폭주 우려): 사용자가 누른 탭의 데이터만 가져옴.

### Tab 1: 컬럼 샘플링(A3)

컬럼 하나 선택, 한 개의 SQL 로 모든 통계 실행:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(col) AS non_null,
  COUNT(DISTINCT col) AS distinct_cnt,
  MIN(col) AS min_val,
  MAX(col) AS max_val
FROM <table>
```

추가로 top-10 실행:

```sql
SELECT col AS value, COUNT(*) AS cnt
FROM <table> GROUP BY col ORDER BY cnt DESC LIMIT 10
```

카드 형태로 통계 + top-N 표 표시. NULL 비율 높음 / distinct 매우 낮음(상태 코드일 수 있음) / 극단값 이상이 한눈에 보임.

### Tab 2: 전체 테이블 프로파일링(B6)

하나의 큰 SELECT 로 모든 컬럼에 대해 `COUNT(col)` + `COUNT(DISTINCT col)` 동시 계산:

```sql
SELECT COUNT(*) AS total,
       COUNT(`a`) AS nn_a, COUNT(DISTINCT `a`) AS dc_a,
       COUNT(`b`) AS nn_b, COUNT(DISTINCT `b`) AS dc_b,
       ...
FROM <table>
```

출력 표: `컬럼명 | 타입 | NULL% | DISTINCT/총수`. NULL% > 50 황색 표시, "이 컬럼은 사실 사용되지 않을 수 있음" 안내.

### Tab 3: 제약 조건 스캔(B5)

테이블의 `IS_NULLABLE = 'NO'` 컬럼을 "NOT NULL 선언" 컬럼으로 나열, 각 컬럼에 대해 `SELECT COUNT(*) WHERE col IS NULL` 실행. 매치 > 0 인 경우 **제약 위반**으로 간주(흔히 옛날에 NOT NULL 을 추가하지 않다가, 나중에 보충했지만 지저분한 데이터 미정리).

### Tab 4: 타입 최적화 제안(B9)

컬럼별 타입 전략으로 축소 제안:

| 현재 타입 | 검사 | 제안 |
|---|---|---|
| `VARCHAR(255)` | `MAX(CHAR_LENGTH(col))` 실제 max | `VARCHAR(max(32, ceil(maxlen*1.5)))`, declared > maxlen*4 이고 차이 > 50 일 때 |
| `BIGINT` | `MAX(ABS(col))` | < 2³¹-1 이면 → `INT` |
| `INT` | 위와 동일 | < 32767 이면 → `SMALLINT` |

각 제안에 이유 제공(`실제 최대 길이 20, 선언 255 로 235 바이트 낭비`).

### Tab 5: 테이블 유지보수(B10)

방언별로 4개 원클릭 버튼 제공:

| 방언 | 버튼 |
|---|---|
| MySQL 패밀리 | `ANALYZE TABLE` / `OPTIMIZE TABLE` / `CHECK TABLE` |
| PG 패밀리 | `ANALYZE` / `VACUUM FULL` / `VACUUM` / `REINDEX TABLE` |

각 실행은 재확인 동반(VACUUM FULL 은 테이블 잠금).

---

## 4. 데이터 정비 — DataFixup

테이블 우클릭 `🩹 데이터 정비`. 3개 탭, "조건 입력 → SQL 생성 → 사용자 검토 → 실행" 4단계 골격 공유. **직접 commit 하지 않음**, 생성된 SQL 을 QueryPane 에 pending 으로 던져 사용자가 검토하도록.

### Tab 1: 중복 행 감지(B3)

몇 개 컬럼을 **비즈니스 키**(`email + tenant_id`)로 체크, 먼저 GROUP BY 로 어느 그룹이 중복인지 확인:

```sql
SELECT col1, col2, COUNT(*) AS cnt
FROM <table>
GROUP BY col1, col2 HAVING COUNT(*) > 1
ORDER BY cnt DESC LIMIT 100
```

중복 확인 후 `정리 SQL 생성` 클릭으로 `ROW_NUMBER()` 기반 윈도우 삭제 문(PG 버전) 획득, 주석에 MySQL self-join 버전 백업으로 제공:

```sql
-- 각 그룹에서 ROW_NUMBER() = 1 만 남기고 나머지 삭제
DELETE FROM <table>
WHERE (col1, col2, ctid) IN (
  SELECT col1, col2, ctid FROM (
    SELECT col1, col2, ctid,
           ROW_NUMBER() OVER (PARTITION BY col1, col2 ORDER BY ctid) AS rn
    FROM <table>
  ) sub WHERE sub.rn > 1
);
```

### Tab 2: NULL 보충(B4)

컬럼 하나 + 전략 선택:

| 전략 | 생성된 SET 표현식 |
|---|---|
| `literal` | `'<사용자 입력 값>'` |
| `avg` | `(SELECT AVG(col) FROM <table>)` |
| `min` / `max` | `(SELECT MIN/MAX(col) FROM <table>)` |
| `most_common` | `(SELECT col GROUP BY col ORDER BY COUNT(*) DESC LIMIT 1)` |

최종적으로 `UPDATE <table> SET col = <expr> WHERE col IS NULL;` 생성, 주석에 "먼저 SELECT COUNT 로 영향 수 확인 권장" 한 문장 추가.

### Tab 3: 소프트 삭제 복구(B8)

휴리스틱으로 컬럼명에서 소프트 삭제 필드 찾기(`deleted_at` / `is_deleted` / `deleted`). 컬럼명이 불리언 또는 타임스탬프인지에 따라 대응 부활 문 생성:

| 컬럼명 | 생성 |
|---|---|
| `is_deleted` / `*_flag` | `UPDATE ... SET col = FALSE WHERE col = TRUE` |
| `deleted_at` / 기타 타임스탬프 | `UPDATE ... SET col = NULL WHERE col IS NOT NULL` |

선택적으로 "추가 WHERE"(`AND user_id = 42`) 입력하여 범위 한정, 모든 소프트 삭제 일괄 부활 회피.

---

## 5. 테이블 간 값 검색 — SearchValueDialog

`⌘K → 테이블 간 검색` 또는 결과 셋 셀에서 우클릭 `🔎 이 값이 어디 또 있나` (후자는 자동 prefill).

### 워크플로우

1. **모든 "검색 가능한" 문자 컬럼 가져오기**(`information_schema.columns`):
   - MySQL: `varchar / char / text / tinytext / mediumtext / longtext / json`
   - PG: `character varying / character / text / json / jsonb`
2. **테이블별 그룹화**: 각 테이블에 `SELECT * FROM t WHERE col1 LIKE :v OR col2 LIKE :v ... LIMIT 50` 생성
3. **동시 실행**(max 6개 동시, 연결 풀 폭주 방지)
4. **진행 바** + 매치 리스트

### 성능 한계

대용량 DB 는 컬럼이 수천 개일 수 있으므로, 검색 전 `table_prefix` 로 범위 필터(`user_*`). `matchMode` 는 `contains` / `exact` 선택 가능:

- `contains` → `LIKE '%v%'`(느리지만 완전)
- `exact` → `= 'v'`(빠름, 정확한 ID 검색에 적합)

`maxPerTable` 은 테이블당 최대 50 매치 제한, 큰 와이드 테이블이 메모리를 폭발시키는 것 방지.

### 사용 예

라이브에서 "사용자 `alice@x.com` 이 왜 푸시 받았나" 트러블슈팅:

1. ⌘K → 테이블 간 검색
2. 값에 `alice@x.com` 입력, 모드 `exact`
3. 모든 DB 일괄 스캔, `users(email)` + `subscription(email)` + `mail_logs(to_addr)` 에 모두 있는 것 발견 → 데이터 흐름 특정

---

## 6. 행 변경 이력 — RowHistoryDialog

결과 셋에서 행 선택 후 우클릭 `⏱ 이력 버전 보기`.

### 휴리스틱 섀도우 테이블 검색

주어진 행의 PK(`{id: 42}`)로, `information_schema.tables` 를 자동 스캔하여 후보 섀도우 테이블 찾기:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE '<base>_%'
   OR table_name = 'audit_<base>'
   OR table_name = '<base>_history'
```

사용자는 드롭다운(`<datalist>`)에서 선택하거나 수동 입력.

### 이력 가져오기

PK 로 필터, `changed_at / updated_at / created_at / version / revision` 내림차순 정렬:

```sql
SELECT * FROM <shadowTable>
WHERE id = 42
ORDER BY changed_at, updated_at, created_at, version, revision DESC
LIMIT 200
```

출력 표에서 각 행은 하나의 버전이며, 컬럼명은 섀도우 테이블 원시 컬럼, 문자열 필드는 80자로 자름.

---

## 7. 비주얼 쿼리 빌더 — VisualQueryDialog

`⌘K → 비주얼 쿼리` 또는 DB 노드 우클릭 `🎨 비주얼 빌더`.

**MVP 는 드래그 캔버스를 만들지 않음** — 더 안정적인 "리스트 + 카드" 레이아웃으로, 진짜 사용 가능하며 demo 에 그치지 않음.

### 레이아웃

| 영역 | 내용 |
|---|---|
| 좌측 | 현재 DB 의 모든 테이블 + 검색 박스 + 체크박스 |
| 중앙 | 체크된 테이블이 카드로 전개, 각 컬럼 앞에 체크박스(체크된 것은 SELECT, 체크 안된 것은 표시만) |
| 상단 | WHERE / ORDER BY 입력 박스 + `LIMIT` 숫자 박스 |
| 하단 | 실시간 생성된 SQL + `새 쿼리 탭으로 열기` 버튼 |

### 자동 JOIN

두 테이블 체크 시 양쪽의 "외래 키 같은 컬럼" 자동 감지, `INNER JOIN` 생성:

```ts
// inferConventionalFks
const m = /^(.+?)_id$|^(.+?)Id$/.exec(col.name)
// user_id → users.id  /  category_id → categories.id
```

후보 대상 테이블: `<base>` 원형 + 단순 복수형(`user → users`, `category → categories`). FK 경로 찾을 수 없으면 `CROSS JOIN` 으로 다운그레이드(사용자에게 효율 주의 시각적 힌트).

### SQL 생성

```sql
SELECT users.id AS users_id, users.name AS users_name,
       orders.id AS orders_id, orders.amount AS orders_amount
FROM users
  INNER JOIN orders ON users.id = orders.user_id
WHERE amount > 100
ORDER BY users.id DESC
LIMIT 200
```

컬럼명에 `<table>_<col>` 별칭 추가, 다중 테이블 동명 컬럼 충돌 회피.

---

## 8. MPP 파티션 관리 — MppPartitionDialog

Doris / StarRocks(MySQL 프로토콜 계열) 적용. DB 노드 우클릭 `🗂 파티션 관리`.

### 필드

`SHOW PARTITIONS FROM <db>.<tbl>` 호출, 표시:

| 필드 | 의미 |
|---|---|
| `PartitionId` / `PartitionName` | 파티션 메타 정보 |
| `State` | NORMAL / 등 |
| `PartitionKey` / `Range` | 파티션 컬럼과 범위 |
| `DistributionKey` / `Buckets` | 버킷 키와 수량 |
| `ReplicationNum` | 복제본 수 |
| `StorageMedium` | HDD / SSD |
| `CooldownTime` | 쿨다운 시간(HDD 강등) |
| `DataSize` | 파티션 데이터 크기(KB/MB/GB 자동 포매팅) |

### 작업

| 버튼 | 동작 |
|---|---|
| `+ 파티션 추가` | 팝업에서 `ADD PARTITION ...` 절 입력, `ALTER TABLE <db>.<tbl>` 접두사 자동 조립 |
| 각 행 `DROP` | 재확인 후 `ALTER TABLE <db>.<tbl> DROP PARTITION <name>` |
| `🔄 새로고침` | SHOW PARTITIONS 재실행 |

---

## 9. 방언 전용 고급

### 9.1 MysqlAdvancedDialog

MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks 에 적용. 3개 탭:

| Tab | 사용 SQL |
|---|---|
| **Binlog** | `SHOW MASTER STATUS` + `SHOW BINARY LOGS` + 파일 선택 후 `SHOW BINLOG EVENTS IN '<file>' LIMIT N` |
| **마스터-슬레이브 상태** | `SHOW REPLICA STATUS`(8.0+) 우선, 실패 시 `SHOW SLAVE STATUS`(MariaDB / 구 버전) 폴백 |
| **변수 / 상태** | `SHOW GLOBAL VARIABLES` / `SHOW GLOBAL STATUS`, 필터 포함; Variables 는 `SET GLOBAL k = v` 로 런타임 파라미터 변경도 가능 |

### 9.2 PgAdvancedDialog

PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift 에 적용. 3개 탭:

| Tab | 데이터 출처 |
|---|---|
| **Extensions** | `pg_available_extensions`; 원클릭 `CREATE EXTENSION IF NOT EXISTS "<name>" WITH SCHEMA "<schema>"` / `DROP EXTENSION` |
| **Publications / Subscriptions** | `pg_publication` + `pg_publication_tables` + `pg_subscription`(논리 복제 관리) |
| **Slots** | `pg_replication_slots`(slot_name / plugin / slot_type / active / restart_lsn / confirmed_flush_lsn / wal_status); `DROP_REPLICATION_SLOT` 가능 |

### 9.3 ClickHouseAdvancedDialog

4개 탭, 모두 `system.*` 읽기, 주로 읽기 전용:

| Tab | 데이터 출처 | 용도 |
|---|---|---|
| **파티션** | `system.parts`(active 필터) | `rows / bytes_on_disk / data_compressed_bytes / marks / min_date / max_date / level` 확인; `DROP / DETACH / ATTACH PARTITION` 지원 |
| **Mutation** | `system.mutations` | `is_done / command / parts_to_do / latest_failed_part / latest_fail_reason` 확인 |
| **복제본** | `system.replicas` | `is_leader / queue_size / inserts_in_queue / merges_in_queue / total_replicas / active_replicas / zookeeper_path` 확인 |
| **테이블 metadata** | `system.tables` | `engine / total_rows / total_bytes / partition_key / sorting_key / primary_key / sampling_key / storage_policy` 확인 |

모든 탭 상단에 `database / table` 필터 박스, 큰 클러스터에 필수.

---

## 10. Oracle → DM(达梦) 마이그레이션 마법사

신촹 외주 빈도 높은 시나리오: 고객의 Oracle DB 전체를 达梦 으로 마이그레이션. `⌘K → Oracle → DM 마이그레이션` 으로 마법사 열기.

### 5단계 흐름

| 단계 | 동작 |
|---|---|
| 1. **연결 선택** | 설정된 연결에서 `dialect == Oracle` / `dialect == DM` 필터, 좌우 각 하나 선택 |
| 2. **객체 선택** | 소스 DB 의 `tables / views / sequences / procedures` 4개 그룹, 기본 전체 선택, 그룹별 / 개별 체크 가능 |
| 3. **미리보기** | 각 객체는 `DBMS_METADATA.GET_DDL` 로 소스 DDL 가져옴 → `translateDdl()` 번역 → warnings 표시 + 편집 허용 |
| 4. **실행** | 객체별 `client.connections.execute(dstConnId, ddl)`, 오류 수집 후 중단 없음 |
| 5. **보고서** | Markdown 으로 성공/실패 요약 + warnings, 복사 / saveText 로 저장 가능 |

### 번역 룰(`oracleToDm.ts`)

**타입 매핑**(`TYPE_MAP`):

| Oracle | DM | 비고 |
|---|---|---|
| `VARCHAR2` | `VARCHAR` | — |
| `NVARCHAR2` | `NVARCHAR` | — |
| `NUMBER` | `NUMERIC` | DM 도 NUMBER 인식, 하지만 NUMERIC 이 더 표준 |
| `CLOB` / `NCLOB` / `BLOB` | 동명 유지 | — |
| `DATE` | `DATE` | ⚠ Oracle 은 시분초 포함, DM 은 미포함 |
| `TIMESTAMP` | `TIMESTAMP` | — |
| `RAW` / `LONG RAW` | `VARBINARY` | — |
| `LONG` | `CLOB` | Oracle 폐기됨 |
| `BINARY_FLOAT` / `BINARY_DOUBLE` | `FLOAT` / `DOUBLE` | — |
| `ROWID` / `UROWID` | `VARCHAR(18)` / `VARCHAR(4000)` | DM 동등 없음, 다운그레이드 |
| `XMLTYPE` | `XML` | XPath/XQuery 표현식 재작성 가능성 있음 |

**타입 치환 구현**: "긴 키 우선" 순으로 매치(`LONG RAW` 가 `LONG` 앞에 와서 가로채지지 않음); 노출 `NUMBER` 는 길이 없으면 보충 안 함; `NUMBER(p,s)` 는 숫자 그대로 옮김; 매치 후 대응 `TYPE_NOTES` 경고 추가.

**함수 / 키워드 매핑**(`FN_MAP`):

| Oracle | DM | 비고 |
|---|---|---|
| `SYSDATE` / `SYSTIMESTAMP` | `CURRENT_TIMESTAMP` | DM 도 SYSDATE 수용, 표준 함수가 더 안정 |
| `NVL(a, b)` | `COALESCE(a, b)` | DM 은 NVL 호환, COALESCE 가 더 크로스 DB |
| `NVL2(...)` | 보존 | 미지원 시 `CASE WHEN expr IS NOT NULL THEN a ELSE b END` 필요 |
| `MINUS` | `EXCEPT` | DM 은 MINUS 호환, EXCEPT 가 더 표준 |
| `DUAL` / `ROWNUM` | 동명 유지 | DM 지원 |

**복잡 구문 경고**(`HARD_WARNINGS`, SQL 변경 없음, `[review]` 경고만 발행):

| 패턴 | 경고 내용 |
|---|---|
| `DECODE(...)` | 여전히 사용 가능, 가독성을 위해 `CASE WHEN` 으로 변경 권장 |
| `CONNECT BY` | 대부분 호환; `NOCYCLE` / `SYS_CONNECT_BY_PATH` 등 고급 기능은 문장별 재검토 필요 |
| `MERGE INTO` | 복잡 분기(`DELETE WHERE` / 다중 소스 `UPDATE` 포함) 동작이 일치하지 않을 수 있음 |
| `INSTEAD OF (INSERT/UPDATE/DELETE) TRIGGER` | DM 트리거 의미에 차이, 트리거 본문은 수동 마이그레이션 필요 |
| `SDO_GEOMETRY` / `MDSYS.*` | Oracle Spatial 동등 없음, DMGeo 또는 서드 파티 필요 |
| `DBMS_*` | 일부만 모사(`DBMS_OUTPUT`/`DBMS_LOB`), 비즈니스 패키지는 재작성 필요 |
| `UTL_*`(`UTL_HTTP`/`UTL_FILE` 등) | 일반적으로 미지원, 외부 스크립트 대체 필요 |
| `INTERVAL YEAR/DAY TO ...` | 일부 버전은 간소화 형태만 지원, 버전 검증 필요 |
| `PIVOT(...)` / `UNPIVOT(...)` | DM 8.x 부터 부분 지원, 구 버전은 `CASE WHEN` 집계로 재작성 필요 |
| `BULK COLLECT` / `FORALL` | PL/SQL 배치 작업, DMSQL 구문에 약간 차이 |

### 의도적으로 하지 않는 것

- **PL/SQL 블록 의미 번역 안 함** — 저장 프로시저는 CREATE 쉘만 마이그레이션, 함수 본문은 수동
- **트리거 내용 번역 안 함** — 위와 동일
- **제약 의존성 정렬 안 함** — 사전식 순서; 실패 시 사용자가 재실행
- **트랜잭션 원자성 없음** — 객체별 독립, 실패는 빨간색 표시

### 데이터 마이그레이션(실험적)

Step 4 에서 "데이터 마이그레이션 포함(테이블당 처음 100 행 샘플)" 체크:

```sql
-- 소스
SELECT * FROM "<table>"  -- 100 행 제한

-- 타겟
INSERT INTO "<table>" (col1, col2, ...) VALUES (v1, v2, ...)  -- 행별
```

이는 **골격** 일 뿐 — 완전 마이그레이션은 페이지네이션 + 타입 변환 + 배치 삽입이 필요, 이 마법사는 후속에 맡김. 프로덕션 환경의 전체 데이터 마이그레이션은 DTS / `expdp + impdp` 같은 전문 도구 사용 권장.

### 보고서

실행 완료 후 Step 5 진입, Markdown 보고서 예시:

```markdown
# Oracle → DM 마이그레이션 보고서

- 소스 연결: `prod-oracle`
- 타겟 연결: `dm-test`
- 시간: 2026-05-30 10:23:11
- 총 객체: 142, 성공 138, 실패 4

## 성공 객체
- [tables] ORDERS (124ms)
- [tables] USERS (89ms)
...

## 실패 객체
- [procedures] CALC_BONUS
  - 오류: ORA-00942 테이블 또는 뷰 미존재

## 번역 경고(수동 review)
- (ORDERS) [type] DATE: Oracle DATE 는 시분초 포함, DM DATE 는 미포함; 원 컬럼이 시간 컴포넌트에 의존하면 TIMESTAMP 로 변경
- (ORDERS_REPORT) [review] PIVOT/UNPIVOT: DM 8.x 부터 부분 지원, 구 버전은 CASE WHEN 집계로 재작성 필요
```

`복사` 로 클립보드 또는 `저장` 으로 `.md` 파일 보관.

---

## 11. 언제 어느 것을 써야 하나?

마지막으로 "증상별 처방" 표:

| 내가 원하는 것… | 사용할 것 |
|---|---|
| 슬로우 SQL 한 건이 어디서 막히는지 보기 | **PlanPanel** + ANALYZE |
| 어떤 인덱스를 만들어야 할지 모를 때 | **IndexRecommender** |
| 새로 인계받은 테이블 헬스 보기 | **DataInspector** 전체 테이블 프로파일링 + 타입 최적화 |
| 지저분한 데이터 / 중복 행 정리 | **DataFixup** |
| 어떤 값이 어디에 출현하는지 트러블슈팅 | **SearchValueDialog** |
| 한 행의 수정 이력 보기 | **RowHistoryDialog** |
| 비기술직 동료에게 쿼리 생성 시연 | **VisualQueryDialog** |
| Doris 파티션 관리 | **MppPartitionDialog** |
| MySQL binlog / 마스터-슬레이브 지연 보기 | **MysqlAdvancedDialog** |
| PG 익스텐션 설치 / 논리 복제 구성 | **PgAdvancedDialog** |
| CH part / Mutation 상태 보기 | **ClickHouseAdvancedDialog** |
| Oracle DB 를 达梦 으로 마이그레이션 | **OracleToDmWizard** |

이 기능들은 [AI 어시스턴트](./ai) 와 함께 사용하면 위력이 배가됩니다 — 예를 들어 PlanPanel 에서 슬로우 노드를 보면 바로 "AI 에게 묻기", IndexRecommender 의 후보를 못 알아보면 AI 에게 설명 요청, DataInspector 의 타입 제안은 AI 로 위험 평가.
