# NoSQL 심층 사용 가이드 — MongoDB / Redis / Elasticsearch

SkylerX 는 NoSQL 을 1급 시민으로 취급, SQL 데이터베이스와 동일한 메타데이터 트리, 동일한 연결 관리, 동일한 AI 어시스턴트를 사용하지만, 저변은 **병렬 채널(executeCommand)** 사용 — 자세한 사항은 [ARCHITECTURE](https://github.com/duhbbx/SkylerX/blob/main/ARCHITECTURE.md). 본 문서는 데이터베이스별로 UI 기능과, 드라이버에 **실제 노출** 된 op 와 파라미터를 설명합니다.

## 개요 — 병렬 채널과 SQL 채널의 관계

`DataClient` 는 상호 독립된 두 진입점 노출:

| 채널 | 진입점 | 적용 |
|---|---|---|
| SQL | `connections.execute(sql)` | MySQL / PostgreSQL / Oracle / ... |
| 명령 | `connections.executeCommand({ op, args, context, maxRows? })` | MongoDB / Redis / Elasticsearch |

NoSQL 드라이버의 `execute()` 는 직접 `SQL_CHANNEL_UNSUPPORTED` throw:

```ts
// packages/core-driver/src/dialects/mongo.ts
async execute(): Promise<QueryResult> {
  throw new Error('SQL_CHANNEL_UNSUPPORTED: MongoDB는 SQL 미지원, executeCommand 사용')
}
```

`executeCommand` 가 실제 일하는 진입점, **각 드라이버가 자체 op 딕셔너리 커스터마이징**. 본 문서의 나머지 절은 이 딕셔너리를 명확히 설명합니다.

공통 규약:

- `context` 가 **대상 객체** 운반(MongoDB 의 `database` / `collection`, Redis 의 `dbIndex`, ES 의 `collection` = index).
- `args` 는 해당 op 자체의 파라미터 객체 / 배열(Mongo / ES 는 객체, Redis 는 위치 파라미터 배열).
- `maxRows` 는 컬렉션을 반환하는 읽기 작업에만 의미 있음, 드라이버가 `limit/size + 1` 로 한 건 더 가져와 `truncated` 식별.
- 반환값은 모두 `CommandResult`: `{ data, executionTimeMs, affected?, truncated? }`.

---

## MongoDB

### 트리 구조

```
Connection
└── Database (다중)
    └── Group "컬렉션" (count)
        └── Collection (kind = Table, SQL 테이블 노드 재사용)
```

드라이버 구현:

- `listDatabases` 는 `admin().listDatabases()` 호출.
- `databaseGroups` 는 `listCollections({}, { nameOnly: true })` 로 컬렉션 수 가져와 `count` 에 입력.
- `listCollections` 는 정렬 후 `kind: Table` 노드로 생성, 프론트는 `connection.dialect === 'mongodb'` 일 때 `MongoPane` 으로 렌더링.

### 컬렉션 브라우저(`MongoPane.vue`)

Collection 노드 열면 이 컴포넌트로 떨어짐, 상단 3개 섹션:

1. **빵 부스러기** `database · collection`, 새로고침 / 수정 제출 / 수정 취소와 나란히.
2. **JSON Filter textarea + limit / skip + 표 / JSON 뷰 전환**.
3. **결과 영역** — 표 뷰는 행 셋 첫 레이어 필드 합집합으로 컬럼, 또는 `rows.value` 의 JSON 직접 렌더링.

실행 버튼이 실제 호출하는 것은 `find`:

```ts
await client.connections.executeCommand(conn.id, {
  op: 'find',
  args: {
    filter,
    options: { limit, skip },
  },
  context: { database, collection },
  maxRows: 500,
})
```

테이블 헤더는 `rows` 의 첫 레이어 필드 합집합으로 동적 계산, schemaless 컬렉션도 표시 가능. `_id` 컬럼이 24-hex 문자열이면 `ObjectId("...")` 로 렌더링, 저변이 BSON ObjectId 임을 안내(IPC 가 이미 문자열로 직렬화).

### 편집 가능 그리드 → updateOne(dot-path)

`_id` 가 아닌 셀 더블 클릭으로 inline 편집 진입(`_id` 컬럼 금지). 에디터에 **유효한 JSON** 입력, Enter 확인. dirty 셀 강조, 상단 "수정 제출 (N)" 이 항목별로 `updateOne` 호출.

diff 알고리즘은 `diffToOps()`:

- 양쪽 모두 plain object 아님 → 전체 필드 `$set`(배열 전개 안 함, 인덱스 어긋남 회피).
- 양쪽 모두 plain object → key 합집합 재귀; 신규만 → `$set`; 구만 있음 → `$unset`; JSON 동등 → 스킵.
- 경로를 dot-path 로 압축, 예: `addr.city = '...'`.

최종 요청 형태:

```ts
{
  op: 'updateOne',
  args: {
    filter: { _id: { $oid: '65f1...' } },
    update: { $set: { 'addr.city': 'BJ' }, $unset: { 'addr.zip': true } },
    options: {},
  },
  context: { database, collection },
}
```

### ObjectId 자동 래핑(`$oid` marker ↔ driver 구현)

ObjectId 가 IPC 경계에서 원래 타입 손실(문자열로 변환), 양방향 **marker** 규약:

- UI 회신 시: `wrapOidStrings()` 가 재귀적으로 모든 24-hex 문자열을 `{ $oid: 'hex' }` 로 래핑.
- 드라이버 수신 후: `normalizeIds()` 가 `_id` 필드 아래의 24-hex 문자열을 직접 `new ObjectId(hex)` 로 래핑.

드라이버 레이어는 **보수적 전략**: 키명 === `_id` 인 필드만 자동 변환, 다른 키는 건드리지 않음. 이유는 `mongo.ts` 코멘트에 직설적으로: ObjectId 처럼 보이는 일반 문자열(예: 일부 해시 ID)을 잘못 망가뜨리는 것 회피. 이는 `userId / refId` 같은 참조 ObjectId 필드로 조회하려면, `{ $oid: '...' }` marker 를 직접 사용하거나 완전한 `EJSON` 작성 필요함을 의미.

`_id` 연산자 객체도 재귀 처리되므로, 다음은 모두 정상 작동:

```jsonc
{ "_id": "65f1aa..."                                      } // → ObjectId
{ "_id": { "$in": ["65f1aa...", "65f2bb..."]              }} // 배열 멤버
{ "_id": { "$eq": "65f1aa...", "$exists": true            }} // 연산자 객체
{ "$or": [{ "_id": "65f1aa..." }, { "name": "x" }]         } // 중첩 쿼리
```

### Aggregation 파이프라인(`MongoAggregationDialog.vue`)

좌측 stage 카드 리스트(상하 이동 가능, 삭제 가능), 우측 결과. 각 stage 는 독립 JSON textarea. `STAGE_TEMPLATES` 가 자주 쓰는 10종 stage 원클릭 삽입:

`$match` · `$project` · `$group` · `$sort` · `$limit` · `$skip` · `$unwind` · `$lookup` · `$addFields` · `$count`

실행 시 순서대로 `{ [stage.op]: JSON.parse(stage.json) }` 로 파이프라인 조립, 호출:

```ts
{
  op: 'aggregate',
  args: {
    pipeline,
    options: { allowDiskUse: true, maxTimeMS: 30000 },
  },
  context: { database, collection },
}
```

stage JSON 파싱 실패 → 전체 파이프라인 오류 보고 및 표시. 결과는 기본 처음 `limit`(UI 의 미니 입력 박스, 1-1000) 건 JSON 전문 표시. `details` 영역에 "파이프라인 JSON 보기" 있어, mongosh 에 복사하여 재현 편리.

### 컬렉션 메타 정보(`MongoCollectionInfoDialog.vue`)

두 개의 탭:

**통계**(`collStats`): `count` / `size` / `avgObjSize` / `storageSize` / `nindexes` / `totalIndexSize`, 모든 크기는 사람이 읽기 쉬운 단위로.

**인덱스** — `listIndexes` + 표(name / keys / unique / sparse / ttl / size) + 인덱스 생성 폼. 인덱스 생성 시:

- 필드 행은 여러 행 추가 가능, 방향은 `1 / -1 / text / 2dsphere` 선택.
- 선택적 `name / unique / sparse / expireAfterSeconds`.
- 백그라운드에서 `createIndex` op 호출, 파라미터 형태: `{ key: { field1: 1, field2: -1 }, unique?, sparse?, expireAfterSeconds? }`.

인덱스 삭제는 `dropIndex` op 호출, UI 가 `_id_` 기본 인덱스 삭제 막음.

### 드라이버 지원 op(전체 리스트)

`mongo.ts` 의 switch 가 실제 나열하는 op:

| 분류 | op | 필수 args | 설명 |
|---|---|---|---|
| 읽기 | `find` | `filter`, `options?` | 커서 toArray; maxRows → `limit+1` 로 truncated 감지 |
| 읽기 | `findOne` | `filter`, `options?` | 단일 문서 |
| 읽기 | `aggregate` | `pipeline`, `options?` | 파이프라인, maxRows 동일 |
| 읽기 | `countDocuments` | `filter`, `options?` | |
| 읽기 | `distinct` | `field`, `filter?`, `options?` | |
| 쓰기 | `insertOne` | `document`, `options?` | `affected = acknowledged ? 1 : 0` |
| 쓰기 | `insertMany` | `documents`, `options?` | `affected = insertedCount` |
| 쓰기 | `updateOne` / `updateMany` | `filter`, `update`, `options?` | `affected = modifiedCount` |
| 쓰기 | `replaceOne` | `filter`, `document`, `options?` | |
| 쓰기 | `deleteOne` / `deleteMany` | `filter`, `options?` | `affected = deletedCount` |
| DB | `runCommand` | 전체 `args` 를 command 로 직접 `db.command()` | 폴백 진입점 |
| DB | `listCollections` | `filter?`, `options?` | |
| DB | `createCollection` | `name`, `options?` | |
| DB | `dropCollection` | `name` | |
| 인덱스 | `collStats` / `listIndexes` / `createIndex` / `dropIndex` | `MongoCollectionInfoDialog` 참조 | `runCommand` 경유 |

> 표에 없는 op 는 일률 `UNKNOWN_OP`. 신규 추가는 `mongo.ts` 의 switch 에 작성, 우회하여 클라이언트 임의 API 사용 금지.

---

## Redis

### 트리 구조

```
Connection
└── Database  db0..db15 (16개 고정 논리 DB, count 는 INFO keyspace 에서)
    └── Group "Strings / Hashes / Lists / Sets / Sorted Sets / Streams"
        └── Key (SCAN 샘플링, 상한 200)
```

`listDatabases` 가 한 번의 `INFO keyspace` 로 16개 DB 의 `keys=N` 전부 가져옴, 빈 DB 는 count 안 달아 노이즈 회피.

`listTypeGroups` 는 `DBSIZE` 확인: `<= 100 000` 이면 전체 DB SCAN + pipeline TYPE 으로 각 그룹의 정확한 count 통계; 초대형 DB 는 통계 포기, 그룹 노드만 부착.

`sampleKeysByType` 는 그룹 선택 시 SCAN + pipeline TYPE 필터, 최대 `SCAN_SAMPLE_LIMIT = 200` 건 샘플링, 스캔 예산 약 `ROUND_CAP × COUNT = 50 × 200 = 10000 key`. 부족하면 `... (더 많음, SCAN 명령 사용)` 행 부착하여 사용자에게 `RedisSearchDialog` 사용 안내.

### Key 브라우저(`RedisPane.vue`)

좌측 SCAN 리스트 + MATCH 검색 박스, 우측은 현재 선택된 key 의 TYPE 에 따라 대응 뷰 렌더링. 하단 "더 로드" 가 SCAN 커서를 계속 푸시, 드라이버가 cursor='0' 반환할 때까지.

로딩 흐름:

1. `SCAN <cursor> MATCH <match> COUNT 500` — `[nextCursor, batch]` 가져옴.
2. 신규 key 를 청크(`TYPE_PIPELINE_CHUNK = 200`)로 동시 `TYPE` 가져옴.
3. `keys.value` 에 추가, 커서 진행.

정렬은 name / type / ttl 3종 지원, 내림차순 / 오름차순 전환; ttl 컬럼 기본 비활성, "TTL" 버튼 클릭해야 일괄 가져옴(key 당 한 번 `TTL`, 청크 100 동시). 다중 선택 후 일괄 `EXPIRE / PERSIST / UNLINK` 가능.

### 각 타입별 value 렌더링

드라이버 `executeCommand` 가 `ioredis.call(op, ...args)` 로 투과, UI 가 직접 원시 Redis 명령 발행. 다음은 `RedisPane` 가 key 선택 후 자동 실행하는 명령:

| TYPE | 작은 셋(≤ `PAGE_SIZE = 100`) | 큰 셋(페이지네이션 로딩) |
|---|---|---|
| `string` | `GET key` | — |
| `hash` | `HGETALL key` | `HSCAN key cursor COUNT 100` |
| `list` | `LRANGE key 0 LIST_PAGE-1`(`LIST_PAGE = 200`) | 페이지 넘김으로 `LRANGE` 계속, `LLEN` 으로 경계 비교 |
| `set` | `SMEMBERS key` | `SSCAN key cursor COUNT 100` |
| `zset` | `ZRANGE key 0 -1 WITHSCORES` | `ZSCAN key cursor COUNT 100` |
| `stream` | `XRANGE key - + COUNT 50` | — |

stream entry 의 구조는 `[id, [f1, v1, f2, v2, ...]]`, UI 가 스스로 `{ id, fields: [[k, v], ...] }` 로 파싱.

#### 추가 뷰(동일 저변 TYPE 의 다양한 해석)

Redis 는 HyperLogLog / Bitmap 을 모두 string 에 저장, Geo 는 zset 에 저장 — `TYPE` 명령은 구분 불가, UI 상단에서 수동 전환 제공:

- **HLL**(string) → `PFCOUNT key` 로 cardinality 추정, 오차 ≈ 0.81%.
- **Bitmap**(string) → `BITCOUNT key`(총수) + 범위 `BITCOUNT key start end` + 단일 bit `GETBIT key offset`.
- **Geo**(zset) → 먼저 `ZRANGE key 0 -1` 로 멤버 가져옴, 다음 한 번의 `GEOPOS key m1 m2 ...` 로 전체 위경도 가져옴. GEOPOS 는 미존재 / 비 geo 멤버에 nil 반환, UI 는 `null` 로 표시.

잘못 전환(예: 일반 string 을 HLL 로) 시 Redis 가 `WRONGTYPE` 응답, 오류 배너에 직접 표시.

### 인라인 편집

string / hash / list / set / zset 모두 편집 모드 지원 — 상단 "편집" 버튼으로 진입, UI 가 draft 유지, 저장 시 타입별로 최소 명령 셋 생성:

- string → `SET key value`
- hash → `HDEL key f1 f2 ...` + `HSET key f1 v1 f2 v2 ...`
- list → 변경된 index 만 `LSET key i v` 호출
- set → `SADD key m1 m2 ...` 와 `SREM key m1 m2 ...`
- zset → `ZREM key m1 m2 ...` 와 `ZADD key s1 m1 s2 m2 ...`

stream 은 일시적으로 인라인 편집 미지원(의미가 너무 무거움).

### Key 생성(`RedisNewKeyDialog.vue`)

5가지 타입의 시각화 생성 지원:

| 타입 | 명령 | UI 입력 |
|---|---|---|
| String | `SET key value` | textarea |
| Hash | `HSET key f1 v1 ...` | field/value 행(증감 가능) |
| List | `RPUSH key v1 v2 ...` | 다중 행 textarea, 한 행 한 항목 |
| Set | `SADD key m1 m2 ...` | 다중 행 textarea, 자동 중복 제거 |
| Sorted Set | `ZADD key s1 m1 s2 m2 ...` | 다중 행 `<score> <member>` |

TTL 선택, > 0 이면 `EXPIRE key ttl` 추가. 제출 전 `EXISTS key` 사전 검사, 이미 존재 시 직접 거부(덮어쓰기 불허). stream 미지원 — `XADD` 는 id + field/value 필요, `RedisPane` 의 명령 입력 박스에서 직접 보내는 것이 더 편리.

### 명령 입력 박스

`RedisPane` 상단 두 번째 행에 범용 명령 에디터, 공백으로 단어 분할 후:

```ts
const op = tokens[0].toUpperCase()
const args = tokens.slice(1)
await client.connections.executeCommand(conn.id, {
  op,
  args,
  context: { dbIndex },
})
```

드라이버의 `executeCommand` → `client.call(op, ...args)` 로 직접 통과, Redis 모든 명령이 여기서 실행 가능(`DEBUG SLEEP`, `OBJECT ENCODING`, `CONFIG REWRITE` 등 포함). **주의**: 명령 파싱은 따옴표 이스케이프 처리 안 함, `SET key "value with space"` 가 4개 토큰으로 분할됨, 공백 있는 값은 `NewKey` 팝업 또는 Lua 스크립트 사용.

### 큰 key 스캔(`RedisBigKeysDialog.vue`)

전체 DB SCAN + key 별 `MEMORY USAGE`(기본 SAMPLES 5, O(N) 샘플링). 청크당 20 key 동시, 청크 간 순차, "정지" 버튼으로 중단 가능. 결과는 바이트 내림차순으로 상위 N(기본 100) 표시, `:` 접두사로 "user / cache / session" 같은 비즈니스 버킷팅 집계, top 8 을 가로 막대 그래프로 렌더링, 어느 접두사가 가장 메모리를 먹는지 직관적으로 보임.

> 수십만 key 의 DB 는 느리고 CPU 점유, 스캔 시 다른 클라이언트가 느낄 수 있음. 저피크에 실행하거나 MATCH 로 범위 축소 권장.

### 실시간 명령 흐름 모니터링(`RedisMonitorDialog.vue`)

**핵심 trade-off**: Redis 원시 `MONITOR` 는 blocking 모드, 현재 연결을 독점, 우리의 요청-응답 채널과 충돌. 따라서 이 패널은 차선책으로, N 초마다(기본 2000ms) 한 번 가져옴:

- `INFO stats` → `total_commands_processed` / `keyspace_hits` / `keyspace_misses` / `instantaneous_ops_per_sec`
- `INFO clients` → `connected_clients`
- `INFO memory` → `used_memory`

최근 60개 샘플을 역순 스크롤 표로 표시, 자동으로 히트율 계산. 명령별 상세를 보려면 터미널에서 `redis-cli MONITOR` 사용, 문구에도 명시.

### 서버 측 패널(`RedisServerInfoDialog.vue`)

7개 탭, 각각이 Redis 관리 명령 하나 / 그룹에 대응:

| Tab | 명령 | 내용 |
|---|---|---|
| INFO | `INFO` | `# Section` 별 블록, memory 필드는 자동으로 사람이 읽기 쉬운 단위로 |
| 슬로우 로그 | `SLOWLOG GET 128` + `CONFIG GET/SET slowlog-log-slower-than` + `SLOWLOG RESET` | id / ts / 소요 μs / 명령 / 클라이언트 |
| 클라이언트 | `CLIENT LIST` + `CLIENT ID` + `CLIENT KILL ID <id>` | self 행에 녹색 표시로 오 종료 방지 |
| 명령 통계 | `INFO commandstats` | `usec_per_call` 내림차순 |
| CONFIG | `CONFIG GET *` + `CONFIG SET k v` | 행 클릭으로 인라인 편집, 필터 지원 |
| Cluster | `CLUSTER INFO` + `CLUSTER NODES` | slot 분포 컬러 바(0-16383), master id 해시로 컬러링; 비 cluster 모드는 오류 보고 및 원인 명시 |
| Sentinel | `SENTINEL MASTERS` | 비 sentinel 노드도 원인 명시 |

상단 "5s 자동 새로고침" 체크 시 현재 탭을 반복 refresh, 팝업 닫으면 자동으로 timer 정리.

### Lua / Functions(`RedisScriptDialog.vue`)

두 개의 탭.

**Lua tab**:

- 에디터 + KEYS / ARGV 입력(공백 구분).
- `▶ EVAL` → `EVAL <script> <numKeys> KEYS... ARGV...`
- `SCRIPT LOAD` 로 sha 가져옴, UI 상태에 캐시; `EVALSHA <sha>` 로 재생; `SCRIPT FLUSH` 로 server 비움.
- 로컬 저장: `localStorage['skylerx.redis.lua.<connId>']` 에 저장, 세션 간 보존.

**Functions tab**(Redis 7+):

- `FUNCTION LIST WITHCODE` → 각 라이브러리의 `library_name / engine / functions[].name / library_code` 파싱.
- 에디터에 library code 붙여넣기 → `FUNCTION LOAD [REPLACE] <code>`.
- `FUNCTION DELETE <lib>` 로 라이브러리 삭제.
- 라이브러리명 클릭으로 `library_code` 를 에디터로 가져올 수 있음.

에디터가 textarea(Monaco 아님)임에 주의 — 의도적인 라이트 선택, 더 복잡한 에디터가 필요하면 터미널에서 편집 후 붙여넣기.

### 전역 SCAN 검색(`RedisSearchDialog.vue`)

16개 논리 DB 를 가로지르는 MATCH 검색:

- 상단에 pattern + 16개 db 체크박스 입력(기본 전체 선택), "전체 선택 / 전체 해제".
- 선택된 db 를 순차 순회, 각 db `SCAN cursor MATCH ... COUNT 500`; 매치 후 동시 `TYPE / TTL`.
- 단일 DB 매치 `> SCAN_PER_DB_LIMIT = 5000` 면 직접 절단 + toast 안내.
- 결과 표 행 클릭 → `pick(db, key)` emit, 외부 Workspace 가 대응 `RedisPane` 으로 전환하여 `pendingKey` 로 위치 결정.

### 가져오기 / 내보내기(`RedisImportExportDialog.vue`)

형식은 커스텀 JSON 사용(RDB 안 함), DB 간 / 인스턴스 간 마이그레이션 편의:

```json
[
  { "db": 0, "key": "...", "type": "string", "ttl": 3600, "value": "..." },
  { "db": 0, "key": "...", "type": "hash", "ttl": -1, "value": { "f": "v" } },
  { "db": 0, "key": "...", "type": "zset", "ttl": 0, "value": [{ "member": "a", "score": "1" }] },
  { "db": 0, "key": "...", "type": "stream", "ttl": -1, "value": [{ "id": "1-0", "fields": [["f","v"]] }] }
]
```

**내보내기**: 현재 db 를 `SCAN MATCH`, 각 key 에 대해 `TYPE / TTL / 대응 구조 데이터` 가져옴, 순차 dump 로 수십 IPC 동시 회피, 마지막으로 `client.files.saveText` 로 네이티브 저장 다이얼로그 호출.

**가져오기**: JSON 열기 → `type` 별로 명령 복원: string → `SET`, hash → `HSET`, list → `RPUSH`, set → `SADD`, zset → `ZADD`, stream → entry 별 `XADD`. 충돌 전략 `skip`(기본) / `overwrite`(먼저 `DEL`). `ttl > 0` 이면 `EXPIRE` 추가.

알려진 제약: **stream 은 consumer group 미동반**; `XINFO` / `XGROUP` 등은 별도 처리 필요.

---

## Elasticsearch

### 트리 구조

```
Connection
└── Index (편평, Database 레이어 없음)
    └── Field (getMapping 의 properties 출처)
```

구현:

- `listIndices` 는 `client.cat.indices({ format: 'json' })` 호출, `.` 시작 시스템 인덱스 필터(연결 `extra.showSystemIndices = true` 로 필터 끔).
- `listFields` 는 `client.indices.getMapping({ index })` 호출, `mappings.properties` 가져옴, 필드 `detail.dataType = prop.type`(기본 `object`).

### 쿼리 패널(`ElasticPane.vue`)

- 상단 빵 부스러기(index) + "새로고침" 버튼 + 상단 `docs.count` badge(독립 `count` 호출로 가져옴).
- 중앙 textarea 에 Query DSL 작성, 옆에 `op` 선택: `search` / `count` / `getMapping`.
- 하단 "실행", 우측 "표 / 원시 JSON" 뷰 전환.

실행 시:

```ts
await client.connections.executeCommand(conn.id, {
  op,                                  // 'search' | 'count' | 'getMapping'
  args: { index, body },               // body 는 textarea 에서 파싱된 JSON
  context: { collection: index },      // 두 경로 모두 입력, 드라이버 needIndex() 폴백
  maxRows: 500,                        // search 에만 실제 적용
})
```

`getMapping` 은 body 불필요; `count` 는 body 를 `{ query: ... }` 로 투과.

### 표 뷰 vs 원시 JSON

- `search` 결과: 컬럼 = `_id` + `hits.hits[*]._source` 필드 합집합, 값은 `cellOf(hit, col)` 로 가져옴(`_id` 는 `hit._id`, 나머지는 `hit._source[col]`).
- 상단 `total: N · took: M ms` 는 `data.hits.total`(`{ value: N }` 또는 구 버전 number) + `executionTimeMs` 출처.
- `count` / `getMapping` 은 "행" 개념 없으므로, 표 뷰도 원시 JSON 으로 떨어짐.
- 어느 op 든 상단 toggle 로 raw JSON 전환 가능.

### `search` 의 `maxRows` 동작(truncated 감지)

드라이버의 이 부분이 특별히 주목할 만함:

```ts
case 'search': {
  const params = { index, ...body }
  let probeTruncated = false
  if (typeof maxRows === 'number' && body.size == null) {
    params.size = maxRows + 1            // 한 건 더 탐사
    probeTruncated = true
  }
  const res = await this.client.search(params)
  const data = unwrap(res)
  if (probeTruncated && data?.hits?.hits?.length > maxRows) {
    data.hits.hits = hits.slice(0, maxRows)
    return { data, executionTimeMs, truncated: true }
  }
  return { data, executionTimeMs }
}
```

핵심:

- **사용자가 DSL 에서 `size` 명시했으면 건드리지 않음**(사용자 의도 존중).
- `size` 안 썼을 때만 `maxRows + 1` 로 탐사; 매치 > maxRows 면 잘라내고 `truncated: true` 반환.
- 반환 구조는 ES 원본 `{ hits: { hits, total } }` 보존, `hits.hits` 만 잘라낸 것.

### 드라이버 지원 op(전체 리스트)

`elasticsearch.ts` 의 switch 가 실제 나열하는 것:

| 분류 | op | 필수 args | 사용하는 client 메서드 |
|---|---|---|---|
| 문서 읽기 | `search` | `index?`, `body?` | `client.search({ index, ...body })` |
| 문서 읽기 | `get` | `index?`, `id` | `client.get({ index, id })` |
| 문서 읽기 | `count` | `index?`, `query?` | `client.count({ index, query })` |
| 문서 쓰기 | `index` | `index?`, `document`, `id?` | `client.index({ index, document, id? })`, `affected = 1` |
| 문서 쓰기 | `update` | `index?`, `id`, `doc?`, `body?` | `client.update({ index, id, doc, ...body })`, `affected = 1` |
| 문서 쓰기 | `delete` | `index?`, `id` | `client.delete({ index, id })`, `affected = 1` |
| 문서 쓰기 | `bulk` | `operations[]` | `client.bulk({ operations })`, `affected = items.length` |
| 인덱스 관리 | `indices.create` / `indices.delete` / `indices.getMapping` / `indices.refresh` | `args` 를 `client.indices.<sub>` 로 투과 | |
| cat | `cat.indices` / `cat.health` / `cat.nodes` | 투과 + 기본 `format: 'json'` | |
| 폴백 | `raw` | `method`, `path`, `body?`, `querystring?` | `client.transport.request(...)`, 임의 REST 투과 |

`needIndex()` 가 `context.collection` 또는 `args.index` 폴백으로 타겟 인덱스 가져옴; 둘 다 없으면 `MISSING_INDEX` throw.

`unwrap(res)` 가 ES 8(기본 body 직접 반환)과 구 버전 v7 `{ body, statusCode, headers, warnings, meta }` 구조 동시 호환, UI 는 클라이언트 버전 관심 없음.

---

## 병렬 채널 계약(간단 요약)

여기까지 읽으면 3개 드라이버 차이가 크다는 것을 발견하지만, 프론트에 대한 계약은 항상 일관:

```ts
interface CommandRequest {
  op: string                   // 드라이버 커스텀 딕셔너리
  args?: unknown               // Mongo/ES 는 객체, Redis 는 위치 배열
  context?: {                  // 대상 객체
    database?: string          // Mongo
    collection?: string        // Mongo / ES (= index)
    dbIndex?: number           // Redis
  }
  maxRows?: number             // 드라이버가 limit+1 절단 구현
}

interface CommandResult {
  data: unknown
  executionTimeMs: number
  affected?: number            // 쓰기 작업의 "영향 받은 건수"
  truncated?: boolean          // maxRows 트리거된 절단 플래그
}
```

이 구조는 SQL 채널과 독립: `QueryResult` 는 여전히 SQL 에만 사용. NoSQL 드라이버 `execute()` 는 일률 `SQL_CHANNEL_UNSUPPORTED` throw, 프론트는 dialect = mongo/redis/elasticsearch 일 때 호출 안 함.

---

## 알려진 제약 / Trade-off

| 항목 | 설명 |
|---|---|
| Mongo 24-hex 오판 | 정확히 24자 16진수인 일반 문자열이 드라이버에 의해 ObjectId 로 잘못 판정될 수 있음. "updateOne 항상 0 매치" 수정의 필수 대가. |
| Mongo 비 `_id` 필드 ObjectId 참조 | 드라이버는 키명 `_id` 만 자동 변환; `userId / refId` 등 참조 ObjectId 는 UI 에서 `{ $oid: 'hex' }` marker 사용 또는 `runCommand` 에서 EJSON 수동 구성 필요. |
| Redis MONITOR | 원시 MONITOR 가 전체 연결을 blocking, 요청-응답 채널과 충돌. 실시간 패널은 `INFO stats` 폴링으로 다운그레이드, 각 명령을 보려면 `redis-cli MONITOR` 사용. |
| Redis 명령 파싱 따옴표 없음 | `RedisPane` 상단 명령 에디터가 공백으로 단어 분할, 따옴표 / 이스케이프 처리 안 함. 공백 포함 값은 `NewKey` 팝업 또는 Lua 스크립트 사용. |
| Redis 트리 샘플링 | 타입 그룹 노드는 최대 200 key 샘플링 부착, 스캔 예산 10000. 초과 시 전역 SCAN 검색(`RedisSearchDialog`) 사용. |
| Redis 타입 그룹 count | DBSIZE > 100 000 큰 DB 는 각 타입 count 통계 안 함, 전체 DB SCAN 이 좌측 트리 전개를 지연시키지 않도록. |
| Redis 큰 key MEMORY USAGE | O(N) 샘플링, 큰 DB 스캔이 느리고 CPU 점유, 저피크에 실행하거나 MATCH 로 범위 축소 권장. |
| Redis 가져오기/내보내기 stream | consumer group 미동반; `XINFO / XGROUP` 등은 별도 마이그레이션 필요. |
| Redis 새 key 생성에 stream 미지원 | `XADD` 의미가 너무 무거움, `RedisPane` 명령 입력 박스 / Lua 스크립트에서 보내는 것이 더 편리. |
| ES SQL | `_xpack/sql` 은 비 ANSI, 현재 SQL 채널에 연결 안 함; 필요 시 `op: 'sql'` 진입점 개발. |
| ES `size` 명시적 `maxRows` 오버라이드 | 사용자가 DSL 에 `size` 작성하면 완전히 존중, 추가 `+1` 탐사 안 함; 이 경우 `truncated` 신호 없음. |
| ES truncated 는 search 에만 적용 | `count` / `get` / `getMapping` 은 "컬렉션" 개념 없음, 절단 참여 안 함. |
| 모든 NoSQL 드라이버 의존성 | `mongodb` / `ioredis` / `@elastic/elasticsearch` 는 모두 **선택적 peerDep**, lazy import. 데스크톱 클라이언트 패키징 시 `apps/desktop` 과 함께 설치; 자체 빌드 백엔드는 대응 패키지 `pnpm add` 필요, 아니면 connect/test 단계에서 "드라이버 미설치" throw. |
