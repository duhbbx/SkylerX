# 빠른 시작

다운로드부터 첫 쿼리 성공까지 5분.

## 1. 다운로드 및 설치

[다운로드 페이지](/ko/download)로 이동하여 해당 플랫폼의 설치 패키지를 선택합니다.

- **macOS**: `.dmg` 파일을 Applications 로 드래그
- **Windows**: `.exe` 설치 마법사, 계속 Next 클릭
- **Linux**: `.AppImage`(설치 불필요, `chmod +x` 후 바로 실행) 또는 `.deb` / `.rpm`(`sudo dpkg -i` / `sudo rpm -ivh`)

첫 실행 시 로컬 설정 저장소(SQLite, OS 표준 사용자 데이터 디렉터리에 위치)가 자동으로 초기화됩니다.

## 2. 첫 연결 생성

앱 실행 → 좌측 상단 "새 연결"(⌘N / Ctrl+N) → 방언 선택.

### MySQL / PostgreSQL 등 주요 방언

| 필드 | 예시 |
|---|---|
| 연결 이름 | 로컬 개발 DB |
| 방언 | MySQL |
| 호스트 | 127.0.0.1 |
| 포트 | 3306(MySQL 기본값) |
| 사용자 | root |
| 비밀번호 | (당신의 비밀번호) |
| 데이터베이스 | (선택, 비우면 연결 후 선택) |
| 환경 라벨 | dev / test / prod |

"연결 테스트" 클릭 → 성공 후 "저장" 클릭.

### Oracle / OB Oracle 테넌트

Oracle 은 Service Name 을 입력해야 합니다(기본 `XEPDB1`, 컨테이너 `gvenzl/oracle-free` 의 경우 `FREEPDB1`).

| 필드 | 예시 |
|---|---|
| 방언 | Oracle |
| 호스트 | 127.0.0.1 |
| 포트 | 1521 |
| 사용자 | system |
| 비밀번호 | oracle |
| 데이터베이스 / Service | FREEPDB1 |
| 고급 → privilege | (비움 = 일반) 또는 SYSDBA / SYSOPER 등 |

### 중국 국산 신촹 데이터베이스

- **达梦 DM**: 포트 5236, `dmdb` npm 패키지 설치 필요(`pnpm -F @db-tool/desktop add dmdb`)
- **人大金仓 KingbaseES**: 포트 54321(기본값), PG 호환으로 추가 드라이버 불필요
- **openGauss**: PG 호환으로 추가 드라이버 불필요
- **OceanBase**: 포트 2881, mysql2 사용 — Oracle 테넌트도 이 방언 사용

자세한 필드 설명은 [연결 관리 →](/ko/docs/connections)

## 3. 네비게이션 트리 탐색

연결 목록에서 **연결 더블 클릭** → 좌측 네비게이션 트리가 자동으로 펼쳐집니다.

```
📦 로컬 개발 DB (MySQL)
  └── 📁 mydb
       ├── 📁 테이블 (12)
       │    ├── users
       │    ├── orders
       │    └── ...
       ├── 📁 뷰 (3)
       ├── 📁 함수 (1)
       └── 📁 저장 프로시저 (0)
```

**테이블명 더블 클릭** → 기본적으로 데이터 그리드 열림(SELECT 처음 200 행, [Settings → 기본 페이지 크기] 에서 변경 가능).

## 4. SQL 작성 및 실행

- 툴바에서 "새 쿼리" 또는 ⌘T / Ctrl+T 로 새 SQL 탭 열기
- Monaco 에디터가 테이블명 / 컬럼명 / 키워드를 자동 완성
- ⌘+Enter / Ctrl+Enter 로 실행(선택 영역이 있으면 선택만 실행)
- 결과는 아래 그리드에 표시

### 자주 쓰는 단축키 몇 개

| 동작 | macOS | Windows / Linux |
|---|---|---|
| 커맨드 팔레트 | ⌘K | Ctrl+K |
| 전역 객체 검색 | ⌘⇧O | Ctrl+Shift+O |
| SQL 실행 | ⌘+Enter | Ctrl+Enter |
| SQL 포매팅 | ⌘⇧F | Ctrl+Shift+F |
| AI 채팅 패널 토글 | ⌘⇧L | Ctrl+Shift+L |
| 새 창(두 번째 세션 열기) | ⌘⇧N | Ctrl+Shift+N |

모든 단축키는 `Settings → 키 바인딩` 에서 커스터마이징할 수 있습니다.

## 5. AI 어시스턴트 설정(선택)

`Settings → AI Provider` → 지원하는 provider 중 하나 추가:

- Anthropic(Claude 시리즈)
- OpenAI(GPT-4 / o1 시리즈)
- DeepSeek
- Codex
- Grok / xAI

API Key 입력 후 바로 사용 가능:
- 우측 채팅 패널(⌘⇧L 토글)
- 에디터 내 인라인 자동 완성(Copilot 스타일)
- 임의의 오류 다이얼로그에서 "✨ AI 에게 묻기" 클릭으로 자동 위치 찾고 수정
- 7개 전문 Toolbox(마이그레이션 작성 / 튜닝 / EXPLAIN 해석 / 테스트 데이터 생성 / 자연어 → SQL / 코멘트 작성 / 테이블 용도 해석)

## 6. 심화 체험

- [SQL 에디터 심층 이해](/ko/docs/query) — 자동 완성 / 스니펫 라이브러리 / EXPLAIN
- [결과 셋 그리드](/ko/docs/grid) — 편집 모드 / 필터 / 컬러링 / 내보내기
- [AI 어시스턴트](/ko/docs/ai) — provider 설정 / 메모리 시스템 / Toolbox 상세
- [트러블슈팅 및 호환성](/ko/docs/troubleshooting) — ORA-xxx / SQLSTATE 일반 오류 자동 위치 찾기

## 문제가 있나요?

- 임의의 앱 오류 다이얼로그에서 "**✨ AI 에게 묻기**" 클릭 — SQL + 오류 정보 + 연결 메타 정보를 자동으로 AI 에게 전달
- 그래도 해결되지 않으면: [GitHub Issues](https://github.com/duhbbx/SkylerX/issues)
