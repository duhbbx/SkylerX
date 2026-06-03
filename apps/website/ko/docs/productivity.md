# 생산성 도구

SkylerX 는 "DBA / 백엔드의 일상 30초 - 30분 단위 고빈도 동작" 을 모두 **키보드 / 커맨드 팔레트 / 알림** 이라는 3대 줄기로 연결합니다, 목표는 클릭 수와 창 전환 수를 줄이는 것. 이 페이지는 "가장 자주 쓰는 진입점" 순서로 나열, 각 도구는 코드 사실과 소스 파일과 대응됩니다.

## 1. 개요

| 도구 | 진입점 | 해결하는 문제 |
|---|---|---|
| 커맨드 팔레트 ⌘K | 전역 / `Settings → 키 바인딩` | 모든 것을 여기서 검색 → 메뉴 네비게이션 스킵 |
| 전역 객체 검색 ⌘⇧O | 전역 | 다중 DB 에 걸쳐 fuzzy 로 테이블 / 뷰 / 컬럼 검색 → 원클릭으로 네비게이션 트리 위치 |
| SQL 스니펫 라이브러리 | 에디터 우측 서랍 / `★` 버튼 | 쿼리 즐겨찾기 재사용, `{{var}}` 템플릿 동반 |
| 쿼리 이력 | 에디터 우측 서랍 | 시간 / 소요 시간 정렬, 슬로우 쿼리 빨간색 표시 |
| 즐겨찾기 | ⌘K → "즐겨찾기" / 툴바 | 테이블 / 뷰 / 쿼리 빠른 재방문 |
| 커스텀 단축키 | `Settings → 키 바인딩` | 12개 명령 임의 재바인딩 + 충돌 감지 |
| Dashboard | ⌘K → "Dashboard" | 다중 SQL 다중 카드 "오늘 상태 보드" |
| Webhook 알림 | `Settings → 알림` | 钉钉 / 飞书 / Slack / 범용, 슬로우 쿼리 + 오류 푸시 |
| 다중 창 ⌘⇧N | 파일 → 새 창 | 동일 앱, 두 개 독립 세션(로컬-로컬 / 로컬-원격 비교) |

---

## 2. 커맨드 팔레트 ⌘K

코드 위치: `packages/ui/src/components/CommandPalette.vue` + `packages/ui/src/Workspace.vue`(아이템 소스 / 라우팅)

⌘K(mac) / Ctrl+K(Win/Linux) 누름 → 상단에 떠 있는 검색 박스 → 키워드 입력으로 필터 → ↑↓ 선택 → Enter 실행. Esc 로 닫기.

### 검색 메커니즘

```ts
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q
    ? props.items.filter((it) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(q))
    : props.items
})
```

- label + hint(연결 hint 는 방언명) 매치, 순수 부분 문자열 includes, **병음 / 순서 매치 불필요**(타이핑 속도가 fuzzy 보다 중요)
- 최대 50건 표시(긴 리스트 멈춤 회피)

### 내장 명령 리스트

아래 표는 `Workspace.vue` 의 `paletteItems` 계산 속성의 전량(액션 + 연결별 전용 액션 + 모든 연결 항목):

| 전역 액션 ID | 라벨 | 등가 경로 |
|---|---|---|
| `act:new-conn` | 연결 생성 | 툴바 + |
| `act:object-search` | 전역 객체 검색 | ⌘⇧O |
| `act:schema-diff` | Schema 비교 | 도구 → Schema diff |
| `act:data-diff` | 데이터 비교 | 도구 → Data diff |
| `act:privileges` | 권한 관리 | 연결 우클릭 → 권한 |
| `act:settings` | 설정 | ⌘, |
| `act:export-conns` / `act:import-conns` | 연결 설정 가져오기 / 내보내기 | 파일 메뉴 |
| `act:refresh` | 네비게이션 트리 새로고침 | F5 |
| `act:favorites` | 즐겨찾기 | 툴바 ⭐ |
| `act:oplog` | 작업 로그 | 툴바 |
| `act:monitor` | 모니터링 패널 | 툴바 |
| `act:dashboard` | Dashboard | 도구 → Dashboard |
| `act:ndjson-viewer` | NDJSON 뷰어 | 툴바 |
| `act:contracts` | 데이터 계약 | 도구 → 데이터 계약 |
| `act:o2dm` | Oracle → DM 마이그레이션 마법사 | 툴바 |
| `act:mig-assess` | 마이그레이션 평가(소스 DB 프로파일링 + 등급 + AI 변환 + 내보내기) | Oracle/DM 연결 우클릭 |
| `act:translate` | SQL 번역(방언 간) | 툴바 |
| `act:notif` | 알림 webhook 설정 | `Settings → 알림` |
| `act:keybind` | 커스텀 단축키 | `Settings → 키 바인딩` |
| `act:drift` | Schema 드리프트 감지 | 툴바 |
| `act:ai-chat` / `act:ai` / `act:ai-toolbox` | AI 채팅 / AI 어시스턴트 / AI 도구 상자 | ⌘⇧L |
| `act:about` / `act:shortcuts` | 정보 / 단축키 레퍼런스 | 도움말 메뉴 |
| `act:new-window` | 새 창(데스크톱 전용) | ⌘⇧N |

### 연결별 전용 액션

다음 액션은 "기존의 각 연결" 별로 한 행으로 전개되며, 라벨 접미사는 `· 연결명 · 방언`:

| ID 접두사 | 의미 |
|---|---|
| `act:activity:` | 서버 활동(processlist / pg_stat_activity) |
| `act:obtopo:` | OceanBase 클러스터 토폴로지(OB 방언만 가시) |
| `act:snapshots:` / `act:backup:` | Schema 스냅샷 / 백업 복원 |
| `act:health:` / `act:vqd:` | AI 헬스 체크 / 비주얼 쿼리 빌더 |
| `act:slowq:` / `act:idxrec:` / `act:repl:` | 슬로우 쿼리 분석 / 인덱스 추천 / 마스터-슬레이브 지연 |
| `act:compliance:` / `act:search-value:` | 컴플라이언스 검사 / 테이블 간 전체 검색 |
| `act:aicmt:` | AI 코멘트 작성 |
| `conn:` 접두사 | 연결 직접 열기(그룹 = "연결") |

> 5개 연결의 워크스페이스에서 커맨드 팔레트가 80+ 건의 명령 검색 가능; group 라벨 + 부분 문자열 includes 필터, 3-4 글자 입력으로 위치 결정 가능.

### 확장 방법

코드는 `paletteItems` 계산 속성에 집중. 명령 추가는 두 단계: 배열에 한 건 `{ id, label, group }` 추가, `onPaletteSelect()` 에 `else if (item.id === ...)` 라우팅 추가. "연결별 전개" 가 필요하면 `act:compliance:` 방식 참고: `.map(c => ({ id: \`act:xxx:${c.id}\`, ... }))`, 라우팅에서 `item.id.startsWith()` 로 id 분할.

---

## 3. 전역 객체 검색 ⌘⇧O

코드 위치: `packages/ui/src/components/ObjectSearchDialog.vue`

⌘⇧O(mac) / Ctrl+Shift+O(Win/Linux) 로 다이얼로그 팝업, 선택된 연결에서 **DB / schema 를 가로지르는 fuzzy 테이블, 뷰, 컬럼 검색**.

### 검색 SQL

`information_schema` 사용, MySQL 계열 / PG 계열 두 SQL 셋:

| 방언 패밀리 | 제외 schema | 이스케이프 패턴 |
|---|---|---|
| MySQL 계열 | `mysql / information_schema / performance_schema / sys` | `LIKE '%term%'`, `%_\\` 3글자 이스케이프 |
| PG 계열 | `pg_catalog / information_schema` | `ILIKE '%term%'` |
| 기타 | — | 미지원, 수동 검색 안내 |

각 분류(테이블 / 뷰 / 컬럼)별로 처음 100건 가져옴; 입력 280ms 디바운스.

### 결과 동작

- **행 클릭 = reveal**: `reveal` 이벤트 emit, Workspace 가 받아서 좌측 네비게이션 트리에서 해당 객체 위치 결정 및 선택(대응 DB 가 아직 전개되지 않았으면 끝까지 전개)
- **호버 시 "미리보기" 버튼 노출**: `preview` emit, `SELECT * FROM schema.table LIMIT 200` 직접 열기(방언의 식별자 quote 사용)
- **아이콘**: `▦` 테이블 / `◫` 뷰 / `·` 컬럼

### 동시성 안전

매 입력마다 `seq` 번호 자동 증가, "최신" 결과만 commit, 빠른 입력 시 구 응답이 새 응답을 덮어쓰는 것 회피.

---

## 4. SQL 스니펫 라이브러리

코드 위치: `packages/ui/src/snippets.ts` + `packages/ui/src/components/SnippetsPanel.vue`

### 데이터 구조

```ts
interface Snippet {
  id: string        // `${timestamp}-${rand5}`
  name: string      // 사용자가 정한 이름, 비어 있으면 SQL 처음 40자 사용
  sql: string
  tags?: string[]   // 분류 태그, UI 에서 # 으로 필터
  dialects?: DbDialect[]  // 방언 제한, 빈 값 = 범용
  createdAt: number
}
```

`localStorage.skylerx.snippets` 에 저장, Vue `reactive` + `watch deep` 으로 실시간 저장.

### 추가 / 삭제

- 임의의 SQL 에디터 우클릭 → "스니펫으로 저장" 또는 툴바 `★`
- 쿼리 이력 각 행의 `★` 버튼 → 즐겨찾기를 스니펫으로 직접 저장
- `Settings → 에디터 → 스니펫 저장` 기본 바인딩 ⌘S(변경 가능)

### 자리표시자 템플릿

스니펫 내 `{{var}}` 는 삽입 시 prompt 팝업으로 사용자가 입력:

```sql
SELECT * FROM {{table}} WHERE id = {{id}}
```

`applySnippetVars()` 가 출현 순서로 자리표시자 추출, 항목별로 박스 팝업; 어느 단계든 취소 → 전체 포기, 반제품 SQL 삽입 안 함.

### 방언별 필터

`snippetsForDialect(dialect)` 가 패널에서 현재 에디터 연결 방언에 따라 자동 필터:

- `dialects = []` 또는 미설정 → 임의 방언에서 모두 보임("범용")
- `dialects = [MySQL, MariaDB]` → MySQL / MariaDB 연결에서만 출현

PG 연결에서 MySQL 전용 구문 무더기를 보는 것 회피.

### 패널 상호 작용

| 작업 | 효과 |
|---|---|
| 상단 검색 박스 | name + SQL + tags 부분 문자열 필터 |
| 태그 바 `#xxx` 클릭 | 태그로 필터; 재클릭 취소 |
| 스니펫 행 더블 클릭 | 자리표시자 적용 후 에디터에 삽입 |
| `×` | 해당 스니펫 삭제(확인 안 함) |

---

## 5. 쿼리 이력

코드 위치: `packages/ui/src/components/HistoryPanel.vue`

매 실행 성공 / 실패마다 로컬 SQLite 에 레코드 한 건 기록, 필드 포함: `sql / executedAt / durationMs / success / pinned / tags / note`.

### 정렬 + 필터

| 컨트롤 | 설명 |
|---|---|
| 검색 박스 | sql + tags + note 부분 문자열 스캔 |
| 정렬 드롭다운 | `시간 내림차순`(기본) / `소요 시간 내림차순` |
| `≥ N ms` | 슬로우 쿼리 필터, 임계값 초과 행 **전체 빨간색**(기본 500ms) |
| `📌` | 핀 고정만 보기 |
| `비우기` | 전체 표 원클릭 비우기 |

핀 고정은 항상 맨 위(`pinned: 1` 가 상단 강제), 기타는 사용자 선택 정렬.

### 행 작업

| 버튼 | 동작 |
|---|---|
| `📌` | 핀 토글 |
| `🏷` | tags 변경(쉼표 구분, 예: `daily,prod,join`) |
| `📝` | note 변경(자유 텍스트 비고) |
| `★` | SQL 스니펫으로 저장(`saveSnippet` emit) |
| 행 더블 클릭 | SQL 을 현재 에디터로 로드 |

모든 메타 정보 수정은 `client.connections.historyMeta(id, patch)` 로 SQLite 에 떨어짐, localStorage 안 거침.

### 슬로우 쿼리 연동 알림

`Settings → 알림 → 전역 트리거 → 슬로우 쿼리 임계값 (ms)`(`settings.slowQueryNotifyMs`). 0 아닌 값 설정 후, 이 임계값 초과 실행은 모두 `notify('slow-query', ...)` 트리거 → 대응 webhook 채널.

---

## 6. 즐겨찾기

코드 위치: `packages/ui/src/favorites.ts`

즐겨찾기는 3가지 `kind` 가능:

| kind | 의미 | 클릭 동작 |
|---|---|---|
| `table` | 데이터 테이블 | 네비게이션 트리로 reveal 및 처음 200 행 미리보기 |
| `view` | 뷰 | 위와 동일 |
| `query` | 커스텀 SQL | 현재 / 새 탭에서 초안으로 열기 |

### 기본 키 룰

- 객체 류: `${connId}|${sqlName}`, 동일 연결에서 동일 객체는 한 번만 즐겨찾기, toggle 재클릭으로 취소
- 쿼리 류: `q|${connId}|${createdAt}|${rand4}`, 동일 SQL 여러 번 즐겨찾기 허용(시나리오: 동일 쿼리의 다른 시점 "스냅샷")

### 그룹 태그

`setFavoriteTag(id, tag)` 가 단일 즐겨찾기에 태그 부착, 패널에서 tag 별로 접어서 표시. 한 즐겨찾기는 첫 tag 만 취득, 단순 무식하게 충분.

### 영속화

`localStorage.skylerx.favorites`, reactive + watch deep.

### 쿼리 이력에서 원클릭 즐겨찾기

`addQueryFavorite({ connId, connName, dialect, name, sql, tags })` 는 "쿼리를 실행했고, 이 값 보존할 만함" 의 빠른 경로 준비. HistoryPanel 의 `★` 버튼은 snippet 경로, 툴바의 "현재 쿼리 즐겨찾기" 는 이 함수 경로.

---

## 7. 커스텀 단축키(K1)

코드 위치: `packages/ui/src/keybindings.ts` + `packages/ui/src/components/KeyBindingsDialog.vue`

진입점: `Settings → 키 바인딩` / 커맨드 팔레트 → "커스텀 단축키".

### 12개 바인딩 가능 명령

| ID | 기본 chord | 용도 |
|---|---|---|
| `run-sql` | `CmdOrCtrl+Enter` | SQL 실행 |
| `palette` | `CmdOrCtrl+K` | 커맨드 팔레트 |
| `object-search` | `CmdOrCtrl+Shift+O` | 전역 객체 검색 |
| `ai-chat` | `CmdOrCtrl+Shift+L` | AI 채팅 패널 토글 |
| `new-conn` | `CmdOrCtrl+N` | 연결 생성 |
| `new-query` | `CmdOrCtrl+T` | 쿼리 생성 |
| `close-tab` | `CmdOrCtrl+W` | 탭 닫기 |
| `find` | `CmdOrCtrl+F` | 에디터 찾기 |
| `replace` | `CmdOrCtrl+H` | 에디터 바꾸기 |
| `format-sql` | `CmdOrCtrl+Shift+F` | SQL 포매팅 |
| `save-snippet` | `CmdOrCtrl+S` | 현재 SQL 을 스니펫으로 저장 |
| `settings` | `CmdOrCtrl+,` | 설정 |

### `CmdOrCtrl` 의 렌더링 규약

| 플랫폼 | 리터럴 `CmdOrCtrl+Shift+K` 가 표시되는 형태 |
|---|---|
| macOS | `⌘⇧K`(시스템 메뉴 스타일, 연결로 `+` 없음) |
| Windows / Linux | `Ctrl+Shift+K` |

저장은 일률 `CmdOrCtrl+...` OS 비의존 문자열, 렌더링은 플랫폼별 매핑; `formatChord()` 가 수행.

### 녹화 흐름

1. 명령 행의 "녹화" 클릭 → 행이 녹화 상태로 진입, 보이지 않는 `input`(`position: absolute; left: -9999px`) 렌더링하여 키보드 포커스 가져옴
2. `keydown` 리스닝, `chordFromEvent(e)` 가 현재 조합 키 파싱:
   - 수정자 키 순서 고정 `CmdOrCtrl → Shift → Alt`(문자열 동등 ↔ chord 리터럴 동등 보장)
   - 단일 글자 강제 대문자, 공백은 `Space`, 기타 `Enter` / `,` / `ArrowUp` 원형
   - 노출 수정자 키(Shift 만 누르고 메인 키 안 누름)는 빈 문자열 반환
3. Enter 로 저장 / Esc 로 취소 / 빈 draft 일 때 Backspace 는 "이 명령 비활성화" 의미(빈 문자열로 저장)

### 충돌 감지

`conflicts` 계산 속성이 병합된 바인딩(녹화 상태의 `draftChord` 포함)을 한 번 스캔, 두 명령이 동일 chord 에 바인딩되어 있으면 행 끝에 빨간색 안내 `"XX 명령과 충돌"`, 사용자가 현장에서 확인.

### 저장 + "기본값 복원"

"기본값과 다른" 항목만 `settings.keyBindings`(`Record<string, string>`)에 떨어짐.

- 기본값으로 되돌리기 → 오버라이드에서 자동 삭제, 저장 컴팩트 유지
- "전체 기본값 복원" → `settings.keyBindings` 비움, 재확인 동반
- "어떤 명령 비활성화" = 빈 문자열 작성, **key 보존** 하지만 값 `''`

---

## 8. Dashboard — 다중 SQL 다중 카드

코드 위치: `packages/ui/src/components/DashboardDialog.vue`

진입점: 도구 메뉴 → Dashboard / ⌘K → "Dashboard".

### 카드 구조

```ts
interface Card {
  id: string
  title: string
  connId: string
  sql: string
  lastRunAt?: number
  lastResult?: QueryResult | null
  lastError?: string | null
}
```

- `localStorage.skylerx.dashboard.cards` 에 영속화, 그러나 **`lastResult` 저장 안 함**(매우 클 수 있음), 재오픈 시 비움
- 각 행에 제목 + 연결명 + SQL 미리보기(200자 자름) + 최근 5 행 결과(60자 자름) 표시

### 작업

| 버튼 | 동작 |
|---|---|
| `+ 카드 추가` | 작은 폼 팝업: 제목 + 연결 + SQL(textarea 4 행) |
| `↻ 전체 새로고침` | `Promise.all(cards.map(runCard))` 동시 실행 |
| 카드 헤더 `↻` | 단일 카드 새로고침 |
| 카드 헤더 `✎` | 편집 폼 진입 |
| 카드 헤더 `×` | 삭제(확인 동반) |

### 하지 않는 것(의도적 트레이드오프)

- **타이머 새로고침 안 함**: 잊고 백그라운드에서 죽도록 실행되기 쉬움, 필요 시 수동으로 ↻ 클릭
- **차트 안 함**: "→ ChartDialog 점프" 가 더 명확한 "보고 싶을 때 보기" 경로
- **공유 / 협업 안 함**: v0.5 이전 미공개, 클라우드 서비스 의존성 도입 회피

---

## 9. Webhook 알림

코드 위치: `packages/ui/src/notifications.ts` + `packages/ui/src/components/NotificationSettingsDialog.vue`

진입점: `Settings → 알림` / ⌘K → "알림 webhook".

### 4가지 채널

| Channel | URL 형태 | 서명 |
|---|---|---|
| `dingtalk` | 钉钉 봇 webhook | HMAC-SHA256(`ts\n${secret}`, key=`secret`), query 에 `?timestamp=&sign=urlencoded(...)` 조립 |
| `feishu` | 飞书 봇 webhook | HMAC-SHA256(빈 data, key=`ts\n${secret}`), sign 을 body 필드에 |
| `slack` | Slack incoming webhook | 서명 없음(URL 이 자격) |
| `webhook` | 범용 POST JSON | 서명 없음, 수신 측이 자체 파싱 |

서명 알고리즘은 `globalThis.crypto.subtle` 의 HMAC-SHA256 사용, **서드 파티 의존성 도입 안 함**.

### 3가지 트리거 이벤트

| Event | 트리거 시점 |
|---|---|
| `query-error` | SQL 실행 실패 |
| `slow-query` | 실행 시간 ≥ `settings.slowQueryNotifyMs`(0 = 비활성화) |
| `manual` | 사용자가 "테스트 전송" / 툴바의 "알림" 클릭 |

각 설정은 이 3가지 이벤트를 독립적으로 구독 가능(`subscribe: NotifEvent[]`).

### 설정 항목

```ts
interface NotifConfig {
  id: string
  name: string
  channel: 'dingtalk' | 'feishu' | 'slack' | 'webhook'
  webhookUrl: string
  secret?: string           // 钉钉/飞书 서명 키(선택)
  enabled: boolean
  subscribe: NotifEvent[]
}
```

`localStorage.skylerx.notifications` 에 저장, `settings` 와 독립(알림은 양이 많고 변동 빈번, settings 와 동기화 시 노이즈 발생).

### 테스트 전송

`Settings → 알림` 에서 설정 선택 → "테스트 전송". 적용 조건:

- `enabled === true`
- `webhookUrl` 비어 있지 않음
- `subscribe.includes('manual')`(테스트는 `notify('manual', ...)` 경로이므로)

어느 하나라도 미충족 시 toast 안내, 실제 전송 안 함.

### 디스패치가 메인 흐름 차단 안 함

`notify(event, payload)` 는 fire-and-forget:

```ts
await Promise.all(targets.map(async (c) => {
  try { await dispatchOne(c, payload) }
  catch (e) { console.warn(`[notify] ${c.channel}/${c.name} failed:`, e) }
}))
```

개별 webhook 실패는 모두 삼킴, console 에 warn 만 남김. **알림은 보조 채널, 메인 흐름을 지연시키지 못함**.

### 데스크톱 클라이언트 프록시 fetch

데스크톱 Electron 은 우선 `globalThis.api.ai.fetch` IPC 프록시 사용, 브라우저 CORS 우회; 웹 클라이언트는 원시 `fetch` 폴백.

---

## 10. 앱 메뉴 구조

코드 위치: `apps/desktop/src/main/menu.ts`

7개 최상위 메뉴(DataGrip / Navicat 레이아웃 참고):

| 메뉴 | 주요 항목 |
|---|---|
| **SkylerX**(mac 전용) | 정보 / 설정 ⌘, / 업데이트 확인 / 서비스 / 숨김 / 종료 |
| **파일** | 연결 생성 ⌘N / 쿼리 생성 ⌘T / SQL 파일 열기 ⌘O / 연결 설정 가져오기 · 내보내기 / 백업 · 복원 / 탭 닫기 ⌘W |
| **편집** | 시스템 role(실행 취소 / 다시 실행 / 잘라내기 / 복사 / 붙여넣기 / 전체 선택) + 찾기 ⌘F / 바꾸기 ⌘H / SQL 포매팅 ⌘⇧F |
| **보기** | 커맨드 팔레트 ⌘K / 객체 검색 ⌘⇧O / AI 채팅 토글 ⌘⇧L / 즐겨찾기 / 작업 로그 / 줌 / 전체 화면 / 개발자 도구 |
| **도구** | 서버 활동 / 백업 복원 / 데이터 전송 / Schema diff / Data diff / Schema 스냅샷 / Dashboard / 테이블 간 전체 검색 / 데이터 계약 / AI 도구 상자 / AI 어시스턴트 |
| **창** | 새 창 ⌘⇧N / 최소화 / 다시 로드 / (mac)모든 창 앞으로 |
| **도움말** | 정보 / 단축키 레퍼런스 / GitHub 저장소 / 피드백 / 업데이트 확인 |

### 구현 세부

커스텀 메뉴 항목은 **메인 프로세스에서 직접 비즈니스 로직 실행 안 함**(렌더러 레이어 Vue 상태 못 가져옴), 대신 통합으로 `webContents.send('menu:command', '<key>')` 로 렌더러 레이어에 통보. 렌더러 레이어는 `Workspace.vue` 에서 `window.api.menu.onCommand(key => ...)` 구독, key 로 대응 paletteItem 의 `onPaletteSelect` 로 라우팅.

---

## 11. Settings 전반

코드 위치: `packages/ui/src/components/SettingsDialog.vue`

`Settings` 다이얼로그 좌측 5개 분류 탭, 우측에 폼 동적 렌더링.

| 분류 | 주요 항목 |
|---|---|
| **일반** ⚙ | 언어(중 / 영), 테마(다크 / 라이트), 인터페이스 줌(70% - 200%), 커밋 모드 기본값(auto / manual), NavTree 사용 빈도 정렬, **데이터 마스킹 스위치 + 룰 편집** |
| **에디터** ⌨ | 폰트 크기, 들여쓰기, 자동 줄 바꿈, 자동 완성 스위치, 키워드 대소문자(upper / lower / preserve) |
| **데이터 그리드** ▦ | 기본 페이지 크기(50 / 100 / 200 / 500 / 1000), NULL 표시 문구 |
| **프로덕션 워터마크** ⚠ | 문구, 투명도(0.04 - 0.5), 각도(-90° - 90°), 폰트 크기, 색상; 실시간 미리보기 동반 |
| **AI 어시스턴트** ✨ | Provider 전환(Anthropic / OpenAI / DeepSeek / Codex / Grok), API Key / Model / Base URL, 메모리 및 프로필(A 자유 텍스트 / B 구조화 사실 / C 벡터 메모리) |

> **테마 관련 항목**: `Settings → 일반 → 테마` 로 다크 / 라이트 전환, 모든 패널 영향. 다크가 기본(`appearance: 'dark'` 가 VitePress / Electron 렌더링 CSS 변수에 작성).

### "AI 메모리" 3등급

| 등급 | 필드 | 의미 |
|---|---|---|
| A | `aiCustomInstructions` | 자유 텍스트 프로필, 매 대화마다 system prompt 에 조립 |
| B | `aiFacts[]` + `aiAutoExtractFacts` | 구조화된 사실 리스트, 수동 / 자동 추출 |
| C | `aiVectorMemory` + embedding 3종 셋 + `aiVectorTopK` | 벡터 메모리, 세션 간 의미 회상 |

하단 `기본값 복원` 으로 전체 settings 표 reset, 재확인 동반.

---

## 12. 다중 창 ⌘⇧N

코드 위치: `apps/desktop/src/main/index.ts` 의 `spawnExtraWindow()` + IPC `window:newSession`

⌘⇧N(mac) / Ctrl+Shift+N(Win/Linux) 누름 → 완전 새로운 BrowserWindow(1100 × 750) 팝업, 동일 renderer URL 재사용, 메인 창과 **완전 독립 세션**.

### 전형적 사용법

| 시나리오 | 방법 |
|---|---|
| 로컬 vs 원격 비교 | 메인 창은 로컬 dev 연결, 새 창은 prod replica 연결, 양쪽 나란히 |
| 다중 테넌트 전환 | 한 창은 테넌트 A 연결, 한 창은 테넌트 B 연결 |
| 큰 쿼리 + 작성하며 조회 | 메인 창에서 느린 SQL 실행, 새 창에서 다음 단락 작성 |

각 창은 SQL 탭 / 현재 선택된 연결 · DB · schema / 에디터 커서 위치를 독립적으로 보유. 이력 / 즐겨찾기 / 스니펫은 **공유**(모두 localStorage 동일 출처 + SQLite 단일 파일 사용).

"창 동기화" 안 함(두 창의 동일 연결 실행은 상호 가시 안 됨, 각자 자기 historyPanel 작성); "창 관리자" 안 함, 창 수 상한 없음, OS 의 Mission Control / Exposé 사용.

---

## 13. 모든 생산성 단축키 빠른 조회

기본 바인딩 다음과 같음; 모두 `Settings → 키 바인딩` 에서 재바인딩 가능(`new-window` 는 메뉴 항목, `COMMANDS` 표에 없음).

| 작업 | macOS | Windows / Linux | 명령 ID |
|---|---|---|---|
| 커맨드 팔레트 | ⌘K | Ctrl+K | `palette` |
| 전역 객체 검색 | ⌘⇧O | Ctrl+Shift+O | `object-search` |
| SQL 실행 | ⌘+Enter | Ctrl+Enter | `run-sql` |
| AI 채팅 토글 | ⌘⇧L | Ctrl+Shift+L | `ai-chat` |
| 연결 생성 / 쿼리 생성 / 탭 닫기 | ⌘N / ⌘T / ⌘W | Ctrl+N / T / W | `new-conn` / `new-query` / `close-tab` |
| 찾기 / 바꾸기 / SQL 포매팅 | ⌘F / ⌘H / ⌘⇧F | Ctrl+F / H / Shift+F | `find` / `replace` / `format-sql` |
| 스니펫으로 저장 / 설정 | ⌘S / ⌘, | Ctrl+S / Ctrl+, | `save-snippet` / `settings` |
| 새 창 | ⌘⇧N | Ctrl+Shift+N | (메뉴 항목) |
