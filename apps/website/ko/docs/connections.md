# 연결 관리

## 새 연결 생성

⌘N / Ctrl+N 또는 좌측 상단 "새 연결" 버튼 → 폼 표시.

### 기본 필드(모든 방언)

| 필드 | 설명 |
|---|---|
| 연결 이름 | 표시용, 임의 |
| 방언 | 데이터베이스 유형(MySQL / PG / Oracle / ...) |
| 호스트 | hostname 또는 IP |
| 포트 | 방언별로 자동 입력(MySQL 3306 / PG 5432 / Oracle 1521 ...) |
| 사용자 | 사용자 이름 |
| 비밀번호 | 비워두고 저장 가능, 첫 연결 시 다시 묻습니다 |
| 데이터베이스 | 기본 연결 DB / schema, 비울 수 있음 |
| 그룹 | 연결 트리 루트 레이어의 폴더, 여러 환경 관리에 편리 |
| 환경 라벨 | dev / test / prod — prod 는 [프로덕션 보호](#프로덕션-보호) 를 트리거합니다 |

### 방언별 전용 필드

#### Oracle / OB Oracle 테넌트

| 필드 | 설명 |
|---|---|
| Service Name | 기본 XEPDB1, 컨테이너 `gvenzl/oracle-free` 의 경우 FREEPDB1 |
| privilege | SYSDBA / SYSOPER / SYSASM / SYSBACKUP / SYSDG / SYSKM / SYSRAC, 일반 연결은 비움 |

> **SYSDBA 로그인** 시 Oracle 은 보통 CDB 루트(`FREEPDB1` 대신 `FREE`)에 연결합니다.

#### Snowflake

| 필드 | 설명 |
|---|---|
| Account | `xy12345.us-east-1` 같은 Snowflake 식별자 |
| Warehouse | 컴퓨트 웨어하우스 |
| Role | 기본 역할 |
| Schema | 기본 schema |
| Authenticator | 기본 password, 또는 `snowflake_jwt` 개인 키 |
| Private Key Path | 개인 키 PEM 파일(JWT 모드일 때 표시) |
| Private Key Passphrase | 개인 키 패스워드(있는 경우) |

#### MongoDB

선택적 **URI 직접 입력 모드**: `mongodb://user:pass@host:27017/db?replicaSet=rs0`, 입력 후에는 host/port/user/password 가 무시됩니다.

#### SQLite / DuckDB

host/port/user 가 필요 없고, **데이터베이스 파일 경로**만 필요합니다.
- 옆에 "찾아보기..." 버튼이 있어 시스템 파일 선택 대화상자를 호출합니다
- 존재하지 않는 파일명 선택 허용(새 DB 자동 생성)
- 빈 값 → 메모리 모드 `:memory:`(앱 종료 시 소실)

#### ClickHouse

| 필드 | 설명 |
|---|---|
| URL | 전체 URL(`https://user:pass@host:8443/...`), 입력하면 host/port 무시 |
| Show System Databases | 기본적으로 `system` / `information_schema` DB 숨김 |

#### Redis

host/port/password/dbIndex 만 필요합니다. SkylerX 가 자동으로 16개 논리 DB(db0..db15)를 펼칩니다.

#### H2

**PG-server 모드**만 지원합니다. H2 시작 시 `-pg` 파라미터를 추가해야 합니다.

```bash
java -cp h2-2.x.x.jar org.h2.tools.Server \
  -pg -pgPort 5435 -ifNotExists -baseDir ./data
```

그 후 연결: Host=localhost, Port=5435, User=`sa`, Password=비움.

## SSH 터널

데이터베이스가 점프 호스트 뒤에 있나요? **SSH 탭** 으로 전환 → SSH 터널 활성화:

- SSH 호스트 / 포트 / 사용자
- 인증: **비밀번호** 또는 **개인 키**(`~/.ssh/id_rsa` 등) 중 택일
- 개인 키 패스워드(암호화된 경우)

SkylerX 가 자동으로 SSH 터널을 열고 그것을 통해 데이터베이스에 연결합니다.

## SSL / TLS

**SSL 탭** 으로 전환 → SSL 활성화:

- 서버 인증서 검증 여부
- CA / 인증서 / 키(PEM 텍스트 붙여넣기 또는 파일 선택)

## Manual Commit 수동 커밋 모드

`Settings → 전역 기본 커밋 모드` 또는 **연결별 → 고급 → 커밋 모드**:

- `auto`(기본): 각 SQL 즉시 커밋
- `manual`: 사용자가 "커밋 / 롤백" 을 명시적으로 눌러야 하며, SkylerX 가 트랜잭션 유지를 위한 영구 연결을 고정

데이터 복구 / 중요 마이그레이션 시나리오에 적합하며, **프로덕션 연결은 manual 강력 권장**.

## 연결 테스트

폼 하단 "연결 테스트" 버튼 → 실시간 피드백:
- ✅ 성공 + 서버 버전 + 왕복 지연 시간 표시
- ❌ 실패 + 오류 코드 + 자동 분류("연결 거부" / "DNS" / "타임아웃" / "인증" / "SSL" 등) + 조치 단계

테스트 실패 다이얼로그에서 **"✨ AI 에게 묻기"** 클릭 → 오류 + 연결 메타 정보를 AI 어시스턴트에게 자동 전달.

## 프로덕션 보호(`env=prod`)

prod 로 마킹된 연결은 추가 보호를 받습니다.

- 트리 루트 레이어에 빨간색 배지 `[prod]` 표시
- `DROP TABLE / DATABASE / INDEX` / `TRUNCATE` / WHERE 없는 `UPDATE/DELETE` 실행 시, **연결 이름 입력을 강제**하여 계속 진행
- AI 가 prod 에서는 더 보수적으로 답변(기본 SELECT-only 스타일)

환경 라벨 판정은 **순수 로컬 설정**이며, 데이터베이스 자체에는 영향을 주지 않습니다.

## 비밀번호 암호화 저장

비밀번호는 OS 키체인으로 암호화됩니다.

- **macOS**: Keychain Access
- **Windows**: DPAPI(현재 사용자 로그인 상태 기반)
- **Linux**: Secret Service(GNOME Keyring / KWallet)

만약 키체인을 사용할 수 없는 경우, base64 인코딩으로 폴백됩니다(명확히 `plain:` 접두사로 표시, **안전하지 않음 경고**). **프로덕션 환경에서는 키체인이 사용 가능한지 강력히 권장**.

## 그룹 관리

각 연결은 하나의 **그룹** 아래에 묶을 수 있고(선택), 루트 트리가 그룹별로 접힙니다.

```
📁 개발 환경
   ├── 로컬 MySQL
   └── 로컬 PostgreSQL
📁 테스트 환경
   └── 테스트 OceanBase
📁 프로덕션 환경  ⚠
   └── prod-mysql [prod]
```

연결 추가 시 "그룹" 필드에 이름을 입력하면 됩니다(Enter 로 확정).

## 다중 창(여러 연결을 병렬로 쿼리)

⌘⇧N / Ctrl+Shift+N 으로 새 SPA 창 열기 → 동일한 설정 저장소를 로드, 두 창이 각자 연결하며 서로 간섭하지 않습니다.

"왼쪽은 prod, 오른쪽은 staging 비교 쿼리" 같은 시나리오에 적합합니다.

## 연결 삭제

연결 우클릭 → 삭제 → 재확인 → SQLite 에서 레코드 삭제 + Keychain 동기 정리.

데이터베이스 자체는 **영향 없음**, 삭제는 SkylerX 측의 연결 설정만 사라집니다.
