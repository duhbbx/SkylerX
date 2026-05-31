# AI Features — manual QA

Covers: AI chat panel, "Ask AI on error", multi-provider config, settings persistence, inline completion (also see `sql-editor.md`), Toolboxes.

> Run when changing: `packages/ui/src/ai/*`, `apps/desktop/src/main/ipc/ai.ts`, `packages/ui/src/settings.ts` (AI section), `apps/desktop/src/main/db/settingsStore.ts`.

## Setup

- Branch / commit:
- OS:
- AI provider configured: <!-- e.g. DeepSeek, OpenAI -->

## Provider switching

For each shipped provider, configure and verify a round-trip:

| Provider | API base | Auth | Test response | Status |
|---|---|---|:---:|
| **Anthropic (Claude)** | api.anthropic.com | apiKey + version header | replies | [ ] |
| **OpenAI** | api.openai.com | apiKey | replies | [ ] |
| **DeepSeek** | api.deepseek.com | apiKey | replies | [ ] |
| **Codex (OpenAI-compat)** | configurable | apiKey | replies | [ ] |
| **Grok (xAI)** | api.x.ai | apiKey | replies | [ ] |
| **Custom (OpenAI-compat URL)** | user-set | user-set | replies | [ ] |

For each:
- [ ] Settings → AI → choose provider → paste key → Save
- [ ] Open AI chat → ask "what's 2+2" → response within 10s
- [ ] Wrong key → red error in chat with **specific** auth error (not "Unknown")
- [ ] Network down → red error, no UI freeze
- [ ] Evidence per provider: screenshot of chat with response

## Settings persistence (the big regression)

- [ ] Configure provider + apiKey → close app normally → reopen → still configured
- [ ] Configure provider + apiKey → `pkill -9 Electron` → reopen → **still configured** (this was the localStorage→SQLite migration)
- [ ] Inspect SQLite (`~/Library/Application Support/SkylerX/skylerx.db` or equivalent) → `app_settings.value` is base64'd blob, **not raw apiKey**
- [ ] Evidence: paste `SELECT * FROM app_settings;` showing only `enc:...` or `plain:...` prefixed value

### Encryption fallback
- [ ] On Linux without libsecret → settings still save (with `plain:` prefix), warning logged once
- [ ] No silent crash
- [ ] Evidence:

## AI Chat (basic)

- [ ] Open chat panel → text input + history visible
- [ ] Type message → send → response streams in (token by token if provider supports SSE)
- [ ] Markdown rendered (code blocks highlighted, lists, tables)
- [ ] SQL code blocks have a "Run" / "Insert to editor" button
- [ ] Click "Run" → SQL executes against active connection
- [ ] Click "Insert to editor" → SQL replaces / appends in active SQL tab
- [ ] Evidence: screenshot of chat with formatted response

## Cancel

- [ ] Start a long AI response → click "Stop" → request actually cancels (verified by network panel or by no more tokens streaming)
- [ ] No leftover request keeps streaming in background
- [ ] Evidence:

## Multi-turn context

- [ ] Send "I have a table `orders(id, customer_id, total)`" → response acknowledges
- [ ] Send "show top 10 by total" → response uses `orders` from earlier context
- [ ] Clear context (button) → next ask doesn't remember
- [ ] Evidence:

## "Ask AI on error" integration

- [ ] Run a broken SQL (e.g. `SELCT * FORM users`) → error result row
- [ ] Click "Ask AI" → chat opens with prefilled prompt containing:
  - Original SQL
  - Error message
  - Dialect
  - Table list / relevant schema (if known)
- [ ] AI responds with corrected SQL
- [ ] "Apply" inserts corrected SQL into editor
- [ ] Evidence: screenshot of full flow

## Toolboxes (7 built-in)

For each toolbox, verify:

| Toolbox | What it does | Status |
|---|---|:---:|
| **SQL → English** | Explain SQL in plain language | [ ] |
| **English → SQL** | Natural language to SQL | [ ] |
| **Optimize query** | Suggest rewrites + index | [ ] |
| **Schema designer** | Generate CREATE TABLE from description | [ ] |
| **Mock data** | Generate INSERT statements | [ ] |
| **Migration helper** | Translate between dialects | [ ] |
| **Audit / security review** | Find privilege escalation / SQLi risks | [ ] |

For each:
- [ ] Click toolbox button → preset prompt populates chat
- [ ] Provide input (SQL / schema / description) → click Run
- [ ] Response usable (not generic AI fluff)
- [ ] Evidence:

## Inline completion (covered separately in `sql-editor.md` — quick check here)

- [ ] Type partial SQL → ghost-text suggestion within ~500ms
- [ ] Tab accepts, Esc dismisses
- [ ] Evidence:

## Performance / cost

- [ ] Settings → "Show token / cost in chat" → each response shows usage
- [ ] Settings → "Max tokens per request" → respected (truncation message if exceeded)
- [ ] Evidence:

## Privacy

- [ ] Settings → "Send schema context to AI" → toggle off → AI requests don't include CREATE TABLE / column list
- [ ] Verify by intercepting request (DevTools Network panel) — payload should not contain schema info when toggled off
- [ ] Evidence: paste request body before/after toggle

## Cross-platform

- [ ] All 3 OS: chat panel resizable, doesn't overflow
- [ ] All 3 OS: Markdown / code-highlight renders identically
- [ ] All 3 OS: copy code button works (uses Electron clipboard)
- [ ] Evidence:

## Known limitations

- Anthropic SDK browser mode is disabled — main process proxies all requests (avoids renderer CORS issues)
- Streaming for non-SSE providers degrades to "wait for full response" — known
- Local LLM (Ollama) support is in roadmap, not yet shipped
