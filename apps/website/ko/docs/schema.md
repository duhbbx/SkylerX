# 구조 관리

데이터베이스는 "데이터를 집어넣기" 만의 일이 아니며, 더 많은 시간을 테이블을 그리고, 수정하고, 대조하고, 마이그레이션하는 데 사용합니다. SkylerX 는 구조 관련 기능을 DB / 테이블 / Schema 를 대상으로 하는 도구 묶음으로 정리하여, 읽기 전용 보기에서 두 DB 정렬까지 한 번에.

이 페이지는 가벼운 것에서 무거운 것 순서로: **보기 → 설계 → 편집 → 관계도 → 스냅샷 → DB 간 비교 → 드리프트 → DB 생성 → Schema 생성 → AI 보조**.

## 개요

| 도구 | 트리거 | 목적 | SQL 생성 | 직접 DB 반영 |
|---|---|---|---|---|
| 테이블 구조(TableStructure) | 좌측 트리: 테이블 노드 → 기본 더블 클릭 | 컬럼/인덱스/키/DDL 읽기 전용 | — | 아니오 |
| 테이블 디자이너(TableDesigner) | 트리 우클릭 → 테이블 생성 / 테이블 디자인 | 시각화 테이블 생성 + diff 인식 ALTER | ✓(미리보기) | ✓(확인 후) |
| DDL 에디터(DdlEditor) | 트리 우클릭 → 뷰, 함수, 프로시저, 트리거 생성 / 편집 | 객체 DDL 직접 작성 / 수정 | ✓(에디터) | ✓ |
| ER 도(ErdView) | 트리 우클릭 schema → ER 도 | 전체 DB 시각화 + 드래그로 테이블 생성 / FK 추가 | ✓(.sql 내보내기) | ✓(DB 에 적용) |
| 구조 스냅샷(SchemaSnapshots) | 커맨드 팔레트 `act:snapshots:{connId}` | 현재 모든 테이블 DDL 을 localStorage 에 저장, 후일 비교 | — | 아니오 |
| 구조 비교(SchemaDiff) | 커맨드 팔레트 `act:schema-diff` | 두 연결 schema 횡적 비교 + 정렬 마이그레이션 스크립트 생성 | ✓(원클릭으로 쿼리에 열기) | 아니오 |
| 구조 드리프트(SchemaDrift) | 커맨드 팔레트 `act:drift` | 동일 방언 두 연결 심층 드리프트 감지(컬럼/인덱스/FK) | ✓(정렬 스크립트) | ✓(확인 후) |
| 데이터베이스 생성(NewDatabase) | 트리 우클릭 연결 노드 → 데이터베이스 생성 | 방언별 `CREATE DATABASE` 생성 | ✓(미리보기 편집 가능) | ✓ |
| Schema 생성(NewSchema) | 트리 우클릭 DB 노드 → Schema 생성 | PG / SQL Server / Oracle 등 | ✓ | ✓ |
| AI 테이블 생성(SchemaArchitect) | 커맨드 팔레트 → AI 테이블 생성 어시스턴트 | 비즈니스 설명 → 다중 테이블 DDL | ✓ | ✓ |
| AI 역추론(SchemaReverse) | 커맨드 팔레트 → AI 역추론 | 샘플 데이터 → CREATE TABLE | ✓ | ✓ |

아래 항목별로 전개.

## 1. 테이블 구조 보기(TableStructure)

가장 단순한 "이 테이블이 어떻게 생겼나 보기", 트리에서 테이블 노드 클릭으로 읽기 전용 탭이 열림. 소스는 `packages/ui/src/components/TableStructure.vue`.

UI 는 4개 탭으로 나뉘며, 탭 접미사에 수량 표시:

- **필드** — 컬럼명 / 타입 / NULL 여부 / 기본 키 여부 / 기본값 / 코멘트
- **인덱스** — 인덱스명 리스트(이름만 표시, 상세 컬럼은 디자이너에서 확인)
- **키** — 기본 키 / 외래 키 / 유니크 키 이름
- **DDL** — 테이블의 `CREATE TABLE` 전문

DDL 탭의 획득 전략은 방언별로 분리:

```ts
if (isMysql) {
  // MySQL 계열은 직접 SHOW CREATE TABLE 가 가장 권위 있음
  const r = await client.connections.execute(connId, `SHOW CREATE TABLE ${ref}`)
  // row['Create Table'] 가져옴
}
// 비 MySQL: buildCreateFromColumns(...) 가 컬럼 정보로 간소화된 DDL 재구성
```

즉: **MySQL / MariaDB / OceanBase** 에서 보는 DDL 은 DB 원본 그대로 출력; PostgreSQL / Oracle / SQL Server 등에서 보는 것은 컬럼 정보로 조립된 근사 버전, 충분하지만 GENERATED / EXTENDS 같은 복잡 구문은 포함 안 됨.

우측 상단 새로고침 버튼 `⟳` 으로 재요청(`Promise.all([meta('columns'), meta('indexes'), meta('keys')])`), 테이블 수정 후 돌아와서 확인할 때 적합.

## 2. 비주얼 테이블 디자이너(TableDesigner)

`packages/ui/src/components/TableDesigner.vue`, **880 줄**, 구조 관리의 주력. 두 가지 mode:

- `mode: 'create'` — 테이블 생성(빈 상태에서 시작)
- `mode: 'alter'` — 테이블 수정(기존 컬럼 구조 + 인덱스 + 외래 키 로드)

### 상단 바

| 버튼 | 동작 |
|---|---|
| 생성 / 리셋 | `resetTable()` 빈 테이블 상태로 초기화 |
| 저장 | 생성 모드 → `CREATE TABLE`; 수정 모드 → `ALTER TABLE` diff 시퀀스 |
| 다른 이름으로 저장 | `prompt` 로 새 테이블명 → 현재 컬럼 구조로 `CREATE TABLE` 새 테이블("구조 복사" 와 동등) |
| ➕ 필드 / 필드 삽입 / 필드 삭제 / 기본 키 / ⬆⬇ | 직접 columns 배열에서 splice |
| 테이블명 입력 박스 | alter 모드에서는 읽기 전용(테이블명 변경은 RENAME 으로, 본 디자이너 범위 밖) |

### 내부 탭(방언에 따라 표시/숨김)

`INNER` 배열이 고정 10개 탭 정의: `fields / indexes / fk / unique / check / trigger / options / storage / comment / sql`. 각 탭은 reactive 서브 폼, 수정 즉시 SQL 미리보기에 반영.

**필드 테이블**(인라인 편집):

| 컬럼 | 편집 방식 |
|---|---|
| 필드명 | 일반 input |
| 타입 | input + datalist(`type-list`), 방언별 후보 제공(`typeOptions(dialect)`) |
| 길이 / 정밀도 | 숫자 input |
| NULL / PK | 체크박스 |
| 기본값 / 코멘트 | input |

선택된 행 아래에 "필드 속성" 영역, MySQL 계열만 `UNSIGNED / ZEROFILL / AUTO_INCREMENT / ON UPDATE CURRENT_TIMESTAMP / CHARSET / COLLATION` 표시, 모든 방언이 `GENERATED` 표현식 표시.

**인덱스** 의 타입 드롭다운은 방언별: MySQL 계열 `BTREE / HASH / FULLTEXT / SPATIAL`, PG 계열 `btree / hash / gin / gist`. PG 에는 추가로 `WHERE`(부분 인덱스) 와 `CONC`(`CREATE INDEX CONCURRENTLY`, 테이블 수정 시 락 안 함) 컬럼.

**외래 키** 도 방언별: `ON DELETE / ON UPDATE` 후보 하드 코딩 `CASCADE / SET NULL / RESTRICT / NO ACTION`; PG 추가로 `MATCH FULL/PARTIAL/SIMPLE` 과 `DEFERRABLE`.

**옵션** 페이지:

- MySQL 계열: Engine / Charset / Collation / Row Format(`DYNAMIC / COMPRESSED / COMPACT / REDUNDANT`) / Auto-increment 시작값
- PG 계열: `TABLESPACE / FILLFACTOR / INHERITS`
- 기타: 빈 안내

### diff 인식 ALTER(수정 모드의 핵심)

alter 모드 진입 시, `loadExisting()` 가 `client.connections.metadata` 로 컬럼 정보를 `ColumnDef[]` 로 매핑, `loadIndexes()` / `loadForeignKeys()` 로 `information_schema` 에서 기존 인덱스 외래 키 가져옴, **전체 스냅샷을 `original.value / originalIndexes.value / originalForeignKeys.value` 로 저장**하여 diff 기준선으로.

그 후 `alterStmts` 는 `computed(() => buildAlterTable(dialect, tableRef, original.value, spec, { indexes: originalIndexes.value, foreignKeys: originalForeignKeys.value }))`.

`buildAlterTable` 은 소스 vs 현재의 필드 단위 diff:

- 컬럼명 변경(그리고 `originalName` 존재) → `ALTER TABLE ... RENAME COLUMN / CHANGE COLUMN`
- 행 삭제 → `DROP COLUMN`
- 행 추가 → `ADD COLUMN`
- 타입 / NULL / 기본값 / 코멘트 변경 → `MODIFY COLUMN`(MySQL) 또는 `ALTER COLUMN`(PG/MSSQL)
- 인덱스 / FK 는 `originalIndexes.value` 와 비교 → 추가/삭제

SQL 미리보기 페이지(`inner === 'sql'`)는 생성된 ALTER 리스트 표시; 아무것도 변경되지 않았으면 `designer.noChanges` 자리표시자. **저장** 은 각 ALTER 를 개별 `client.connections.execute`, 어느 하나라도 실패하면 그 자리에 멈추고 포커스를 SQL 탭으로 전환, 이미 성공한 것은 롤백 안 함(테이블 수정 시나리오에서 일반적으로 수용 가능, 실패 정보는 오류 바에 표시).

### dirty 체크 + 생성 후 alter 로 전환

dirty 체크는 `JSON.stringify({ tableName, spec })` 를 기준선과 비교, 탭 닫을 때 부모 컴포넌트가 `isDirty()` 를 호출하여 "저장되지 않음" 안내 여부 결정. 저장 성공 / 리셋 후 기준선이 동기화되므로, 새 생성 탭을 막 열었을 때 dirty 로 잘못 판정되지 않음.

생성 저장 성공 후, 컴포넌트가 스스로 `runtimeMode` 를 `alter` 로 전환, 방금 CREATE 된 컬럼을 `originalName` 으로 마킹, 이후 매번 저장은 ALTER diff 로. 효과: 저장을 누르면 테이블이 만들어지고, 탭이 닫히거나 점프하지 않으며, 필드 계속 추가, 타입 변경 가능 — 이는 "만들면서 생각" 워크플로우의 최적화.

## 3. DDL 에디터(뷰 / 함수 / 프로시저 / 트리거)

`packages/ui/src/components/DdlEditor.vue`. 디자이너 외의 schema 객체는 SQL 텍스트로 직접 작성, 본 컴포넌트는 방언 인식 Monaco 래퍼.

- **mode: 'create'** — `objectTemplate(dialect, kind, ctx)` 로 최소 스켈레톤 제공(예: `CREATE VIEW v AS SELECT 1;`)
- **mode: 'edit'** — `objectDdlQuery(dialect, kind, ref, node)` 호출하여 기존 정의 가져옴

`objectDdlQuery` 는 세 가지 mode 중 하나 반환:

| mode | 적용 | 정의 획득 방식 |
|---|---|---|
| `showCreate` | MySQL 계열 | `SHOW CREATE VIEW / PROCEDURE / FUNCTION / TRIGGER`, row 에서 `^create` 로 시작하는 필드 가져옴 |
| `viewdef` | PG 뷰 | `pg_get_viewdef(...)`, 본 컴포넌트가 `prefix` 조립(`CREATE OR REPLACE VIEW ... AS\n`) |
| `funcdef` / `oracle-ddl` | PG 함수 / Oracle DBMS_METADATA | `row.ddl` 직접 읽기 |

툴바:

- **저장 / 실행**(mode 별 텍스트) — 전체 단락을 단일 statement 로 실행(함수 / 프로시저 본문에 세미콜론 있어 세미콜론으로 분할 안 됨)
- **포매팅** — `sql-formatter` 방언별: `mysql` 계열 → mysql, `pg` 계열 → postgresql, `sqlserver` → transactsql, `oracle/dm` → plsql. 파싱 실패 시 원본 유지, 입력 차단 안 함.
- **취소** — 탭 직접 닫기

오류 바는 백엔드 원시 오류 표시, 트리거 / 저장 프로시저는 일반적으로 세미콜론 / DELIMITER 작성 문제.

## 4. ER 도(ErdView)

`packages/ui/src/components/ErdView.vue`, SVG 손 그림 캔버스. 여는 방법: 트리의 DB / Schema 노드 우클릭 → ER 도, 새 `kind: 'erd'` 탭이 열림.

### 뷰 모드(기본)

- 모든 테이블 가져오기(`loadErd`, 내부에서 `information_schema` / `pg_constraint` 등 사용) → 자동 그리드 레이아웃
- 마우스 휠 = 줌, 빈 공간 누르고 드래그 = 팬
- 테이블 박스는 임의 위치로 개별 드래그 가능(음수 좌표 포함, canvas 잘림 안 함)
- 상단: `－ / + / 1:1 / ⟳ / 편집` 줌 및 새로고침

### 편집 모드("편집" 클릭으로 열기)

세 가지 수정을 동시에 할 수 있으며, 제출 시 함께 실행:

1. **테이블 생성** — `addTable()` 가 박스 팝업, 컬럼 추가, 타입 변경, 기본 키 체크 가능
2. **외래 키 생성** — 임의 컬럼 우측 포트에서 누름 → 다른 테이블 컬럼으로 드래그하여 놓음 → `newFks.push(...)`; 시각적으로는 보라색 점선
3. **ALTER 컬럼 추가**(D1) — 기존 테이블의 "+ ALTER 컬럼 추가..." 버튼 → 두 개의 prompt 팝업(컬럼명 / 타입) → `alterAddCols[tableName]` 에 진입, 박스에 보라색 강조로 `+` 접두사와 함께 표시

### 산출물

`generateDdl()` 은 `client.files.saveText` 사용, `.sql` 파일 산출, 포함 내용:

```sql
CREATE TABLE "t1" (
  "id" int,
  ...
);

ALTER TABLE "orders" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "users" ADD COLUMN "phone" varchar(64);
```

`applyChanges()` 는 `buildDdl(true)`(신규 추가 부분만)를 `;\n` 으로 분할, `executeBatch` 로 일괄 현재 연결에 발행, 성공 후 `load()` 재요청, 뷰 모드로 복귀. 실패 시 alert 팝업, 사용자 구조 미변경.

## 5. 구조 스냅샷(SchemaSnapshotsDialog)

`packages/ui/src/components/SchemaSnapshotsDialog.vue`. 커맨드 팔레트 `act:snapshots:{connId}` 로 트리거.

포지션: **동일 연결의 서로 다른 시점** DDL 비교. 후술하는 SchemaDiff(두 연결), SchemaDrift(심층 드리프트)와 중첩되지 않음.

### 스냅샷 촬영

"📸 스냅샷 촬영" 클릭 → 첫 번째 database/schema 아래 모든 테이블의 DDL 가져옴. MySQL 은 `SHOW CREATE TABLE` 사용, PG 는 간소화된 DDL 조립(컬럼 + 타입 + NULL + DEFAULT). 종료 후 prompt 팝업으로 코멘트 작성("릴리스 전 / 주문 시스템 수정 후 / ..."), `localStorage['skylerx.schema-snapshots']` 에 저장, 연결당 `MAX_PER_CONN = 20` 개 보존, 초과 시 LRU 로 가장 오래된 것 제거.

### 비교

리스트에서 두 개 체크(두 개 초과 시 가장 오래된 것 자동 제거) → "⟷ 비교". 알고리즘 단순:

- A 에만 있음 → `added`(녹색)
- B 에만 있음 → `removed`(빨간색)
- 양쪽에 있지만 내용 다름 → `changed`(황색)
- 완전 동일 → `same`(기본 숨김)

diff 행 클릭 → 우측에 이중 컬럼 DDL, 바로 눈으로 비교.

> 제약: 첫 번째 database/schema 만 봄, 다중 DB 시나리오는 각 DB 별로 촬영 필요. 저변에 `localStorage` 사용 이유: SQLite 마이그레이션을 이 같은 "로그형" 데이터로 방해하고 싶지 않으며, 5MB 할당량은 보통 수십 테이블 × 20 스냅샷에 충분.

## 6. 구조 비교(SchemaDiffDialog) — 두 연결 비교 + 정렬 SQL

`packages/ui/src/components/SchemaDiffDialog.vue`. 커맨드 팔레트 `act:schema-diff` 로 트리거.

### 트리거 조건

- 소스 연결 + 소스 schema, 타겟 연결 + 타겟 schema 선택
- **동일 패밀리** 여야 함(MySQL ↔ MySQL / PG ↔ PG), 패밀리 간 SQL 구문이 맞지 않아, UI 에 "MySQL ↔ MySQL / PG ↔ PG 만 지원" 표시

연결 전환 후 `onPickSrc / onPickTgt` 가 자동으로 기본 schema 입력: PG → `public`, MySQL → 연결 설정의 `database`.

### 캡처 + 비교

양쪽이 병렬로 한 건의 `information_schema.COLUMNS` 쿼리(`TABLE_NAME / COLUMN_NAME / 타입 / NULL 여부 / PK 여부 / 기본값`) 실행, `TableSnapshot[]` 획득 → `diffSchemas` 가 세 종류 산출: `added / changed / removed`. 각 changed 행은 컬럼 단위 `columnChanges`(`add / drop / modify`) 동반.

### 산출물

`generateMigration` 이 타겟 방언에 따라 정렬 SQL 생성, 헤더에 요약(추가 몇 개, 수정 몇 개, 누락 몇 개). 아래 두 개 버튼:

- **복사** — 클립보드로
- **타겟 연결의 쿼리에 열기** — `emit('openSql', tgtId, migration)`, Workspace 가 새 query tab 을 열고 SQL 을 주입, 검토 후 Run. 이 단계는 **자동으로 DB 에 반영되지 않음을 보장**.

## 7. 구조 드리프트 감지(SchemaDriftDialog)

`packages/ui/src/components/SchemaDriftDialog.vue`, **925 줄**, SchemaDiff 보다 한 단계 더 깊음. 커맨드 팔레트 `act:drift`.

차이: SchemaDiff 는 컬럼만 보지만, DriftDialog 는 **인덱스** 와 **외래 키** 도 보며, 생성된 정렬 스크립트를 **SkylerX 내에서 직접 발행 실행 가능**.

### TableProfile

각 테이블을 `TableProfile` 로 정규화: `columns: Map<name, {type, nullable, default, pk}>` + `indexes: Map<name, {unique, columns[]}>` + `fks: Map<name, "(c1,c2) → other(c1,c2)">`, 추가로 원시 DDL 한 부 보존하여 육안 비교에 제공.

캡처 소스는 방언별: MySQL 은 `SHOW CREATE TABLE` + `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE`; PG 는 `information_schema.columns` + `pg_indexes`(`indexdef` 텍스트에서 정규식으로 unique 와 컬럼명 추출) + `information_schema.constraint_column_usage`.

### 보고서

3열: **소스에만 있음 / 타겟에만 있음 / 내용 다름**. 세 번째 열의 각 테이블 전개 시 컬럼 변화(`+ name / − name / ~ name`), 인덱스 변화(`+ idx_x`), FK 변화(`~ fk_x`) 표시. 행 클릭으로 아래 이중 컬럼 DDL diff 전개.

### 정렬 스크립트(핵심 산출물)

각 행에 "+ 정렬" 버튼, 해당 테이블의 수정 SQL 을 아래 스크립트 미리보기 박스에 **추가**:

| 상태 | 생성된 문 |
|---|---|
| 소스에만 있음 | 소스 측 DDL 그대로 복사(`CREATE TABLE`) |
| 타겟에만 있음 | `-- DROP TABLE \`x\`; -- 주석 처리, 수동으로 제거 필요` |
| 컬럼 add | `ALTER TABLE \`t\` ADD COLUMN \`c\` {srcType};` |
| 컬럼 drop | 주석 처리된 `-- ALTER TABLE ... DROP COLUMN ...`(실수 삭제 방지) |
| 컬럼 modify | MySQL: `MODIFY COLUMN`; PG: `ALTER COLUMN ... TYPE` |
| 인덱스 / FK 차이 | `-- INDEX +xx` / `-- FK -xx` 주석으로만 안내, **자동 생성 안 함**(인덱스 재생성 구문 복잡, 수동에 위임) |

실행 흐름: `▶ 스크립트 실행` 으로 고위험 확인 → `;\s*\n` 으로 문 분할, `--` 주석 행 스킵 → `executeBatch`.

> 설계 트레이드오프: 테이블 삭제 / 컬럼 삭제는 기본 주석 처리, 컬럼 추가 / 타입 변경은 실행 가능 SQL 직접 제공. "파괴적인 것은 주석, 보완적인 것은 실행 허용", 운영 시나리오에서 가장 사고 안 남.

## 8. 데이터베이스 생성(NewDatabaseDialog)

`packages/ui/src/components/NewDatabaseDialog.vue`. 트리 우클릭 연결 노드 → 데이터베이스 생성.

팝업 내: **이름(필수)** + 접힌 "고급 옵션"(문자셋 / 정렬 규칙 / 코멘트) + **SQL 미리보기(편집 가능)**. 최종 실행되는 것은 미리보기 박스의 텍스트지 폼이 아님 — 미리보기 후 `IF NOT EXISTS` 같은 것을 수동으로 추가 가능.

### 방언 매트릭스

| 방언 | 지원 | 비고 |
|---|---|---|
| MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks | ✓ | `CREATE DATABASE \`n\` [DEFAULT CHARACTER SET ...] [DEFAULT COLLATE ...]`(COMMENT 없음) |
| PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift | ✓ | `CREATE DATABASE "n" [ENCODING '...']` + 독립 `COMMENT ON DATABASE` |
| SQL Server | ✓ | `CREATE DATABASE [n]`(문자셋 없음) |
| ClickHouse | ✓ | `CREATE DATABASE \`n\` COMMENT '...'` |
| Snowflake | ✓ | `CREATE DATABASE "n" COMMENT = '...'` |
| TDengine | ✓ | `CREATE DATABASE n`(따옴표 없음) |
| **Oracle / DM** | ✗ | 데이터베이스 = 인스턴스 레벨, DBCA 필요. "보통 schema(사용자) 생성으로 대체해야 함" 안내 |
| SQLite / DuckDB | ✗ | 파일 형, 데이터베이스 = 파일, 새 연결에서 파일 경로 선택으로 "생성" |
| H2 | ✗ | 시작 파라미터로 결정, 즉시 SQL 생성 불가 |
| MongoDB / Redis / Elasticsearch | ✗ | collection / index / db0-15 등 메커니즘 사용, CREATE DATABASE 안 함 |

미지원 방언 UI 는 빨간색 안내를 직접 표시, 제출 불가.

### 문자셋 옵션

방언별 추천:

- MySQL 계열: `utf8mb4 / utf8 / latin1 / gbk`, collation `utf8mb4_general_ci / unicode_ci / 0900_ai_ci / bin`
- PG 계열: `UTF8 / SQL_ASCII / LATIN1 / GBK`

제출 시 `;\s*\n` 으로 문 분할하여 항목별 `execute`.

## 9. Schema 생성(NewSchemaDialog, Oracle 특수 처리)

`packages/ui/src/components/NewSchemaDialog.vue`. 트리 우클릭 DB 노드 → Schema 생성.

### 방언 매트릭스

| supportInfo | 방언 | 구문 |
|---|---|---|
| `pg` | PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift | `CREATE SCHEMA "n" [AUTHORIZATION "owner"]` + 선택적 `COMMENT ON SCHEMA` |
| `sqlserver` | SQL Server | `CREATE SCHEMA [n] [AUTHORIZATION owner]` |
| `snowflake` | Snowflake | `CREATE SCHEMA "n" [COMMENT = '...']` |
| `oracle` | Oracle / DM | **Schema = User**, CREATE USER + GRANT 사용(아래 참조) |
| `null` | MySQL / SQLite / ClickHouse / TDengine / NoSQL | Schema 개념 없음, "이 방언은 Schema 개념 없음" 표시 |

### Oracle / DM 의 특수 처리

Oracle 에서 "schema" 는 "user" 의 동의어, 본 다이얼로그는 이를 고려해 개발 시나리오의 합리적 기본값 묶음 제공:

```sql
CREATE USER :name IDENTIFIED BY :password
  DEFAULT TABLESPACE USERS
  TEMPORARY TABLESPACE TEMP
  QUOTA UNLIMITED ON USERS;

GRANT CONNECT, RESOURCE, UNLIMITED TABLESPACE,
      CREATE VIEW, CREATE SYNONYM, CREATE SEQUENCE,
      CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE,
      CREATE MATERIALIZED VIEW, CREATE DATABASE LINK
   TO :name;
```

(자리표시자 `:name` / `:password` 는 실제 입력한 사용자명 / 비밀번호.)

왜 이렇게 작성했는지, 코드 코멘트가 설명:

- `QUOTA UNLIMITED ON USERS` — 안 붙이면 새 사용자가 데이터 삽입 시 `ORA-01950: insufficient quota on tablespace USERS`
- Oracle 12c+ `RESOURCE` 가 `CREATE VIEW / SEQUENCE` 등 포함 안 함, 개발 자주 쓰는 것 명시 보충 필요
- `SELECT ANY TABLE / DBA / SYSDBA` 부여 안 함 — "자기 schema 만 다룰 수 있게" 유지
- 사용자명 / 비밀번호 기본 **따옴표 안 함**: 합법적인 unquoted 식별자는 Oracle 자동 대문자화("큰따옴표 소문자 → 이후 ALTER USER 못 찾음" 회피). 소문자 또는 특수 문자 보존하려면, SQL 미리보기에서 직접 큰따옴표 추가

비밀번호 필드 비어 있으면 자리표시자 `CHANGE_ME_123` 입력, 사용자에게 변경 안내.

### 제출

`execute` 시 `database` 컨텍스트 동반(PG 계열 schema 는 DB 에 속함, 먼저 USE 후 CREATE). 실패 toast 의 오류 정보는 `askAi` 링크 첨부, SQL + 오류를 AI 에게 함께 던져 설명 요청(Oracle 테이블 공간 미존재 / 권한 부족 자주 발생).

## 10. AI 보조: Schema Architect + Schema Reverse

두 개의 대화식 도구, 모두 생성된 SQL 을 마지막에 사용자가 검토 후 실행하도록 보존.

### Schema Architect(비즈니스 설명 → 다중 테이블 DDL)

`packages/ui/src/components/AiSchemaArchitectDialog.vue`. 대화식, 다중 라운드 반복 가능.

System Prompt 요지:

> You are a senior database architect. The user describes a business domain.
> 1. Design **multiple related tables** with PK, FK, indexes for the **`{dialect}`** dialect.
> 2. Output a single ```sql code block containing the COMPLETE CREATE TABLE statements.
> 3. Explain key design decisions in 2-4 bullets.
> 4. When user asks to revise, output the FULL updated SQL again (not a diff).

워크플로우:

1. 비즈니스 설명("전자상거래 주문 시스템 구축: 사용자, 상품, 주문, 주문 항목, 쿠폰 지원")
2. AI 가 markdown 한 단락 제공: 설계 설명 + 완전한 SQL 코드 블록
3. 대화에서 추가 질문("status 필드 추가" / "order_items 를 파티션 테이블로 변경"), AI 가 **전체** 새 버전 SQL 제공
4. 상단 버튼 `▶ 최신 버전 실행` — `latestSql`(마지막 어시스턴트 응답의 SQL 블록) 가져옴, `;\s*(?:\n|$)` 으로 분할 → 항목별 `execute`

`latestSql` 은 항상 최신 라운드 가져옴 — 5번 반복했으면, 실행되는 것은 5번째 버전, 초기 버전에 의해 오염되지 않음.

### Schema Reverse(샘플 데이터 → CREATE TABLE)

`packages/ui/src/components/AiSchemaReverseDialog.vue`. 단일 라운드 비대화식, "CSV 가 있는데, 대응 테이블 생성 도와줘" 에 적합.

입력: **형식**(CSV / TSV / JSON) + **테이블명** + **샘플 데이터**(몇 줄 붙여넣으면 충분, 헤더 포함이 가장 정확) + 선택적 "INSERT 동시 생성".

Prompt 가 4개 섹션 출력 강제: **추론 설명**(컬럼명 → 타입 → 이유), **CREATE TABLE**(`sql` 코드 블록), **INSERT (데이터)**(선택, `sql` 코드 블록), **인덱스 제안**(bullet list).

AI 응답 후 자동으로 `extractSql(text)` 가 첫 번째 SQL 코드 블록을 추출하여 아래 편집 박스에 입력, 수정 후 `▶ 실행` 클릭 가능.

> 인덱스 추천에 관하여: Schema Reverse 에서 AI 는 "제안"(경험 기반)만 제공, 자동 인덱스 생성 안 함. 실제 과거 SQL + 기존 인덱스 기반 추천 → [고급 및 엔지니어링 → 인덱스 추천기](./advanced.md) 참고.

## 11. 마이그레이션 평가(MigrationAssessWizard)

Oracle / DM 소스 DB를 openGauss 계열 국산 DB(Vastbase / openGauss) 또는 DM으로 마이그레이션하는 타당성 보고서로 만듭니다. 탈 Oracle("去O") 프로젝트의 프리세일즈 / DBA를 위한 기능으로, 마이그레이션 공수를 산정하기 *전에* 소스에 무엇이 얼마나 있고, 얼마나 크고, 얼마나 어려운지 파악합니다.

**진입점**: 명령 팔레트 `act:mig-assess`(「마이그레이션 평가」 검색), 또는 Oracle / DM 연결 우클릭 → `🧭 마이그레이션 평가…`(해당 연결을 소스로 자동 입력). 코드는 `packages/ui/src/components/MigrationAssessWizard.vue`, 평가 로직은 모두 `packages/ui/src/migrate/`에 있습니다.

### 5단계 마법사

| 단계 | 내용 |
|---|---|
| 1 연결 | 소스(프로파일 가능한 방언) + 타겟(변환 경로가 있는 방언) 선택 |
| 2 프로파일링 | 데이터베이스 / 스키마 목록(시스템 제외), 마이그레이션 대상 체크, 전체 객체 인벤토리 + 리스크 지표 |
| 3 평가 | 선택한 스키마의 객체를 가져와 각각 A/B/C/D 등급 + 전체 「준비도」 점수 |
| 4 AI 변환 | C 등급(PL/SQL 본문 / 복잡한 SQL)을 AI에 넘겨 타겟 방언으로 번역(읽기 전용) |
| 5 보고서 | 집계 후 Excel / Word / PDF / Markdown 으로 내보내기 |

### hub-and-spoke 변환 아키텍처

소스→타겟 쌍별 변환기(N×M 폭발) 대신, 중간에 추상 데이터베이스 모델(Logical IR)을 둡니다:

```
소스 ──parse──▶ Logical IR ──emit──▶ 타겟
```

각 방언은 parser 또는 emitter 하나만 만들면 되므로 DB 추가는 N×M이 아니라 N+M입니다. 코드: `migrate/ir.ts`(모델), `migrate/convert.ts`(오케스트레이션), `migrate/dialects/{oracle,postgres,dameng}.ts`. **경계**: 구조 객체(테이블 / 컬럼 / 타입 / 제약)는 결정론적 IR을 거치고, 절차형 객체(프로시저 / 함수 / 패키지 / 트리거 / 뷰)는 원본 DDL을 유지하여 AI(`migrate/aiConvert.ts`)가 번역합니다. 정규식으로는 의미 수준의 재작성이 불가능하기 때문입니다.

### 소스 프로파일링

`migrate/profile.ts` + `migrate/profilers/{oracle,postgres}.ts`, 소스 패밀리별 카탈로그 쿼리 세트. 17가지 객체 카테고리를 집계하며, **지원하지 않는 객체는 가짜 0이 아니라 `—`(null)로 표시**합니다:

> 테이블 · 뷰 · 구체화 뷰 · 파티션 테이블 · 인덱스 · 기본 키 · 외래 키 · 유니크 제약 · 체크 제약 · 시퀀스 · 함수 · 프로시저 · 패키지 · 트리거 · 타입 · 시노님 · DB 링크

여기에 마이그레이션 리스크 지표: **기본 키 없는 테이블 수**(CDC의 최대 함정), **LOB 컬럼 수**(데이터 마이그레이션 시간의 대부분), **트리거가 있는 테이블 수**, **주석이 있는 테이블 수**; 그리고 행 수 버킷(≥100만 / ≥1000만 / ≥1억), 테이블스페이스 크기, 최대 테이블. 행 수는 카탈로그 통계 추정치(`reltuples` / `num_rows`)를 쓰고 정확한 `COUNT(*)`는 하지 않으므로 수십억 행 테이블도 초 단위로 반환됩니다. `dba_segments`를 읽을 수 없을 때(DBA 권한 없음)는 자동으로 축소됩니다(크기 0 + 안내).

### 문서 내보내기

보고서 페이지의 버튼 4개, 모두 기존 의존성(`xlsx` / `marked`)을 재사용하며 새 라이브러리 없음:

| 형식 | 방법 |
|---|---|
| Excel `.xlsx` | 멀티 시트: 개요 / 인벤토리 / 대형 테이블 / 평가 상세 / AI 변환 |
| Word `.doc` | Markdown을 스타일 HTML로 렌더링, Word에서 네이티브로 열림 |
| PDF | 동일한 HTML을 새 창에서 자동 인쇄 → Chromium의 「PDF로 저장」 |
| Markdown `.md` | 일반 텍스트 보고서 |

> 등급: **A 자동**(결정론적, 그대로 사용) · **B 보조**(타입 / 의미 차이, 샘플 확인 권장) · **C 수동**(PL/SQL 본문 또는 독자 구문, AI + 사람 필요) · **D 차단**(공간 / 외부 패키지 등 등가물 없음, 아키텍처 수준 검토 필요). 준비도 = 객체 등급의 가중 평균(A=100 / B=80 / C=40 / D=0).

## 호환성 매트릭스

아래 표는 각 도구가 어떤 방언을 지원하는지 정리. `▣` = 완전 지원, `◐` = 부분 지원, `-` = 적용 안 함 / 스킵.

| 도구 | MySQL 계열 | PG 계열 | SQL Server | Oracle / DM | SQLite | ClickHouse | NoSQL |
|---|---|---|---|---|---|---|---|
| TableStructure | ▣(`SHOW CREATE TABLE` 원본) | ◐(컬럼 재구성) | ◐(컬럼 재구성) | ◐(컬럼 재구성) | ◐ | ◐ | - |
| TableDesigner — CREATE | ▣ | ▣ | ▣ | ▣ | ◐(타입 / 옵션 적음) | ◐ | - |
| TableDesigner — ALTER diff | ▣ | ▣ | ◐ | ◐ | ◐ | ◐ | - |
| DdlEditor | ▣(SHOW CREATE) | ▣(`pg_get_viewdef` / `funcdef`) | ◐ | ▣(DBMS_METADATA) | ◐ | ◐ | - |
| ErdView | ▣ | ▣ | ◐ | ◐ | ◐ | - | - |
| SchemaSnapshots | ▣ | ◐(간소화 DDL) | - | - | - | - | - |
| SchemaDiff | ▣ | ▣ | - | - | - | - | - |
| SchemaDrift | ▣ | ▣ | - | - | - | - | - |
| NewDatabase | ▣ | ▣ | ▣ | -(NewSchema 사용) | -(파일 형) | ▣ | -(전용 명령 사용) |
| NewSchema | -(개념 없음) | ▣ | ▣ | ▣(=User) | - | - | - |
| AI Architect / Reverse | ▣ | ▣ | ▣ | ▣ | ▣ | ▣ | ◐ |

"MySQL 계열" 은 MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks 포함. "PG 계열" 은 PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift / H2(PG 호환) 포함.

## 일반적인 워크플로우 연결해 보기

**처음부터 비즈니스 DB 구축**:
1. 트리 우클릭 연결 → 데이터베이스 생성 → SQL 미리보기 확인 → 실행
2. 커맨드 팔레트 → AI 테이블 생성 어시스턴트 → 비즈니스 설명 → 완전한 DDL 받음 → 새 DB 에서 실행
3. 트리 우클릭 schema → ER 도 → 관계 확인 / 미세 조정
4. 필드 변경: 트리 우클릭 테이블 → 테이블 디자인(alter 모드) → 수정 후 저장(ALTER diff 사용)

**DB 간 정렬**:
1. 커맨드 팔레트 `act:schema-diff` → dev / prod 두 연결 선택 → 마이그레이션 SQL 받음 → "타겟 연결 쿼리에 열기" → 검토 → Run
2. prod 가 수동 수정된 의심: `act:drift` → baseline / prod 선택 → 3열 보고서 보기 → 수정해야 할 테이블에 "+ 정렬" 클릭 → 스크립트 미리보기 검토 → 실행

**이력 회고**:
1. 릴리스 전 `act:snapshots:{connId}` → 스냅샷 촬영 → 비고 "v2.0 릴리스 전"
2. 3개월 후 재방문: 스냅샷 다이얼로그 열기 → "v2.0 릴리스 전" + 현재 새 스냅샷 체크 → 비교 → 어느 테이블이 변경되었는지 확인

여기까지 구조 레이어의 모든 기능. 런타임 쿼리 계획, 슬로우 로그, 인덱스 추천을 계속 보려면 [고급 및 엔지니어링](./advanced.md) 참고; 방언 간 마이그레이션 도구는 [데이터베이스 지원](./databases.md) 참고.
