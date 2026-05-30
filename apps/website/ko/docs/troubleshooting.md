# 트러블슈팅 및 호환성

## 연결 실패 자주 발생하는 문제

### `ECONNREFUSED` — 연결 거부

- 데이터베이스 프로세스가 실행되지 않았거나 포트가 잘못됨
- 확인: `nc -zv <host> <port>` 또는 `telnet`
- Docker 컨테이너: `docker ps` 로 Up 여부 + 포트 매핑이 맞는지 확인

### `ETIMEDOUT` — 타임아웃

- 방화벽 / 보안 그룹 / VPN 차단
- SSH 터널 시나리오: 점프 호스트 미연결

### `Authentication failed` — 인증 실패

- 사용자 이름 / 비밀번호 오류
- MySQL `caching_sha2_password` 호환성 문제 — mysql2 업그레이드 또는 `mysql_native_password` 로 변경
- PG `pg_hba.conf` 가 해당 출처를 허용하지 않음

### Oracle `ORA-12541: TNS:no listener`

- Oracle 컨테이너가 완전히 시작되지 않았거나 LISTENER 미등록
- 1-2 분 대기 후 재시도
- service name 이 올바른지 확인(기본 XEPDB1, `gvenzl/oracle-free` 는 FREEPDB1)

### Oracle `ORA-00900: invalid SQL statement near 'v'`(OceanBase 연결 시)

- 이는 **OceanBase Oracle 테넌트** 의 특징 — `VERSION()` 함수가 Oracle 모드에 존재하지 않음
- SkylerX v0.5+ 에서 수정됨(`SELECT 1 FROM DUAL` 사용으로 변경)
- 구 버전: 최신으로 업그레이드

### Oracle `ORA-01950: insufficient quota on tablespace USERS`

새로 만든 Oracle 사용자가 quota 가 없으면, 삽입 / 테이블 생성이 모두 실패합니다. **수정**:

```sql
-- SYSDBA 로 연결하여 실행
ALTER USER "your_username" QUOTA UNLIMITED ON USERS;
-- 또는 더 철저히
GRANT UNLIMITED TABLESPACE TO "your_username";
```

> ⚠️ Oracle 은 기본적으로 따옴표 없는 식별자를 대문자로 변환합니다. 사용자 이름이 큰따옴표로 감싼 소문자(`"test"`)일 경우, 이후 ALTER 도 반드시 큰따옴표 + 원본 대소문자를 사용해야 합니다.

### MongoDB ObjectId 편집 불가

- 편집 그리드에서 `_id` 필드 수정이 실패 — IPC 직렬화 후 ObjectId 가 문자열이 되며, driver 가 자동 wrap 하지 않음
- SkylerX v0.5+ 에서 수정됨: driver 레이어가 24-hex 문자열 _id 를 자동 감지하여 ObjectId 로 wrap
- 구 버전: 진짜 ObjectId 기본 키 컬렉션은 임시로 mongosh 사용하여 편집

## 오류 코드 빠른 조회

### MySQL / MariaDB / TiDB / Doris / StarRocks

| errno | 의미 | 일반적인 원인 |
|---|---|---|
| 1045 | Access denied | 사용자 이름 / 비밀번호 오류 |
| 1049 | Unknown database | 데이터베이스 미존재 |
| 1054 | Unknown column | 컬럼 이름 오타 |
| 1062 | Duplicate entry | 유니크 인덱스 충돌 |
| 1064 | SQL syntax error | 구문 오류 |
| 1146 | Table doesn't exist | 테이블 미존재 / DB 선택 오류 |
| 1213 | Deadlock | 데드락, 재시도 |
| 1264 | Out of range value | 컬럼 타입이 값을 담을 수 없음 |
| 2002 | Can't connect via socket | 호스트 / 포트 오류 |
| 2003 | Can't connect to MySQL server | 연결 거부 |
| 2013 | Lost connection during query | 서버 측 크래시 / 타임아웃 |

### PostgreSQL / 호환 방언(KingbaseES / openGauss / CockroachDB / Greenplum / Redshift / H2)

5자리 SQLSTATE:

| code | 의미 |
|---|---|
| 23505 | unique violation |
| 23502 | not null violation |
| 23503 | foreign key violation |
| 42P01 | undefined table |
| 42703 | undefined column |
| 42601 | syntax error |
| 28000 | invalid authorization |
| 08001 | unable to connect |
| 40001 | serialization failure(재시도) |
| 53300 | too many connections |

### Oracle / OB Oracle 테넌트 / DM 达梦

ORA-xxxxx 시리즈:

| code | 의미 |
|---|---|
| 00900 | invalid SQL statement |
| 00904 | invalid identifier |
| 00911 | invalid character |
| 00942 | table or view does not exist |
| 01017 | invalid username/password |
| 01950 | no privileges on tablespace |
| 12541 | TNS no listener |
| 12514 | service not found |
| 28000 | account locked |

## 성능 저하

### 큰 결과 셋 멈춤

- 기본 페이지 크기가 너무 큰가? 200-500 행으로 줄이면 가상 스크롤이 자동으로 활성화됨
- 컬럼이 너무 많은가? 불필요한 컬럼을 숨김(컬럼 헤더 우클릭 → 숨김)

### 네트워크 지연 큼

- 원격 연결이 느림: SSH 터널 압축 / 점프 호스트를 가까이 배치
- AI 가 느림: 더 가까운 provider region 으로 전환(deepseek.com 이 중국 내에서 빠름)

### SkylerX 시작 느림

- `Settings → 시작` 확인 → "자동으로 업데이트 확인" 해제
- macOS: `xattr -d com.apple.quarantine /Applications/SkylerX.app` 로 격리 속성 제거

## 데이터 보안 / 프라이버시

- 비밀번호 암호화 — OS 키체인 사용(macOS Keychain / Win DPAPI / Linux Secret Service)
- AI 는 기본적으로 **데이터를 전송하지 않음**, schema hint 만 전송
- 모든 연결 / SQL 이력 / 스니펫 / 설정은 로컬 SQLite 에 저장
- 어떤 통계 / 텔레메트리도 업로드하지 않음

## 업그레이드 자주 발생하는 문제

### 자동 업데이트 실패

- 네트워크 문제: 수동으로 [Releases](https://github.com/duhbbx/SkylerX/releases) 에서 새 버전 다운로드하여 설치
- 권한 문제: macOS 앱이 쓰기 권한이 없을 경우, 관리자 권한으로 재설치

### 업그레이드 후 연결 / 설정 손실

**발생하지 않아야 합니다**. 로컬 SQLite 는 버전 간 호환됩니다. 만약 발생하면 **구 버전 데이터 디렉터리를 삭제하지 말고**, 먼저 [Issue 등록](https://github.com/duhbbx/SkylerX/issues), 보통 경로 마이그레이션 문제입니다.

## 버그 제출

위 모든 것으로 해결되지 않으면:

1. 앱의 임의의 오류 다이얼로그에서 "**✨ AI 에게 묻기**" 클릭하여 AI 가 위치를 찾을 수 있는지 확인
2. 여전히 해결되지 않으면 → [GitHub Issues](https://github.com/duhbbx/SkylerX/issues/new)
3. Issue 에 첨부:
   - SkylerX 버전(`Help → About`)
   - 운영 체제 + 버전
   - 데이터베이스 유형 + 버전
   - 재현 단계
   - 전체 오류 정보

## 엔터프라이즈 협력 / 프라이빗 배포

- 신촹 환경 심층 적응(龙芯 / 飞腾 / 鲲鹏)
- 중국 국가 암호 컴플라이언스 / 보안 등급 보호 배포
- 데이터베이스 마이그레이션 컨설팅(Oracle → 达梦 / KingbaseES)
- 인트라넷 커스텀 버전

연락처: `duhbbx@gmail.com` · WeChat `tuhoooo`
