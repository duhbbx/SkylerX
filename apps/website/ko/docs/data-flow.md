# 데이터 흐름: 가져오기 / 내보내기 / 백업 / 마이그레이션

SkylerX 는 "데이터가 데이터베이스를 떠나거나 들어오는" 모든 경로를 일련의 다이얼로그에 수렴시키며, 통합으로 커스텀 `SaveFileDialog`(크로스 플랫폼 일관, 시스템 네이티브 호출 안 함)와 렌더러 측 파싱(CSV/JSON/Excel 모두 메모리에서 처리)을 사용합니다. 이 장은 "출구 → 입구 → 백업/복원 → DB 간 마이그레이션 → 데이터 사전 → 데이터 비교" 순서로 정리합니다.

## 1. 개요: 이 영역이 다루는 것

| 시나리오 | 진입점 | 메인 다이얼로그 / 함수 | 관련 형식 |
|---|---|---|---|
| 한 행/몇 행을 즉석 복사 | 결과 그리드 우클릭 → "복사 형식" | `ResultGrid.vue::copyRows` | CSV / TSV / JSON / Markdown / SQL VALUES |
| 한 테이블 / 전체 schema 다운로드 | NavTree 우클릭 "SQL 내보내기" → `ExportOptionsDialog` | `Workspace.vue::doTableExport` / `doSchemaExport` | SQL(CREATE + INSERT) |
| 전체 workspace 이전 | 커맨드 팔레트 `act:export-conns` / `WorkspaceExportDialog` | `WorkspaceExportDialog.vue` | `.skylerxws` JSON |
| CSV/JSON/Excel 을 테이블에 주입 | NavTree 우클릭 "데이터 가져오기" → `ImportDialog` | `ImportDialog.vue` + `io.ts` | CSV / TXT / JSON / NDJSON / XLSX |
| Excel/飞书 표 클립보드 직접 붙여넣기 | 메인 영역에서 ⌘V(또는 `PasteImportDialog`) | `PasteImportDialog.vue` | TSV / CSV |
| .ndjson 파일 바로 보기 | 커맨드 팔레트 `act:ndjson-viewer` | `NdjsonViewerDialog.vue` | `.ndjson` / `.jsonl` |
| 전체 DB 백업 / 복원 | 커맨드 팔레트 `act:backup:<id>`(연결당 한 건) | `BackupRestoreDialog.vue` | `.sql` / `.ndjson` |
| 연결 간 테이블 복사 | NavTree 우클릭 "데이터 전송" | `DataTransferDialog.vue` | 행 단위 SELECT → 배치 INSERT |
| 데이터 사전 생성 | NavTree 우클릭 schema/db → "데이터 사전" | `Workspace.vue::genDataDict` + `dump.ts` | Markdown / HTML |
| 두 테이블 데이터 차이 비교 | 커맨드 팔레트 `act:data-diff` | `DataDiffDialog.vue` + `data-diff.ts` | 행 단위 diff → 동기화 SQL |

파일 IO 능력은 모두 `client.files`(메인 프로세스가 `openText / saveText / listDir / commonDirs / mkdir` 구현)를 사용합니다. 웹 클라이언트에서 `listDir` 는 사용 불가하므로, 브라우저 다운로드/업로드(텍스트 형식만 지원)로 폴백.

## 2. 내보내기

### 2.1 결과 셋 다중 형식 복사

`ResultGrid.vue` 의 셀/선택 영역 우클릭, "복사 형식" 하위 메뉴 표시:

| 항목 | 구현 | 용도 |
|---|---|---|
| CSV | `io.ts::toCSV` | Excel / Numbers 에 직접 붙여넣어 표 출력 |
| TSV | `io.ts::toTSV` | Excel / Notion / 飞书 표(구분자 `\t`) |
| JSON | `io.ts::toJSON` | 프로그램에서 `JSON.parse`, `Date` 자동 `toISOString()` |
| Markdown | `io.ts::toMarkdown` | 문서 / PR 설명에 표 붙여넣기(`|` 와 줄바꿈 이스케이프) |
| SQL VALUES | `io.ts::toSqlValuesList` | `(1, 'a'), (2, 'b')` 형태, `INSERT...VALUES` / `VALUES (...) AS t` / `ON CONFLICT ... EXCLUDED` 에 붙여넣기 |
| SQL INSERT | `io.ts::toInsertSql` | 바로 실행 가능한 `INSERT INTO tbl (...) VALUES (...)`, 행당 한 건 |

**타입 복원 세부**(`io.ts` 구현):

- `null/undefined` → 빈 값(CSV) / `NULL`(SQL) 출력;
- `Date` → `toISOString()`;
- `number` → 그대로, `Infinity/NaN` 은 SQL 에서 `NULL` 로 다운그레이드;
- `boolean` → SQL 에서 `TRUE/FALSE`(SQLite 는 다시 `1/0` 으로 변환됨에 주의);
- `object/array` → `JSON.stringify`, SQL 에서는 작은따옴표로 감쌈;
- 작은따옴표 `'` 는 일률 더블링(`a'b` → `'a''b'`), 인젝션 회피.

CSV 셀은 `"` / `,` / 줄바꿈을 만났을 때만 따옴표 추가; TSV 는 `\t` / 줄바꿈 / `"` 만났을 때만 따옴표 추가 — 무작정 따옴표를 추가하지 않아, Excel 에 붙여넣을 때 셀이 깨끗.

### 2.2 ExportOptionsDialog — 테이블 / Schema 통째 내보내기

NavTree 우클릭 테이블 또는 schema(DB) → "SQL 내보내기", 먼저 간단한 양자택일 다이얼로그 `ExportOptionsDialog` 표시:

- **구조만** → `withData = false`, `CREATE TABLE` 만 출력;
- **구조 + 데이터** → `withData = true`, `SELECT * FROM ref` 로 데이터 가져와 `INSERT` 리스트 연결.

`pick` 수신 후 `Workspace.vue` 가 `doTableExport` / `doSchemaExport` 실행:

1. `client.connections.metadata(... group: 'columns')` 로 컬럼 가져오기;
2. `dump.ts::buildCreateFromColumns` 가 컬럼 메타로 **CREATE TABLE 재구성**(v1 은 기본 키 포함, 인덱스와 외래 키 미포함 — 방언 간 인덱스 구문 차이가 너무 커서 일단 안정 우선);
3. `withData` 가 true 면 `SELECT * FROM ref`(페이지네이션 없음, 큰 테이블은 백업/마이그레이션 사용);
4. `buildTableDump` 가 조립:

   ```sql
   -- 테이블 구조
   CREATE TABLE `users` (...);

   -- 데이터(N 행)
   INSERT INTO `users` (...) VALUES (...);
   ```

5. 파일명 기본 `<객체명>.sql`, 확장자 고정 `.sql`, `client.files.saveText` 로 커스텀 `SaveFileDialog` 호출하여 사용자가 경로 선택.

전체 schema 내보내기는 모든 base table 을 순회하며, 상단에 한 줄 `-- ws.dumpHeader { label, n }` 메타 정보 마킹 추가.

### 2.3 Workspace 전량 내보내기(`.skylerxws`)

`WorkspaceExportDialog.vue` 는 "컴퓨터 교체/동료 공유" 두 시나리오를 합칩니다. 파일 구조:

```ts
interface WorkspaceFile {
  version: 1
  exportedAt: number
  source: string                  // 'SkylerX'
  connections?: ConnectionConfig[]
  snippets?: typeof snippets
}
```

내보내기 옵션(모두 독립적으로 체크 가능):

| 옵션 | 기본값 | 설명 |
|---|---|---|
| 연결 설정 포함 | ✓ | `client.connections.list()` 사용, 기본 **마스킹**(비밀번호 없음) |
| ⚠ 비밀번호 포함 | ✗ | 체크 시 **항목별** `client.connections.get(id)` 호출하여 평문 가져옴. 파일은 머신 간 해독 가능 — 머신 간 시스템 keychain 에 의존하지 않음, 대신 파일 자체가 평문 평이라 신중히 사용 |
| SQL Snippets 포함 | ✓ | 전체 JSON 복사, ID 이름 변경 없음 |

기본 파일명 `skylerx-workspace-YYYY-MM-DD.skylerxws`, filter 는 `.skylerxws` 와 `.json` 모두 수용.

가져오기 시 "연결 + Snippets" 카운트 → 재확인 → 충돌 정책에 따른 병합:

- **skip**: 동명 스킵(기본);
- **overwrite**: 동일 `name` 으로 dup.id 의 `update` 호출, 모든 필드 덮어쓰기(비밀번호 포함, 파일에 있으면);
- **rename**: `name` 에 `(가져오기)` 접미사로 새로 생성.

### 2.4 암호화 내보내기 `.sql.enc`(AES-256-GCM + PBKDF2)

`export-encrypt.ts` 는 순수 함수 API 를 제공, UI 레이어가 시나리오별로 호출(전형적 시나리오: 민감 데이터 포함 SQL dump 를 외부 협력자에게 내보내기). 알고리즘 선정:

| 항목 | 값 | 트레이드오프 |
|---|---|---|
| 파일 헤더 매직 | `SKYLERX-ENC-v1` | 알고리즘 업그레이드 시 버전 식별 |
| KDF | PBKDF2-HMAC-SHA-256 | 브라우저/Node 모두 네이티브 지원, 의존성 없음 |
| 반복 횟수 | `DEFAULT_ITER = 200_000` | OWASP 2023 권장 ≥ 600k, 여기서는 구 머신 경험 절충, 후속 인상 가능 |
| 암호화 알고리즘 | AES-GCM | 128-bit 인증 태그 내장, 비밀번호 오류/변조 모두 `WRONG_PASSWORD` throw |
| 키 길이 | 256 bit | `deriveKey` 가 AES-GCM 256 직접 생성 |
| Salt | 16 바이트 랜덤 | 매번 재생성, 재사용 안 함 |
| IV | 16 바이트 랜덤 | 매번 재생성, 재사용 안 함 |
| 직렬화 | 단일 행 JSON | 스트리밍 읽기/쓰기 편의, `.sql.enc` 는 텍스트 에디터로 육안 확인 가능 |

저장 형식(단일 행 JSON):

```json
{ "magic": "SKYLERX-ENC-v1", "salt": "<b64>", "iv": "<b64>", "iter": 200000, "data": "<b64-cipher+tag>" }
```

구현 세부:

- `globalThis.crypto.subtle` 사용, **서드 파티 의존성 없음**; 구 Node 에 subtle 이 없으면 직접 에러 throw 하여 사용자가 런타임 업그레이드;
- `Uint8Array` 는 모두 저변에서 `new ArrayBuffer(n)` 으로 폴백, TS 5.7 + lib.dom 이 `BufferSource` 를 `ArrayBuffer` 백엔드로 좁힌 후 발생하는 타입 에러 우회;
- base64 인코딩은 32 KB 청크로 분할, 큰 파일에서 `String.fromCharCode(...bytes)` 스택 폭발 회피;
- 복호화 시 GCM 검증 실패를 일괄 `WRONG_PASSWORD` 로 변환, 원시 `OperationError` **노출 안 함**, 공격자에게 사이드 채널 회피.

## 3. 가져오기

### 3.1 ImportDialog — CSV / JSON / NDJSON / Excel 전 형식 3단계 마법사

NavTree 우클릭 테이블 → "데이터 가져오기", `ImportDialog.vue` 는 고정 3단계 마법사(`step: 'pick' | 'map' | 'run'`).

#### Step 1 파일 선택

- 메인 버튼 "파일 선택" → `client.files.openText`, filter `csv / txt / json`(JSON 은 `\.json$/i` 또는 첫 글자 `[`/`{` 스니핑으로 자동, `parseJSON` 사용).
- 보조 버튼 "Excel…" → 렌더러 측 `<input type=file>`, `ArrayBuffer` 읽은 후 **필요 시 동적 로드** `xlsx`(SheetJS). 첫 sheet 만 읽음, `raw: false`(Excel 표시값 사용, 날짜가 숫자로 변하지 않음), `defval: ''`. Excel 경로는 텍스트 채널을 거치지 않고(바이너리 경유), 크기가 커도 IPC 막힘 없음.
- 파싱 후 처음 5 행 미리보기, "첫 행 헤더" 체크박스로 수동 전환 가능.

`io.ts::parseCSV` 는 손으로 쓴 상태 기계: BOM 제거, `""` 이스케이프, CRLF / LF, 따옴표 내 쉼표 줄바꿈 지원. 마지막으로 단일 셀이 빈 필드만 있는 "빈 행" 필터.

`io.ts::parseJSON` 은 세 가지 형태 호환:

- **객체 배열**: 키 합집합이 헤더(출현 순서);
- **배열의 배열**: 첫 행이 헤더;
- **단일 객체**: 1 행으로 처리.

#### Step 2 필드 매핑 + 타입 추론

`autoMap()` 은 "소문자화 후 정확 일치" 로 소스/타겟 컬럼 자동 매칭. 각 컬럼에 수동 선택 드롭다운, "스킵" = `-1`.

타입 추론 `inferType(srcIdx)` 은 **해당 컬럼의 처음 50 개 비어 있지 않은 값** 샘플링, 순차 감지:

| 추론 | 정규식 |
|---|---|
| `number` | `/^-?\d+(\.\d+)?$/` |
| `date` | `/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?Z?$/i` |
| `boolean` | `/^(true|false|t|f|y|n)$/i` |
| `string` | 폴백 |

빈 문자열이 있으면 `nullable` 표시, UI 에 `·∅` 표시. **주의**: 타입 추론은 안내일 뿐, 실행 시는 여전히 문자열로 삽입, 실제 cast 는 DB 엔진이 컬럼 정의에 따라 완성 — 이렇게 하면 방언 차이 허용(MySQL `'2024-01-01'` 자동 DATE, SQLite 는 TEXT).

#### Step 3 옵션 + 실행

| 옵션 | 기본값 | 동작 |
|---|---|---|
| TRUNCATE 후 가져오기 | ✗ | `INSERT` 앞에 `TRUNCATE TABLE <ref>` 한 건 삽입; 체크 시 신중, **롤백 불가**(MySQL/PG 의 TRUNCATE 는 모두 DDL) |
| 배치당 행 수 | 200(min 1, max 2000) | `INSERT INTO t (...) VALUES (...), (...), ...` 한 문장의 행 수 제어, 단일 문장이 너무 길어 드라이버에 의해 절단 회피 |

실행은 `client.connections.executeBatch`, 소스 행의 빈 문자열(`''`)은 일률 `NULL` 로 간주(`io.ts::buildInsertStatements` 의 `s == null || s === '' ? 'NULL' : ...`), 따라서 **가져오기 시 "진짜 빈 문자열" 과 "값 없음" 을 구분 못 함**. 엄격히 구분 필요한 시나리오는 SQL 에디터로 수동 작성.

### 3.2 PasteImportDialog — 클립보드 직접 삽입

`PasteImportDialog.vue` 는 ImportDialog 의 라이트 대체: 열면 `navigator.clipboard.readText()`, 파일 선택 불필요.

| 입력 | 파싱 경로 |
|---|---|
| `\t` 포함 | TSV(Excel / 飞书 표 기본 복사 형식), `\t` 로 분할 |
| `\t` 미포함 | 손으로 쓴 CSV 간단 파싱(`""` 이스케이프 지원, 그러나 **복잡한 중첩 따옴표 미처리** — 복잡한 경우 ImportDialog 로 전환) |

타겟 테이블 컬럼은 `information_schema.columns` 에서 실시간 가져옴(MySQL / MariaDB / OB / TiDB / Doris / StarRocks 는 `table_schema + table_name`; PG / 기타는 `table_name + table_catalog`). 자동 정규화 후(`toLowerCase + _-공백 제거`) 매칭, 나머지는 수동 선택, 빈 선택 = 스킵.

실행 배치 크기 고정 `BATCH = 500`, 배치당 한 건 `INSERT INTO ... VALUES (...), (...)` 조립; `sqlLiteral` 간소화 처리: 빈 문자열 → `NULL`, 순수 숫자 그대로, 나머지는 작은따옴표 추가(`'` 더블 이스케이프). **Redis / 문서 DB 등 비 SQL 방언은 사전 필터링**(`dialectKind === DbKind.Sql` 연결만 나열).

적용 시나리오: 飞书/Excel 에서 수십~수천 행 복사하여 즉시 테이블에 붙여넣기. 더 큰 양은 ImportDialog 사용(`executeBatch`) 또는 DataTransferDialog(페이지네이션 경유).

## 4. NDJSON 브라우저(`NdjsonViewerDialog`)

커맨드 팔레트 `act:ndjson-viewer` → `.ndjson` / `.jsonl` 파일 선택 → 표로 보기, **데이터베이스 연결 불필요**.

파싱 규칙(`parse()`):

- 행 단위로 분할, 빈 행/파싱 실패 행 → `skipped` 카운트(중단 안 함);
- dbgate Archives 스타일 `{ __table, data }` 래퍼 인식 → 행은 테이블 `__table` 에 속하고, 데이터는 `data`;
- 오류 마크 `{ __error: "..." }` 인식 → 스킵 카운트 `skipped++`;
- 나머지는 일반 JSON 행으로 간주, `table = ''`.

UI 특성:

- **테이블 간 탭**: 상단에 출현한 `__table` 로 탭 나열, 클릭 시 해당 테이블만 표시;
- **컬럼 합집합**: 모든 가시 행의 `Object.keys` 합집합으로 컬럼 헤더(각 행 필드 불균일 가능, 누락은 `null` 표시);
- **행 상세**: 행 우측 더블 클릭 / 하단으로 완전 JSON 전개;
- **전문 복사 / 다른 이름 저장**: 전체 파일 클립보드 복사 또는 `saveText` 로 다른 이름 저장(원본 파일명 기본 사용);
- **읽기 전용 v1**: 편집 미지원, DB 로 다시 가져오기 미지원, 후속 예정.

## 5. 백업 / 복원(`BackupRestoreDialog`)

커맨드 팔레트 `act:backup:<connId>` → `BackupRestoreDialog`. **MVP 는 순수 SQL 경로**: 외부 `mysqldump` / `pg_dump` 호출 안 함(크로스 플랫폼 경로 감지 번거롭고, 사용자 머신에 없을 수 있음); 후속에 DDL 완전성(trigger / view / FK 순서) 필요 시 IPC 로 `child_process.spawn` 실행.

#### 백업 형식

| 형식 | 구현 | 특징 |
|---|---|---|
| **SQL** | 사용자에게 NavTree 우클릭 "SQL 내보내기" 안내(`doSchemaExport` 재사용) | 전통 경로, `mysql/psql` 클라이언트가 바로 수용 가능 |
| **NDJSON** | 내장 `doBackupNdjson()` | dbgate Archives 스타일, 연결 간 가져오기/내보내기 친화 |

NDJSON 백업 흐름:

1. `metadata({ group: 'tables', path: [database] })` 로 모든 base table 가져옴;
2. 테이블별 `SELECT * FROM <sqlName>`, 각 행을 `{"__table":"t","data":{...}}\n` 으로 기록;
3. 단일 테이블 실패 **중단 안 함**, `{"__table":"t","__error":"..."}` 한 건 기록(복원자가 볼 수 있도록);
4. `saveText` 로 `skylerx-<연결명>-<타임스탬프>.ndjson` 저장, filter 는 `.ndjson / .jsonl` 수용;
5. 전 과정 진행 바(`done / total · phase`) + "⏹ 정지" 버튼(`stopRequested` 는 각 테이블 전에 체크).

알려진 제약: `BLOB / Buffer` 는 `JSON.stringify` 거치면 `{ type: 'Buffer', data: [...] }` 가 됨, **복원 시 바이너리로 돌아오지 않음**; 엄격한 시나리오는 SQL 경로 사용.

#### 복원 흐름

| 경로 | 흐름 |
|---|---|
| SQL | `client.files.openText` → `splitStatements(content)` 로 `;` 분할 → 재확인 → 순차 `execute`, **단일 실패 중단 안 함**, 오류는 `restoreProgress.errors[]` 에 기록(각 처음 200자 자름) |
| NDJSON | `__table` 별 버킷팅 → **버킷당 한 번의 큰 `INSERT`**, 내부에서 `chunkSize = 100` 으로 분할(`max_allowed_packet` 회피) → 동일한 오류 수집 |

UI 에 실시간 진행 바 + 오류 리스트(긴 것 절단 + 줄 바꿈) + 완료 후 `restoreOk / restoreWithErrors / restoreStopped` 3상태 toast.

## 6. 연결 간 데이터 마이그레이션(`DataTransferDialog`)

NavTree 우클릭 테이블 → "데이터 전송". "백업/복원" 보다 좁음: **단일 테이블 대 단일 테이블**, 소스 측 선택 후 시작, 개발 → 프리 프로덕션 데이터 이동에 적합.

| 필드 | 기본값 | 설명 |
|---|---|---|
| 타겟 연결 | 현재 연결 | 드롭다운에 모든 연결, `(현재)` 접미사로 표시 |
| 타겟 database | 소스 ctx | 방언별 의미 다름; PG 는 catalog, MySQL 은 DB |
| 타겟 schema | 소스 ctx | PG/KB 는 필수(기본 `public`), MySQL 은 비움 |
| 타겟 테이블명 | 소스 테이블명 | 존재하지 않으면 삽입 실패; 자동 테이블 생성 안 함 |
| 배치당 행 수 | 500 | 소스 측 `SELECT ... LIMIT ? OFFSET ?` 페이지네이션 크기 제어 |
| 먼저 타겟 TRUNCATE | ✗ | 실제로는 `DELETE FROM <ref>` 실행(`TRUNCATE` 아님, 트랜잭션 롤백 가능) |

실행 루프:

```ts
for (let page = 0; page < 100000; page++) {
  const res = await execute(srcId, `SELECT * FROM ${srcRef}`, [],
    { ..., limit: size, offset: page * size })
  if (!res.rows.length) break
  await executeBatch(tgtId, rowInserts(tgt.dialect, dstRef, cols, res.rows), dstOpts)
  if (res.rows.length < size) break    // 조기 정지
}
```

- 최대 페이지 수 10w 는 데드 루프 폴백;
- 컬럼명은 소스 테이블 `metadata` 에서 가져오므로, **타겟 테이블에 동일 컬럼명이 있어야 함**(순서는 상관없음, `rowInserts` 가 컬럼 리스트 명시);
- 타입 변환은 JS → SQL literal(`io.ts::sqlLiteral`) + 타겟 DB 엔진 암시적 cast 에 위임. 복잡 타입(Postgres `jsonb`, MySQL `BIT(1)`) 은 왜곡 가능성이 있어, 마이그레이션 후 샘플링 spot-check 권장.

## 7. 데이터 사전 내보내기(Markdown / HTML)

NavTree 우클릭 schema(또는 DB) → "데이터 사전 → Markdown / HTML". `Workspace.vue::genDataDict` 가 `dump.ts::buildDataDictMarkdown / buildDataDictHtml` 호출.

테이블당 한 섹션, 필드 표의 컬럼 고정:

| 필드 | 타입 | 널 허용 | 기본 키 | 기본값 | 코멘트 |
|---|---|---|---|---|---|
| `id` | `bigint unsigned` | N | 🔑 | | 사용자 기본 키 |
| `email` | `varchar(255)` | Y | | `NULL` | 이메일 |

데이터 출처: `metadata({ group: 'columns' })` 가 반환하는 `MetadataNode.detail.{dataType, nullable, primaryKey, defaultValue, comment}`.

#### Markdown 과 HTML 의 차이

| 차원 | Markdown | HTML |
|---|---|---|
| 이스케이프 | `|` → `\|`, 줄바꿈 → 공백 | `&<>` 엔티티 |
| 목차 | 없음(IDE 아웃라인 사용) | 3 열 TOC, 앵커 링크 `#t-<urlencoded>` |
| 레이아웃 | 순수 Markdown | 인라인 `<style>`, 고정 sans-serif, 표 보더, 홀짝 행 얼룩, `@media print` 로 section 페이지 넘어가지 않도록 방지 |
| 적용 | 문서 라이브러리 / Wiki / GitLab 에 임베드 | 브라우저로 열어 바로 PDF 인쇄 |

파일명 `<schema-or-db>-data-dict.md|html`. **완전 오프라인** 생성 — 데이터 사전은 컴플라이언스 감사 시나리오에서 가장 일반적인 요구, 단절 환경에서도 실행 가능.

## 8. 데이터 비교(`DataDiffDialog`)

커맨드 팔레트 `act:data-diff`. **두 연결 × 두 테이블 → 행 단위 diff → 동기화 SQL**.

핵심 알고리즘은 `data-diff.ts::diffRows`(순수 함수, 단위 테스트 가능):

```ts
diff = {
  inserts: Row[],            // 소스에 있음 / 타겟에 없음
  updates: RowUpdate[],      // 기본 키 동일, 비키 컬럼 다름
  deletes: Row[]             // 타겟에 있음 / 소스에 없음
}
```

매칭 키(`keyCols`):

- 기본은 소스 테이블 `information_schema.table_constraints + key_column_usage` 에서 **기본 키** 가져옴(MySQL / PG 공통 SQL);
- 사용자가 `keyColsInput`(쉼표 구분) 수동 입력 / 수정으로 오버라이드 가능.

값 비교 `same(a, b)` 는 **문자열 정규화** 사용: `null/undefined` 동등 빈 값, 나머지 `String(a) === String(b)` — 드라이버 차이 허용(`MySQL2` 는 `BigInt` 반환, `pg` 는 `Number` 반환, SQLite 는 `string` 반환).

지원 매트릭스: **MySQL 패밀리(MySQL / MariaDB / OB) + PostgreSQL 패밀리(PG / KingbaseES) 만**; 기타 방언(SQLite / Oracle / SQL Server / Redis 등)은 UI 에 "MyPg 에만 일시적" 경고 표시, 버튼 회색 처리.

실행 결과:

| 지표 | 의미 |
|---|---|
| `inserts` | 타겟을 소스에 맞게 보충 |
| `updates` | 타겟을 소스와 일치하도록 변경(실제 다른 컬럼만 SET) |
| `deletes` | 타겟의 잉여 행, **마지막 섹션에 출력 + 코멘트 추가** "타겟에만 존재; 확인 후 실행", 실수 삭제 회피 |

마지막으로 `generateDataSync` 가 가독성 있는 SQL 로 조립, "복사" 또는 "쿼리 페이지에서 열기" 가능, 타겟 연결에서 실행 — dry-run / human-review 윈도우 제공.

`LIMIT`(기본 2000)으로 메모리 폭발 방지, 기본 키 차이가 많을 때는 먼저 범위를 좁혀야 함.

## 9. 보안(요약)

상세는 [보안 모델](./troubleshooting.md) 참고. 이 장 관련 핵심:

- **Workspace 내보내기 기본 비밀번호 미포함**; 체크 시 평문 JSON, UI 에 빨간색 "⚠" 명시 경고;
- **`.sql.enc` 암호화 내보내기** 는 AES-256-GCM, 비밀번호 오류와 파일 변조는 동일 오류 부여, 사이드 채널 누설 안 함;
- NDJSON 백업 **마스킹 안 함**; 진짜 마스킹은 생성 시 PII Scanner 실행 또는 SQL 에디터에서 수동 `SELECT replace(...)` 작성;
- 가져오기/내보내기의 임시 데이터는 **메모리에만**, 중간 파일 쓰지 않음, 다이얼로그 닫으면 즉시 해제.

## 10. 호환성 매트릭스

| 능력 | MySQL 패밀리 | PG 패밀리 | SQLite | Oracle | SQL Server | DM / KingbaseES | Redis | MongoDB |
|---|---|---|---|---|---|---|---|---|
| CSV/TSV/JSON/MD 복사 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| SQL VALUES/INSERT 복사 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| 테이블/Schema SQL 내보내기 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| `.skylerxws` 전량 내보내기 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `.sql.enc` 암호화 내보내기 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ImportDialog(CSV/JSON/Excel) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | RedisImportExport 사용 | NDJSON 경로 사용 |
| 클립보드 가져오기 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| NDJSON 브라우저 | DB 비의존 | DB 비의존 | — | — | — | — | — | — |
| 백업/복원 SQL 경로 | ✓ | ✓ | ✓ | 부분 | ✓ | ✓ | — | — |
| 백업/복원 NDJSON 경로 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| 연결 간 데이터 마이그레이션 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| 데이터 사전(MD/HTML) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| 행 단위 데이터 비교 + 동기화 SQL | ✓ | ✓ | ✗ | ✗ | ✗ | ✓(KB) | — | — |

"✗" 는 현재 명시적으로 회색 처리; "—" 는 해당 방언에 무의미(KV / 문서 DB 는 별도 `RedisImportExportDialog` 사용).

## 트리거 방법 빠른 조회

| 작업 | 툴바 | 우클릭 메뉴 | ⌘K 커맨드 팔레트 | 단축키 |
|---|---|---|---|---|
| 결과를 CSV / TSV / ... 로 복사 | — | 결과 그리드 → 복사 형식 → ... | — | — |
| 테이블 SQL 내보내기 | — | NavTree 테이블 노드 → SQL 내보내기 | — | — |
| Schema SQL 내보내기 | — | NavTree schema 노드 → SQL 내보내기 | — | — |
| Workspace 내보내기 | 상단 톱니바퀴 → 내보내기 | — | `Workspace 내보내기`(`act:export-conns`) | — |
| Workspace 가져오기 | 상단 톱니바퀴 → 가져오기 | — | `Workspace 가져오기`(`act:import-conns`) | — |
| 데이터 가져오기(CSV/JSON/Excel) | — | NavTree 테이블 노드 → 데이터 가져오기 | — | — |
| 클립보드 가져오기 | — | — | `PasteImport`(상단 메뉴 트리거) | — |
| NDJSON 파일 보기 | — | — | `NDJSON 브라우저`(`act:ndjson-viewer`) | — |
| 백업 / 복원 | — | — | `백업/복원 · <연결>`(`act:backup:<id>`) | — |
| 데이터 전송 | — | NavTree 테이블 노드 → 데이터 전송 | — | — |
| 데이터 사전 | — | NavTree schema/DB → 데이터 사전 → MD / HTML | — | — |
| 데이터 비교 | — | — | `데이터 비교`(`act:data-diff`) | — |

팁: 모든 "다른 이름으로 저장" 동작은 저변에 동일한 커스텀 `SaveFileDialog`(`packages/ui/src/components/SaveFileDialog.vue`) 사용 — macOS / Windows / Linux 에서 완전 일관, **시스템 네이티브 다이얼로그 호출 안 함**; 즐겨찾기, 최근 디렉터리, ↑↓ 항목 선택, Enter 저장, ⌘L 주소 바 포커스 지원.
