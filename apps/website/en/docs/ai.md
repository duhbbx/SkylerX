# AI Assistant

SkylerX wires AI into the product through **multiple independent channels** — not one chat box for everything:

- **Right-side chat panel** (`⌘⇧L`): multi-turn chat + schema injection + one-click SQL insert/run
- **Inline completion**: Copilot-style ghost text in the editor
- **Error diagnosis "Ask AI"**: button on every error dialog / result panel
- **AI Toolbox**: 7 common prompts behind a single dialog
- **Domain-specific dialogs**: health check / insights / table design / reverse / comment writer / translation / mock data

The plumbing shares a single `provider abstraction + 3-tier memory + multi-channel IPC`. This page is all code-facts, no marketing.

## 1. Overview — multi-provider + parallel channels

| Module | File | Role |
|---|---|---|
| `askAi()` / `askAiChat()` | `ai.ts` | Provider dispatch (Anthropic vs OpenAI-compatible), HTTP request (optionally through main-process IPC), cancellable |
| `pXxx()` prompts | `ai-prompts.ts` | 9 domain prompt templates, pure string assembly |
| Inline completion | `aiInline.ts` | Monaco InlineCompletionsProvider, 600ms debounce + AbortController |
| 3-tier memory | `memory.ts` | A profile / B facts / C vector, unified `buildMemorySection()` injection into system prompt |
| Chat panel | `AiChatPanel.vue` | Right sidebar, schema injection + chat-bus subscription |
| Domain dialogs | `Ai*Dialog.vue` | Health check / insights / table design / reverse / comments / mock data |
| Cross-dialect translation | `SqlTranslateDialog.vue` | Plain SQL + stored procedure modes |

All channels go through `askAi*` → IPC fetch → the same provider config. **Switching provider switches every channel at once.**

## 2. Provider configuration

`Settings → AI Provider` supports 5 providers:

| Provider | Protocol | Endpoint |
|---|---|---|
| **Anthropic** | Anthropic Messages | `${baseUrl}/v1/messages`, `x-api-key` auth |
| **OpenAI** | OpenAI Chat | `${baseUrl}/v1/chat/completions`, `Authorization: Bearer` auth |
| **DeepSeek** | OpenAI-compatible | Same |
| **Codex** | OpenAI-compatible | Same |
| **Grok / xAI** | OpenAI-compatible | Same |

The actual code (`ai.ts → askAi`):

```ts
const provider = settings.aiProvider
const cfg = settings.aiProviders[provider]
if (!cfg?.apiKey?.trim()) throw new Error('NO_API_KEY')
if (provider === 'anthropic') return callAnthropic(o, cfg.apiKey.trim(), base, model)
return callOpenAiCompat(o, cfg.apiKey.trim(), base, model)
```

### Custom endpoints

Each provider has its own `baseUrl`:

| Scenario | Config |
|---|---|
| In-house Anthropic proxy | provider=Anthropic, `baseUrl=https://your-proxy.example.com` |
| Private OpenAI-compatible (vLLM / Ollama / one-api) | provider=OpenAI, edit `baseUrl` and `model` |
| DeepSeek direct | `https://api.deepseek.com`, `model=deepseek-chat` |
| Grok direct | `https://api.x.ai`, `model=grok-3-mini` |

### Encrypted API key storage

API keys go through the same OS keychain as DB passwords (macOS Keychain / Windows Credential / GNOME libsecret); `settings.aiProviders[*].apiKey` is encrypted on disk.

### IPC or browser fetch?

Desktop preload exposes `window.api.ai.fetch` (main-process proxy — bypasses browser CORS, supports real cancel). Web falls back to native `fetch`. `ai.ts → aiBridge()` chooses automatically:

```ts
function aiBridge() {
  return globalThis.api?.ai ?? null
}
```

The IPC path chains the renderer's `AbortSignal` to the main process's `ai:cancel` — **actually aborts in-flight requests** (not just discards the response):

```ts
const reqId = `r${Date.now()}-${random}`
init.signal?.addEventListener('abort', () => bridge.cancel?.(reqId))
```

## 3. Right-side chat panel — AiChatPanel

`⌘⇧L` / `Ctrl+Shift+L` toggles visibility. Drag the left edge to resize (`280-800px`); width persists in `skylerx.aiChat.width`.

### Context bar (top)

| Control | Purpose |
|---|---|
| **Connection picker** | Which connection this conversation targets (decides dialect + schema source) |
| **DB / schema picker** | MySQL via `SCHEMATA`; PG via `pg_namespace`; system DBs filtered |
| **Attach schema** checkbox | When on, queries `information_schema.COLUMNS` and builds `tbl(col1 type, col2 type, ...)` strings into the system prompt (capped at 6000 chars) |
| **New chat** / **Clear** | Clear current history, start fresh |

### Schema injection

MySQL via `information_schema.COLUMNS`, PG via `information_schema.columns`. Grouped by table into one `tbl(col1 type, col2 type, ...)` per line. Over 6000 chars gets truncated with `-- (truncated)`. **Only table + column names + types are sent — no rows.**

### Multi-turn

Messages stored in `localStorage` under `skylerx.aiChat.messages` (max 50). Each `send()`:

```ts
const memorySection = await buildMemorySection(text)  // A/B/C memory
const reply = await askAiChat({
  messages: messages.value,           // full history
  dialect: connOf(connId.value)?.dialect,
  schema: useSchema.value ? schemaText.value : undefined,
  memorySection,
  signal: controller.signal,
})
```

After the reply lands, two **background** jobs run:
- `autoExtractFacts({ user, assistant })` — let the LLM extract 1-3 durable facts into tier B
- `rememberVector(\`Q: ${user}\nA: ${assistant}\`)` — vector-embed into tier C

### Thinking timer + stuck hint

`elapsedTimer` increments every second and renders as `12s`. After 20s, a red `maybeStuck` hint is appended. `[Stop]` calls `controller.abort()` (IPC path truly interrupts).

### SQL code-block rendering

The reply is split by ` ``` ` via `splitParts`. SQL chunks get Monaco `editor.colorize` highlighting (cached by content hash in `sqlHtml`); non-SQL chunks use `renderMarkdown` with GFM.

Each SQL block has three buttons below:

| Button | Action |
|---|---|
| `Copy` | `navigator.clipboard.writeText` |
| `Insert as draft` | `emit('insertSql', sql, connId)` → Workspace fills it into QueryPane |
| `▶ Run` | Confirm → `emit('runSql', ...)` → Workspace runs |

### SQL execution badges

After "Run", a badge is attached to the SQL block (persisted in `skylerx.aiChat.runMarks`, max 200):

| State | Display |
|---|---|
| `pending` | ⌛ grey + "10:23 dispatched" |
| `ok` | ✓ green + "10:23 succeeded" |
| `error` | ✗ red + "10:23 failed", hover for the error message |

After QueryPane finishes, `onChatSqlExecuted` broadcasts via the event bus; the chat panel listens and updates badges.

### Provider switcher

The dropdown at the bottom lists **only providers with an apiKey configured** (avoids picking an empty key and getting `NO_API_KEY`); a nearby `⚙` button emits `openSettings` to jump to the AI section.

## 4. Inline completion — aiInline.ts

Monaco InlineCompletionsProvider, Copilot-style ghost text. Registered on SQL editors:

```ts
monaco.languages.registerInlineCompletionsProvider('sql', provider)
```

### Throttling

| Param | Value | Purpose |
|---|---|---|
| `DEBOUNCE_MS` | 600ms | Only fire after a 600ms pause |
| `MAX_PREFIX` | 2000 chars | Take text before the cursor; long suffix truncated |
| Minimum trigger length | 3 chars | `prefix.trim().length < 3` returns empty |

Each new trigger **aborts the previous in-flight request**:

```ts
function clearPending() {
  if (!pending) return
  clearTimeout(pending.timer)
  pending.abort.abort()  // truly cancels the previous request
  pending = null
}
```

No wasted quota, no stale ghost text suddenly popping in.

### Prompt + system hint

```ts
const text = await askAiChat({
  messages: [{ role: 'user', content: buildPrompt(prefix, ctx) }],
  dialect: ctx.dialect,
  extraSystem: 'You are a SQL inline completion engine. Output only the SQL fragment after the cursor, '
             + 'max 1 line, no code fences, no explanation, no repetition of prefix. '
             + 'If context is insufficient, output empty string.',
  signal: abort.signal,
})
```

`buildPrompt` returns: `Dialect: <d>\n\nSchema:\n<hint>\n\nSQL prefix (cursor at end):\n<prefix>`.

### Sanitization (`sanitizeCompletion`)

- Strip ` ```sql ... ``` ` fences (LLMs sometimes wrap)
- Trim duplicate prefix (model repeats the prefix start; strip when it begins with the last 80 chars of prefix)
- Take only the first line of multi-line replies

### Accept / dismiss

| Key | Action |
|---|---|
| `Tab` | Accept |
| `Esc` / `Backspace` / continue typing | Dismiss (Monaco built-in) |

### Master toggle

Reuses `settings.enableCompletion` (same toggle as SQL autocomplete) — disabling stops LLM calls. Failures are silent (inline completion isn't mission-critical; we don't pester the user).

## 5. Error diagnosis "Ask AI"

On execution failure, **every alert dialog / result-area error strip** carries an `✨ Ask AI` button. It triggers `AiChatPanel.askAboutError()`:

```ts
async function askAboutError(p: { connId, connName?, sql, error }) {
  controller?.abort()             // 1) abort current conversation
  for (let i=0; i<30 && running.value; i++) await sleep(50)  // wait for finally
  connId.value = p.connId         // 2) switch to the failing connection
  useSchema.value = true          // 3) force schema context on
  saveToStorage()
  const msg = `${t('aichat.askAiPrompt')}\n\n**Connection**: ${p.connName}\n\n**SQL**\n\`\`\`sql\n${p.sql}\n\`\`\`\n\n**Error**\n\`\`\`\n${p.error}\n\`\`\``
  input.value = msg
  if (switching) await sleep(200) // 4) wait for async schema load
  if (!schemaText.value) await loadSchema()
  await send()
}
```

### Message shape

The user message looks like:

```markdown
Help me debug this SQL error — list likely causes and suggested fixes.

**Connection**: prod-mysql

**SQL**
```sql
INSERT INTO orders(user_id, amount) VALUES (42, 99.9)
```

**Error**
```
ERROR 1452 (23000): Cannot add or update a child row:
a foreign key constraint fails (`shop`.`orders`, CONSTRAINT `fk_user` ...)
```

Combined with the auto-injected schema (`users(id int, ...)` and `orders(...)`), the AI usually pinpoints "`user_id=42` doesn't exist in `users.id`" in seconds.

### chat-bus

This mechanism isn't just for the chat panel — `MockDataDialog` failures route through the same bus to surface `askAi`:

```ts
toast.error(`Execution failed: ${errMsg}`, {
  askAi: { sql: stmt, error: errMsg, connId, connName, dialect },
})
```

`ChatErrorAskEvent` is a unified shape — any code path can attach an "Ask AI" button without re-implementing it.

## 6. AI Toolbox (7 pro prompts)

`🛠 AI Toolbox` or `⌘K → AI Toolbox`. One dialog hosts 7 task types; pick one, click "Let AI do it" → the dialog closes and the prompt is sent to the right-side chat panel.

| Toolbox | Prompt template | Input | Output |
|---|---|---|---|
| **Write migration** | `pMigration` | Target table + requirement | Three separate `\`\`\`sql` blocks: forward ALTER / rollback / data migration |
| **Optimize SQL** | `pOptimizeSql` | Original SQL + optional EXPLAIN | Verdict → rewrite suggestion (SQL block) → index suggestion (SQL block) → expected gain |
| **Read EXPLAIN** | `pExplainAnalysis` | SQL + EXPLAIN text | Plain-English per-node walkthrough + "conclusion + the single biggest win" |
| **Generate test data** | `pTestData` | Table + row count + business context | One `\`\`\`sql` block, INSERT per row, FK-aware |
| **NL → SQL** | `pNl2Sql` | Natural-language description | One `\`\`\`sql` block; ambiguous cases default to the most common reading + flag the ambiguity |
| **Write docs (field meaning)** | `pDataDictDoc` | Table + columns CSV | Markdown 3-column table: field / type / business meaning |
| **Explain table purpose** | `pExplainTable` | Table + columns + FK hints | ≤200-word paragraph + 3 bullets (who inserts / who reads / deletion policy) |

### Toolbox form fields

| Task | Needs table | Needs SQL | Needs EXPLAIN | Extra |
|---|---|---|---|---|
| migration | ✓ | | | Requirement text |
| optimize | | ✓ | (optional) | |
| explain-analysis | | ✓ | ✓ | |
| test-data | ✓ | | | Row count + business context |
| nl2sql | | | | Requirement text |
| doc | ✓ | | | Auto-pulls columns CSV |
| explain-table | ✓ | | | Auto-pulls columns CSV |

On submit, the appropriate `pXxx(...)` builds the prompt → `emit('submit', { prompt, connId, connName, withSchema: true })` → Workspace forwards to `AiChatPanel.askPredefined(...)`, sharing the same pipeline as `askAboutError`.

### Design principles

- Keep the user's original phrasing ("add a column / rename / optimize") in the prompt — don't translate away semantics
- Context (SQL / table name / EXPLAIN text) goes in as Markdown code blocks for the AI to lock onto
- The expected output format is explicit ("give me ALTER + reverse ALTER + data migration") — fewer round-trips
- Strict output (three separate `\`\`\`sql` blocks + H3 headings) — frontend parses by heading reliably

## 7. AI Health Check

Toolbar `❤️ Health Check`. Four auto steps:

1. **Collect metadata** — 3 parallel SQL queries:
   - MySQL: `COLUMNS / STATISTICS / KEY_COLUMN_USAGE` (filter `REFERENCED_TABLE_NAME IS NOT NULL`)
   - PG: `information_schema.columns + pg_index + pg_class` + FK subquery
2. **Serialize** — compact per-table text (columns / indexes / FKs)
3. **Send to AI** — `pHealthCheck` builds the prompt; `askAiChat` is called
4. **Render** — Markdown split by H2 into 6 category cards

### 6 anti-patterns + actual AI instructions (`pHealthCheck`)

| Section | Title | What the AI actually checks |
|---|---|---|
| 1 | Frequently-queried columns lacking indexes | Heuristic: `status / created_at / user_id / type / is_* / *_at` columns commonly used in WHERE/ORDER BY without matching indexes |
| 2 | Names like foreign keys but no FK constraint | `xxx_id` / `xxxId` in tables without an FK to any parent table → list + guess parent |
| 3 | Mixed naming styles | snake_case + camelCase mixed in one table or across the DB → call out and unify |
| 4 | Types chosen too large | `VARCHAR(255)` for short strings / `BIGINT` for small ints / time stored as `VARCHAR` |
| 5 | Core business tables / fields without COMMENT | `user / order / payment / account` tables without COMMENT; pick key fields worth annotating |
| 6 | Soft-delete fields without an index | `deleted_at / is_deleted` not part of any index → suggest `CREATE INDEX` |
| Summary | — | 3-5 ordered "biggest wins for least effort" |

**Strict output format**: must have 6 `## 1.` ~ `## 6.` H2 headings (so the frontend splits cleanly). Even empty sections keep the heading with "No issues found".

### Metadata collection

MySQL uses `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE`; PG uses `information_schema.columns + pg_index/pg_class + table_constraints` with FK subquery. 3 SQLs run in parallel (each capped at ~5000 rows). Prompt metadata is truncated at ~12K chars to keep tokens in check. Supported on MySQL family / PG family only.

## 8. AI Insights — slow SQL + error root cause

Two-tab dialog; you can paste SQL / errors and run without a connection:

### Tab 1: slow SQL optimization

Input: SQL (required) + EXPLAIN (optional) + table stats / row count (optional). AI returns 4 sections: suspected slow points (full scan / no index / Cartesian / implicit cast / stale stats) → recommended indexes (`CREATE INDEX`) → rewrite suggestions (covering index / subquery → JOIN / equivalent rewrite) → estimated improvement.

`extraSystem`: `You are a database performance expert. Be specific and reference actual cost trade-offs.`

### Tab 2: error root cause

Input: error message (required) + context (optional: SQL run / time / user). AI returns: meaning (in plain English) → top 3 likely causes (by probability) → diagnostic steps → fixes.

`extraSystem`: `You are an SRE/DBA. Be practical, prioritize quick mitigation.`

Difference vs the "Ask AI" button: Insights is **manual deep-dive** (paste an error, analyze slowly); the button is **one-click association of current SQL + error + connection schema** into a multi-turn conversation in the chat panel.

## 9. AI Schema Architect

Conversational table designer. Describe the business → AI returns multi-table + FK + index DDL; keep iterating to refine the design.

### System prompt (hard-coded)

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

### Flow

1. Describe the business (`"e-commerce order system: users, products, orders, order items, with coupons"`)
2. `askAiChat({ messages, dialect, extraSystem })` returns Markdown
3. `extractAllSql(reply)` extracts every `\`\`\`sql` block as `sqlBlocks`
4. Ask follow-ups → history flows back → AI returns the **complete** new SQL (system prompt enforces "no diff, full output")

### One-click run

Bottom `▶ Execute latest version`: takes all `sqlBlocks` from the last assistant turn, joins + `splitStatements` + executes each via `client.connections.execute`. Confirmation shows the count of `CREATE` statements + target DB.

## 10. AI Schema Reverse

Given CSV / TSV / JSON sample data → AI infers schema → generates `CREATE TABLE` + optional `INSERT`.

### Input

| Field | Notes |
|---|---|
| Format | CSV / TSV / JSON |
| Table name | Defaults to `inferred_table` |
| Sample data | A few rows is enough; with header is most accurate |
| Also generate INSERT | Checkbox; appends "5. Generate INSERTs for the sample data" to the prompt |

### Prompt skeleton

```text
Based on the CSV sample below, reverse-infer the schema and produce CREATE TABLE SQL for the mysql dialect...

Requirements:
1. Pick the **most appropriate** type per column (length, numeric-only, date-like, enum-like, etc.)
2. Decide which columns should be **primary key** (auto-increment vs business key) and which **must be NOT NULL**
3. Recommend 1-2 **index candidates** (FK-like columns, common filter columns)
4. Table name: `inferred_table`

Sample data:
```
id,name,email,created_at
1,alice,a@x.com,2026-01-01
...
```

Output strictly in this structure:

### Inference notes
(column → type → reasoning, 2-3 sentences)

### CREATE TABLE
```sql
CREATE TABLE ...
```

### Index suggestions
- ...
```

### Edit then run

The returned SQL drops into an editable box on the right (`sqlEdit`); after edits, click `▶ Execute` → confirm → `splitStatements` → execute each.

## 11. AI Comment Writer

Right-click a table `💬 AI write comments` or the toolbar entry. Flow:

1. **Pull columns** — MySQL via `information_schema.COLUMNS` (name / type / nullable / default / comment); PG adds `pg_catalog.col_description` for existing comments
2. **Serialize** — into `columnsCsv`: `- col type [NOT NULL] [DEFAULT ...]`
3. **Send to AI** — `pComment(ctx, columnsCsv)`, requiring a single `\`\`\`json` block as output
4. **Parse** — extract JSON, get `[{ col, comment }]`
5. **Comparison table** — current comment vs AI suggestion, per-row checkbox to accept
6. **Apply** — generate ALTER:
   - MySQL: `ALTER TABLE ... MODIFY <col> <type> [NOT NULL] [DEFAULT ...] COMMENT '...'` (must carry original type / nullable / default through or they're lost)
   - PG: `COMMENT ON COLUMN <table>.<col> IS '...'`

### Prompt constraints (`pComment`)

The prompt enforces: **single `\`\`\`json` code block, no surrounding text**; each item is `{ "col": "column_name", "comment": "one-line business meaning" }`; `col` must be **verbatim** from the schema (case-sensitive, no translation); `comment` ≤ 30 chars, "?(needs review)" when there's not enough info; **list every column** (including `id / created_at` etc.).

Strict output = `parseSuggestion()` reliably extracts ` ```json ... ``` ` via regex, falling back to "whole text as JSON" once if needed. Verbatim `col` ensures alignment with existing state + the ALTER prompt.

### Table-level comments

Beyond columns, you can comment the table itself: MySQL `ALTER TABLE ... COMMENT='...'`, PG `COMMENT ON TABLE ... IS '...'`.

## 12. AI SQL translate — SqlTranslateDialog

`🌐 Translate` entry. Four fixed dialects: `mysql / postgresql / sqlserver / oracle`.

### Two modes

| Mode | Prompt |
|---|---|
| **SQL** (regular queries / DDL) | `pTranslate(from, to, sql)` |
| **Stored procedure / function** | `pTranslateProcedure(from, to, code)` — covers parameter modes / BEGIN-END / DECLARE / exception handling / cursors / DELIMITER |

`extraSystem` switches too:

- SQL: `You are a senior SQL polyglot. Translate SQL across dialects precisely; flag every non-portable construct honestly.`
- Procedure: `You are a senior SP/PL/SQL polyglot. Translate stored procedures faithfully; preserve control flow and explicit error handling.`

### Output constraints (`pTranslate`)

Three sections, strictly:

1. **Translated SQL** — one `\`\`\`sql` block, single statement, no explanation
2. **`### Warnings`** — bullets for **non-portable** points (`MySQL ON DUPLICATE KEY UPDATE` → `PG ON CONFLICT DO UPDATE` — semantically close but behaviorally distinct; `DATETIME vs TIMESTAMP`; `NVARCHAR vs NVARCHAR2`; pagination / auto-increment / string concat / quoting styles; implicit casts; NULL ordering); write "no obvious non-portable constructs" when applicable
3. **`### Suggestions`** — bullets for more idiomatic target-dialect writing (CTE / `LIMIT OFFSET` / `COALESCE` instead of `IFNULL`); write "direct translation is idiomatic enough" when applicable

H3 headings split → frontend renders by section.

### Two-pane display

| Left | Right |
|---|---|
| `extractSql(answer)` extracts the translated SQL → Monaco `colorize` + "Copy" | Strip the first `\`\`\`sql` block, render the rest (warnings + suggestions) → `renderMarkdown` |

### Niceties

- `swapDialects()`: swap from/to in one click — easy round-trip
- **Same-dialect short-circuit**: `from === to` skips the LLM and synthesizes a "no translation needed" reply
- Cancellable in flight via `controller?.abort()`

## 13. AI Mock Data — FK-aware test data

Right-click a table `🧪 Generate test data`. The dialog is mostly a **rule engine** (`mockgen.ts` infers `SemanticKind` from column name + SQL type); AI is involved at two points:

### 13.1 `aiInfer()` — let the AI infer all column semantic kinds in one shot

Button `✨ AI inference`. Prompt is in English (LLMs respond more reliably to English JSON instructions), constraints:

- Pick from the fixed whitelist `SEMANTIC_KINDS` (`auto / integer / decimal / money / name_cn / phone_cn / id_card_cn / address_cn / email / enum / lorem_cn / ...`); other values are invalid
- For Chinese-context columns (`name/姓名 / 手机/phone / 身份证 / 地址`), prefer the `_cn` variants
- **`auto` is disallowed** (produces meaningless random text); pick a specific kind
- `money/price/amount/cost` → `money`; `decimal/float` → `decimal`
- Integer PK columns marked `[PK]` → `integer` (generator auto-increments); `status/state/role` → `enum`; `description/content/remark/note` → `lorem_cn`
- **Output only** a JSON object, e.g. `{"user_id":"integer","name":"name_cn","mobile":"phone_cn"}`

On return, `/\{[\s\S]*\}/` grabs the first JSON object (tolerates surrounding text); each kind validated against the whitelist and column against baseColumns before applying.

### 13.2 "Ask AI" on execution failure

INSERT fails (NOT NULL missing / FK absent / type mismatch) → toast carries an `askAi` button → chat-bus sends stmt + error + connection info to the chat panel.

INSERT generation itself uses `buildMockInserts(dialect, tableRef, columns, count)` (chunked at 100 rows). AI isn't in the generation path — only **kind inference** + **error diagnosis**.

## 14. Three-tier memory — memory.ts

`Settings → AI → Memory` configures it; every conversation auto-injects to the front of the system prompt (LLMs are more sensitive to leading context).

| Tier | Name | Shape | Use | Trigger |
|---|---|---|---|---|
| **A** | `aiCustomInstructions` | Free text | Long-term identity / preferences | Injected fully every turn |
| **B** | `aiFacts` | `{id, text, createdAt}[]` | Structured facts | Injected fully every turn; `aiAutoExtractFacts` on → auto-extract 1-3 each turn |
| **C** | `aiVectorMemories` | `{id, text, vec, createdAt}[]` | Bulk notes | Top-K by cosine similarity (`aiVectorTopK`), only entries with score > 0.3 |

### `buildMemorySection(query)` assembly order

A → B → C into Markdown:

- A: `## User profile & preferences` + free text
- B: `## Known facts` + bullets
- C: `## Relevant past notes` + bullets (needs query + an embedding key; `recallRelevant(query)` returns top-K above 0.3 threshold)

### Embedding config

Tier C needs an embedding endpoint. Configure under `Settings → AI → Memory`:

| Field | Default |
|---|---|
| `aiEmbeddingBaseUrl` | (empty — user fills) |
| `aiEmbeddingApiKey` | (empty) |
| `aiEmbeddingModel` | `text-embedding-3-small` |

Requests go through the OpenAI-compatible `${base}/v1/embeddings`. DeepSeek / Grok are compatible too. Embedding requests time out at 15s so the main chat flow isn't dragged down.

### LRU truncation

Tier C caps at 1000; oldest entries are evicted on overflow:

```ts
if (settings.aiVectorMemories.length > 1000) {
  settings.aiVectorMemories.splice(1000, settings.aiVectorMemories.length - 1000)
}
```

### Auto fact extraction (tier B)

With `aiAutoExtractFacts` on, after each chat turn `autoExtractFacts({ user, assistant })` asks the LLM to look at one round and extract ≤ 3 **durable** facts (`"uses MySQL 8"` / `"works on 'orders' schema"` / `"prefers snake_case"`), skipping ephemeral content; `none` skips, otherwise bullets are parsed and stored. Failures are silent (memory must not block chat). `extraSystem`: `You are a memory curator. Output bullet list of durable facts only.`

## 15. Privacy & security

| Default | Note |
|---|---|
| API key encrypted | OS keychain (macOS / Windows / Linux libsecret) |
| API key never leaves the machine | Desktop IPC connects vendor endpoints directly; Web sends from the browser (change baseUrl to route via your proxy) |
| **No row data sent by default** | "Attach schema" in the chat panel is off by default; even on, **only** `tbl(col1 type, col2 type, ...)` summaries are sent, never rows |
| 6KB schema cap | Auto-truncates with `-- (truncated)` to prevent token blow-ups |
| `request log` auditable | `Settings → AI → Request log` (full on the desktop IPC path) |
| Auto "Ask AI on error" is explicit about what it sends | Full SQL + error code + connection metadata + schema hint |

## 16. Cost control

| Lever | How |
|---|---|
| Switch provider | Dropdown at the bottom of the chat panel / `⌘K → Switch AI provider` |
| Change model | `Settings → AI Provider → <provider> → model` (cheap model for inline / health check, premium for design / translate) |
| Disable inline completion | `Settings → Completion` master toggle — reuses `enableCompletion` (turn off in heavy-token sessions) |
| Disable vector memory | `Settings → AI → Memory → Vector memory` off — every chat calls embedding, off saves tokens |
| Disable auto fact extraction | `aiAutoExtractFacts` off — skips the per-turn extraction request |
| Long vs short context | Tick "Attach schema" only when relevant (don't waste tokens on "explain this SQL syntax" questions) |

---

## 17. Behavior cheatsheet

| When I want to… | Use… |
|---|---|
| Multi-turn chat, iterate while asking | **AiChatPanel** |
| Get inline help while typing | **Inline completion** (`aiInline.ts`) |
| Quickly diagnose an error | **Error "Ask AI" button** (chat-bus) |
| Write a migration / optimize SQL / read EXPLAIN for one table | **AiToolboxDialog** |
| Sweep the whole DB for anti-patterns | **AiHealthCheckDialog** |
| Deep-dive on one slow SQL / error | **AiInsightsDialog** |
| Design multiple tables from a business description | **AiSchemaArchitectDialog** |
| Reverse a schema from sample data | **AiSchemaReverseDialog** |
| Write Chinese comments for all columns + persist | **AiCommentDialog** |
| Translate SQL / stored procedures across dialects | **SqlTranslateDialog** |
| Generate test data (semantic + FK-aware) | **MockDataDialog** |
| Give the AI long-term memory | **memory.ts → A/B/C** |

Pairs well with [Advanced features](./advanced) — when EXPLAIN is confusing, ask AI; when index suggestions are unclear, let AI explain; when migrating Oracle → DM, let AI assess the translation warnings.
