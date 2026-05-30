# AI 어시스턴트

SkylerX 는 AI 를 **여러 독립 채널**로 분할하여 제품의 다양한 위치에 주입합니다. 단일 채팅 박스로 모든 것을 해결하지 않습니다.

- **우측 채팅 패널**(`⌘⇧L`): 멀티턴 대화 + DB 구조 주입 + SQL 원클릭 삽입 / 실행
- **인라인 자동 완성**: 에디터에 회색 ghost text(Copilot 과 유사)
- **오류 진단 "AI 에게 묻기"**: 모든 에러 다이얼로그 / 결과 영역에 버튼이 있음
- **AI Toolbox**: 7개 주요 prompt 의 통합 진입점
- **도메인 전용 dialog**: 헬스 체크 / 인사이트 / 테이블 생성 / 역추론 / 코멘트 / 번역 / 테스트 데이터

저변에는 `provider 추상화 + 3계층 메모리 + 다중 채널 IPC` 가 공통으로 사용됩니다. 이 문서는 모두 코드 사실에 기반하여 서술하며, 주관적 칭찬은 섞지 않습니다.

## 1. 개요 — 다중 provider + 병렬 채널

| 모듈 | 파일 | 책임 |
|---|---|---|
| `askAi()` / `askAiChat()` | `ai.ts` | provider 디스패치(Anthropic vs OpenAI 호환), HTTP 요청(메인 프로세스 IPC 경유 가능), 중단 가능 |
| `pXxx()` prompts | `ai-prompts.ts` | 9개 도메인 prompt 템플릿, 순수 문자열 조립 |
| 인라인 자동 완성 | `aiInline.ts` | Monaco InlineCompletionsProvider, 600ms 쓰로틀 + AbortController |
| 3계층 메모리 | `memory.ts` | A 프로필 / B 사실 / C 벡터 메모리, 통합 `buildMemorySection()` 으로 system prompt 에 주입 |
| 채팅 패널 | `AiChatPanel.vue` | 우측 사이드바, schema 주입 + chat-bus 수신 |
| 도메인 다이얼로그 | `Ai*Dialog.vue` | 헬스 체크 / 인사이트 / 테이블 생성 / 역추론 / 코멘트 / 테스트 데이터 |
| 방언 간 번역 | `SqlTranslateDialog.vue` | 일반 SQL + 저장 프로시저 두 가지 모드 |

모든 채널은 저변에서 `askAi*` → IPC fetch → 동일한 provider 설정을 사용합니다. provider 를 바꾸면 **모든 채널이 즉시 함께 바뀝니다**.

## 2. Provider 설정

`Settings → AI Provider` 는 5종 provider 를 지원합니다.

| Provider | 프로토콜 | 엔드포인트 |
|---|---|---|
| **Anthropic** | Anthropic Messages | `${baseUrl}/v1/messages`, `x-api-key` 인증 |
| **OpenAI** | OpenAI Chat | `${baseUrl}/v1/chat/completions`, `Authorization: Bearer` 인증 |
| **DeepSeek** | OpenAI 호환 | 위와 동일 |
| **Codex** | OpenAI 호환 | 위와 동일 |
| **Grok / xAI** | OpenAI 호환 | 위와 동일 |

실제 코드(`ai.ts → askAi`):

```ts
const provider = settings.aiProvider
const cfg = settings.aiProviders[provider]
if (!cfg?.apiKey?.trim()) throw new Error('NO_API_KEY')
if (provider === 'anthropic') return callAnthropic(o, cfg.apiKey.trim(), base, model)
return callOpenAiCompat(o, cfg.apiKey.trim(), base, model)
```

### 커스텀 endpoint

각 provider 는 독립적인 `baseUrl` 을 가지며, 필드를 바로 수정하면 됩니다.

| 시나리오 | 설정 방법 |
|---|---|
| 자체 Anthropic 프록시 | provider=Anthropic, `baseUrl=https://your-proxy.example.com` |
| 프라이빗 OpenAI 호환(vLLM / Ollama / one-api) | provider=OpenAI, `baseUrl` 과 `model` 만 수정 |
| DeepSeek 직접 연결 | `https://api.deepseek.com`, `model=deepseek-chat` |
| Grok 직접 연결 | `https://api.x.ai`, `model=grok-3-mini` |

### API Key 암호화 저장

Key 는 연결 비밀번호와 동일하게 시스템 키체인(macOS Keychain / Windows Credential / GNOME libsecret)에 저장되며, `settings.aiProviders[*].apiKey` 는 디스크 상 암호화 형태입니다.

### IPC 경유인지 브라우저 직접 발송인지?

데스크톱 클라이언트의 preload 는 `window.api.ai.fetch`(메인 프로세스 프록시, 브라우저 CORS 우회, 진짜 cancel 지원)를 노출합니다. 웹 클라이언트는 원시 `fetch` 로 폴백합니다. `ai.ts → aiBridge()` 가 자동 선택합니다.

```ts
function aiBridge() {
  return globalThis.api?.ai ?? null
}
```

IPC 경로는 렌더러 측의 `AbortSignal` 을 메인 프로세스의 `ai:cancel` 에 연결하여, **진짜 진행 중인 요청을 취소**합니다(응답을 버리는 것이 아닌).

```ts
const reqId = `r${Date.now()}-${random}`
init.signal?.addEventListener('abort', () => bridge.cancel?.(reqId))
```

## 3. 우측 채팅 패널 — AiChatPanel

`⌘⇧L` / `Ctrl+Shift+L` 로 가시성 토글. 패널은 좌측 가장자리를 드래그하여 너비 조정(`280-800px`), 너비는 `skylerx.aiChat.width` 에 영속화됩니다.

### 컨텍스트 바(상단)

| 컨트롤 | 역할 |
|---|---|
| **연결 선택** | 현재 대화가 어느 연결을 가리킬지(방언 + schema 출처 결정) |
| **DB / schema 선택** | MySQL 은 `SCHEMATA`, PG 는 `pg_namespace` 사용; 시스템 DB 자동 필터링 |
| **DB 구조 첨부** 체크박스 | 체크 시 `information_schema.COLUMNS` 조회하여 `tbl(col1 type, col2 type, ...)` 으로 조립, system prompt 에 주입(6000자 제한) |
| **새 대화** / **비우기** | 현재 이력 비우고 새 대화 시작 |

### Schema 주입 구현

MySQL 은 `information_schema.COLUMNS`, PG 는 `information_schema.columns` 사용. 테이블별로 그룹화하여 `tbl(col1 type, col2 type, ...)` 한 줄 한 테이블 형식으로 조립, 6000자 초과 시 잘라내고 `-- (truncated)` 추가. **테이블명 + 컬럼명 + 타입만 전송하며, 데이터는 보내지 않습니다**.

### 멀티턴 대화

메시지는 `localStorage` key `skylerx.aiChat.messages` 에 저장, 최대 50개. 매 라운드 `send()`:

```ts
const memorySection = await buildMemorySection(text)  // A/B/C 3계층 메모리
const reply = await askAiChat({
  messages: messages.value,           // 전체 이력
  dialect: connOf(connId.value)?.dialect,
  schema: useSchema.value ? schemaText.value : undefined,
  memorySection,
  signal: controller.signal,
})
```

응답이 들어온 후 **백그라운드** 작업:
- `autoExtractFacts({ user, assistant })` — LLM 으로 장기 기억할 만한 사실 1-3개 추출하여 B 등급에 저장
- `rememberVector(\`Q: ${user}\nA: ${assistant}\`)` — 벡터화 후 C 등급 저장

### 사고 중 타이머 + 멈춤 안내

`elapsedTimer` 가 매초 +1, `12s` 로 렌더링. 20초 초과 시 빨간색 `maybeStuck` 안내 자동 추가. `[정지]` 버튼은 `controller.abort()` 호출(IPC 경로에서 진짜 중단).

### SQL 코드 블록 특수 렌더링

응답을 ` ``` ` 으로 `splitParts` 분할, SQL 블록은 Monaco `editor.colorize` 비동기 하이라이트(내용 해시로 `sqlHtml` 에 캐시), SQL 이 아닌 블록은 `renderMarkdown` 으로 GFM 렌더링.

각 SQL 블록 아래 세 개 버튼:

| 버튼 | 동작 |
|---|---|
| `복사` | `navigator.clipboard.writeText` |
| `초안 삽입` | `emit('insertSql', sql, connId)` → Workspace 가 QueryPane 에 주입 |
| `▶ 실행` | 재확인 → `emit('runSql', ...)` → Workspace 실행 |

### SQL 실행 배지

"실행" 클릭 후 SQL 블록 위에 배지 부착(`skylerx.aiChat.runMarks` 영속화, 최대 200개):

| 상태 | 표시 |
|---|---|
| `pending` | ⌛ 회색 배경 + "10:23 디스패치 완료" |
| `ok` | ✓ 녹색 배경 + "10:23 성공" |
| `error` | ✗ 빨간색 배경 + "10:23 실패", hover 시 오류 본문 표시 |

실행 후 QueryPane 이 `onChatSqlExecuted` 이벤트 버스로 브로드캐스트, 채팅 패널이 구독하여 배지 업데이트.

### Provider 스위처

하단 드롭다운은 **apiKey 가 설정된 provider 만** 표시(빈 key 선택으로 인한 `NO_API_KEY` 회피), 옆의 `⚙` 버튼은 `openSettings` 를 emit 하여 AI 설정 섹션으로 이동.

## 4. 인라인 자동 완성 — aiInline.ts

Monaco InlineCompletionsProvider, Copilot 스타일 ghost text. SQL 에디터에 등록:

```ts
monaco.languages.registerInlineCompletionsProvider('sql', provider)
```

### 쓰로틀 전략

| 파라미터 | 값 | 역할 |
|---|---|---|
| `DEBOUNCE_MS` | 600ms | 사용자가 600ms 멈춰야 LLM 호출 |
| `MAX_PREFIX` | 2000자 | 커서 앞 텍스트 취득, 초과 시 끝부분 잘라냄 |
| 최소 트리거 길이 | 3자 | `prefix.trim().length < 3` 이면 바로 빈 값 반환 |

매 새로운 트리거는 **즉시 이전을 abort**:

```ts
function clearPending() {
  if (!pending) return
  clearTimeout(pending.timer)
  pending.abort.abort()  // 이전 요청을 진짜 취소
  pending = null
}
```

쿼터를 낭비하지 않으며, 이전 완성이 갑자기 튀어나오지도 않습니다.

### Prompt + 시스템 프롬프트

```ts
const text = await askAiChat({
  messages: [{ role: 'user', content: buildPrompt(prefix, ctx) }],
  dialect: ctx.dialect,
  extraSystem: '당신은 SQL 인라인 완성 엔진입니다. 커서 위치 이후의 SQL 텍스트 조각만 출력하세요, '
             + '최대 1줄, 코드 블록 / 설명 / 기존 윗부분 반복 금지. '
             + '컨텍스트가 완성에 부족하면 빈 문자열 출력.',
  signal: abort.signal,
})
```

`buildPrompt` 내용: `방언: <d>\n\nSchema:\n<hint>\n\nSQL 윗부분(커서가 끝):\n<prefix>`.

### 후처리 정리(`sanitizeCompletion`)

- ` ```sql ... ``` ` 펜스 제거(LLM 이 가끔 코드 블록으로 감쌈)
- 모델이 가끔 prefix 를 반복, prefix 끝 80자로 시작하면 → 잘라냄
- 다중 행 응답에서 첫 줄만 취함

### 수락 / 취소

| 키 | 동작 |
|---|---|
| `Tab` | 완성 수락 |
| `Esc` / `Backspace` / 입력 계속 | 취소(Monaco 내장) |

### 글로벌 토글

`settings.enableCompletion` 재사용(SQL 자동 완성과 토글 공유), 완성 꺼지면 LLM 호출 안 함. 실패는 일률 무음(인라인 완성은 채팅처럼 mission-critical 하지 않으므로, 실패해도 사용자를 방해하지 않음).

## 5. 오류 진단 "AI 에게 묻기" 버튼

실행 오류 시 **모든 alert 다이얼로그 / 결과 영역 오류 바**에 `✨ AI 에게 묻기` 버튼이 있습니다. 클릭하면 `AiChatPanel.askAboutError()` 트리거:

```ts
async function askAboutError(p: { connId, connName?, sql, error }) {
  controller?.abort()             // 1) 현재 대화 중단
  for (let i=0; i<30 && running.value; i++) await sleep(50)  // finally 완료 대기
  connId.value = p.connId         // 2) 오류 연결로 전환
  useSchema.value = true          // 3) schema 컨텍스트 강제 활성화
  saveToStorage()
  const msg = `${t('aichat.askAiPrompt')}\n\n**연결**: ${p.connName}\n\n**SQL**\n\`\`\`sql\n${p.sql}\n\`\`\`\n\n**Error**\n\`\`\`\n${p.error}\n\`\`\``
  input.value = msg
  if (switching) await sleep(200) // 4) schema 비동기 로딩 대기
  if (!schemaText.value) await loadSchema()
  await send()
}
```

### 메시지 형태

전송되는 사용자 메시지는 다음과 같은 형태:

```markdown
이 SQL 오류를 봐주세요. 가능한 원인과 수정 제안을 주세요.

**연결**: prod-mysql

**SQL**
```sql
INSERT INTO orders(user_id, amount) VALUES (42, 99.9)
```

**Error**
```
ERROR 1452 (23000): Cannot add or update a child row:
a foreign key constraint fails (`shop`.`orders`, CONSTRAINT `fk_user` ...)
```

자동 주입된 schema 컨텍스트(`users(id int, ...)` 와 `orders(...)` 모두 포함)와 함께, AI 는 보통 "`user_id=42` 가 `users.id` 에 없음" 을 초 단위로 찾아냅니다.

### chat-bus 버스

이 메커니즘은 채팅 패널만 사용하지 않습니다 — `MockDataDialog` 실행 실패도 동일 버스로 `askAi` 버튼을 띄웁니다:

```ts
toast.error(`실행 실패: ${errMsg}`, {
  askAi: { sql: stmt, error: errMsg, connId, connName, dialect },
})
```

`ChatErrorAskEvent` 는 통합 형태이며, 어떤 위치에서 오류가 발생하더라도 "AI 에게 묻기" 버튼을 부착할 수 있고, 매번 반복 구현이 필요 없습니다.

## 6. AI Toolbox(7개 전문 prompt)

`🛠 AI Toolbox` 또는 `⌘K → AI 도구 상자`. 하나의 다이얼로그가 7종 작업을 처리, 선택 후 "AI 에게 시키기" 클릭 → 다이얼로그 닫고 + prompt 가 우측 채팅 패널로 전송.

| Toolbox | Prompt 템플릿 | 입력 | 출력 형태 |
|---|---|---|---|
| **마이그레이션 작성** | `pMigration` | 대상 테이블 + 요구사항 설명 | 3개 독립 `\`\`\`sql`: 정방향 ALTER / 역방향 롤백 / 데이터 마이그레이션 |
| **SQL 최적화** | `pOptimizeSql` | 원 SQL + 선택적 EXPLAIN | 판정 → 재작성 제안(SQL 블록) → 인덱스 제안(SQL 블록) → 예상 이득 |
| **EXPLAIN 해석** | `pExplainAnalysis` | SQL + EXPLAIN 텍스트 | 노드별로 평이한 해석 + "결론 + 가장 손댈 가치 있는 한 곳" |
| **테스트 데이터 생성** | `pTestData` | 테이블 + 행 수 + 비즈니스 배경 | 단일 `\`\`\`sql`, 행별 INSERT, FK 인식 |
| **NL → SQL** | `pNl2Sql` | 자연어 설명 | 단일 `\`\`\`sql`, 모호함이 있으면 가장 일반적인 해석으로 처리 + 모호 포인트 안내 |
| **문서 작성(필드 의미)** | `pDataDictDoc` | 테이블 + 컬럼 CSV | Markdown 3열 표: 필드 / 타입 / 비즈니스 의미 |
| **테이블 용도 설명** | `pExplainTable` | 테이블 + 컬럼 + FK 힌트 | ≤ 200자 단락 + 3 bullet(누가 삽입 / 누가 읽음 / 삭제 정책) |

### Toolbox 폼 필드

| 작업 | 테이블 필요 | SQL 필요 | EXPLAIN 필요 | 추가 |
|---|---|---|---|---|
| migration | ✓ | | | 요구사항 텍스트 |
| optimize | | ✓ | (선택) | |
| explain-analysis | | ✓ | ✓ | |
| test-data | ✓ | | | 행 수 + 비즈니스 배경 |
| nl2sql | | | | 요구사항 텍스트 |
| doc | ✓ | | | 자동으로 컬럼 CSV 가져옴 |
| explain-table | ✓ | | | 자동으로 컬럼 CSV 가져옴 |

제출 시 `pXxx(...)` 호출하여 prompt 조립 → `emit('submit', { prompt, connId, connName, withSchema: true })` → Workspace 가 `AiChatPanel.askPredefined(...)` 로 포워딩, `askAboutError` 와 동일한 방식.

### 설계 포인트

- 사용자의 원시 요구("컬럼 추가 / 이름 변경 / 최적화")는 prompt 안에 원형 그대로 보존, 번역으로 의미 손실 회피
- 컨텍스트(SQL / 테이블명 / EXPLAIN 텍스트)는 Markdown 코드 블록으로 삽입, AI 가 더 쉽게 식별
- 기대 출력 형식 명시("ALTER + 역방향 ALTER + 데이터 마이그레이션 주세요"), 왕복 감소
- 출력 형식 강제 제약(3개 독립 `\`\`\`sql` + H3 제목) = 프론트가 제목으로 분할하여 안정적인 파싱

## 7. AI Health Check — 데이터베이스 헬스 체크

툴바 `❤️ Health Check`. 열면 4단계 자동 실행:

1. **메타데이터 수집** — 3개 동시 SQL:
   - MySQL: `COLUMNS / STATISTICS / KEY_COLUMN_USAGE`(`REFERENCED_TABLE_NAME IS NOT NULL` 필터)
   - PG: `information_schema.columns + pg_index + pg_class` + FK 서브 쿼리
2. **직렬화** — 테이블별로 그룹화하여 컴팩트 텍스트(columns / indexes / FKs)
3. **AI 에 전송** — `pHealthCheck` 로 prompt 조립, `askAiChat` 호출
4. **렌더링** — Markdown 을 H2 로 분할하여 6개 카테고리 카드

### 6종 안티 패턴 + AI 실제 검사 지시(`pHealthCheck`)

| 절 | 제목 | AI 가 실제 하는 일 |
|---|---|---|
| 1 | 고빈도 쿼리 컬럼에 인덱스 없음 | `status / created_at / user_id / type / is_* / *_at` 같은 고빈도 필터/정렬 컬럼이지만 대응 인덱스가 없는 경우 휴리스틱으로 추론하여 → 지적 |
| 2 | 외래 키처럼 명명되었으나 FK 제약 없음 | `xxx_id` / `xxxId` 인데 소속 테이블에 부모 테이블을 가리키는 FOREIGN KEY 가 없음 → 나열 + 부모 테이블 추측 |
| 3 | 필드 명명 스타일 혼용 | 같은 테이블 / 전체 DB 에서 snake_case + camelCase 혼용 → 어느 것으로 통일할지 지적 |
| 4 | 타입을 너무 크게 선택 | `VARCHAR(255)` 에 짧은 문자열 / `BIGINT` 에 작은 정수 / 시간을 `VARCHAR` 로 저장 |
| 5 | 핵심 비즈니스 테이블 / 필드에 comment 없음 | `user / order / payment / account` 같은 핵심 테이블에 COMMENT 없음, 코멘트 추가할 만한 핵심 필드 선정 |
| 6 | 소프트 삭제 필드에 인덱스 없음 | `deleted_at / is_deleted` 가 어떤 인덱스에도 포함되지 않음 → `CREATE INDEX` 제안 |
| 요약 | — | "가성비" 순으로 3~5개 우선 액션 |

**출력 강제 제약**: 반드시 6개의 `## 1.` ~ `## 6.` H2 제목으로 분절(프론트가 H2 로 카드 분할에 편리), 문제 없는 절도 제목을 유지하고 "명백한 문제 없음" 으로 기재.

### 메타데이터 수집

MySQL 은 `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE`, PG 는 `information_schema.columns + pg_index/pg_class + table_constraints` FK 서브 쿼리 사용, 3개 SQL 동시 실행(각 ~5000행 제한). prompt 총 메타데이터 ~12K 자 상한으로 절단, token 폭주 방지; MySQL 패밀리 / PG 패밀리만 지원.

## 8. AI Insights — 슬로우 SQL + 오류 원인

이중 탭 다이얼로그, SQL / 오류를 바로 붙여넣어 실행 가능(연결 없이도).

### Tab 1: 슬로우 SQL 최적화

입력: SQL(필수) + EXPLAIN(선택) + 테이블 통계/행 수(선택). AI 가 4개 섹션 출력: 의심 슬로우 포인트(풀 스캔/인덱스 없음/카테시안 곱/암시적 변환/오래된 통계) → 추천 인덱스(`CREATE INDEX`) → 재작성 제안(커버 인덱스 / 서브 쿼리 → JOIN / 동등 재작성) → 개선 효과 추정.

`extraSystem`: `You are a database performance expert. Be specific and reference actual cost trade-offs.`

### Tab 2: 오류 원인

입력: 오류 정보(필수) + 컨텍스트(선택: 실행한 SQL / 시간 / 사용자). AI 출력: 오류 의미(자연어 번역) → 확률 순 3가지 가능 원인 → 조사 단계 → 수정 방안.

`extraSystem`: `You are an SRE/DBA. Be practical, prioritize quick mitigation.`

"AI 에게 묻기 버튼" 과의 차이: Insights 는 **수동 deep dive**(오류 한 단락을 천천히 분석), 버튼은 **현재 SQL + 오류 + 현재 연결 schema 를 원클릭으로 채팅 패널에 연결**하여 멀티턴 계속.

## 9. AI Schema Architect — 테이블 설계

대화형 테이블 생성 어시스턴트. 비즈니스 요구사항을 주면 → AI 가 다중 테이블 + FK + 인덱스의 완전한 DDL 출력, 추가 질문으로 설계 변경 가능.

### 시스템 프롬프트(컴포넌트에 하드 코딩)

```text
You are a senior database architect. The user describes a business domain (in any language).
Your job:
1. Design multiple related tables (with primary keys, foreign keys, indexes,
   sensible types for the <dialect> dialect).
2. Output a single ```sql code block containing the COMPLETE CREATE TABLE statements
   (including foreign keys and indexes) so the user can copy-paste-run.
3. Explain key design decisions briefly in 2-4 bullet points.
4. When the user asks to revise, output the FULL updated SQL again (not just a diff)
   — they will execute the whole block.

Stay concise. Prefer normalized design unless user asks for denormalized.
```

### 흐름

1. 사용자가 비즈니스 설명 입력(`"전자상거래 주문 시스템: 사용자, 상품, 주문, 주문 항목, 쿠폰 지원"`)
2. `askAiChat({ messages, dialect, extraSystem })` 가 Markdown 받음
3. `extractAllSql(reply)` 가 모든 `\`\`\`sql` 블록을 `sqlBlocks` 로 추출
4. 사용자가 추가 질문 → 전체 이력 전송 → AI 가 **완전한 새 버전** SQL 출력(system prompt 에 강제: diff 가 아닌 전체)

### 원클릭 실행

하단 `▶ 최신 버전 실행` 버튼: 마지막 어시스턴트 응답의 모든 `sqlBlocks` join + `splitStatements` 분할 + 항목별 `client.connections.execute`. 재확인은 `CREATE` 문 수 + 대상 DB 표시.

## 10. AI Schema Reverse — 역추론

CSV / TSV / JSON 샘플 데이터를 주면 → AI 가 schema 추론 → `CREATE TABLE` + 선택적 `INSERT` 생성.

### 입력

| 필드 | 설명 |
|---|---|
| 형식 | CSV / TSV / JSON 3택 |
| 테이블명 | 기본 `inferred_table`, 변경 가능 |
| 샘플 데이터 | 몇 줄이면 충분, 헤더/필드명 포함이 가장 정확 |
| INSERT 동시 생성 | 체크박스, 체크 시 prompt 에 "5. 샘플 데이터를 모두 삽입하는 INSERT 문 생성" 추가 |

### Prompt 구조

```text
다음 CSV 샘플 데이터에 기반하여, schema 를 역추론하고 mysql 방언의 CREATE TABLE SQL 을 생성하세요...

요구사항:
1. 각 컬럼에 **가장 적합한** 타입을 추론(길이, 순수 숫자 여부, 날짜 여부, enum 여부 등 고려)
2. 어느 컬럼이 **기본 키**(자동 증가 vs 비즈니스 키), 어느 것이 **반드시 NOT NULL** 인지 추론
3. 1-2개 **인덱스 후보** 추천(외래 키 같은 컬럼, 자주 필터링되는 컬럼 기반)
4. 테이블명: `inferred_table`

샘플 데이터:
```
id,name,email,created_at
1,alice,a@x.com,2026-01-01
...
```

다음 구조에 따라 엄격히 출력:

### 추론 설명
(컬럼명 → 타입 → 이유, 2-3 문장)

### CREATE TABLE
```sql
CREATE TABLE ...
```

### 인덱스 제안
- ...
```

### 편집 후 실행

반환된 SQL 은 우측 편집 가능 박스(`sqlEdit`)로 추출, 사용자가 수정 후 `▶ 실행` 클릭 → 재확인 → `splitStatements` 분할 → 항목별 실행.

## 11. AI Comment Writer — 테이블 / 컬럼 코멘트 작성

테이블 우클릭 `💬 AI 코멘트 작성` 또는 툴바 진입점. 흐름:

1. **컬럼 가져오기** — MySQL 은 `information_schema.COLUMNS`(name / type / nullable / default / comment) 사용, PG 는 기존 comment 조회를 위해 `pg_catalog.col_description` 추가
2. **직렬화** — `columnsCsv` 조립: `- col type [NOT NULL] [DEFAULT ...]`
3. **AI 에 전송** — `pComment(ctx, columnsCsv)`, **단일 `\`\`\`json` 코드 블록**만 출력 요구
4. **파싱** — JSON 추출, `[{ col, comment }]` 획득
5. **비교 테이블** — 기존 comment vs AI 제안, 행별 체크박스로 채택 여부 결정
6. **적용** — ALTER 생성:
   - MySQL: `ALTER TABLE ... MODIFY <col> <type> [NOT NULL] [DEFAULT ...] COMMENT '...'`(원래 type / nullable / default 를 함께 가져와야 하며, 아니면 손실됨)
   - PG: `COMMENT ON COLUMN <table>.<col> IS '...'`

### Prompt 강제 제약(`pComment`)

prompt 강제: **단일 `\`\`\`json` 코드 블록만 출력, 전후 설명 텍스트 없음**; 배열 각 항목 `{ "col": "컬럼명", "comment": "한국어 한 문장 비즈니스 의미" }`; `col` 은 반드시 **원형 그대로** 필드명 복사(대소문자 구분, 번역 안 함); `comment` ≤ 30자, 정보 부족 시 "?(수동 보완 권장)" 기재; **모든 필드 나열**(`id / created_at` 같은 기본 필드도 포함).

출력 강제 제약 = `parseSuggestion()` 이 안정적인 정규식으로 ` ```json ... ``` ` 추출, 실패 시 전체를 원시 JSON 으로 시도. `col` 은 반드시 원형 그대로 회신 → 현황 비교 + ALTER 조립 시 어긋남 없음.

### 테이블 레벨 코멘트

컬럼 레벨 외에, 테이블 자체에도 한 줄 작성 가능: MySQL `ALTER TABLE ... COMMENT='...'`, PG `COMMENT ON TABLE ... IS '...'`.

## 12. AI SQL 번역 — SqlTranslateDialog

`🌐 Translate` 진입점. 4개 방언 고정: `mysql / postgresql / sqlserver / oracle`.

### 두 가지 모드

| 모드 | Prompt |
|---|---|
| **SQL**(일반 쿼리 / DDL) | `pTranslate(from, to, sql)` |
| **저장 프로시저 / 함수** | `pTranslateProcedure(from, to, code)` — 추가로 파라미터 모드 / BEGIN-END / DECLARE / 예외 처리 / 커서 / DELIMITER 커버 |

`extraSystem` 도 따라 전환:

- SQL: `You are a senior SQL polyglot. Translate SQL across dialects precisely; flag every non-portable construct honestly.`
- Procedure: `You are a senior SP/PL/SQL polyglot. Translate stored procedures faithfully; preserve control flow and explicit error handling.`

### 출력 강제 제약(`pTranslate`)

엄격한 3개 섹션:

1. **번역된 SQL** — 단일 `\`\`\`sql` 코드 블록, 한 건만, 설명 없음
2. **`### 경고`** — bullet 로 **이식 불가능한** 포인트 나열(`MySQL ON DUPLICATE KEY UPDATE` → `PG ON CONFLICT DO UPDATE`, 의미는 대략 정렬 가능하지만 행동 세부 차이; `DATETIME vs TIMESTAMP`; `NVARCHAR vs NVARCHAR2`; 페이지네이션 / 자동 증가 / 문자열 연결 / 인용 스타일; 암시적 변환, NULL 정렬 행동 차이); 없으면 "명백한 이식 불가 구문 없음" 기재
3. **`### 제안`** — bullet 로 대상 방언에서 **더 관용적인** 작성 방법 제시(CTE / `LIMIT OFFSET` / `COALESCE` 가 `IFNULL` 대체); 없으면 "직역으로 충분히 관용적" 기재

H3 제목 분리 → 프론트가 제목으로 분할 렌더링.

### 이중 컬럼 렌더링

| 좌측 | 우측 |
|---|---|
| `extractSql(answer)` 로 번역된 SQL 추출 → Monaco `colorize` 하이라이트 + `원클릭 복사` | 첫 번째 `\`\`\`sql` 블록 제거 후 남은 Markdown(경고 + 제안) → `renderMarkdown` |

### 작은 최적화

- `swapDialects()`: 원클릭으로 from/to 교환, 번역 후 역방향에 편리
- **동일 방언 단락 회로**: `from === to` 이면 "번역 불필요" 가짜 응답 직접 생성, 요청 낭비 없음
- 번역 중 `controller?.abort()` 로 취소 가능

## 13. AI Mock Data — FK 인식 테스트 데이터

테이블 우클릭 `🧪 테스트 데이터 생성`. 이 다이얼로그의 본체는 **룰 엔진**(`mockgen.ts` 이 컬럼명 + SQL 타입으로 `SemanticKind` 추론), AI 는 두 지점에서만 개입.

### 13.1 `aiInfer()` — AI 로 모든 컬럼의 의미 타입 일괄 추론

`✨ AI 추론` 버튼. prompt 는 영어(모델이 영어 JSON instruction 에 더 안정적), 제약:

- 고정 화이트리스트 `SEMANTIC_KINDS` 에서 선택(`auto / integer / decimal / money / name_cn / phone_cn / id_card_cn / address_cn / email / enum / lorem_cn / ...`), 그 외는 유효하지 않음
- 중국어 컨텍스트 컬럼(`name/姓名 / 手机/phone / 身份证 / 地址`)은 `_cn` 변형 우선
- `auto` **금지**(무의미한 랜덤 텍스트 생성), 반드시 구체적인 타입 선택
- `money/price/amount/cost` → `money`; `decimal/float` → `decimal`
- `[PK]` 표시된 정수 기본 키 → `integer`(생성기가 자동 증가); `status/state/role` → `enum`; `description/content/remark/note` → `lorem_cn`
- JSON object 만 출력, 형태: `{"user_id":"integer","name":"name_cn","mobile":"phone_cn"}`

반환 후 `/\{[\s\S]*\}/` 로 첫 JSON 추출(전후 잉여 텍스트 허용), 항목별로 kind 가 화이트리스트에 있는지 + 컬럼이 baseColumns 에 있는지 검증 후 적용.

### 13.2 실행 실패 시 "AI 에게 묻기" 부착

INSERT 실패(NOT NULL 값 누락 / FK 미존재 / 타입 불일치) → toast 에 `askAi` 버튼 부착 → chat-bus 로 stmt + 오류 + 연결 정보를 채팅 패널에 전송.

실제 INSERT 생성은 `buildMockInserts(dialect, tableRef, columns, count)` 가 담당(chunk 분할, chunk 당 100행), AI 는 생성 자체에 관여하지 않음 — **의미 추론** 과 **오류 진단** 에만 사용.

## 14. 3계층 메모리 — memory.ts

`Settings → AI → 메모리` 에서 설정; 매 대화마다 자동으로 system prompt 의 앞쪽에 주입(모델은 앞쪽 컨텍스트에 더 민감).

| 등급 | 이름 | 형태 | 용법 | 트리거 |
|---|---|---|---|---|
| **A** | `aiCustomInstructions` | 자유 텍스트 | 장기 신원 / 선호 | 매 대화마다 전량 주입 |
| **B** | `aiFacts` | `{id, text, createdAt}[]` | 구조화된 사실 | 매 대화마다 전량 주입; `aiAutoExtractFacts` 활성 시 매 라운드 자동으로 1-3개 추출하여 저장 |
| **C** | `aiVectorMemories` | `{id, text, vec, createdAt}[]` | 대량 노트 | 매 회 코사인 유사도로 top-K 취득(기본 `aiVectorTopK`), 점수 > 0.3 만 사용 |

### `buildMemorySection(query)` 조립 순서

A → B → C 순으로 Markdown 단락 조립:

- A: `## User profile & preferences` + 자유 텍스트
- B: `## Known facts` + bullet 리스트
- C: `## Relevant past notes` + bullet 리스트(query 필요 + embedding key 설정 필요, `recallRelevant(query)` 가 top-K + 임계값 > 0.3 취득)

### Embedding 설정

C 등급은 embedding 엔드포인트가 필요. `Settings → AI → 메모리` 에서 별도 설정:

| 필드 | 기본값 |
|---|---|
| `aiEmbeddingBaseUrl` | (빈 값, 사용자 입력 필요) |
| `aiEmbeddingApiKey` | (빈 값) |
| `aiEmbeddingModel` | `text-embedding-3-small` |

실제 요청은 OpenAI 호환 `${base}/v1/embeddings`, DeepSeek / Grok 도 동일하게 호환. Embedding 유형 짧은 요청은 타임아웃 15s, 채팅 메인 흐름을 지연시키지 않도록.

### LRU 절단

C 등급 용량 상한 1000개, 초과 시 가장 오래된 것 절단:

```ts
if (settings.aiVectorMemories.length > 1000) {
  settings.aiVectorMemories.splice(1000, settings.aiVectorMemories.length - 1000)
}
```

### 자동 사실 추출(B 등급)

`aiAutoExtractFacts` 활성 시, 매 라운드 chat 종료 후 `autoExtractFacts({ user, assistant })` 가 LLM 에게 한 라운드 user/assistant 대화를 보여주고, ≤ 3개의 **장기 기억할 만한** 사실 추출(`"uses MySQL 8"` / `"works on 'orders' schema"` / `"prefers snake_case"`), ephemeral content 는 스킵; `none` 응답은 스킵, 그렇지 않으면 bullet 파싱하여 저장; 실패는 일률 무음(memory 가 메인 대화를 차단하지 않도록). `extraSystem`: `You are a memory curator. Output bullet list of durable facts only.`

## 15. 프라이버시 & 보안

| 기본 동작 | 설명 |
|---|---|
| API Key 암호화 저장 | 시스템 키체인(macOS / Windows / Linux libsecret) |
| API Key 는 결코 로컬 머신을 떠나지 않음 | 데스크톱 클라이언트는 IPC 로 벤더 엔드포인트에 직접 연결; 웹 클라이언트는 브라우저에서 직접 발송(baseUrl 변경하여 자체 프록시 경유 가능) |
| 기본 **데이터 전송 안 함** | 채팅 패널 "DB 구조 첨부" 기본 비활성; 활성 시 **만** `tbl(col1 type, col2 type, ...)` 요약 전송, 행 데이터 전송 안 함 |
| Schema 6KB 상한 | 초과 시 자동 `-- (truncated)` 절단, token 폭발 방지 |
| `request log` 감사 가능 | `Settings → AI → 요청 로그`(데스크톱 클라이언트 IPC 경로에서 완전 기록) |
| 자체 오류 "AI 에게 묻기" 가 전송 내용 명시 안내 | SQL 전문 + 오류 코드 + 연결 메타 정보 + schema 힌트 |

## 16. 비용 통제

| 차원 | 설정 방법 |
|---|---|
| provider 전환 | 채팅 패널 하단 드롭다운 / `⌘K → AI provider 전환` |
| model 변경 | `Settings → AI Provider → <provider> → model`(저렴한 모델은 인라인 완성 + Health Check, 비싼 모델은 테이블 생성 / 번역) |
| 인라인 완성 끄기 | `Settings → 자동 완성` 글로벌 토글 — `enableCompletion` 재사용(높은 토큰 소비 시나리오에서 필요 시 끔) |
| 벡터 메모리 끄기 | `Settings → AI → 메모리 → 벡터 메모리` 끔 — 매 대화마다 embedding 을 호출하므로, 끄면 embedding token 절약 |
| 자동 사실 추출 끄기 | `aiAutoExtractFacts` 끔 — 끄면 매 라운드 추가 추출 요청을 보내지 않음 |
| 긴 컨텍스트 vs 짧음 | "DB 구조 첨부" 필요 시 체크, DB 와 무관한 질문(`이 SQL 구문 설명`)에는 안 켜도 됨 |

---

## 17. 동작 대조 빠른 조회

| 내가 원하는 것… | 어느 채널 사용 |
|---|---|
| 멀티턴 대화, 질문하며 수정 | **AiChatPanel** |
| 에디터에서 즉석 작성 보조 | **인라인 완성**(`aiInline.ts`) |
| 오류 발생 시 빠른 진단 | **오류 "AI 에게 묻기" 버튼**(chat-bus) |
| 테이블에 마이그레이션 / SQL 최적화 / EXPLAIN 해석 | **AiToolboxDialog** |
| 전체 DB 안티 패턴 스캔 | **AiHealthCheckDialog** |
| 슬로우 SQL / 오류 정보에 deep dive | **AiInsightsDialog** |
| 비즈니스 설명으로 다중 테이블 설계 | **AiSchemaArchitectDialog** |
| 샘플 데이터로 schema 역추론 | **AiSchemaReverseDialog** |
| 모든 컬럼에 한국어 코멘트 작성 + DB 적용 | **AiCommentDialog** |
| 방언 간 SQL / 저장 프로시저 번역 | **SqlTranslateDialog** |
| 테이블에 테스트 데이터 채우기(의미 타입 + FK 안전) | **MockDataDialog** |
| AI 에게 장기 기억 부여 | **memory.ts → A/B/C 3등급** |

[고급 기능](./advanced) 과 함께 사용하면 위력이 배가됩니다 — EXPLAIN 을 못 읽으면 AI 에게 직접 묻고, 인덱스 추천이 확신이 안 가면 AI 에게 설명을 요청하고, Oracle → DM 마이그레이션 번역 경고는 AI 로 위험을 평가.
