# 결과 셋의 대체 뷰

SQL 을 실행하여 결과 셋을 얻으면 기본적으로 보이는 것은 그리드([결과 셋 그리드](./grid.md) 참조)입니다. 그러나 그리드가 항상 최선의 뷰는 아닙니다 — 100 행의 `(month, revenue)` 추세를 볼 때, 꺾은선 그래프가 표보다 만 배 더 직관적입니다. SkylerX 는 결과 툴바에 **대체 뷰** 묶음을 넣어, 데이터를 다시 실행하지 않고 현재 결과 셋을 메모리에서 다른 형태로 표시합니다.

이 페이지가 다루는 것: **언제 뷰를 바꾸나, 각 뷰가 어떻게 계산되나, 어떤 데이터 형태를 요구하나, 산출물을 무엇으로 저장 가능하나**.

## 언제 뷰 전환이 그리드보다 직관적인가

| 데이터 형태 | 추천 뷰 | 전형적 시나리오 |
|---|---|---|
| 카테고리 컬럼 1개 + 숫자 컬럼 1개 | 막대 / 파이 / 도넛 | 도시별 매출, endpoint 별 오류 |
| 시간 컬럼 1개 + 숫자 컬럼 1개(연속) | 꺾은선 / 면적 | DAU 추세, CPU 사용 |
| 숫자 컬럼 2개(상관관계) | 산점 | 사용자 활성 vs 리텐션 |
| 카테고리 / 숫자 3개 컬럼 | 피벗 표 | 채널 × 월 = 수익 |
| `(lat, lng)` 2개 컬럼 | 지리 산점 | 매장 분포, 사용자 지도 |
| 시간 컬럼 1개 + label 컬럼 1개 | 타임라인 | 배포 이벤트, 주문 라이프사이클 |
| `(id, parent_id, ...)` | 자기 참조 FK 트리 | 댓글 계층, 조직 부서 |
| 같은 행의 다중 이력 | 행 변경 이력 | audit 표 추적 |

하단 바 트리거(`packages/ui/src/components/ResultGrid.vue:1202-1215`):

```vue
<button :disabled="!result?.rows.length" @click="chartOpen = true">📊 차트</button>
<div class="menu-box">
  <button @click="showViewMenu = !showViewMenu">📐 뷰</button>
  <!-- 팝업 메뉴 -->
  <button @click="altView = 'pivot'">⊞ 피벗</button>
  <button @click="altView = 'tree'">🌳 트리</button>
  <button @click="altView = 'geo'">🗺 지리</button>
  <button @click="altView = 'timeline'">⏱ 타임라인</button>
</div>
```

이 모든 뷰는 modal 에서 열리며, 닫으면 그리드로 복귀 — 그리드의 "돋보기" 이지 그리드를 대체하지 않습니다.

## 1. 차트 뷰(막대 / 꺾은선 / 파이 + 4종 확장)

`packages/ui/src/components/ChartDialog.vue`, **630 줄**, 트리거 버튼: **📊 차트**.

### 설계 선택

코드 코멘트가 솔직히 설명:

> ECharts 를 도입하지 않고 SVG 직접 작성(막대 / 꺾은선 + 파이 각각 100여 줄), 이유:
> - 데스크톱 앱 크기에 민감; 차트는 result grid 의 "작은 도구" 일 뿐, 메인 무대가 아님
> - 3종 차트가 임시 데이터 보기 시나리오의 90% 커버; 더 화려한 것이 필요하면 ECharts 로 업그레이드해도 늦지 않음
> - SVG 렌더링은 PNG 내보내기 쉬움(toDataURL via `<canvas>`)

7종 차트 모두 순수 손으로 쓴 SVG:

| 차트 | 적용 | 상한 | 비고 |
|---|---|---|---|
| 📊 막대(bar) | 카테고리 숫자 비교 | 처음 50 행 | Y 축 자동 round 상한 |
| 📈 꺾은선(line) | 추세 / 시계열 | 처음 200 행 | `M / L` 경로 |
| 🥧 파이(pie) | 비율 | 처음 50 행 | 자동 백분율 라벨 |
| ⛰ 면적(area) | 추세 + 양 | 처음 200 행 | 꺾은선을 baseline 으로 닫음 |
| ·· 산점(scatter) | 이산 점 구름 | 처음 200 행 | 원형 점 |
| ⭕ 도넛(donut) | 비율 변형 | 처음 50 행 | 외환 `r * 1.0`, 내부 구멍 `r * 0.55` |
| 📡 레이더(radar) | 다차원 비교 | 처음 50 행, 최소 3개 점 | 행당 축 1개 |

### 컬럼 선택

상단 바 3개 선택기: **Label**(임의 컬럼, `.toString()`), **Value**(숫자 컬럼 자동 스니핑, 비 숫자 컬럼 뒤에 `(?)` 표시), **타입**. `isNumericColumn` 이 처음 20 행으로 `Number.isFinite(Number(v))` 스니핑, 기본 Y 컬럼 = 첫 번째 숫자 컬럼. result 전환 시 `watch` 가 선택 리셋.

데이터 룰: `Number(v)` 가 NaN 인 행은 스킵, 행 수가 상한 초과 시 처음 N 행만 취득(막대 / 파이 50, 꺾은선 / 면적 / 산점 200, 레이더 50).

### Y 축

눈금을 "깔끔" 하게 보이도록, 상한은 `Math.ceil(m / 10^floor(log10(m))) * 10^floor(log10(m))` 으로 반올림. 눈금 숫자는 `B / M / k` 로 포매팅(1e9 / 1e6 / 1e4 초과 시).

### 산출물: PNG 내보내기

툴바 우측 `⬇ PNG 내보내기` → `XMLSerializer` 가 SVG 직렬화 → `<canvas>` 2× HiDPI 그리기(어두운 배경 `#1d1e22`) → `canvas.toBlob('image/png')` → 커스텀 `SaveFileDialog` 사용. 파일명 `chart-{kind}-{ts}.png`, 해상도 1440×720, 飞书 / Slack 에 바로 붙여넣기 적합.

## 2. 피벗 표(PivotDialog)

`packages/ui/src/components/PivotDialog.vue`, 162 줄. 트리거: **📐 뷰 → ⊞ 피벗**.

포지션: **메모리에서** 현재 결과 셋에 대해 pivot, SQL 재실행 안 함. 알고리즘 복잡하지 않음 — 행을 `(rowFields...)` 로 그룹화 → 그룹 내에서 `colField` 로 다시 버킷 → 버킷 내 `agg`.

### 3축 + 1개 집계 함수

| 컨트롤 | 동작 |
|---|---|
| **행**(chips 다중 선택) | 이 컬럼들로 그룹화, key 는 `'\|'` 로 조립 |
| **컬럼**(드롭다운) | 이 컬럼의 모든 distinct 값이 헤더 컬럼으로 전개(사전 순) |
| **값** + 집계 | 각 (row, col) 셀 내에서 해당 컬럼에 집계 |
| 집계 드롭다운 | `COUNT / SUM / AVG / MIN / MAX` |

### 알고리즘

2단계 중첩 `Map<rowKey, Map<colKey, number[]>>`: `result.rows` 를 한 번 스캔, `rowKey` 는 `rowFields` 각 컬럼 문자열을 `|` 로 조립, `colKey` 는 `colField` 의 문자열 값, `Number(row[valueField])` 를 배열에 넣음. `NULL` 은 일률 리터럴 `'NULL'` 으로(같은 그룹 집계). COUNT 는 `length` 사용, 나머지는 숫자 집계.

### 제약

코드 코멘트가 직접 언급:

> 미지원: 다중 value field, 정렬된 컬럼명(pivot 컬럼은 사전 순), 필터; 이들은 다음 버전에 보충 가능.

즉 — "월별로 정렬 1-12, 10, 11, 12, 1, 2... 가 아님" 을 그리고 싶다면 일시적으로 불가능, 먼저 SQL 에서 컬럼을 zero-padded 문자열(`'01' / '02' / ...`)로 변경 필요.

### 산출물

임시 표 뷰일 뿐, 직접 내보내기 불가. 데이터 영속화 권장 사항:

- 피벗 닫고 그리드로 복귀 → 우클릭 복사 → CSV / Markdown 선택하여 Excel / Notion 에 붙여넣기
- 피벗 로직을 SQL 로 재작성: MySQL 의 `GROUP BY x WITH ROLLUP` / PG 의 `crosstab()`

## 3. 지리 산점(GeoMapDialog)

`packages/ui/src/components/GeoMapDialog.vue`, 138 줄. 트리거: **📐 뷰 → 🗺 지리**.

leaflet 도입 안 함 / 베이스 맵 그리지 않음, SVG 산점으로 `(lng, lat)` 직접 그림. 코드 코멘트 설명:

> 투영: 등거리 등거리 투영(Mercator 시각 변형 작음, 로컬 데이터는 위경도 직접 그려도 충분, 복잡 좌표계 안 함).
> 안 함: 베이스 맵(tiles 도입 안 함), 클러스터링(점이 너무 많으면 흐려지지만 드래그 zoom 으로 해결 가능).

### 자동 컬럼 인식

```ts
latCol = cols.find(c => /^(lat|latitude|y)$/i.test(c)) ?? cols[0]
lngCol = cols.find(c => /^(lng|lon|long|longitude|x)$/i.test(c)) ?? cols[1]
labelCol = cols.find(c => /^(name|title|label|id)$/i.test(c)) ?? ''
```

숫자 합리성 강력 필터(쓰레기 데이터 방지):

```ts
if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
```

### 자동 뷰 박스

전체 세계 지도가 아닌, bounds 가 "모든 점을 딱 감싸기 + 5% 여백" 으로 계산:

```ts
const dx = Math.max(0.001, (maxX - minX) * 0.05)
return { minX: minX - dx, maxX: maxX + dx, ... }
```

네 모서리의 위경도 숫자는 SVG 가장자리에 표시, 마우스를 점에 올리면 `lat=... lng=...` 표시.

### 산출물

시각적 탐색용, PNG 내보내기 안 함(다음 버전에 보충 가능). 영속화 시각화를 원하면, SQL 출력에 카테고리 컬럼 추가하고 차트 뷰(산점)로 스크린샷도 가능.

### 데이터 형태 요구사항

| 호환 컬럼명 | 예 |
|---|---|
| `lat`, `latitude`, `y` | `latitude FLOAT` |
| `lng`, `lon`, `long`, `longitude`, `x` | `lng DECIMAL(9,6)` |
| `name`, `title`, `label`, `id`(label, 선택) | `store_name VARCHAR` |

표준 이름에 없어도 됨 — 드롭다운에서 수동 선택, 값이 숫자이며 범위 내이면 됨.

## 4. 타임라인(TimelineDialog)

`packages/ui/src/components/TimelineDialog.vue`, 171 줄. 트리거: **📐 뷰 → ⏱ 타임라인**.

### 자동 컬럼 인식

```ts
timeCol = cols.find(c => /at$|_time$|date|time|created|updated/i.test(c)) ?? cols[0]
labelCol = cols.find(c => /^(name|title|label|id|user|action)$/i.test(c)) ?? ''
colorCol = ''   // 선택: 이 컬럼으로 카테고리 컬러링
```

폴백으로 `created_at / updated_at / event_time / order_date / login_time` 등 매치.

### 시간 값 파싱(`toMs`)

4가지 형식 수용:

```ts
function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000   // ms 또는 s 휴리스틱
  const ms = Date.parse(String(v))  // ISO / "YYYY-MM-DD HH:MM:SS"
  return Number.isNaN(ms) ? null : ms
}
```

> 1e12(2001년) 이하 숫자는 Unix 초로 간주되어 1000 곱함; 이상은 ms 로 간주. 일반 비즈니스 시간으로 충분, 극소수 1969년 이전 타임스탬프는 잘못 판정될 수 있음 — 데이터에 있으면 먼저 SQL 에서 `to_char(...)` 로 문자열 변환.

### 렌더링

수평 타임라인, 이벤트 점은 위아래 엇갈리게 배치하여 중첩 방지(`i % 2 === 0 ? -16 : +16`), X 축에 5 등분 눈금으로 날짜 표시.

**color** 컬럼이 지정되면, distinct 값이 순차적으로 8색 팔레트(`#7c6cff / #4caf50 / #e0a020 / #e04050 / #3aa1ff / #b48cff / #67c23a / #ff9966`) 사용, 아래에 legend 표시. 점에 마우스 올리면 하단 정보 바에 `시간 · label` 표시.

### 데이터 형태 요구사항

최소한 시간 컬럼 1개(임의의 Date / ISO / Unix 초 또는 밀리초). Label / Color 는 선택.

## 5. 자기 참조 FK 트리(TreeViewDialog)

`packages/ui/src/components/TreeViewDialog.vue`, 130 줄. 트리거: **📐 뷰 → 🌳 트리**.

**자기 참조 외래 키** 또는 계층 데이터에 적합: 댓글 계층(`comments.parent_id → comments.id`), 조직 부서(`departments.parent_dept_id → id`), 지리 행정구(`regions.parent_id`).

### 세 개의 축

| 선택기 | 추론 규칙 |
|---|---|
| **id** | `/^id$/i` 매치 우선, 아니면 첫 컬럼 |
| **parent** | `/parent[_-]?id\|pid/i` 매치, 기본 비움 |
| **label** | `/^(name\|title\|label)$/i` 매치, 아니면 id 로 폴백 |

### 알고리즘

두 번 스캔: 첫 번째는 id 로 인덱스 빌드(`byId: Map<id, node>`), 두 번째는 자식을 부모 아래에 매달기; 부모 id 가 인덱스에 없음(NULL 포함) → 루트. `parent === self` 도 루트로 간주(`WHERE id=1 AND parent_id=1` 같은 가짜 레코드 방지).

### 사이클 감지

`walk(n, depth)` DFS 가 `Set<string>` 으로 방문 기록; 같은 id 재차 만나면 `n.cycle = true` 로 설정하고 멈춤. 해당 노드 옆에 황색 `⚠` 표시, 마우스 올리면 "사이클" 안내. 운영자가 데이터를 잘못 수정한 후 자주 발생(부모-자식 관계가 순환으로 그려져야 함).

### 렌더링

flatten 후 `depth * 18px` 들여쓰기, 각 노드에 `▸ <label> #<id>` 표시. label 에 마우스 올리면 `title="{json}"` 으로 완전한 행 데이터 표시(빠른 육안 검사).

### 데이터 형태 요구사항

최소 id + parent 2개 컬럼; `SELECT id, parent_id, name FROM comments WHERE post_id = 1234` 한 문장으로 전체 트리를 한 번에 가져오면, 뷰가 자동으로 계층 렌더링.

## 6. 행 변경 이력(RowHistoryDialog)

`packages/ui/src/components/RowHistoryDialog.vue`, 123 줄.

포지션: **단일 행 버전 추적** — 주어진 테이블의 어떤 행의 기본 키로, `audit / *_history / *_log` 섀도우 테이블에서 모든 버전을 찾음.

### 섀도우 테이블 자동 발견

열 때 자동으로 `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '{base}_%' OR table_name = 'audit_{base}' OR table_name = '{base}_history'` 실행, 후보를 `<datalist>` 드롭다운에 입력, 사용자가 선택 또는 수동 입력 가능.

### 이력 조회

섀도우 테이블 확정 후, PK 조건으로 `SELECT * FROM {shadow} WHERE {pk}=... ORDER BY changed_at, updated_at, created_at, version, revision DESC LIMIT 200` 조회. ORDER BY 가 5개 후보 컬럼명을 한 번에 나열, 데이터베이스가 존재하는 것을 사용(MySQL 관대 / PG 엄격, 일반 audit 표는 최소 하나 있음). 결과는 컴팩트 미니 표로 표시, 각 셀은 80자로 자름.

### 데이터 형태 요구사항

비즈니스 테이블 + `*_history` / `*_audit` / `*_log` 섀도우 테이블(기본 키 + 비즈니스 컬럼 중복 + `changed_at / version` 필드) 필요. 일반 audit trigger 구현은 모두 이 규약을 만족.

> 구현 노트: 이 다이얼로그는 저장소에 이미 작성되어 있고(`Workspace.vue` 에 `rowHistOpen` 상태와 modal 마운트 있음), 결과 그리드 우클릭으로 직접 열리는 진입점은 아직 없음 — 현재는 후속 우클릭 메뉴를 위해 예약된 기능.

## 7. 데이터 리니지(LineageDialog) — 휴리스틱 버전

`packages/ui/src/components/LineageDialog.vue`, 98 줄.

코드 코멘트가 단도직입:

> 컬럼 리니지(휴리스틱 버전): 실제 SQL parser 가 아직 없어, 가장 단순한 휴리스틱 사용 — 과거 SQL 텍스트에 「`{table}.{column}`」또는 노출 `{column}`(SQL 에서 `{table}` 을 FROM 한 전제) 출현 시 관련된 것으로 간주.
> 정확도 제한적: 누락(별칭 / 서브 쿼리), 오탐(동명 컬럼). 사용자에게 이것이 「heuristic」버전이며, SQL parser 출시 후 진짜 리니지 분석으로 교체될 것임을 명확히 안내.

### 알고리즘

본 연결의 최근 500건 이력 SQL 가져옴, 항목별로 `\b{table}\b` + `\b{column}\b` 두 개의 word-boundary 정규식으로 텍스트 매치. 매치 후 시작 부분 확인: `INSERT / UPDATE` → sinks(쓰기) 진입, `SELECT / WITH` → sources(읽기) 진입.

### 렌더링

이중 컬럼:

- **← Sinks** — 이 컬럼에 데이터를 **쓰는** SQL(INSERT / UPDATE)
- **→ Sources** — 이 컬럼에서 데이터를 **읽는** SQL(SELECT / WITH)

각 행은 실행 시간 + 처음 120자 SQL 요약 표시. 상단 황색 바에서 "이는 휴리스틱 결과, 감사 근거로 사용 불가" 안내.

### 데이터 형태 요구사항

**쿼리 이력**(`client.connections.history`) 의존. SkylerX 에서 관련 쿼리를 한 적 없으면, 리니지 창에 "No hits" 표시.

> 구현 노트: RowHistoryDialog 와 동일, `Workspace.vue` 에 마운트되어 있고 외부 trigger 필요(`lineageOpen.value = {...}`), 현재 전용 UI 진입점 없음, 예약 API 로 사용.

## 지원 매트릭스

| 뷰 | 자동 컬럼 인식 | 데이터 규모 상한 | 정적 내보내기 | SQL 재실행 | 적합 |
|---|---|---|---|---|---|
| 차트(7종) | 숫자 컬럼 스니핑 | 50 / 200 행 | PNG(2× HiDPI) | 아니오 | 한 번에 양 / 추세 / 비율 명확히 보기 |
| 피벗 표 | 첫/둘/셋째 컬럼 | 브라우저 메모리에 의존 | CSV 로 복사 | 아니오 | 이중 축 교차 집계 |
| 지리 산점 | `lat / lng / x / y` 별칭 | 상한 없음 | 아니오 | 아니오 | 위경도 직접 그리기 |
| 타임라인 | `at$ / time / date / created` 접미사 | 상한 없음 | 아니오 | 아니오 | 이벤트 흐름 + 카테고리 컬러링 |
| 트리 | `id / parent_id / name` | 상한 없음 | 아니오 | 아니오 | 자기 참조 FK 계층 |
| 행 이력 | 테이블명 `*_history / *_audit` 휴리스틱 | 200 행(SQL LIMIT) | 아니오 | ✓(audit 표 조회) | 단일 행 버전 추적 |
| 데이터 리니지 | — | 이력 500건 | 아니오 | 아니오 | 컬럼 읽기/쓰기 관계(휴리스틱) |

## 트리거 방법 일람

| 뷰 | 진입점 | 비고 |
|---|---|---|
| 차트 | 결과 툴바 `📊 차트` | 막대 차트 기본으로 직접 열기 |
| 피벗 / 트리 / 지리 / 타임라인 | 결과 툴바 `📐 뷰 → 팝업 메뉴` | 동일 modal 이 `altView` 상태 공유 |
| 행 이력 | `rowHistOpen.value = { conn, table, pk }` 로 트리거 | 현재 예약, 우클릭 메뉴 통합 대기 |
| 데이터 리니지 | `lineageOpen.value = { conn, table, column }` 로 트리거 | 현재 예약, 우클릭 메뉴 통합 대기 |

모든 modal 이 닫힌 후 원래 그리드로 복귀, 페이지네이션 / 정렬 상태 손실 없음 — 그리드 위에 "돋보기" 한 레이어를 겹친 것일 뿐, 결과 셋 자체를 대체하지 않음.

## 뷰 선택의 작은 의사 결정 트리

**양 / 순위 / 추세 / 비율** 보기? → 차트
- 양 vs 시간 → 꺾은선 / 면적
- 카테고리 순위 → 막대
- 비율 → 파이 / 도넛
- 다차원 → 레이더

**이중 축 교차** 보기?(예: "채널 × 월") → 피벗

데이터에 **`(lat, lng)`** → 지리 산점

데이터에 **시간 컬럼**:
- 시계열 값 연속(매일 DAU) → 꺾은선
- 이산 이벤트(배포, 출시, 경보) → 타임라인

데이터 **자기 참조 FK** → 트리

**한 행의 이력 변화** 보기 → 행 이력

**이 컬럼을 누가 읽고 누가 쓰는지** 찾기 → 데이터 리니지(휴리스틱, 신중히 사용)

여기까지 결과 셋 레이어의 모든 대체 뷰를 커버했습니다. 데이터 형태가 위 어느 것에도 해당하지 않으면, 90% 의 경우 SQL 을 약간 재작성하면 어느 뷰에 끼워 넣을 수 있습니다 — 정말 방법이 없으면 그리드로 돌아가 복사 기능으로 Excel / Numbers / Notion 에 붙여넣어 이어서 처리.

SQL 자체의 실행 상태(슬로우 로그, Explain, 인덱스 추천)를 보려면 [고급 및 엔지니어링](./advanced.md) 참고; 데이터 내보내기/가져오기는 [데이터 마이그레이션](./databases.md) 참고.
