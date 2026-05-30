# 보안 및 컴플라이언스

SkylerX 는 dev / test / prod 세 가지 환경을 동시에 대상으로 하며, **연결 자격 증명에서 결과 셋 렌더링, SQL 제출에서 일괄 내보내기** 까지 엔드 투 엔드 보안 모델을 내장합니다. 이 페이지는 코드에 실제 구현된 각 방어선이 무엇을 하고, 무엇을 하지 않으며, 운영과 컴플라이언스 감사에 어떤 증거를 제공할 수 있는지 명확히 설명합니다.

## 1. 개요

SkylerX 의 보안 모델은 "데이터 흐름" 에 따라 5단계로 나뉘며, 각 단계마다 전용 코드가 뒷받침됩니다.

| 단계 | 모듈 / 파일 | 주요 책임 |
|---|---|---|
| 자격 증명 저장 | `apps/desktop/src/main/db/connectionStore.ts` | 비밀번호 / SSH 개인 키를 OS 키체인(Electron `safeStorage`)으로 암호화하여 저장 |
| 환경 인식 | `packages/ui/src/connEnv.ts` | dev / test / prod 3색 마킹 + 읽기 전용 연결 + 읽기 문 화이트리스트 |
| 문장 인터셉트 | `packages/ui/src/sqlLint.ts` | 7가지 휴리스틱 룰(WHERE 없는 UPDATE/DELETE, prod 에서 DROP/TRUNCATE 등) |
| 데이터 표현 | `packages/ui/src/masking.ts` + `DataMaskingViewDialog` | 컬럼명 패턴 매칭 → 렌더링 시 마스킹 + DB 에 저장되는 마스킹 뷰 |
| 거버넌스 / 감사 | `compliance.ts` / `PiiScannerDialog` / `DataContractDialog` / `export-encrypt.ts` | 중국 보안 등급 보호 컴플라이언스 검사, PII 스캔, 데이터 계약, 암호화 내보내기 |

아래 코드 사실 기반으로 단계별 설명.

## 2. 연결 비밀번호 암호화(OS 키체인)

코드 위치: `apps/desktop/src/main/db/connectionStore.ts`

연결 생성 / 편집 시, 비밀번호는 평문으로 SQLite 에 저장되지 않고, Electron 의 `safeStorage`(macOS = Keychain, Windows = DPAPI, Linux = libsecret / kwallet)를 사용:

```ts
function encryptPassword(plain?: string): string | null {
  if (!plain) return null
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(plain).toString('base64')}`
  }
  return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
}
```

저장 필드는 일률 접두사를 포함하여 후속 버전 식별 용이:

| 접두사 | 의미 | 출현 시점 |
|---|---|---|
| `enc:` | OS 키체인 암호문 | 정상 경로, macOS / Windows / 대부분 Linux |
| `plain:` | base64 폴백(**dev 에만 사용**) | `safeStorage.isEncryptionAvailable()` 가 `false` 반환 시, 일반적으로 노출 Linux 컨테이너, libsecret / kwallet 누락 |
| 기타 | 구 버전의 접두사 없는 호환 필드 | 이력 데이터 |

> **중요:** `plain:` 보이면 SkylerX 는 여전히 동작하지만, **평문과 동등**. Linux 에 `gnome-keyring` 또는 `kwallet` 설치 권장, 사용자가 연결을 다시 한 번 편집하도록(저장 시 재암호화 트리거).

### SSH 터널 키

SSH 설정은 `password` / `privateKey` / `passphrase` 3개 항목 포함, 전체가 동일한 암호화 체인 사용. **리스트 조회 시(`listConnections`) 키 필드를 적극적으로 제거**, 메모리에서 중복 보유 회피:

```ts
function decryptSsh(stored, withSecrets) {
  const ssh = JSON.parse(decryptPassword(stored)) as SshConfig
  return withSecrets
    ? ssh
    : { ...ssh, password: undefined, privateKey: undefined, passphrase: undefined }
}
```

실제 연결 시작 / 편집 폼 채우기(`getConnection`) 시에만 전체 키와 함께 반환.

## 3. 환경 라벨 dev / test / prod + 프로덕션 보호

코드 위치: `packages/ui/src/connEnv.ts`

연결 설정의 `extra.env` 필드가 3상 enum 저장:

| 값 | UI 라벨 | 색상 (`ENV_META.color`) | 기본 엄격도 |
|---|---|---|---|
| `dev` | 개발 | `#4caf50` 녹색 | 표준 |
| `test` | 테스트 | `#e0a020` 주황 | 표준 |
| `prod` | 프로덕션 | `#e04050` 빨간색 | **추가 SQL 룰 + 실행 전 재확인 트리거** |

### 전체 연결 읽기 전용(`extra.readOnly`)

읽기 전용 연결은 `connReadOnly()` 로 마킹. SkylerX 는 두 곳에서 독립적으로 검사:

1. **전체 연결 레벨**: `isReadOnlyStatement(sql)` 가 첫 키워드 화이트리스트(`select` / `with` / `show` / `explain` / `desc(ribe)` / `pragma`)로 쓰기 문 인터셉트, 화이트리스트에 없으면 일률 서버로 발송 금지.
2. **커밋 모드**: 읽기 전용 연결은 `auto` commit 강제(수동 트랜잭션이 읽기 전용 연결에는 무의미); `initialCommitMode()` 참조.

### 프로덕션 워터마크

`Settings → 프로덕션 워터마크` 에서 문구 / 각도 / 투명도 / 색상 커스터마이징 가능, prod 연결의 모든 뷰(SQL 에디터, 결과 셋, 내보내기 미리보기)에 SVG 워터마크 오버레이, 스크린샷 확산 방지.

## 4. SQL Linter — 7개 내장 룰

코드 위치: `packages/ui/src/sqlLint.ts`

휴리스틱 순수 문자열 스캔, 완전한 parser 안 함, "명백히 위험한" 패턴만 매치. 결과 3단계:

| Severity | UI 피드백 | 여전히 실행? |
|---|---|---|
| `error` | 모달 재확인 | 사용자가 확인 클릭해야 실행 |
| `warn` | toast 안내 | **실행됨**(안내만) |
| `info` | 호출자 결정(에디터 사이드 바에 아이콘 부착 가능) | 실행됨 |

전체 룰 표:

| 룰 ID | Severity | 트리거 조건 | 안내 |
|---|---|---|---|
| `no-where-update` | error | `UPDATE` 시작 + `WHERE` 없음 | UPDATE 에 WHERE 절 누락, 전체 테이블 업데이트됨 |
| `no-where-delete` | error | `DELETE FROM` + `WHERE` 없음 | DELETE 에 WHERE 절 누락, 전체 테이블 비워짐 |
| `prod-drop` | error | 연결 env=prod + `DROP TABLE/DATABASE/SCHEMA/INDEX/VIEW` | 프로덕션 환경에서 DROP XXX 실행 |
| `prod-truncate` | warn | 연결 env=prod + `TRUNCATE` | 프로덕션 환경에서 TRUNCATE 실행 |
| `cross-join` | warn | `SELECT` + `FROM a, b`(쉼표 JOIN) 또는 `JOIN` 에 `ON/USING` 없음 | 다중 테이블 쿼리에 조인 조건 미지정(카테시안 곱 의심) |
| `select-star` | info | `SELECT *` | SELECT * 는 명시적 컬럼 나열 권장 |
| `forgotten-limit` | info | `SELECT` 에 `LIMIT` / `FETCH FIRST` / `TOP n` / `COUNT()` 없음 | SELECT 에 LIMIT 없음, 대량 데이터 반환 가능 |

### 룰의 "저렴한" 제약

코멘트 제거는 가장 단순한 두 정규식(`/\/\*[\s\S]*?\*\//g` 와 `/--[^\n]*/g`)으로, `-- WHERE 1=1` 같은 가짜 WHERE 가 linter 를 속이지 않도록 보장. 모든 룰은 O(n) 문자열 스캔, 실행 핫 패스에서 실행해도 사용자를 늦추지 않음.

### 다중 문 집계

`lintStatements(stmts, ctx)` 가 같은 id 의 finding 을 severity 최고로 한 번만 보존, "SQL 파일 한 단락 복사하여 전체 선택 실행" 시나리오에 적합.

## 5. 데이터 계약(notNull / range / regex)

코드 위치: `packages/ui/src/components/DataContractDialog.vue`

데이터 계약은 "비즈니스 필드에 나오지 않아야 할 값" 을 사전에 매립. 한 계약은 4부분으로 구성:

| 필드 | 타입 | 설명 |
|---|---|---|
| `name` | string | 사용자가 정한 계약명 |
| `table` | string | 적용 가능한 `schema.table` |
| `notNull` | `string[]` | 이 컬럼들은 NULL 불가 |
| `range` | `Record<string, [min, max]>` | 숫자 범위, `null` 은 무한 |
| `regex` | `Record<string, string>` | 컬럼 값이 매치해야 하는 정규식 |
| `enabled` | boolean | 활성화 스위치 |

저장은 `localStorage.skylerx.dataContracts`, JSON 배열.

### 전형적 사용법

```json
{
  "name": "사용자 테이블 무결성",
  "table": "public.users",
  "notNull": ["phone", "email"],
  "range": { "age": [0, 150] },
  "regex": { "email": "^[^@]+@[^@]+$", "phone": "^1\\d{10}$" },
  "enabled": true
}
```

### 가져오기 / 내보내기

- **📋 내보내기** 클릭 → JSON 을 클립보드로 복사, 팀 공유 문서 / git 저장소에 붙여넣기 가능
- **📥 가져오기** 클릭 → JSON 붙여넣어 현재 리스트 덮어쓰기

이렇게 DBA 가 계약을 작성한 후, 팀 / 프로젝트별로 개발자에게 배포하면, 로컬 SkylerX 에 떨어진 후 자동 적용.

## 6. 민감 필드 스캔(PII Scanner)

코드 위치: `packages/ui/src/components/PiiScannerDialog.vue`

2단계 휴리스틱: **컬럼명 매칭 → 샘플링 검증**.

### 컬럼명 매칭 단계

`DEFAULT_MASK_RULES`(다음 절 참조) 의 `columnPattern` 정규식 사용. 예: 컬럼명 `user_phone` 이 `(phone|mobile|tel|手机|电话)` 매치, `phone` 으로 분류.

### 샘플링 검증 단계(선택)

매치된 컬럼에서 처음 N 행 가져옴(기본 50, 10-1000 으로 변경 가능), 정규식으로 2차 확인:

| kind | 샘플링 검증 정규식 |
|---|---|
| `phone` | `/^\+?[\d\s\-()]{7,20}$/` |
| `email` | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `idCard` | `/^\d{15}$\|^\d{17}[\dxX]$/` |
| `bankCard` | `/^\d{12,19}$/` |
| `name` / `address` / `default` | 없음, 컬럼명만 사용 |

매치율 < 30% 면 "컬럼명 우연, 실제 PII 아님" 으로 간주, 보고서에서 제외.

### 보고서와 다음 단계

보고서는 "매치 수 내림차순" 으로 테이블별 그룹화, **📋 CSV 내보내기**(컬럼: schema/table/column/data_type/rule/kind/sample) 가능. CSV 는 컴플라이언스 감사에 바로 제공 가능; 또는 DB 우클릭 → "마스킹 뷰 생성" 으로 이 컬럼들에 마스킹 뷰 생성도 가능.

## 7. 데이터 마스킹 뷰(DataMaskingViewDialog)

코드 위치: `packages/ui/src/masking.ts` + `packages/ui/src/components/DataMaskingViewDialog.vue`

### 7.1 내장 마스킹 룰

`DEFAULT_MASK_RULES` 는 룰 기준선, 사용자가 `Settings → 데이터 마스킹` 에서 삭제 / 수정 / 커스텀 룰 추가 가능.

| 룰명 | columnPattern | kind | 기본 활성화 | 알고리즘 |
|---|---|---|---|---|
| 전화번호 | `(phone\|mobile\|tel\|手机\|电话)` | phone | ✅ | 처음 3 + `****` + 마지막 4 |
| 이메일 | `(email\|mail\|邮箱)` | email | ✅ | 첫 글자 + `***@domain` |
| 신분증 | `(id_?card\|身份证\|idno)` | idCard | ✅ | 처음 6 + `*…` + 마지막 4 |
| 은행 카드 | `(bank_?card\|card_?no\|账号\|账户)` | bankCard | ✅ | 처음 4 ` **** **** ` 마지막 4 |
| 이름 | `(real_?name\|user_?name\|full_?name\|姓名)` | name | ❌ | 첫 글자 + `*`(나머지 숨김) |
| 주소 | `(address\|addr\|地址)` | address | ❌ | 처음 6 글자 + `***` |
| 비밀번호 / Token | `(password\|passwd\|secret\|pwd\|token\|api_?key\|密码)` | default | ✅ | 처음 2 + `****` + 마지막 2 |

### 7.2 렌더링 시 마스킹 vs. DB 마스킹 뷰

SkylerX 는 두 가지 독립 마스킹 경로 제공:

- **렌더링 시 마스킹**: `Settings → 데이터 마스킹 → 활성화`. 프론트가 컬럼명 → 룰 → 알고리즘으로 즉시 마스킹, **DB 미변경**, 내보내기 시 내보내기 다이얼로그에서 "원문 / 마스킹" 선택 가능.
- **DB 마스킹 뷰**(`DataMaskingViewDialog`): `CREATE OR REPLACE VIEW ... AS SELECT mask_expr(c) ...` SQL 생성하여 DB 에 적용, **애플리케이션은 뷰를 통과하며 원본 테이블을 직접 읽지 않음**. 6가지 전략 사용 가능:

| 전략 | 생성된 SQL 표현식(MySQL 예) |
|---|---|
| `raw` 원본 | `` `c` AS `c` `` |
| `md5` | `` md5(CAST(`c` AS char(4000))) AS `c` `` |
| `partial` 앞 N 뒤 M | `` CONCAT(LEFT(`c`,N), '***', RIGHT(`c`,M)) AS `c` `` |
| `fixed` 교체 | `'***' AS \`c\`` |
| `truncate` 자르기 | `` LEFT(`c`, max) AS `c` `` |
| `null` | `` NULL AS `c` `` |

다이얼로그가 열릴 때 컬럼명별로 `recommendStrategy(colName)` 호출하여 추천 제시; 사용자가 컬럼별로 오버라이드 가능. 생성 SQL 은 수동 편집 후 실행 가능(▶ 뷰 생성 클릭).

## 8. 중국 보안 등급 보호 2.0 (GB17859) 컴플라이언스 검사

코드 위치: `packages/ui/src/compliance.ts` + `packages/ui/src/components/ComplianceDialog.vue`

"데이터베이스 연결로 직접 검증 가능" 한 항목 위주, 방화벽 / 디스크 암호화 같은 OS 레이어는 다루지 않음. 결과 4상:

| Severity | 의미 |
|---|---|
| `pass` ✅ | 컴플라이언스 충족 |
| `warn` ⚠️ | 비충족이지만 위험 통제 가능(예: 감사 미활성, SSL 꺼짐) |
| `fail` ❌ | 심각한 위반(예: root 원격 개방, 빈 비밀번호 사용자) |
| `unknown` — | 판정 불가(권한 부족, 상용 버전 전용 기능) |

### MySQL 계열(MySQL / MariaDB / OceanBase / TiDB) — 7개

| ID | 대분류 | 제목 | 탐지 방식 |
|---|---|---|---|
| `mysql.auth.password-policy` | 신원 인증 | 강한 비밀번호 정책 강제 사용 | `SHOW VARIABLES LIKE 'validate_password%'`, policy ≥ MEDIUM 그리고 length ≥ 8 |
| `mysql.audit.enabled` | 보안 감사 | 감사 로그 활성화 | `audit_log_*`(엔터프라이즈) 또는 `server_audit_*`(MariaDB) |
| `mysql.auth.root-remote` | 액세스 제어 | root 원격 로그인 불허 | `SELECT user, host FROM mysql.user WHERE user='root'` |
| `mysql.auth.anonymous` | 액세스 제어 | 익명 사용자 미존재 | `mysql.user WHERE user=''` |
| `mysql.transport.ssl` | 데이터 무결성 | SSL 전송 강제 | `require_secure_transport=ON` |
| `mysql.audit.slowlog` | 보안 감사 | 슬로우 쿼리 로그 활성화 | `slow_query_log=ON` |
| `mysql.integrity.binlog` | 데이터 무결성 | binlog 활성화 | `log_bin=ON`(시점 복구 / 마스터-슬레이브 복제 전제) |

### PostgreSQL 계열(PG / KingbaseES / openGauss / Greenplum / CockroachDB) — 6개

| ID | 대분류 | 제목 | 탐지 방식 |
|---|---|---|---|
| `pg.auth.password-encryption` | 신원 인증 | 비밀번호 암호화 알고리즘이 SCRAM-SHA-256 사용 | `SHOW password_encryption` |
| `pg.audit.pgaudit` | 보안 감사 | pgaudit 감사 익스텐션 설치됨 | `pg_extension WHERE extname='pgaudit'` |
| `pg.transport.ssl` | 데이터 무결성 | SSL 활성화 | `SHOW ssl` |
| `pg.access.superuser-count` | 액세스 제어 | 슈퍼유저 수 통제됨(≤ 2) | `SELECT rolname FROM pg_roles WHERE rolsuper` |
| `pg.audit.log-statement` | 보안 감사 | log_statement 설정됨 | `SHOW log_statement` ≠ none |
| `pg.auth.empty-password` | 신원 인증 | 빈 비밀번호의 로그인 가능 사용자 미존재 | `pg_authid WHERE rolpassword IS NULL AND rolcanlogin` |

### Markdown 보고서 내보내기

**Markdown 내보내기** 클릭으로 `renderReport()` 호출, 대분류별 그룹화, "요약: ✅ N · ⚠️ N · ❌ N · — N" 통계 행 첨부 + 각 룰의 설명 / 결론 / `evidence` 원시 증거. 파일명은 연결명 + 타임스탬프 자동 적용: `compliance-<safeName>-<YYYY-MM-DDTHH-MM-SS>.md`.

### 동시 실행

"검사 시작" 클릭으로 `Promise.all` 이 모든 룰을 병렬로 실행, 실패가 다른 항목에 영향 안 줌(`try/catch` 폴백으로 `unknown`), 드라이버 레이어가 자체 큐잉 / 연결 재사용.

### 기타 방언

비 MySQL / PG 계열은 자리표시자 항목 진입:

```
현재 방언은 컴플라이언스 검사를 제공하지 않습니다 — 수동 확인 필요
```

후속에 필요 시 Oracle / SQL Server / SQLite / 达梦 룰 보충.

## 9. 중국 국가 암호 SM2 / SM3 / SM4(계획 중)

컴플라이언스 룰 셋에는 이미 "`password_encryption=md5` 가 중국 국가 암호 / 보안 등급 보호에서 약한 알고리즘으로 간주" 를 경고 판정 기준으로(`pg.auth.password-encryption` 설명 참조). SM2 / SM3 / SM4 보조 API(데이터 DB 적용 전 애플리케이션 레이어에서 중국 국가 암호 서명 / 암호화) 는 현재 **미공개**, v0.6 에서 독립 `cryptoCn.ts` 도구 모듈 제공 계획:

- SM2 타원 곡선 서명 / 암복호화(sm-crypto 기반)
- SM3 메시지 다이제스트
- SM4 대칭 블록 암호화(CBC / ECB)

인터페이스 시그니처 안정화 후 이 페이지 "중국 국가 암호 보조 API" 절에 보충.

## 10. 암호화 내보내기 .skbk

코드 위치: `packages/ui/src/export-encrypt.ts`

임의의 텍스트(보통 SQL dump 또는 연결 설정)를 비밀번호로 암호화하여 단일 행 JSON 파일로, 확장자 `.sql.enc` / `.skbk`.

### 알고리즘 스택

| 단계 | 알고리즘 | 파라미터 |
|---|---|---|
| 키 파생 | PBKDF2-HMAC-SHA-256 | iter = `DEFAULT_ITER` = **200 000**(조정 가능, 헤더에 기록) |
| 암호화 | AES-GCM 256 | salt 16 바이트 + iv 16 바이트, 매번 재생성 |
| 무결성 | AES-GCM 내장 128-bit auth tag | 비밀번호 오류 / 파일 변조 → 복호화 시 직접 `WRONG_PASSWORD` throw |
| 파일 헤더 | `magic: 'SKYLERX-ENC-v1'` | 알고리즘 / 파라미터 업그레이드 시 버전 식별 |

> **PBKDF2 iter 200 000 선정의 트레이드오프**: OWASP 2023 은 SHA-256 ≥ 600 000 권장, 그러나 데스크톱 클라이언트는 구 머신 고려 필요(Atom CPU 에서 600k 는 1+초 멈춤), 절충. 내보내는 내용이 극도로 민감하면, `encryptText` 호출 시 iter 필드를 수동으로 인상 가능.

### 직렬화 형식

```json
{
  "magic": "SKYLERX-ENC-v1",
  "salt": "<base64 16B>",
  "iv":   "<base64 16B>",
  "iter": 200000,
  "data": "<base64 ciphertext + tag>"
}
```

필드 순서 고정, git diff 편의; 단일 행 JSON, 스트리밍 읽기/쓰기 편의.

### 오류 코드

| 오류 | throw 시점 | UI 피드백 |
|---|---|---|
| `INVALID_BLOB` | 파싱 시 필드 누락 / 타입 불일치 / `magic` 불일치 | "파일 형식 손상" 안내 |
| `WRONG_PASSWORD` | AES-GCM auth tag 검증 실패(비밀번호 오류 / 파일 변조) | "비밀번호 오류" 안내(두 경우 구분 안 함, 원시 오류 누설 회피) |

### Web Crypto 의존성

구현은 통합으로 `globalThis.crypto.subtle` 사용, 서드 파티 의존성 도입 안 함. 데스크톱 Electron 렌더러 레이어 + 현대 브라우저 모두 직접 지원; Node 18+ 도 실행 가능(테스트용). 매우 오래된 환경은 `Web Crypto API unavailable: upgrade to Node 18+ or a modern browser` throw.

## 11. AI 프라이버시 경계

AI 어시스턴트(Anthropic / OpenAI / DeepSeek / Codex / Grok) 는 SkylerX 의 핵심 강화 기능이지만, 서드 파티 API 로 보내는 것은 **컨텍스트 필수 사항에 한정**:

| 유형 | 전송? | 비고 |
|---|---|---|
| 현재 SQL 텍스트 | ✅ | 사용자가 능동적으로 대화 / 완성 트리거하는 전제 |
| 현재 schema hint(DB / 테이블 / 컬럼명) | ✅ | 메타데이터만, **행 데이터 전송 안 함** |
| 오류 정보 본문 + 오류 코드 | ✅ | "AI 에게 묻기" 진단용, `AI` 문서 4절 참조 |
| 연결 메타 정보(방언 / 연결명 / DB 명) | ✅ | AI 가 올바른 방언 선택하도록 |
| **결과 셋 행 데이터** | ❌ | 사용자가 AI 인라인 완성 켜도, schema hint 만 보내고, SELECT 반환 행은 안 보냄 |
| **연결 비밀번호 / SSH 개인 키** | ❌ | OS 키체인의 암호문은 결코 안내용으로 읽혀지지 않음 |
| **로컬 연결 설정 전체** | ❌ | 현재 선택된 연결의 dialect / database 만 취득 |

AI 를 완전히 격리하려면:

1. `Settings → AI Provider → API Key 비우기` → 인라인 완성 / 채팅 / AI 에게 묻기 진입점 전부 비활성화
2. 또는 로컬 endpoint 사용(Ollama / vLLM / 프라이빗 배포), `endpoint` 필드를 `http://localhost:...` 로 지정

> **AI 알림 webhook 동일 원칙**: 알림 본문에 기본으로 "제목 + 요약 + 트리거 시간" 만 포함, SQL 행 데이터 첨부 안 함. 구체적으로 `Settings → 알림` 의 템플릿에서 변경 가능.

## 12. 보안 관련 빠른 진입점 일람

| 작업 | 진입점 |
|---|---|
| 보안 등급 보호 컴플라이언스 검사 | ⌘K → "중국 보안 등급 보호 2.0 컴플라이언스 검사 · 연결명" / 연결 우클릭 → 컴플라이언스 검사 |
| PII 스캔 | DB 우클릭 → PII 스캐너 |
| 마스킹 뷰 생성 | DB / 테이블 우클릭 → 마스킹 뷰 생성 |
| 데이터 계약 | ⌘K → "데이터 계약" / 도구 → 데이터 계약 |
| 암호화 내보내기 | 결과 셋 / SQL 에디터 → 내보내기 → `.skbk` 선택 |
| 모든 연결의 보안 정책 | `Settings → 데이터 마스킹` / `Settings → 프로덕션 워터마크` |
| 커스텀 단축키(오 터치 방지) | `Settings → 키 바인딩` |

## 13. 알려진 제약

코드 사실 측면에서 DBA 에게 알려야 할 경계:

- **SQL Linter 는 휴리스틱**: 완전한 SQL parser 안 함, 문자열 스캔이 극소수 케이스에서 누락 가능(예: 중첩 `/* ... */` 코멘트 + 문자열 리터럴에 `where` 키워드 출현). 고위험 작업은 prod 재확인(연결명 입력) 동시 활성화 권장.
- **컴플라이언스 검사는 해당 읽기 권한 필요**: `mysql.user` 표는 SELECT 권한 필요, `pg_authid` 는 슈퍼유저 필요, 권한 부족 항목은 `unknown` 으로 떨어지지 `fail` 아님, **unknown 을 pass 로 간주하지 말 것**.
- **마스킹 렌더링은 UI 레이어에서만**: 데이터베이스에는 여전히 원문. "애플리케이션이 원문을 읽는 것" 을 철저히 막으려면 DB 마스킹 뷰 + DB 계정 권한 축소.
- **암호화 내보내기 파일 자체는 "무차별 사전 공격"을 막지 않음**: 200k 라운드 PBKDF2 가 ~10^7 양급의 비용을 제공하지만, 약한 비밀번호는 여전히 오프라인 깨질 수 있음. 파일에 강한 비밀번호 부여하거나, 팀 내에서 KMS / 공개 키 배포 사용.
- **환경 라벨은 소프트 제약**: `extra.env = 'prod'` 는 연결 저장 시 사용자가 직접 입력; 사용자가 실수로 `dev` 선택하면, prod 전용 룰은 트리거 안 됨. 팀 레벨에서 "연결 설정 내보내기 → 동료 가져오기" 로 이 필드 표준화 권장.
